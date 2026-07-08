import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeRunCheckAgent, runCheck } from "./check.mjs";

const wrap = (obj) => "```json\n" + JSON.stringify(obj) + "\n```";

const payload = {
  contradictions: [
    {
      severity: "critical",
      entity: { type: "project", name: "checkout" },
      draftClaim: "guest checkout ships Friday",
      conflict: "guest checkout was cut",
      evidence: "project/checkout: dropped in redesign",
    },
  ],
};

test("runCheck returns parsed contradictions from the agent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-chk-"));
  let seenPrompt = "";
  const runAgent = async (p) => {
    seenPrompt = p;
    return wrap(payload);
  };
  const r = await runCheck({ draft: "guest checkout ships Friday", scope: { kind: "all" }, vaultDir: dir, runAgent });
  assert.equal(r.contradictions.length, 1);
  assert.equal(r.contradictions[0].severity, "critical");
  assert.match(seenPrompt, /guest checkout ships Friday/);
});

test("runCheck never writes to the vault", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-chk-"));
  const runAgent = async () => wrap({ contradictions: [] });
  await runCheck({ draft: "anything", scope: { kind: "all" }, vaultDir: dir, runAgent });
  const entries = await readdir(dir);
  assert.deepEqual(entries, []);
});

test("makeRunCheckAgent captures stderr so progress logs stay out of check output", () => {
  const calls = [];
  const makeRunAgent = (...args) => {
    calls.push(args);
    return async () => wrap({ contradictions: [] });
  };

  makeRunCheckAgent(["codex", "exec"], 1234, { makeRunAgent });

  assert.deepEqual(calls, [[["codex", "exec"], 1234, { captureStderr: true }]]);
});
