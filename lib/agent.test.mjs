import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_AGENT_CMD, buildAgentArgv, resolveAgent, makeRunAgent } from "./agent.mjs";

test("buildAgentArgv appends prompt when no {prompt} token", () => {
  assert.deepEqual(buildAgentArgv(["codex", "exec"], "P"), { file: "codex", args: ["exec", "P"] });
});

test("buildAgentArgv substitutes the {prompt} token in place", () => {
  assert.deepEqual(buildAgentArgv(["claude", "-p", "{prompt}"], "P"), { file: "claude", args: ["-p", "P"] });
});

test("resolveAgent defaults to codex when no config file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-agent-"));
  assert.deepEqual((await resolveAgent(dir)).cmd, DEFAULT_AGENT_CMD);
});

test("resolveAgent reads agentCmd from config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-agent-"));
  await writeFile(join(dir, "kizuki.config.json"), JSON.stringify({ agentCmd: ["claude", "-p"] }));
  assert.deepEqual((await resolveAgent(dir)).cmd, ["claude", "-p"]);
});

test("resolveAgent throws on invalid agentCmd (not a non-empty string array)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-agent-"));
  await writeFile(join(dir, "kizuki.config.json"), JSON.stringify({ agentCmd: [] }));
  await assert.rejects(resolveAgent(dir), /agentCmd/);
  await writeFile(join(dir, "kizuki.config.json"), JSON.stringify({ agentCmd: ["ok", 3] }));
  await assert.rejects(resolveAgent(dir), /agentCmd/);
});

test("resolveAgent throws on malformed JSON (no silent failure)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-agent-"));
  await writeFile(join(dir, "kizuki.config.json"), "{ not json");
  await assert.rejects(resolveAgent(dir), /config/i);
});

test("makeRunAgent spawns the command and returns its stdout", async () => {
  const run = makeRunAgent(["node", "-e", "process.stdout.write('OUT:'+process.argv[1])", "{prompt}"]);
  assert.equal(await run("hi"), "OUT:hi");
});

test("makeRunAgent rejects on non-zero exit", async () => {
  const run = makeRunAgent(["node", "-e", "process.exit(3)"]);
  await assert.rejects(run("x"), /exit/i);
});

test("resolveAgent returns default timeoutMs when config has none", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-"));
  await writeFile(join(dir, "kizuki.config.json"), JSON.stringify({ agentCmd: ["echo"] }));
  const { timeoutMs } = await resolveAgent(dir);
  assert.equal(timeoutMs, 300000);
});

test("resolveAgent reads timeoutMs from config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-"));
  await writeFile(join(dir, "kizuki.config.json"), JSON.stringify({ agentCmd: ["echo"], timeoutMs: 1234 }));
  const { timeoutMs } = await resolveAgent(dir);
  assert.equal(timeoutMs, 1234);
});

test("resolveAgent rejects non-positive or non-integer timeoutMs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-"));
  await writeFile(join(dir, "kizuki.config.json"), JSON.stringify({ agentCmd: ["echo"], timeoutMs: "5s" }));
  await assert.rejects(() => resolveAgent(dir), /timeoutMs must be a positive integer/);
});

test("resolveAgent with no config file returns defaults", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-"));
  const { cmd, timeoutMs } = await resolveAgent(dir);
  assert.deepEqual(cmd, ["codex", "exec"]);
  assert.equal(timeoutMs, 300000);
});

test("makeRunAgent rejects when the agent exceeds timeoutMs", async () => {
  const run = makeRunAgent(["sh", "-c", "sleep 5", "{prompt}"], 100);
  await assert.rejects(() => run("ignored"), /agent timed out after 100ms/);
});

test("makeRunAgent resolves normally under the timeout", async () => {
  const run = makeRunAgent(["sh", "-c", "echo hi", "{prompt}"], 5000);
  const out = await run("ignored");
  assert.match(out, /hi/);
});
