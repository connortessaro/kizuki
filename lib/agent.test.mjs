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
  const dir = await mkdtemp(join(tmpdir(), "vigil-agent-"));
  assert.deepEqual((await resolveAgent(dir)).cmd, DEFAULT_AGENT_CMD);
});

test("resolveAgent reads agentCmd from config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vigil-agent-"));
  await writeFile(join(dir, "vigil.config.json"), JSON.stringify({ agentCmd: ["claude", "-p"] }));
  assert.deepEqual((await resolveAgent(dir)).cmd, ["claude", "-p"]);
});

test("resolveAgent throws on invalid agentCmd (not a non-empty string array)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vigil-agent-"));
  await writeFile(join(dir, "vigil.config.json"), JSON.stringify({ agentCmd: [] }));
  await assert.rejects(resolveAgent(dir), /agentCmd/);
  await writeFile(join(dir, "vigil.config.json"), JSON.stringify({ agentCmd: ["ok", 3] }));
  await assert.rejects(resolveAgent(dir), /agentCmd/);
});

test("resolveAgent throws on malformed JSON (no silent failure)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vigil-agent-"));
  await writeFile(join(dir, "vigil.config.json"), "{ not json");
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
