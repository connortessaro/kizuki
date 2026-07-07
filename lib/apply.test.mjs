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
  const dir = await mkdtemp(join(tmpdir(), "kizuki-"));
  for (const d of ["people", "projects", "teams", "transcripts"]) await mkdir(join(dir, d), { recursive: true });
  return dir;
}

test("creates a new person file with log + analysis", async () => {
  const v = await makeVault();
  const { changes } = await applyPayload(v, {
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
  const { changes, newAlerts } = await applyPayload(v, {
    entities: [{ type: "team", name: "platform", rawEntries: [], analysis: {} }],
    consumedTranscripts: [],
  }, { dryRun: true, now: FIXED });
  assert.equal(changes.length, 1);
  assert.deepEqual(newAlerts, []);
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

test("applyPayload throws when the vault lock is held by a live process", async () => {
  const v = await makeVault();
  await mkdir(join(v, "state"), { recursive: true });
  await writeFile(join(v, "state", "vault.lock"), JSON.stringify({ pid: 4242, tool: "mcp", startedAt: "x" }));
  await assert.rejects(
    applyPayload(v, {
      entities: [{ type: "person", name: "bob", rawEntries: [], analysis: {} }],
      consumedTranscripts: [],
    }, { now: FIXED, lock: { waitMs: 20, pollMs: 5, pidAlive: () => true } }),
    /vault locked by mcp \(pid 4242\)/
  );
  assert.equal(await exists(join(v, "people", "bob.md")), false);
});

test("applyPayload removes the lock file after a successful write", async () => {
  const v = await makeVault();
  await applyPayload(v, {
    entities: [{ type: "person", name: "bob", rawEntries: [], analysis: {} }],
    consumedTranscripts: [],
  }, { now: FIXED });
  assert.equal(await exists(join(v, "state", "vault.lock")), false);
  assert.equal(await exists(join(v, "people", "bob.md")), true);
});

test("dry-run never touches the lock or the state dir", async () => {
  const v = await makeVault();
  await applyPayload(v, {
    entities: [{ type: "team", name: "platform", rawEntries: [], analysis: {} }],
    consumedTranscripts: [],
  }, { dryRun: true, now: FIXED });
  assert.equal(await exists(join(v, "state")), false);
});

test("applyPayload appends alerts and dedupes on re-run", async () => {
  const v = await makeVault();
  const alert = {
    severity: "warn",
    kind: "blocker",
    type: "project",
    name: "staff",
    evidence: "Inbound schema still missing.",
  };
  const payload = {
    entities: [{ type: "person", name: "bob", rawEntries: [], analysis: {} }],
    consumedTranscripts: [],
    alerts: [alert],
  };
  const first = await applyPayload(v, payload, { now: FIXED });
  assert.equal(first.newAlerts.length, 1);
  const file = await readFile(join(v, "alerts", "2026-06-30.md"), "utf8");
  assert.match(file, /\[warn\] blocker/);
  const second = await applyPayload(v, payload, { now: FIXED });
  assert.equal(second.newAlerts.length, 0);
});
