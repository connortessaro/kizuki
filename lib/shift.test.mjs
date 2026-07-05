import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readShift, startShift, endShift, readLastStop, recordStop } from "./shift.mjs";

test("shift flag lifecycle", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vigil-s-"));
  assert.equal(await readShift(dir), null);
  await startShift(dir, new Date("2026-07-06T09:00:00Z"));
  assert.deepEqual(await readShift(dir), { started: "2026-07-06T09:00:00.000Z" });
  await endShift(dir);
  assert.equal(await readShift(dir), null);
  await endShift(dir); // idempotent — no throw
});

test("last-stop record lifecycle", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vigil-s-"));
  assert.equal(await readLastStop(dir), null);
  await recordStop(dir, new Date("2026-07-06T17:00:00Z"));
  assert.deepEqual(await readLastStop(dir), { stopped: "2026-07-06T17:00:00.000Z" });
});
