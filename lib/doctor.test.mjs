import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
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
  const factory = (cmd, timeoutMs, opts) => {
    factory.calls.push({ cmd, timeoutMs, opts });
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

test("runDoctor passes all agent checks with default config and responsive agent", async () => {
  const dir = await tmp();
  const factory = fakeFactory("OK\n");
  const r = byName(await collect(runDoctor(dir, { makeRunAgent: factory, lookupPath: foundLookup })));
  assert.deepEqual(r["config"], { name: "config", status: "pass", detail: "using default: codex exec" });
  assert.deepEqual(r["agent-binary"], { name: "agent-binary", status: "pass", detail: "/fake/bin/codex" });
  assert.equal(r["agent-smoke-test"].status, "pass");
  assert.match(r["agent-smoke-test"].detail, /30000ms budget/);
  assert.deepEqual(factory.calls, [
    { cmd: ["codex", "exec"], timeoutMs: 30000, opts: { captureStderr: true } },
  ]);
});

test("runDoctor reports explicit agentCmd and caps budget at min(timeoutMs, cap)", async () => {
  const dir = await tmp();
  await writeFile(join(dir, "kizuki.config.json"), JSON.stringify({ agentCmd: ["claude", "-p"], timeoutMs: 5000 }));
  const factory = fakeFactory("OK\n");
  const r = byName(await collect(runDoctor(dir, { makeRunAgent: factory, lookupPath: foundLookup })));
  assert.deepEqual(r["config"], { name: "config", status: "pass", detail: "agentCmd: claude -p" });
  assert.equal(factory.calls[0].timeoutMs, 5000);
});

test("runDoctor config failure skips agent-binary and smoke test", async () => {
  const dir = await tmp();
  await writeFile(join(dir, "kizuki.config.json"), "{ not json");
  const factory = fakeFactory("OK\n");
  const r = byName(await collect(runDoctor(dir, { makeRunAgent: factory, lookupPath: foundLookup })));
  assert.equal(r["config"].status, "fail");
  assert.match(r["config"].detail, /not valid JSON/);
  assert.deepEqual(r["agent-binary"], { name: "agent-binary", status: "skip", detail: "skipped: config invalid" });
  assert.deepEqual(r["agent-smoke-test"], { name: "agent-smoke-test", status: "skip", detail: "skipped: config invalid" });
  assert.equal(factory.calls.length, 0);
});

test("runDoctor fails agent-binary when not on PATH", async () => {
  const dir = await tmp();
  const r = byName(await collect(runDoctor(dir, { makeRunAgent: fakeFactory("OK\n"), lookupPath: missingLookup })));
  assert.deepEqual(r["agent-binary"], { name: "agent-binary", status: "fail", detail: "codex not found on PATH" });
});

test("runDoctor fails smoke test on exit 0 with empty output", async () => {
  const dir = await tmp();
  const r = byName(await collect(runDoctor(dir, { makeRunAgent: fakeFactory("  \n"), lookupPath: foundLookup })));
  assert.deepEqual(r["agent-smoke-test"], { name: "agent-smoke-test", status: "fail", detail: "exit 0 but empty output" });
});

test("runDoctor surfaces smoke-test rejection message as the failure detail", async () => {
  const dir = await tmp();
  const boom = new Error("codex exited with 1: auth expired");
  const r = byName(await collect(runDoctor(dir, { makeRunAgent: fakeFactory(boom), lookupPath: foundLookup })));
  assert.deepEqual(r["agent-smoke-test"], { name: "agent-smoke-test", status: "fail", detail: "codex exited with 1: auth expired" });
});

test("runDoctor skips smoke test when runSmoke is false", async () => {
  const dir = await tmp();
  const factory = fakeFactory("OK\n");
  const r = byName(await collect(runDoctor(dir, { makeRunAgent: factory, lookupPath: foundLookup, runSmoke: false })));
  assert.deepEqual(r["agent-smoke-test"], { name: "agent-smoke-test", status: "skip", detail: "skipped: --no-smoke" });
  assert.equal(factory.calls.length, 0);
});
