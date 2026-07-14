import { randomBytes as defaultRandomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const DAEMON_CONFIG_VERSION = 1;
export const DEFAULT_DAEMON_HOST = "127.0.0.1";
export const DEFAULT_DAEMON_PORT = 4247;

const CONFIG_FIELDS = new Set(["version", "host", "port", "token"]);

export const daemonConfigPath = (vaultDir) => join(vaultDir, "state", "daemon.json");

function assertObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("daemon config must be an object");
  }
}

export function validateDaemonConfig(config) {
  assertObject(config);
  for (const field of Object.keys(config)) {
    if (!CONFIG_FIELDS.has(field)) throw new Error(`unknown daemon config field ${field}`);
  }
  if (config.version !== DAEMON_CONFIG_VERSION) {
    throw new Error(`unsupported daemon config version ${JSON.stringify(config.version)}`);
  }
  if (config.host !== DEFAULT_DAEMON_HOST) {
    throw new Error(`daemon host must be ${DEFAULT_DAEMON_HOST}`);
  }
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65_535) {
    throw new Error("daemon port must be an integer from 1024 to 65535");
  }
  if (typeof config.token !== "string" || config.token.length < 32) {
    throw new Error("daemon token must be at least 32 characters");
  }
  return config;
}

async function readConfigFile(vaultDir) {
  let raw;
  try {
    raw = await readFile(daemonConfigPath(vaultDir), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("daemon config is not valid JSON");
  }
  return validateDaemonConfig(parsed);
}

export async function readDaemonConfig(vaultDir) {
  const config = await readConfigFile(vaultDir);
  if (config === null) throw new Error("daemon config not found; run `kizuki init` or `kizuki daemon install`");
  return config;
}

export async function ensureDaemonConfig(vaultDir, {
  randomBytes = defaultRandomBytes,
  host = DEFAULT_DAEMON_HOST,
  port = DEFAULT_DAEMON_PORT,
} = {}) {
  const existing = await readConfigFile(vaultDir);
  if (existing !== null) return existing;

  const bytes = randomBytes(32);
  if (!Buffer.isBuffer(bytes) || bytes.length !== 32) {
    throw new Error("daemon randomBytes must return a 32-byte Buffer");
  }
  const config = validateDaemonConfig({
    version: DAEMON_CONFIG_VERSION,
    host,
    port,
    token: bytes.toString("base64url"),
  });
  await mkdir(join(vaultDir, "state"), { recursive: true });
  try {
    await writeFile(
      daemonConfigPath(vaultDir),
      `${JSON.stringify(config, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
    return config;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    return readDaemonConfig(vaultDir);
  }
}
