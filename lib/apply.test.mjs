// lib/apply.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPayload } from "./apply.mjs";
import { readSignalEvents } from "./signals.mjs";

const FIXED = new Date("2026-06-30T12:00:00Z");
const exists = (p) => access(p).then(() => true, () => false);

const receipt = (over = {}) => ({
  source: "slack",
  locator: "C123:1752084000.000100",
  observedAt: "2026-06-30T11:55:00Z",
  excerpt: "Inbound schema is missing.",
  ...over,
});

const signal = (over = {}) => ({
  severity: "warn",
  kind: "blocker",
  type: "project",
  name: "staff",
  topic: "inbound-schema",
  evidence: "Inbound schema still missing.",
  receipts: [receipt()],
  ...over,
});

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
  const alert = signal();
  const payload = {
    entities: [{ type: "person", name: "bob", rawEntries: [], analysis: {} }],
    consumedTranscripts: [],
    alerts: [alert],
  };
  const first = await applyPayload(v, payload, { now: FIXED });
  assert.equal(first.newAlerts.length, 1);
  assert.equal(first.signalChanges.length, 1);
  const file = await readFile(join(v, "alerts", "2026-06-30.md"), "utf8");
  assert.match(file, /\[warn\] blocker/);
  assert.equal((await readSignalEvents(v)).length, 1);
  const second = await applyPayload(v, payload, { now: FIXED });
  assert.equal(second.newAlerts.length, 0);
  assert.deepEqual(second.signalChanges, []);
  assert.equal((await readSignalEvents(v)).length, 1);
});

test("new receipt surfaces even when compatibility markdown dedupes the line", async () => {
  const v = await makeVault();
  const base = {
    entities: [],
    consumedTranscripts: [],
    alerts: [signal()],
  };
  await applyPayload(v, base, { now: FIXED });
  const next = signal({
    receipts: [receipt({
      source: "github",
      locator: "https://github.com/example/repo/issues/12/comments/1",
      observedAt: "2026-06-30T12:01:00Z",
      excerpt: "The schema is still blocked.",
    })],
  });
  const result = await applyPayload(v, { ...base, alerts: [next] }, { now: new Date("2026-06-30T12:02:00Z") });
  assert.deepEqual(result.newAlerts, [next]);
  assert.equal(result.signalChanges.length, 1);
  const markdown = await readFile(join(v, "alerts", "2026-06-30.md"), "utf8");
  assert.equal(markdown.match(/\[warn\] blocker/g)?.length, 1);
  assert.equal((await readSignalEvents(v)).length, 2);
});

test("signal planning fails before entity writes", async () => {
  const v = await makeVault();
  await assert.rejects(
    applyPayload(v, {
      entities: [{ type: "person", name: "bob", rawEntries: [], analysis: {} }],
      consumedTranscripts: [],
      alerts: [{ ...signal(), topic: undefined }],
    }, { now: FIXED }),
    /topic/,
  );
  assert.equal(await exists(join(v, "people", "bob.md")), false);
});

test("compatibility output failure leaves the signal ledger uncommitted", async () => {
  const v = await makeVault();
  await assert.rejects(
    applyPayload(v, {
      entities: [],
      consumedTranscripts: [],
      alerts: [signal()],
    }, {
      now: FIXED,
      appendAlertsImpl: async () => {
        throw new Error("compatibility write failed");
      },
    }),
    /compatibility write failed/,
  );
  assert.deepEqual(await readSignalEvents(v), []);
});

test("ledger failure leaves consumed transcripts in place", async () => {
  const v = await makeVault();
  await writeFile(join(v, "transcripts", "m.txt"), "hello", "utf8");
  await assert.rejects(
    applyPayload(v, {
      entities: [],
      consumedTranscripts: ["m.txt"],
      alerts: [signal()],
    }, {
      now: FIXED,
      writeSignalEventsImpl: async () => {
        throw new Error("ledger write failed");
      },
    }),
    /ledger write failed/,
  );
  assert.equal(await exists(join(v, "transcripts", "m.txt")), true);
  assert.equal(await exists(join(v, "transcripts", "processed", "m.txt")), false);
});

test("dry-run plans signal changes but creates no runtime files", async () => {
  const v = await makeVault();
  const result = await applyPayload(v, {
    entities: [{ type: "team", name: "platform", rawEntries: [], analysis: {} }],
    consumedTranscripts: [],
    alerts: [signal()],
    warnings: ["legacy compatibility"],
  }, { dryRun: true, now: FIXED });
  assert.equal(result.newAlerts.length, 1);
  assert.equal(result.signalChanges.length, 1);
  assert.deepEqual(result.warnings, ["legacy compatibility"]);
  assert.equal(await exists(join(v, "teams", "platform.md")), false);
  assert.equal(await exists(join(v, "signals")), false);
  assert.equal(await exists(join(v, "alerts")), false);
  assert.equal(await exists(join(v, "state")), false);
});
