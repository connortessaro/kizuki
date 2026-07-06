import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const DEFAULT_AGENT_CMD = ["codex", "exec"];
export const DEFAULT_TIMEOUT_MS = 300000;
const CONFIG_FILE = "kizuki.config.json";
const PROMPT_TOKEN = "{prompt}";

export function buildAgentArgv(cmd, prompt) {
  const [file, ...rest] = cmd;
  const args = rest.includes(PROMPT_TOKEN)
    ? rest.map((a) => (a === PROMPT_TOKEN ? prompt : a))
    : [...rest, prompt];
  return { file, args };
}

export async function resolveAgent(vaultDir) {
  let raw;
  try {
    raw = await readFile(join(vaultDir, CONFIG_FILE), "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return { cmd: DEFAULT_AGENT_CMD, timeoutMs: DEFAULT_TIMEOUT_MS };
    throw e;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${CONFIG_FILE} is not valid JSON: ${e.message}`);
  }
  const cmd = data.agentCmd;
  if (!Array.isArray(cmd) || cmd.length === 0 || !cmd.every((a) => typeof a === "string")) {
    throw new Error(`${CONFIG_FILE}: agentCmd must be a non-empty array of strings`);
  }
  const timeoutMs = data.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`${CONFIG_FILE}: timeoutMs must be a positive integer (milliseconds)`);
  }
  return { cmd, timeoutMs };
}

export function makeRunAgent(cmd, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return (prompt) =>
    new Promise((resolve, reject) => {
      const { file, args } = buildAgentArgv(cmd, prompt);
      const child = spawn(file, args, { stdio: ["ignore", "pipe", "inherit"] });
      let out = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`agent timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      child.stdout.on("data", (d) => (out += d));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(out);
        else reject(new Error(`${file} exited with ${code}`));
      });
    });
}
