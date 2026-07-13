import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_AGENT_CMD, AGENT_PRESETS, buildAgentArgv, resolveAgent, makeRunAgent } from "./agent.mjs";

test("buildAgentArgv appends prompt when no {prompt} token", () => {
  assert.deepEqual(buildAgentArgv(["codex", "exec"], "P"), { file: "codex", args: ["exec", "P"] });
});

test("buildAgentArgv substitutes the {prompt} token in place", () => {
  assert.deepEqual(buildAgentArgv(["claude", "-p", "{prompt}"], "P"), { file: "claude", args: ["-p", "P"] });
});

test("resolveAgent defaults to codex when no config file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-agent-"));
  const resolved = await resolveAgent(dir);
  assert.equal(resolved.kind, "cmd");
  assert.deepEqual(resolved.cmd, DEFAULT_AGENT_CMD);
});

test("resolveAgent reads agentCmd from config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-agent-"));
  await writeFile(join(dir, "kizuki.config.json"), JSON.stringify({ agentCmd: ["claude", "-p"] }));
  const resolved = await resolveAgent(dir);
  assert.equal(resolved.kind, "cmd");
  assert.deepEqual(resolved.cmd, ["claude", "-p"]);
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
  const { kind, cmd, timeoutMs } = await resolveAgent(dir);
  assert.equal(kind, "cmd");
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

test("makeRunAgent captureStderr appends stderr tail to rejection", async () => {
  const run = makeRunAgent(
    ["node", "-e", "console.error('boom detail'); process.exit(2)"],
    5000,
    { captureStderr: true }
  );
  await assert.rejects(run("x"), /exited with 2: boom detail/);
});

test("makeRunAgent captureStderr with empty stderr leaves message bare", async () => {
  const run = makeRunAgent(["node", "-e", "process.exit(2)"], 5000, { captureStderr: true });
  await assert.rejects(run("x"), (e) => e.message === "node exited with 2");
});

test("makeRunAgent default rejection message is unchanged (no opts)", async () => {
  const run = makeRunAgent(["node", "-e", "process.exit(3)"]);
  await assert.rejects(run("x"), (e) => e.message === "node exited with 3");
});

test("AGENT_PRESETS expose known CLI agents", () => {
  assert.deepEqual(AGENT_PRESETS.codex, ["codex", "exec"]);
  assert.deepEqual(AGENT_PRESETS.claude, ["claude", "-p"]);
  assert.deepEqual(AGENT_PRESETS.gemini, ["gemini", "-p"]);
  assert.deepEqual(AGENT_PRESETS.opencode, ["opencode", "run"]);
});

test("resolveAgent returns kind cmd for agentCmd configs and by default", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-agent-"));
  assert.deepEqual(await resolveAgent(vault), {
    kind: "cmd", cmd: ["codex", "exec"], timeoutMs: 300000,
  });
  await writeFile(join(vault, "kizuki.config.json"),
    JSON.stringify({ agentCmd: ["claude", "-p"], timeoutMs: 1000 }), "utf8");
  assert.deepEqual(await resolveAgent(vault), {
    kind: "cmd", cmd: ["claude", "-p"], timeoutMs: 1000,
  });
});

test("resolveAgent returns kind http and validates agentHttp", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-agent-"));
  const good = { baseUrl: "https://api.deepseek.com/v1/", model: "deepseek-chat", apiKeyEnv: "DEEPSEEK_API_KEY" };
  await writeFile(join(vault, "kizuki.config.json"), JSON.stringify({ agentHttp: good }), "utf8");
  const resolved = await resolveAgent(vault);
  assert.equal(resolved.kind, "http");
  assert.equal(resolved.http.baseUrl, "https://api.deepseek.com/v1");
  assert.equal(resolved.timeoutMs, 300000);

  await writeFile(join(vault, "kizuki.config.json"),
    JSON.stringify({ agentCmd: ["codex", "exec"], agentHttp: good }), "utf8");
  await assert.rejects(resolveAgent(vault), /exactly one of agentCmd or agentHttp/);

  await writeFile(join(vault, "kizuki.config.json"),
    JSON.stringify({ agentHttp: { baseUrl: "x", model: "y" } }), "utf8");
  await assert.rejects(resolveAgent(vault), /agentHttp\.apiKeyEnv/);

  await writeFile(join(vault, "kizuki.config.json"),
    JSON.stringify({ agentHttp: { ...good, extra: 1 } }), "utf8");
  await assert.rejects(resolveAgent(vault), /unknown agentHttp field/);
});
