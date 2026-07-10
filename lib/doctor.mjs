import { access, constants, mkdir, stat } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { DEFAULT_AGENT_CMD, resolveAgent } from "./agent.mjs";

export const DOCTOR_TIMEOUT_CAP_MS = 30000;
export const REQUIRED_DIRS = ["people", "projects", "teams", "transcripts", "transcripts/processed", "signals", "insights"];

const executable = async (p) => {
  try {
    await access(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

export async function lookupPath(name, envPath = process.env.PATH ?? "") {
  if (name.includes("/")) return (await executable(name)) ? name : null;
  for (const dir of envPath.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (await executable(candidate)) return candidate;
  }
  return null;
}

export async function* runDoctor(vaultDir, {
  makeRunAgent,
  lookupPath: lookup = lookupPath,
  checkOnly = false,
  runSmoke = true,
}) {
  let cmd;
  let timeoutMs;
  let configOk = false;
  try {
    ({ cmd, timeoutMs } = await resolveAgent(vaultDir));
    configOk = true;
    const detail = cmd === DEFAULT_AGENT_CMD ? "using default: codex exec" : `agentCmd: ${cmd.join(" ")}`;
    yield { name: "config", status: "pass", detail };
  } catch (e) {
    yield { name: "config", status: "fail", detail: e.message };
  }

  if (!configOk) {
    yield { name: "agent-binary", status: "skip", detail: "skipped: config invalid" };
  } else {
    const found = await lookup(cmd[0]);
    yield found
      ? { name: "agent-binary", status: "pass", detail: found }
      : { name: "agent-binary", status: "fail", detail: `${cmd[0]} not found on PATH` };
  }

  if (!runSmoke) {
    yield { name: "agent-smoke-test", status: "skip", detail: "skipped: --no-smoke" };
  } else if (!configOk) {
    yield { name: "agent-smoke-test", status: "skip", detail: "skipped: config invalid" };
  } else {
    const budget = Math.min(timeoutMs, DOCTOR_TIMEOUT_CAP_MS);
    const runAgent = makeRunAgent(cmd, budget, { captureStderr: true });
    try {
      const out = await runAgent("Reply with the single word OK and nothing else.");
      yield out.trim()
        ? { name: "agent-smoke-test", status: "pass", detail: `agent replied (${budget}ms budget)` }
        : { name: "agent-smoke-test", status: "fail", detail: "exit 0 but empty output" };
    } catch (e) {
      yield { name: "agent-smoke-test", status: "fail", detail: e.message };
    }
  }

  const created = [];
  const existed = [];
  const missing = [];
  let dirError = null;
  for (const d of REQUIRED_DIRS) {
    const p = join(vaultDir, d);
    let isDir = false;
    try {
      isDir = (await stat(p)).isDirectory();
    } catch (e) {
      if (e.code !== "ENOENT") {
        dirError = `${d}: ${e.message}`;
        break;
      }
    }
    if (isDir) {
      existed.push(d);
    } else if (checkOnly) {
      missing.push(d);
    } else {
      try {
        await mkdir(p, { recursive: true });
        created.push(d);
      } catch (e) {
        dirError = `${d}: ${e.message}`;
        break;
      }
    }
  }
  if (dirError) {
    yield { name: "vault-dirs", status: "fail", detail: dirError };
  } else if (missing.length) {
    yield { name: "vault-dirs", status: "fail", detail: `missing: ${missing.join(", ")} (omit --check-only to create)` };
  } else {
    const prefix = created.length ? `created ${created.join(", ")}; ` : "";
    yield { name: "vault-dirs", status: "pass", detail: `${prefix}${existed.length} already present` };
  }
}
