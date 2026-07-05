// lib/apply.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPayload } from "./apply.mjs";

const FIXED = new Date("2026-06-30T12:00:00Z");
const exists = (p) => access(p).then(() => true, () => false);

async function makeVault() {
  const dir = await mkdtemp(join(tmpdir(), "vigil-"));
  for (const d of ["people", "projects", "teams", "transcripts"]) await mkdir(join(dir, d), { recursive: true });
  return dir;
}

test("creates a new person file with log + analysis", async () => {
  const v = await makeVault();
  const changes = await applyPayload(v, {
    entities: [{ type: "person", name: "bob", rawEntries: [{ source: "slack", timestamp: "t", text: "hi" }], analysis: { status: "ok" } }],
    consumedTranscripts: [],
  }, { now: FIXED });
  const file = await readFile(join(v, "people", "bob.md"), "utf8");
  assert.match(file, /\*\*slack\*\* t: hi/);
  assert.match(file, /\*\*Status:\*\* ok/);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].entity, "bob");
});

test("preserves hand notes in an existing file", async () => {
  const v = await makeVault();
  await writeFile(join(v, "people", "bob.md"), "# bob\n\nMY NOTE\n\n## Log\n", "utf8");
  await applyPayload(v, {
    entities: [{ type: "person", name: "bob", rawEntries: [], analysis: { status: "new" } }],
    consumedTranscripts: [],
  }, { now: FIXED });
  const file = await readFile(join(v, "people", "bob.md"), "utf8");
  assert.match(file, /MY NOTE/);
  assert.match(file, /\*\*Status:\*\* new/);
});

test("dry-run writes nothing but reports changes", async () => {
  const v = await makeVault();
  const changes = await applyPayload(v, {
    entities: [{ type: "team", name: "platform", rawEntries: [], analysis: {} }],
    consumedTranscripts: [],
  }, { dryRun: true, now: FIXED });
  assert.equal(changes.length, 1);
  assert.equal(await exists(join(v, "teams", "platform.md")), false);
});

test("consumed transcripts are archived", async () => {
  const v = await makeVault();
  await writeFile(join(v, "transcripts", "m.txt"), "hello", "utf8");
  await applyPayload(v, {
    entities: [{ type: "person", name: "bob", rawEntries: [], analysis: {} }],
    consumedTranscripts: ["m.txt"],
  }, { now: FIXED });
  assert.equal(await exists(join(v, "transcripts", "m.txt")), false);
  assert.equal(await exists(join(v, "transcripts", "processed", "m.txt")), true);
});
