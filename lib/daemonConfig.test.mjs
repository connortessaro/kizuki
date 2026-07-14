import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DAEMON_CONFIG_VERSION,
  DEFAULT_DAEMON_HOST,
  DEFAULT_DAEMON_PORT,
  daemonConfigPath,
  ensureDaemonConfig,
  readDaemonConfig,
  validateDaemonConfig,
} from "./daemonConfig.mjs";

const TOKEN = Buffer.alloc(32, 7).toString("base64url");
const VALID = Object.freeze({
  version: 1,
  host: "127.0.0.1",
  port: 4247,
  token: TOKEN,
});

async function makeVault() {
  return mkdtemp(join(tmpdir(), "kizuki-daemon-config-"));
}

test("exports fixed local daemon defaults", () => {
  assert.equal(DAEMON_CONFIG_VERSION, 1);
  assert.equal(DEFAULT_DAEMON_HOST, "127.0.0.1");
  assert.equal(DEFAULT_DAEMON_PORT, 4247);
});

test("ensureDaemonConfig creates loopback config with private mode", async () => {
  const vaultDir = await makeVault();
  const config = await ensureDaemonConfig(vaultDir, {
    randomBytes: () => Buffer.alloc(32, 7),
  });
  assert.deepEqual(config, VALID);
  assert.equal((await stat(daemonConfigPath(vaultDir))).mode & 0o777, 0o600);
  assert.equal(await readFile(daemonConfigPath(vaultDir), "utf8"), `${JSON.stringify(VALID, null, 2)}\n`);
});

test("ensureDaemonConfig preserves an existing token", async () => {
  const vaultDir = await makeVault();
  const first = await ensureDaemonConfig(vaultDir, { randomBytes: () => Buffer.alloc(32, 7) });
  const second = await ensureDaemonConfig(vaultDir, {
    randomBytes: () => {
      throw new Error("must not generate again");
    },
  });
  assert.deepEqual(second, first);
});

test("readDaemonConfig rejects missing or malformed config", async () => {
  const vaultDir = await makeVault();
  await assert.rejects(readDaemonConfig(vaultDir), /daemon config not found/);
  await mkdir(join(vaultDir, "state"), { recursive: true });
  await writeFile(daemonConfigPath(vaultDir), "{", "utf8");
  await assert.rejects(readDaemonConfig(vaultDir), /daemon config is not valid JSON/);
});

test("validateDaemonConfig rejects unsafe fields", () => {
  const cases = [
    [{ ...VALID, host: "0.0.0.0" }, /host must be 127\.0\.0\.1/],
    [{ ...VALID, port: 80 }, /port must be an integer from 1024 to 65535/],
    [{ ...VALID, port: 65536 }, /port must be an integer from 1024 to 65535/],
    [{ ...VALID, token: "short" }, /token must be at least 32 characters/],
    [{ ...VALID, version: 2 }, /unsupported daemon config version/],
    [{ ...VALID, extra: true }, /unknown daemon config field extra/],
  ];
  for (const [value, pattern] of cases) assert.throws(() => validateDaemonConfig(value), pattern);
});

test("validation errors never include the token", () => {
  const secret = "this-token-must-never-appear-in-an-error";
  assert.throws(
    () => validateDaemonConfig({ ...VALID, token: secret, host: "example.com" }),
    (error) => {
      assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    },
  );
});
