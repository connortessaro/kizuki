import test from "node:test";
import assert from "node:assert/strict";
import { runDaemonCommand } from "./daemonCommands.mjs";

const TOKEN = "x".repeat(32);

test("daemon status never prints token", async () => {
  const text = await runDaemonCommand("/vault", "/repo", ["status"], {
    status: async () => ({ running: true, url: "http://127.0.0.1:4247", detail: "ok" }),
  });
  assert.equal(text, "Kizuki daemon running at http://127.0.0.1:4247");
});

test("daemon status reports a clear message when stopped", async () => {
  const text = await runDaemonCommand("/vault", "/repo", ["status"], {
    status: async () => ({ running: false, url: "http://127.0.0.1:4247", detail: "connection refused" }),
  });
  assert.equal(text, "Kizuki daemon not running (connection refused) — expected at http://127.0.0.1:4247");
});

test("daemon install ensures config then installs the OS service", async () => {
  const calls = [];
  const text = await runDaemonCommand("/vault", "/repo", ["install"], {
    ensureDaemonConfig: async (vaultDir) => {
      calls.push(["ensure", vaultDir]);
      return { host: "127.0.0.1", port: 4247, token: TOKEN };
    },
    install: async (options) => {
      calls.push(["install", options]);
      return { platform: "darwin", path: "/home/me/Library/LaunchAgents/com.kizuki.daemon.plist" };
    },
  });
  assert.deepEqual(calls[0], ["ensure", "/vault"]);
  assert.deepEqual(calls[1], ["install", { vaultDir: "/vault", repoDir: "/repo" }]);
  assert.equal(text, "Kizuki daemon installed (darwin) at /home/me/Library/LaunchAgents/com.kizuki.daemon.plist");
  assert.doesNotMatch(JSON.stringify(calls) + text, new RegExp(TOKEN));
});

test("daemon uninstall removes the OS service", async () => {
  const text = await runDaemonCommand("/vault", "/repo", ["uninstall"], {
    uninstall: async () => ({ platform: "darwin", path: "/x" }),
  });
  assert.equal(text, "Kizuki daemon uninstalled (darwin)");
});

test("daemon restart reloads the OS service", async () => {
  const text = await runDaemonCommand("/vault", "/repo", ["restart"], {
    restart: async () => ({ platform: "linux", path: "/x" }),
  });
  assert.equal(text, "Kizuki daemon restarted (linux)");
});

test("daemon run starts the server in the foreground without installing a service", async () => {
  const signals = [];
  const text = await runDaemonCommand("/vault", "/repo", ["run"], {
    readDaemonConfig: async (vaultDir) => {
      assert.equal(vaultDir, "/vault");
      return { host: "127.0.0.1", port: 4247, token: TOKEN };
    },
    listen: async (options) => {
      assert.deepEqual(options, { vaultDir: "/vault", host: "127.0.0.1", port: 4247, token: TOKEN });
      return { url: "http://127.0.0.1:4247", close: async () => {} };
    },
    proc: { on: (signal) => signals.push(signal) },
  });
  assert.equal(text, "Kizuki daemon listening on http://127.0.0.1:4247");
  assert.deepEqual(signals, ["SIGINT", "SIGTERM"]);
});

test("daemon rejects an unknown subcommand", async () => {
  await assert.rejects(runDaemonCommand("/vault", "/repo", ["bogus"]), /unknown daemon command: bogus/);
});

test("daemon requires a subcommand", async () => {
  await assert.rejects(runDaemonCommand("/vault", "/repo", []), /unknown daemon command/);
});

test("daemon rejects trailing arguments", async () => {
  await assert.rejects(
    runDaemonCommand("/vault", "/repo", ["status", "extra"]),
    /unknown option for daemon status: extra/,
  );
});
