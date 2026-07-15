import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lookupPath, runDoctor } from "./doctor.mjs";

const tmp = () => mkdtemp(join(tmpdir(), "kizuki-doctor-"));

const stubExe = async (dir, name) => {
  const p = join(dir, name);
  await writeFile(p, "#!/bin/sh\n");
  await chmod(p, 0o755);
  return p;
};

test("lookupPath finds an executable on the provided PATH", async () => {
  const dir = await tmp();
  const bin = await stubExe(dir, "fakeagent");
  assert.equal(await lookupPath("fakeagent", dir), bin);
});

test("lookupPath returns null when not found", async () => {
  const dir = await tmp();
  assert.equal(await lookupPath("no-such-bin", dir), null);
});

test("lookupPath ignores non-executable files", async () => {
  const dir = await tmp();
  await writeFile(join(dir, "plainfile"), "data");
  await chmod(join(dir, "plainfile"), 0o644);
  assert.equal(await lookupPath("plainfile", dir), null);
});

test("lookupPath checks slash-containing names directly, not via PATH", async () => {
  const dir = await tmp();
  const bin = await stubExe(dir, "direct");
  assert.equal(await lookupPath(bin, ""), bin);
  assert.equal(await lookupPath(join(dir, "absent"), ""), null);
});

test("lookupPath scans later PATH entries and skips empty segments", async () => {
  const a = await tmp();
  const b = await tmp();
  const bin = await stubExe(b, "second");
  assert.equal(await lookupPath("second", `${a}::${b}`), bin);
});

const collect = async (iter) => {
  const out = [];
  for await (const r of iter) out.push(r);
  return out;
};
const byName = (results) => Object.fromEntries(results.map((r) => [r.name, r]));

const fakeFactory = (result) => {
  const factory = (resolved, options) => {
    factory.calls.push({ resolved, options });
    return async () => {
      if (result instanceof Error) throw result;
      return result;
    };
  };
  factory.calls = [];
  return factory;
};
const foundLookup = async (name) => `/fake/bin/${name}`;
const missingLookup = async () => null;

const VALID_CONFIG = { version: 1, host: "127.0.0.1", port: 4247, token: "x".repeat(40) };
const DOCTOR_OPTIONS = { makeConfiguredRunAgent: fakeFactory("OK\n"), lookupPath: foundLookup, runSmoke: false };

test("runDoctor passes all agent checks with default config and responsive agent", async () => {
  const dir = await tmp();
  const factory = fakeFactory("OK\n");
  const r = byName(await collect(runDoctor(dir, { makeConfiguredRunAgent: factory, lookupPath: foundLookup })));
  assert.deepEqual(r["config"], { name: "config", status: "pass", detail: "using default: codex exec" });
  assert.deepEqual(r["agent-binary"], { name: "agent-binary", status: "pass", detail: "/fake/bin/codex" });
  assert.equal(r["agent-smoke-test"].status, "pass");
  assert.match(r["agent-smoke-test"].detail, /30000ms budget/);
  assert.deepEqual(factory.calls, [
    { resolved: { kind: "cmd", cmd: ["codex", "exec"], timeoutMs: 30000 }, options: { cmd: { captureStderr: true } } },
  ]);
});

test("runDoctor reports explicit agentCmd and caps budget at min(timeoutMs, cap)", async () => {
  const dir = await tmp();
  await writeFile(join(dir, "kizuki.config.json"), JSON.stringify({ agentCmd: ["claude", "-p"], timeoutMs: 5000 }));
  const factory = fakeFactory("OK\n");
  const r = byName(await collect(runDoctor(dir, { makeConfiguredRunAgent: factory, lookupPath: foundLookup })));
  assert.deepEqual(r["config"], { name: "config", status: "pass", detail: "agentCmd: claude -p" });
  assert.equal(factory.calls[0].resolved.timeoutMs, 5000);
});

test("runDoctor runs the smoke test for http agents via makeConfiguredRunAgent", async () => {
  const dir = await tmp();
  const http = { baseUrl: "https://api.example.com/v1", model: "m", apiKeyEnv: "K" };
  await writeFile(join(dir, "kizuki.config.json"), JSON.stringify({ agentHttp: http }));
  const factory = fakeFactory("OK\n");
  const r = byName(await collect(runDoctor(dir, { makeConfiguredRunAgent: factory, lookupPath: foundLookup })));
  assert.deepEqual(r["agent-binary"], { name: "agent-binary", status: "pass", detail: "http agent — no binary needed" });
  assert.equal(r["agent-smoke-test"].status, "pass");
  assert.match(r["agent-smoke-test"].detail, /30000ms budget/);
  assert.deepEqual(factory.calls, [
    { resolved: { kind: "http", http, timeoutMs: 30000 }, options: { cmd: { captureStderr: true } } },
  ]);
});

test("runDoctor config failure skips agent-binary and smoke test", async () => {
  const dir = await tmp();
  await writeFile(join(dir, "kizuki.config.json"), "{ not json");
  const factory = fakeFactory("OK\n");
  const r = byName(await collect(runDoctor(dir, { makeConfiguredRunAgent: factory, lookupPath: foundLookup })));
  assert.equal(r["config"].status, "fail");
  assert.match(r["config"].detail, /not valid JSON/);
  assert.deepEqual(r["agent-binary"], { name: "agent-binary", status: "skip", detail: "skipped: config invalid" });
  assert.deepEqual(r["agent-smoke-test"], { name: "agent-smoke-test", status: "skip", detail: "skipped: config invalid" });
  assert.equal(factory.calls.length, 0);
});

test("runDoctor fails agent-binary when not on PATH", async () => {
  const dir = await tmp();
  const r = byName(await collect(runDoctor(dir, { makeConfiguredRunAgent: fakeFactory("OK\n"), lookupPath: missingLookup })));
  assert.deepEqual(r["agent-binary"], { name: "agent-binary", status: "fail", detail: "codex not found on PATH" });
});

test("runDoctor fails smoke test on exit 0 with empty output", async () => {
  const dir = await tmp();
  const r = byName(await collect(runDoctor(dir, { makeConfiguredRunAgent: fakeFactory("  \n"), lookupPath: foundLookup })));
  assert.deepEqual(r["agent-smoke-test"], { name: "agent-smoke-test", status: "fail", detail: "exit 0 but empty output" });
});

test("runDoctor surfaces smoke-test rejection message as the failure detail", async () => {
  const dir = await tmp();
  const boom = new Error("codex exited with 1: auth expired");
  const r = byName(await collect(runDoctor(dir, { makeConfiguredRunAgent: fakeFactory(boom), lookupPath: foundLookup })));
  assert.deepEqual(r["agent-smoke-test"], { name: "agent-smoke-test", status: "fail", detail: "codex exited with 1: auth expired" });
});

test("runDoctor skips smoke test when runSmoke is false", async () => {
  const dir = await tmp();
  const factory = fakeFactory("OK\n");
  const r = byName(await collect(runDoctor(dir, { makeConfiguredRunAgent: factory, lookupPath: foundLookup, runSmoke: false })));
  assert.deepEqual(r["agent-smoke-test"], { name: "agent-smoke-test", status: "skip", detail: "skipped: --no-smoke" });
  assert.equal(factory.calls.length, 0);
});

const noSmoke = (dir) =>
  runDoctor(dir, { makeConfiguredRunAgent: fakeFactory("OK\n"), lookupPath: foundLookup, runSmoke: false });

test("runDoctor yields checks in order, ending with the daemon checks", async () => {
  const dir = await tmp();
  const names = (await collect(noSmoke(dir))).map((r) => r.name);
  assert.deepEqual(names, ["config", "agent-binary", "agent-smoke-test", "vault-dirs", "daemon-config", "daemon-health"]);
});

test("doctor reports stopped daemon without exposing token", async () => {
  const vaultDir = await tmp();
  const results = [];
  for await (const result of runDoctor(vaultDir, {
    ...DOCTOR_OPTIONS,
    readDaemonConfig: async () => VALID_CONFIG,
    daemonStatus: async () => ({ running: false, url: "http://127.0.0.1:4247", detail: "connection refused" }),
  })) results.push(result);
  assert.deepEqual(results.find((r) => r.name === "daemon-health"), {
    name: "daemon-health", status: "fail", detail: "connection refused",
  });
  assert.doesNotMatch(JSON.stringify(results), new RegExp(VALID_CONFIG.token));
});

test("runDoctor daemon-config passes and daemon-health reports a running daemon without leaking the token", async () => {
  const vaultDir = await tmp();
  const r = byName(await collect(runDoctor(vaultDir, {
    ...DOCTOR_OPTIONS,
    readDaemonConfig: async () => VALID_CONFIG,
    daemonStatus: async () => ({ running: true, url: "http://127.0.0.1:4247", detail: "ok" }),
  })));
  assert.equal(r["daemon-config"].status, "pass");
  assert.deepEqual(r["daemon-health"], { name: "daemon-health", status: "pass", detail: "ok" });
  assert.doesNotMatch(JSON.stringify(r), new RegExp(VALID_CONFIG.token));
});

test("runDoctor fails daemon-config and skips daemon-health when config is missing", async () => {
  const vaultDir = await tmp();
  const r = byName(await collect(runDoctor(vaultDir, {
    ...DOCTOR_OPTIONS,
    readDaemonConfig: async () => { throw new Error("daemon config not found"); },
    daemonStatus: async () => { throw new Error("daemonStatus must not be called"); },
  })));
  assert.deepEqual(r["daemon-config"], { name: "daemon-config", status: "fail", detail: "daemon config not found" });
  assert.deepEqual(r["daemon-health"], { name: "daemon-health", status: "skip", detail: "skipped: daemon config invalid" });
});

test("runDoctor daemon checks require no config creation under --check-only", async () => {
  const vaultDir = await tmp();
  let statusCalls = 0;
  const r = byName(await collect(runDoctor(vaultDir, {
    ...DOCTOR_OPTIONS,
    checkOnly: true,
    readDaemonConfig: async () => VALID_CONFIG,
    daemonStatus: async () => { statusCalls++; return { running: false, url: "http://127.0.0.1:4247", detail: "connection refused" }; },
  })));
  assert.equal(r["daemon-config"].status, "pass");
  assert.equal(r["daemon-health"].status, "fail");
  assert.equal(statusCalls, 1);
  await assert.rejects(stat(join(vaultDir, "state", "daemon.json")));
});

test("runDoctor creates missing vault dirs and reports them", async () => {
  const dir = await tmp();
  const r = byName(await collect(noSmoke(dir)));
  assert.equal(r["vault-dirs"].status, "pass");
  assert.match(r["vault-dirs"].detail, /created people, projects, teams, transcripts, transcripts\/processed, signals, insights/);
  assert.ok((await stat(join(dir, "transcripts", "processed"))).isDirectory());
  assert.ok((await stat(join(dir, "signals"))).isDirectory());
  assert.ok((await stat(join(dir, "insights"))).isDirectory());
});

test("runDoctor reports all-present vault dirs without creating", async () => {
  const dir = await tmp();
  for (const d of ["people", "projects", "teams", "transcripts", "transcripts/processed", "signals", "insights"]) {
    await mkdir(join(dir, d), { recursive: true });
  }
  const r = byName(await collect(noSmoke(dir)));
  assert.deepEqual(r["vault-dirs"], { name: "vault-dirs", status: "pass", detail: "7 already present" });
});

test("runDoctor checkOnly reports missing dirs as failure and creates nothing", async () => {
  const dir = await tmp();
  await mkdir(join(dir, "people"));
  const r = byName(
    await collect(runDoctor(dir, { makeConfiguredRunAgent: fakeFactory("OK\n"), lookupPath: foundLookup, runSmoke: false, checkOnly: true }))
  );
  assert.equal(r["vault-dirs"].status, "fail");
  assert.equal(r["vault-dirs"].detail, "missing: projects, teams, transcripts, transcripts/processed, signals, insights (omit --check-only to create)");
  await assert.rejects(stat(join(dir, "projects")));
  await assert.rejects(stat(join(dir, "insights")));
});

test("runDoctor fails vault-dirs when a required path is a file", async () => {
  const dir = await tmp();
  await writeFile(join(dir, "people"), "not a dir");
  const r = byName(await collect(noSmoke(dir)));
  assert.equal(r["vault-dirs"].status, "fail");
  assert.match(r["vault-dirs"].detail, /people/);
});

test("runDoctor runs vault-dirs even when config is invalid", async () => {
  const dir = await tmp();
  await writeFile(join(dir, "kizuki.config.json"), "{ not json");
  const r = byName(await collect(noSmoke(dir)));
  assert.equal(r["config"].status, "fail");
  assert.equal(r["vault-dirs"].status, "pass");
});
