// lib/run.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSync } from "./run.mjs";

async function makeVault() {
  const dir = await mkdtemp(join(tmpdir(), "orgmind-run-"));
  for (const d of ["people", "projects", "teams", "transcripts"]) await mkdir(join(dir, d), { recursive: true });
  return dir;
}

test("runSync builds prompt, applies payload, returns summary", async () => {
  const v = await makeVault();
  let seenPrompt = "";
  const fakeCodex = async (prompt) => {
    seenPrompt = prompt;
    return "```json\n" + JSON.stringify({
      entities: [{ type: "person", name: "bob", rawEntries: [{ source: "slack", timestamp: "t", text: "hi" }], analysis: { status: "ok" } }],
      consumedTranscripts: [],
    }) + "\n```";
  };

  const result = await runSync({ argv: ["bob", "--source", "slack"], vaultDir: v, runAgent: fakeCodex });

  assert.match(seenPrompt, /bob/);
  assert.match(seenPrompt, /slack/);
  assert.deepEqual(result.sources, ["slack"]);
  assert.equal(result.changes.length, 1);
  const file = await readFile(join(v, "people", "bob.md"), "utf8");
  assert.match(file, /\*\*Status:\*\* ok/);
});

test("runSync dry-run writes nothing", async () => {
  const v = await makeVault();
  const fakeCodex = async () => "```json\n" + JSON.stringify({ entities: [{ type: "team", name: "plat", rawEntries: [], analysis: {} }], consumedTranscripts: [] }) + "\n```";
  const result = await runSync({ argv: ["--dry-run"], vaultDir: v, runAgent: fakeCodex });
  assert.equal(result.dryRun, true);
  assert.equal(result.changes.length, 1);
  await assert.rejects(readFile(join(v, "teams", "plat.md"), "utf8"));
});
