import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const DEFAULT_ASK_HOST = "127.0.0.1";
export const DEFAULT_ASK_PORT = 4248;
const CONFIG_FIELDS = new Set(["version", "host", "port", "token"]);

export const askConfigPath = (vaultDir) => join(vaultDir, "state", "ask.json");

export function validateAskConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("ask config must be an object");
  }
  for (const field of Object.keys(config)) {
    if (!CONFIG_FIELDS.has(field)) throw new Error(`unknown ask config field ${field}`);
  }
  if (config.version !== 1) throw new Error(`unsupported ask config version ${JSON.stringify(config.version)}`);
  if (config.host !== DEFAULT_ASK_HOST) throw new Error(`ask host must be ${DEFAULT_ASK_HOST}`);
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65_535) {
    throw new Error("ask port must be an integer from 1024 to 65535");
  }
  if (typeof config.token !== "string" || config.token.length < 32) {
    throw new Error("ask token must be at least 32 characters");
  }
  return config;
}

export async function readAskConfig(vaultDir, { read = readFile } = {}) {
  let raw;
  try {
    raw = await read(askConfigPath(vaultDir), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(
        "ask service is not configured; start it with `uv run uvicorn kizuki_analytics.ask.app:app --port 4248` in analytics/",
      );
    }
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("ask config is not valid JSON");
  }
  return validateAskConfig(parsed);
}

export async function askService(vaultDir, question, {
  fetchImpl = fetch,
  read = readFile,
  k = 6,
  timeoutMs = 60_000,
} = {}) {
  const config = await readAskConfig(vaultDir, { read });
  const url = `http://${config.host}:${config.port}/v1/ask`;
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.token}` },
      body: JSON.stringify({ question, k }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(`ask service is not reachable at ${url}: ${error.message}`);
  }
  if (!response.ok) {
    throw new Error(`ask service returned ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  return response.json();
}

export async function qualityReport(vaultDir, {
  fetchImpl = fetch,
  read = readFile,
  timeoutMs = 30_000,
} = {}) {
  const config = await readAskConfig(vaultDir, { read });
  const url = `http://${config.host}:${config.port}/v1/quality`;
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(`ask service is not reachable at ${url}: ${error.message}`);
  }
  if (!response.ok) throw new Error(`ask service returned ${response.status}`);
  return response.json();
}

export function formatQuality(payload) {
  if (!payload.summary.length) return "No data-quality issues detected.";
  const lines = ["check                          severity  issues  magnitude"];
  for (const row of payload.summary) {
    lines.push(
      row.check_name.padEnd(30) +
        " " +
        row.severity.padEnd(9) +
        " " +
        String(row.issues).padStart(6) +
        " " +
        String(row.total_magnitude).padStart(10),
    );
  }
  const errors = payload.summary.filter((row) => row.severity === "error");
  lines.push("", errors.length ? `${errors.length} check(s) at error severity.` : "No errors.");
  return lines.join("\n");
}

export function formatAnswer(payload) {
  const lines = [payload.answer, ""];
  if (payload.sql?.executed_sql) {
    lines.push("SQL:", payload.sql.executed_sql, "");
    if (payload.sql.row_count) {
      lines.push(payload.sql.columns.join(" | "));
      for (const row of payload.sql.rows.slice(0, 10)) lines.push(row.join(" | "));
      if (payload.sql.row_count > 10) lines.push(`… ${payload.sql.row_count - 10} more rows`);
      lines.push("");
    }
  }
  if (payload.sql?.error) lines.push(`SQL problem: ${payload.sql.error}`, "");
  if (payload.citations?.length) {
    lines.push("Sources:");
    for (const c of payload.citations) {
      lines.push(`  [${c.is_synthetic ? "synthetic" : "real"}] ${c.title} (${c.score}) — ${c.source_path}`);
    }
  }
  if (payload.contains_synthetic) {
    lines.push("", "Note: some sources above are generated demo records, not real meetings.");
  }
  return lines.join("\n");
}

export async function runAskCommand(argv, vaultDir, options = {}) {
  const kAt = argv.indexOf("--k");
  const k = kAt === -1 ? 6 : Number.parseInt(argv[kAt + 1], 10);
  if (!Number.isInteger(k) || k < 1 || k > 20) throw new Error("--k must be an integer from 1 to 20");
  const question = argv
    .filter((arg, index) => !arg.startsWith("--") && index !== (kAt === -1 ? -1 : kAt + 1))
    .join(" ")
    .trim();
  if (!question) throw new Error('usage: kizuki ask "<question>" [--k n]');
  const payload = await askService(vaultDir, question, { ...options, k });
  return options.json ? JSON.stringify(payload, null, 2) : formatAnswer(payload);
}
