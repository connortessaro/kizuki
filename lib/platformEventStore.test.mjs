import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  capturePlatformEvent,
  listPlatformCaptures,
  platformEventsPath,
  readPlatformEvents,
  writePlatformEventsAtomic,
} from "./platformEventStore.mjs";

const FIXED = new Date("2026-07-14T12:00:00.000Z");
const INPUT = Object.freeze({ kind: "note", text: "Persist this." });

async function makeVault() {
  const vaultDir = await mkdtemp(join(tmpdir(), "kizuki-platform-store-"));
  await mkdir(join(vaultDir, "state"), { recursive: true });
  return vaultDir;
}

function sequenceUUID(...values) {
  let index = 0;
  return () => values[index++];
}

function options(overrides = {}) {
  return {
    now: FIXED,
    randomUUID: sequenceUUID(
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ),
    idempotencyKey: "store-1",
    ...overrides,
  };
}

test("readPlatformEvents returns an empty list when the ledger is missing", async () => {
  assert.deepEqual(await readPlatformEvents(await makeVault()), []);
});

test("capturePlatformEvent writes one event and dedupes retry", async () => {
  const vaultDir = await makeVault();
  const first = await capturePlatformEvent(vaultDir, INPUT, options());
  const retry = await capturePlatformEvent(vaultDir, INPUT, options());

  assert.equal(first.disposition, "created");
  assert.equal(retry.disposition, "existing");
  assert.equal(retry.event.eventId, first.event.eventId);
  const events = await readPlatformEvents(vaultDir);
  assert.equal(events.length, 1);
  assert.equal((await readFile(platformEventsPath(vaultDir), "utf8")), `${JSON.stringify(first.event)}\n`);
  assert.equal((await stat(platformEventsPath(vaultDir))).mode & 0o777, 0o600);
});

test("listPlatformCaptures returns projected captures", async () => {
  const vaultDir = await makeVault();
  const { event } = await capturePlatformEvent(vaultDir, INPUT, options());
  assert.deepEqual(await listPlatformCaptures(vaultDir), [{
    captureId: event.aggregate.id,
    eventId: event.eventId,
    at: event.at,
    kind: "note",
    text: "Persist this.",
    entity: null,
    visibility: event.visibility,
    packIds: [],
    receipts: [],
  }]);
});

test("capturePlatformEvent serializes through the vault lock", async () => {
  const vaultDir = await makeVault();
  await writeFile(join(vaultDir, "state", "vault.lock"), JSON.stringify({
    pid: 1,
    tool: "sync",
    startedAt: "2026-07-14T12:00:00.000Z",
  }));
  await assert.rejects(
    capturePlatformEvent(vaultDir, INPUT, options({
      lock: { waitMs: 20, pollMs: 5, pidAlive: () => true },
    })),
    /vault locked by sync/,
  );
  assert.deepEqual(await readPlatformEvents(vaultDir), []);
});

test("readPlatformEvents reports the ledger line on malformed content", async () => {
  const vaultDir = await makeVault();
  await mkdir(join(vaultDir, "events"), { recursive: true });
  await writeFile(platformEventsPath(vaultDir), "{}\nnot-json\n", "utf8");
  await assert.rejects(
    readPlatformEvents(vaultDir),
    /events\/events\.jsonl line 1: unknown platform event field|events\/events\.jsonl line 1:/,
  );
});

test("readPlatformEvents rejects blank lines", async () => {
  const vaultDir = await makeVault();
  await mkdir(join(vaultDir, "events"), { recursive: true });
  await writeFile(platformEventsPath(vaultDir), "\n", "utf8");
  await assert.rejects(readPlatformEvents(vaultDir), /events\/events\.jsonl line 1: blank line/);
});

test("writePlatformEventsAtomic refuses removal or rewrite", async () => {
  const vaultDir = await makeVault();
  const { event } = await capturePlatformEvent(vaultDir, INPUT, options());
  await assert.rejects(writePlatformEventsAtomic(vaultDir, []), /cannot remove existing platform events/);
  await assert.rejects(
    writePlatformEventsAtomic(vaultDir, [{ ...event, idempotencyKey: "changed" }]),
    /cannot rewrite existing platform events/,
  );
});

test("writePlatformEventsAtomic leaves no temporary file", async () => {
  const vaultDir = await makeVault();
  await capturePlatformEvent(vaultDir, INPUT, options());
  assert.deepEqual((await readdir(join(vaultDir, "events"))).sort(), ["events.jsonl"]);
});
