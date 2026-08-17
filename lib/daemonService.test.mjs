import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listenApiServer } from "../server/api.mjs";
import {
  LAUNCHD_LABEL,
  SYSTEMD_SERVICE,
  launchdPlistPath,
  systemdUnitPath,
  launchdPlist,
  systemdUnit,
  installDaemon,
  uninstallDaemon,
  restartDaemon,
  daemonStatus,
} from "./daemonService.mjs";

const TOKEN = "test-token-that-is-at-least-32-characters";

async function makeVault() {
  const vaultDir = await mkdtemp(join(tmpdir(), "kizuki-daemon-service-"));
  await mkdir(join(vaultDir, "state"), { recursive: true });
  return vaultDir;
}

test("launchd plist starts server at login and restarts it", () => {
  const xml = launchdPlist({
    nodePath: "/usr/bin/node",
    serverPath: "/repo/server/cli.mjs",
    vaultDir: "/repo",
  });
  assert.match(xml, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(xml, /<key>KeepAlive<\/key><true\/>/);
  assert.match(xml, /<string>--vault<\/string>\s*<string>\/repo<\/string>/);
  assert.doesNotMatch(xml, /token/);
});

test("launchd plist uses the daemon label by default", () => {
  const xml = launchdPlist({ nodePath: "/usr/bin/node", serverPath: "/repo/server/cli.mjs", vaultDir: "/repo" });
  assert.match(xml, new RegExp(`<string>${LAUNCHD_LABEL}</string>`));
});

test("systemd unit runs as a user service", () => {
  const unit = systemdUnit({ nodePath: "/usr/bin/node", serverPath: "/repo/server/cli.mjs", vaultDir: "/repo" });
  assert.match(unit, /^\[Unit\]/);
  assert.match(unit, /Restart=on-failure/);
  assert.match(unit, /WantedBy=default\.target/);
  assert.match(unit, /ExecStart=\/usr\/bin\/node \/repo\/server\/cli\.mjs --vault \/repo/);
  assert.doesNotMatch(unit, /token/);
});

test("launchdPlistPath and systemdUnitPath resolve under the given home", () => {
  assert.equal(launchdPlistPath("/home/me"), `/home/me/Library/LaunchAgents/${LAUNCHD_LABEL}.plist`);
  assert.equal(systemdUnitPath("/home/me"), `/home/me/.config/systemd/user/${SYSTEMD_SERVICE}`);
});

test("installDaemon writes a launchd plist and loads it on darwin", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-daemon-svc-"));
  const calls = [];
  const written = {};
  const result = await installDaemon({
    vaultDir: "/vault",
    repoDir: "/repo",
    platform: "darwin",
    home: dir,
    nodePath: "/usr/bin/node",
    mkdir: async (path, options) => calls.push(["mkdir", path, options]),
    writeFile: async (path, content) => { written[path] = content; },
    exec: async (file, args) => calls.push([file, ...args]),
  });
  const path = launchdPlistPath(dir);
  assert.equal(result.platform, "darwin");
  assert.equal(result.path, path);
  assert.match(written[path], /\/repo\/server\/cli\.mjs/);
  assert.match(written[path], /<string>--vault<\/string>\s*<string>\/vault<\/string>/);
  assert.deepEqual(calls, [
    ["mkdir", join(dir, "Library", "LaunchAgents"), { recursive: true }],
    ["launchctl", "load", path],
  ]);
});

test("installDaemon writes a systemd unit and enables it on linux", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-daemon-svc-"));
  const calls = [];
  const written = {};
  const result = await installDaemon({
    vaultDir: "/vault",
    repoDir: "/repo",
    platform: "linux",
    home: dir,
    nodePath: "/usr/bin/node",
    mkdir: async (path, options) => calls.push(["mkdir", path, options]),
    writeFile: async (path, content) => { written[path] = content; },
    exec: async (file, args) => calls.push([file, ...args]),
  });
  const path = systemdUnitPath(dir);
  assert.equal(result.platform, "linux");
  assert.equal(result.path, path);
  assert.match(written[path], /ExecStart=\/usr\/bin\/node \/repo\/server\/cli\.mjs --vault \/vault/);
  assert.deepEqual(calls, [
    ["mkdir", join(dir, ".config", "systemd", "user"), { recursive: true }],
    ["systemctl", "--user", "daemon-reload"],
    ["systemctl", "--user", "enable", "--now", SYSTEMD_SERVICE],
  ]);
});

test("installDaemon rejects unsupported platforms", async () => {
  await assert.rejects(
    installDaemon({ vaultDir: "/vault", repoDir: "/repo", platform: "win32", home: "/home/me" }),
    /kizuki daemon requires macOS or Linux/,
  );
});

test("uninstallDaemon unloads and removes the darwin plist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-daemon-svc-"));
  const calls = [];
  const result = await uninstallDaemon({
    platform: "darwin",
    home: dir,
    exec: async (file, args) => calls.push([file, ...args]),
    rm: async (path, options) => calls.push(["rm", path, options]),
  });
  const path = launchdPlistPath(dir);
  assert.equal(result.path, path);
  assert.deepEqual(calls, [
    ["launchctl", "unload", path],
    ["rm", path, { force: true }],
  ]);
});

test("uninstallDaemon disables and removes the systemd unit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-daemon-svc-"));
  const calls = [];
  const result = await uninstallDaemon({
    platform: "linux",
    home: dir,
    exec: async (file, args) => calls.push([file, ...args]),
    rm: async (path, options) => calls.push(["rm", path, options]),
  });
  const path = systemdUnitPath(dir);
  assert.equal(result.path, path);
  assert.deepEqual(calls, [
    ["systemctl", "--user", "disable", "--now", SYSTEMD_SERVICE],
    ["rm", path, { force: true }],
  ]);
});

test("restartDaemon reloads the darwin job", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-daemon-svc-"));
  const calls = [];
  const result = await restartDaemon({
    platform: "darwin",
    home: dir,
    exec: async (file, args) => calls.push([file, ...args]),
  });
  const path = launchdPlistPath(dir);
  assert.equal(result.path, path);
  assert.deepEqual(calls, [
    ["launchctl", "unload", path],
    ["launchctl", "load", path],
  ]);
});

test("restartDaemon restarts the systemd unit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-daemon-svc-"));
  const calls = [];
  await restartDaemon({
    platform: "linux",
    home: dir,
    exec: async (file, args) => calls.push([file, ...args]),
  });
  assert.deepEqual(calls, [["systemctl", "--user", "restart", SYSTEMD_SERVICE]]);
});

test("daemonStatus reports a real running server as up", async (t) => {
  const running = await listenApiServer({ host: "127.0.0.1", port: 0, vaultDir: await makeVault(), token: TOKEN });
  t.after(() => running.close());
  const status = await daemonStatus({
    vaultDir: "irrelevant",
    readDaemonConfig: async () => ({ host: "127.0.0.1", port: running.port, token: TOKEN }),
  });
  assert.deepEqual(status, { running: true, url: `http://127.0.0.1:${running.port}`, detail: "ok" });
});

test("daemonStatus reports connection refusal as stopped", async () => {
  const status = await daemonStatus({
    vaultDir: "irrelevant",
    readDaemonConfig: async () => ({ host: "127.0.0.1", port: 4247, token: TOKEN }),
    fetchImpl: async () => {
      const error = new Error("fetch failed");
      error.cause = { code: "ECONNREFUSED" };
      throw error;
    },
  });
  assert.deepEqual(status, { running: false, url: "http://127.0.0.1:4247", detail: "connection refused" });
});

test("daemonStatus fails loudly when the health probe never resolves", async () => {
  const status = await daemonStatus({
    vaultDir: "irrelevant",
    readDaemonConfig: async () => ({ host: "127.0.0.1", port: 4247, token: TOKEN }),
    fetchImpl: () => new Promise(() => {}),
    timeoutMs: 20,
  });
  assert.deepEqual(status, {
    running: false,
    url: "http://127.0.0.1:4247",
    detail: "health probe timed out after 20ms",
  });
});

test("daemonStatus rethrows config errors", async () => {
  await assert.rejects(
    daemonStatus({
      vaultDir: "irrelevant",
      readDaemonConfig: async () => {
        throw new Error("daemon config not found; run `kizuki init` or `kizuki daemon install`");
      },
    }),
    /daemon config not found/,
  );
});

test("daemonStatus rethrows unexpected protocol errors", async () => {
  await assert.rejects(
    daemonStatus({
      vaultDir: "irrelevant",
      readDaemonConfig: async () => ({ host: "127.0.0.1", port: 4247, token: TOKEN }),
      fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }),
    }),
    /daemon health check failed with status 401/,
  );
});

test("daemonStatus never includes the token in its result", async () => {
  const status = await daemonStatus({
    vaultDir: "irrelevant",
    readDaemonConfig: async () => ({ host: "127.0.0.1", port: 4247, token: TOKEN }),
    fetchImpl: async () => {
      const error = new Error("fetch failed");
      error.cause = { code: "ECONNREFUSED" };
      throw error;
    },
  });
  assert.doesNotMatch(JSON.stringify(status), new RegExp(TOKEN));
});
