import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordSyncFailure, recordSyncSuccess, readSyncFailures } from "./syncFailures.mjs";

test("recordSyncFailure increments and notifies at 2", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-fail-"));
  const notified = [];
  assert.equal(await recordSyncFailure(dir, { notifySyncFailing: () => notified.push(1) }), 1);
  assert.equal(notified.length, 0);
  assert.equal(await recordSyncFailure(dir, { notifySyncFailing: () => notified.push(1) }), 2);
  assert.equal(notified.length, 1);
  assert.equal(await recordSyncFailure(dir, { notifySyncFailing: () => notified.push(1) }), 3);
  assert.equal(notified.length, 1);
});

test("recordSyncSuccess resets the counter", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-fail-"));
  await recordSyncFailure(dir, {});
  await recordSyncSuccess(dir);
  assert.deepEqual(await readSyncFailures(dir), { consecutive: 0 });
  const raw = await readFile(join(dir, "state", "sync-failures.json"), "utf8");
  assert.match(raw, /"consecutive":\s*0/);
});
