import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ASK_PORT,
  askConfigPath,
  askService,
  formatAnswer,
  formatQuality,
  qualityReport,
  runAskCommand,
  validateAskConfig,
} from "./askCommands.mjs";

const CONFIG = { version: 1, host: "127.0.0.1", port: DEFAULT_ASK_PORT, token: "t".repeat(32) };

const readConfig = async () => JSON.stringify(CONFIG);
const missingConfig = async () => {
  const error = new Error("ENOENT");
  error.code = "ENOENT";
  throw error;
};

const PAYLOAD = {
  route: "hybrid",
  answer: "The warehouse returns one row: commits=236.",
  contains_synthetic: true,
  sql: {
    executed_sql: 'SELECT "commits" FROM "v_repo_activity"',
    error: null,
    columns: ["commits"],
    rows: [[236]],
    row_count: 1,
  },
  citations: [
    { title: "harbor working session", source_path: "corpus/synthetic/a.md", is_synthetic: true, score: 0.83 },
  ],
};

function fetchReturning(payload, { ok = true, status = 200 } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok,
      status,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    };
  };
  return { impl, calls };
}

test("askConfigPath points at the vault state directory", () => {
  assert.equal(askConfigPath("/vault"), "/vault/state/ask.json");
});

test("validateAskConfig accepts a well-formed config", () => {
  assert.deepEqual(validateAskConfig({ ...CONFIG }), CONFIG);
});

test("validateAskConfig refuses a non-loopback host", () => {
  assert.throws(() => validateAskConfig({ ...CONFIG, host: "0.0.0.0" }), /ask host must be 127\.0\.0\.1/);
});

test("validateAskConfig refuses a short token", () => {
  assert.throws(() => validateAskConfig({ ...CONFIG, token: "short" }), /at least 32 characters/);
});

test("validateAskConfig refuses a privileged or out-of-range port", () => {
  assert.throws(() => validateAskConfig({ ...CONFIG, port: 80 }), /ask port must be/);
  assert.throws(() => validateAskConfig({ ...CONFIG, port: 70_000 }), /ask port must be/);
});

test("validateAskConfig refuses an unknown field", () => {
  assert.throws(() => validateAskConfig({ ...CONFIG, extra: 1 }), /unknown ask config field/);
});

test("a missing config explains how to start the service", async () => {
  await assert.rejects(
    () => askService("/vault", "q", { read: missingConfig }),
    /ask service is not configured/,
  );
});

test("askService sends the bearer token to the loopback service", async () => {
  const { impl, calls } = fetchReturning(PAYLOAD);
  await askService("/vault", "why did harbor spike?", { fetchImpl: impl, read: readConfig });
  assert.equal(calls[0].url, `http://127.0.0.1:${DEFAULT_ASK_PORT}/v1/ask`);
  assert.equal(calls[0].init.headers.authorization, `Bearer ${CONFIG.token}`);
  assert.deepEqual(JSON.parse(calls[0].init.body), { question: "why did harbor spike?", k: 6 });
});

test("a connection failure names the address rather than leaking a stack", async () => {
  const impl = async () => {
    throw new Error("ECONNREFUSED");
  };
  await assert.rejects(
    () => askService("/vault", "q", { fetchImpl: impl, read: readConfig }),
    /ask service is not reachable at http:\/\/127\.0\.0\.1:4248\/v1\/ask/,
  );
});

test("a non-2xx response surfaces the status", async () => {
  const { impl } = fetchReturning({ detail: "nope" }, { ok: false, status: 401 });
  await assert.rejects(
    () => askService("/vault", "q", { fetchImpl: impl, read: readConfig }),
    /ask service returned 401/,
  );
});

test("formatAnswer shows the executed SQL, the rows and the sources", () => {
  const text = formatAnswer(PAYLOAD);
  assert.match(text, /SELECT "commits" FROM "v_repo_activity"/);
  assert.match(text, /commits\n236/);
  assert.match(text, /\[synthetic\] harbor working session/);
});

test("formatAnswer warns when any source is fabricated", () => {
  assert.match(formatAnswer(PAYLOAD), /generated demo records, not real meetings/);
});

test("formatAnswer stays quiet about synthetic sources when there are none", () => {
  const real = { ...PAYLOAD, contains_synthetic: false, citations: [] };
  assert.doesNotMatch(formatAnswer(real), /generated demo records/);
});

test("formatAnswer reports a SQL problem instead of hiding it", () => {
  const failed = {
    ...PAYLOAD,
    sql: { ...PAYLOAD.sql, executed_sql: null, error: "rejected by guard: forbidden function: glob" },
  };
  assert.match(formatAnswer(failed), /SQL problem: rejected by guard/);
});

test("runAskCommand joins a multi-word question", async () => {
  const { impl, calls } = fetchReturning(PAYLOAD);
  await runAskCommand(["why", "did", "harbor", "spike"], "/vault", {
    fetchImpl: impl,
    read: readConfig,
  });
  assert.equal(JSON.parse(calls[0].init.body).question, "why did harbor spike");
});

test("runAskCommand honours --k without treating its value as a word", async () => {
  const { impl, calls } = fetchReturning(PAYLOAD);
  await runAskCommand(["--k", "3", "why", "did", "harbor", "spike"], "/vault", {
    fetchImpl: impl,
    read: readConfig,
  });
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.k, 3);
  assert.equal(body.question, "why did harbor spike");
});

test("runAskCommand rejects an out-of-range --k", async () => {
  await assert.rejects(
    () => runAskCommand(["--k", "99", "q"], "/vault", { read: readConfig }),
    /--k must be an integer from 1 to 20/,
  );
});

test("runAskCommand requires a question", async () => {
  await assert.rejects(() => runAskCommand([], "/vault", { read: readConfig }), /usage: kizuki ask/);
  await assert.rejects(
    () => runAskCommand(["--json"], "/vault", { read: readConfig }),
    /usage: kizuki ask/,
  );
});

test("runAskCommand returns raw JSON when asked", async () => {
  const { impl } = fetchReturning(PAYLOAD);
  const out = await runAskCommand(["q"], "/vault", { fetchImpl: impl, read: readConfig, json: true });
  assert.deepEqual(JSON.parse(out), PAYLOAD);
});

const QUALITY = {
  summary: [
    { check_name: "orphan_head", severity: "error", issues: 1, total_magnitude: 1 },
    { check_name: "identity_alias", severity: "warn", issues: 5, total_magnitude: 13 },
    { check_name: "bot_author", severity: "info", issues: 5, total_magnitude: 39 },
  ],
  issues: [],
};

test("qualityReport authenticates against the quality endpoint", async () => {
  const { impl, calls } = fetchReturning(QUALITY);
  const report = await qualityReport("/vault", { fetchImpl: impl, read: readConfig });
  assert.equal(calls[0].url, `http://127.0.0.1:${DEFAULT_ASK_PORT}/v1/quality`);
  assert.equal(calls[0].init.headers.authorization, `Bearer ${CONFIG.token}`);
  assert.equal(report.summary.length, 3);
});

test("qualityReport names the address when the service is down", async () => {
  const impl = async () => {
    throw new Error("ECONNREFUSED");
  };
  await assert.rejects(
    () => qualityReport("/vault", { fetchImpl: impl, read: readConfig }),
    /ask service is not reachable/,
  );
});

test("qualityReport surfaces a non-2xx status", async () => {
  const { impl } = fetchReturning(QUALITY, { ok: false, status: 500 });
  await assert.rejects(
    () => qualityReport("/vault", { fetchImpl: impl, read: readConfig }),
    /ask service returned 500/,
  );
});

test("formatQuality lists every check and counts the errors", () => {
  const text = formatQuality(QUALITY);
  assert.match(text, /orphan_head/);
  assert.match(text, /identity_alias/);
  assert.match(text, /1 check\(s\) at error severity/);
});

test("formatQuality says so plainly when nothing is wrong", () => {
  assert.equal(formatQuality({ summary: [], issues: [] }), "No data-quality issues detected.");
});

test("formatQuality reports no errors when every check is warn or info", () => {
  const clean = { summary: QUALITY.summary.filter((r) => r.severity !== "error"), issues: [] };
  assert.match(formatQuality(clean), /No errors\./);
});
