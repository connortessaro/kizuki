import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, mkdir, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  archiveInsight,
  captureInsight,
  listInsightStates,
  readInsight,
  runInsightCommand,
  runInsightsCommand,
} from "./insightCommands.mjs";
import { readInsightEvents } from "./insights.mjs";

const FIXED = new Date("2026-07-09T20:00:00Z");
const LATER = new Date("2026-07-09T21:00:00Z");
const INPUT = {
  kind: "learning",
  summary: "Per-FC manifests drive backend lookup.",
  context: "The backend resolves one FC at a time.",
  entities: [{ type: "project", name: "staff" }],
  origin: { client: "cursor", locator: "thread-1/turn-2" },
};
const execFileAsync = promisify(execFile);

async function makeVault() {
  return mkdtemp(join(tmpdir(), "kizuki-insight-commands-"));
}

test("capture creates one event and exact retry writes nothing", async () => {
  const vault = await makeVault();
  const first = await captureInsight(vault, INPUT, { now: FIXED });
  const retry = await captureInsight(vault, INPUT, { now: LATER });
  assert.equal(first.disposition, "created");
  assert.equal(first.state.status, "active");
  assert.equal(retry.disposition, "exact-repeat");
  assert.equal(retry.insightId, first.insightId);
  assert.equal((await readInsightEvents(vault)).length, 1);
  assert.deepEqual((await readdir(vault)).sort(), ["insights", "state"]);
  assert.deepEqual(await readdir(join(vault, "state")), []);
});

test("list defaults active and sorts newest first", async () => {
  const vault = await makeVault();
  const older = await captureInsight(vault, INPUT, { now: FIXED });
  const newer = await captureInsight(vault, {
    ...INPUT,
    kind: "question",
    summary: "Who owns validation?",
    origin: { client: "codex" },
  }, { now: LATER });
  const states = await listInsightStates(vault);
  assert.deepEqual(states.map((state) => state.insightId), [newer.insightId, older.insightId]);
  const human = await runInsightsCommand(vault, []);
  assert.ok(human.indexOf(newer.insightId) < human.indexOf(older.insightId));
  assert.match(human, /\[question\] project\/staff codex/);
  assert.match(human, /Who owns validation\?/);
});

test("show and JSON return state plus history", async () => {
  const vault = await makeVault();
  const captured = await captureInsight(vault, INPUT, { now: FIXED });
  const human = await runInsightCommand(vault, ["show", captured.insightId]);
  assert.match(human, /Per-FC manifests drive backend lookup/);
  assert.match(human, /The backend resolves one FC at a time/);
  assert.match(human, /project\/staff/);
  assert.match(human, /thread-1\/turn-2/);

  const json = JSON.parse(
    await runInsightCommand(vault, ["show", captured.insightId, "--json"]),
  );
  assert.equal(json.insightId, captured.insightId);
  assert.equal(json.history.length, 1);
});

test("archive is terminal and filters support active archived all", async () => {
  const vault = await makeVault();
  const captured = await captureInsight(vault, INPUT, { now: FIXED });
  const event = await archiveInsight(vault, {
    insightId: captured.insightId,
    note: "absorbed",
  }, { now: LATER });
  assert.equal(event.to, "archived");
  assert.equal(await runInsightsCommand(vault, []), "No insights.");
  assert.match(
    await runInsightsCommand(vault, ["--status", "archived"]),
    new RegExp(captured.insightId + " archived"),
  );
  assert.equal(JSON.parse(await runInsightsCommand(vault, ["--status", "all", "--json"])).length, 1);
  await assert.rejects(
    archiveInsight(vault, { insightId: captured.insightId }, { now: LATER }),
    /already archived/,
  );
});

test("archive command output names only ID and transition", async () => {
  const vault = await makeVault();
  const captured = await captureInsight(vault, INPUT, { now: FIXED });
  const output = await runInsightCommand(vault, [
    "archive",
    captured.insightId,
    "--note",
    "absorbed",
  ], { now: LATER });
  assert.equal(output, captured.insightId + " active -> archived");
  assert.doesNotMatch(output, /Per-FC|backend|absorbed/);
});

test("commands reject invalid syntax, statuses, IDs, and unknown insights", async () => {
  const vault = await makeVault();
  await assert.rejects(runInsightsCommand(vault, ["--status", "open"]), /invalid insight status/);
  await assert.rejects(runInsightsCommand(vault, ["--wat"]), /unknown option for insights/);
  await assert.rejects(runInsightCommand(vault, []), /unknown insight command/);
  await assert.rejects(runInsightCommand(vault, ["show"]), /requires an ID/);
  await assert.rejects(runInsightCommand(vault, ["show", "bad"]), /invalid insight ID/);
  await assert.rejects(
    runInsightCommand(vault, ["show", "ins_000000000000"]),
    /unknown insight/,
  );
  await assert.rejects(
    runInsightCommand(vault, ["archive", "ins_000000000000", "--note"]),
    /--note requires a value/,
  );
});

test("archive rejects an invalid note before touching filesystem state", async () => {
  const vault = await makeVault();
  await assert.rejects(
    archiveInsight(vault, { insightId: "ins_000000000000", note: " " }),
    /note/,
  );
  assert.deepEqual(await readdir(vault), []);
});

test("capture and archive honor the vault lock", async () => {
  const vault = await makeVault();
  await mkdir(join(vault, "state"), { recursive: true });
  await writeFile(
    join(vault, "state", "vault.lock"),
    JSON.stringify({ pid: 1, tool: "sync", startedAt: "x" }),
  );
  const lock = { waitMs: 20, pollMs: 5, pidAlive: () => true };
  await assert.rejects(captureInsight(vault, INPUT, { now: FIXED, lock }), /vault locked by sync/);

  await writeFile(join(vault, "state", "vault.lock"), "");
  const captured = await captureInsight(vault, INPUT, {
    now: FIXED,
    lock: { pidAlive: () => false },
  });
  await writeFile(
    join(vault, "state", "vault.lock"),
    JSON.stringify({ pid: 1, tool: "sync", startedAt: "x" }),
  );
  await assert.rejects(
    archiveInsight(vault, { insightId: captured.insightId }, { now: LATER, lock }),
    /vault locked by sync/,
  );
});

test("readInsight rejects unknown IDs", async () => {
  const vault = await makeVault();
  await assert.rejects(readInsight(vault, "ins_000000000000"), /unknown insight/);
});

test("kizuki routes the insights list command", async () => {
  const vault = await makeVault();
  const script = join(vault, "kizuki");
  await copyFile(fileURLToPath(new URL("../kizuki", import.meta.url)), script);
  await symlink(dirname(fileURLToPath(import.meta.url)), join(vault, "lib"));
  const { stdout } = await execFileAsync(process.execPath, [script, "insights", "--json"]);
  assert.equal(stdout.trim(), "[]");
});
