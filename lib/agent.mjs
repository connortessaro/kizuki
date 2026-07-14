import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { makeRunAgentHttp } from "./agentHttp.mjs";

export const DEFAULT_AGENT_CMD = ["codex", "exec"];
export const DEFAULT_TIMEOUT_MS = 300000;
const CONFIG_FILE = "kizuki.config.json";
const PROMPT_TOKEN = "{prompt}";

export const AGENT_PRESETS = Object.freeze({
  codex: ["codex", "exec"],
  claude: ["claude", "-p"],
  gemini: ["gemini", "-p"],
  opencode: ["opencode", "run"],
});

const HTTP_FIELDS = ["baseUrl", "model", "apiKeyEnv"];

function validateAgentHttp(http) {
  if (!http || typeof http !== "object" || Array.isArray(http)) {
    throw new Error(`${CONFIG_FILE}: agentHttp must be an object`);
  }
  for (const key of Object.keys(http)) {
    if (!HTTP_FIELDS.includes(key)) {
      throw new Error(`${CONFIG_FILE}: unknown agentHttp field ${JSON.stringify(key)}`);
    }
  }
  for (const key of HTTP_FIELDS) {
    if (typeof http[key] !== "string" || http[key].trim() === "") {
      throw new Error(`${CONFIG_FILE}: agentHttp.${key} must be a non-empty string`);
    }
  }
  return {
    baseUrl: http.baseUrl.replace(/\/+$/, ""),
    model: http.model,
    apiKeyEnv: http.apiKeyEnv,
  };
}

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
    if (e.code === "ENOENT") return { kind: "cmd", cmd: DEFAULT_AGENT_CMD, timeoutMs: DEFAULT_TIMEOUT_MS };
    throw e;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${CONFIG_FILE} is not valid JSON: ${e.message}`);
  }
  const timeoutMs = data.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`${CONFIG_FILE}: timeoutMs must be a positive integer (milliseconds)`);
  }
  if (data.agentCmd !== undefined && data.agentHttp !== undefined) {
    throw new Error(`${CONFIG_FILE}: set exactly one of agentCmd or agentHttp`);
  }
  if (data.agentHttp !== undefined) {
    return { kind: "http", http: validateAgentHttp(data.agentHttp), timeoutMs };
  }
  const cmd = data.agentCmd;
  if (!Array.isArray(cmd) || cmd.length === 0 || !cmd.every((a) => typeof a === "string")) {
    throw new Error(`${CONFIG_FILE}: agentCmd must be a non-empty array of strings`);
  }
  return { kind: "cmd", cmd, timeoutMs };
}

export function makeRunAgent(cmd, timeoutMs = DEFAULT_TIMEOUT_MS, { captureStderr = false } = {}) {
  return (prompt) =>
    new Promise((resolve, reject) => {
      const { file, args } = buildAgentArgv(cmd, prompt);
      const child = spawn(file, args, {
        stdio: ["ignore", "pipe", captureStderr ? "pipe" : "inherit"],
      });
      let out = "";
      let err = "";
      const fail = (msg) => {
        const tail = err.trim().split("\n").slice(-3).join("\n").trim();
        reject(new Error(tail ? `${msg}: ${tail}` : msg));
      };
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        fail(`agent timed out after ${timeoutMs}ms`);
      }, timeoutMs);
      child.stdout.on("data", (d) => (out += d));
      if (captureStderr) child.stderr.on("data", (d) => (err += d));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(out);
        else fail(`${file} exited with ${code}`);
      });
    });
}

export function makeConfiguredRunAgent(resolved, options = {}) {
  if (resolved.kind === "http") return makeRunAgentHttp(resolved.http, resolved.timeoutMs, options.http ?? {});
  return makeRunAgent(resolved.cmd, resolved.timeoutMs, options.cmd ?? {});
}
