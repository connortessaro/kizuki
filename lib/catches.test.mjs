import { test } from "node:test";
import assert from "node:assert/strict";
import {
  catchIdentity,
  planCatchCapture,
  readCatchEvents,
  reduceCatchEvents,
  validateCatchInput,
  writeCatchEventsAtomic,
} from "./catches.mjs";
import { mkdtemp, readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FIXED = new Date("2026-07-08T10:00:00Z");
const LATER = new Date("2026-07-08T11:00:00Z");

function caught(note = "caught the staff scope cut", now = FIXED, links = {}) {
  return planCatchCapture([], { note, ...links }, { now }).event;
}

test("validateCatchInput trims the note and defaults links to null", () => {
  const normalized = validateCatchInput({ note: "  caught it  " });
  assert.deepEqual(normalized, { note: "caught it", signalId: null, insightId: null });
});

test("validateCatchInput rejects empty, oversized, and unknown fields", () => {
  assert.throws(() => validateCatchInput({ note: "  " }), /non-empty string/);
  assert.throws(() => validateCatchInput({ note: "x".repeat(501) }), /at most 500/);
  assert.throws(() => validateCatchInput({ note: "ok", extra: 1 }), /unknown catch field/);
});

test("validateCatchInput rejects malformed link ids", () => {
  assert.throws(() => validateCatchInput({ note: "ok", signalId: "sig_nope" }), /invalid signal ID/);
  assert.throws(() => validateCatchInput({ note: "ok", insightId: "bad" }), /invalid insight ID/);
});

test("catchIdentity is deterministic over at and note", () => {
  const left = catchIdentity({ note: "same note" }, "2026-07-08T10:00:00.000Z");
  const right = catchIdentity({ note: "  same note  " }, "2026-07-08T10:00:00.000Z");
  assert.equal(left.catchId, right.catchId);
  assert.match(left.catchId, /^cat_[0-9a-f]{12}$/);
  const other = catchIdentity({ note: "same note" }, "2026-07-08T10:00:01.000Z");
  assert.notEqual(left.catchId, other.catchId);
});

test("planCatchCapture creates a version-1 caught event", () => {
  const planned = planCatchCapture([], { note: "caught it" }, { now: FIXED });
  assert.equal(planned.disposition, "created");
  assert.deepEqual(planned.event, {
    version: 1,
    event: "caught",
    catchId: planned.catchId,
    at: "2026-07-08T10:00:00.000Z",
    note: "caught it",
    signalId: null,
    insightId: null,
  });
  assert.deepEqual(planned.state, {
    catchId: planned.catchId,
    at: "2026-07-08T10:00:00.000Z",
    note: "caught it",
    signalId: null,
    insightId: null,
  });
});

test("planCatchCapture is an exact-repeat no-op for the same note at the same time", () => {
  const first = planCatchCapture([], { note: "caught it" }, { now: FIXED });
  const repeat = planCatchCapture([first.event], { note: "caught it" }, { now: FIXED });
  assert.equal(repeat.disposition, "exact-repeat");
  assert.equal(repeat.event, null);
  assert.equal(repeat.catchId, first.catchId);
  const later = planCatchCapture([first.event], { note: "caught it" }, { now: LATER });
  assert.equal(later.disposition, "created");
});

test("reduceCatchEvents rejects tampered and malformed events", () => {
  const event = caught();
  assert.throws(() => reduceCatchEvents([{ ...event, note: "edited" }]), /identity mismatch/);
  assert.throws(() => reduceCatchEvents([{ ...event, version: 2 }]), /invalid catch event version/);
  assert.throws(() => reduceCatchEvents([{ ...event, event: "other" }]), /unknown catch event/);
  assert.throws(() => reduceCatchEvents([{ ...event, at: "yesterday" }]), /ISO timestamp/);
  assert.throws(() => reduceCatchEvents([event, event]), /duplicate catch event/);
  assert.throws(() => reduceCatchEvents([{ ...event, surprise: 1 }]), /unknown catch event field/);
});

test("reduceCatchEvents keeps link ids in state", () => {
  const event = caught("linked catch", FIXED, {
    signalId: "sig_0123456789ab",
    insightId: "ins_0123456789ab",
  });
  const state = reduceCatchEvents([event]).get(event.catchId);
  assert.equal(state.signalId, "sig_0123456789ab");
  assert.equal(state.insightId, "ins_0123456789ab");
});

test("readCatchEvents returns [] when the ledger does not exist", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-catches-"));
  assert.deepEqual(await readCatchEvents(vault), []);
});

test("write then read round-trips and leaves no temp files", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-catches-"));
  const event = caught();
  await writeCatchEventsAtomic(vault, [event]);
  assert.deepEqual(await readCatchEvents(vault), [event]);
  const names = await readdir(join(vault, "catches"));
  assert.deepEqual(names, ["events.jsonl"]);
});

test("readCatchEvents names the file and line on malformed content", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-catches-"));
  await mkdir(join(vault, "catches"), { recursive: true });
  const path = join(vault, "catches", "events.jsonl");
  await writeFile(path, "not json\n", "utf8");
  await assert.rejects(readCatchEvents(vault), new RegExp("events\\.jsonl:1: malformed JSON"));
  await writeFile(path, JSON.stringify(caught()) + "\n\n" + JSON.stringify(caught("x", LATER)) + "\n", "utf8");
  await assert.rejects(readCatchEvents(vault), /:2: blank JSONL line/);
});

test("writeCatchEventsAtomic rejects removing or rewriting existing events", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-catches-"));
  const first = caught("first");
  const second = caught("second", LATER);
  await writeCatchEventsAtomic(vault, [first]);
  await assert.rejects(writeCatchEventsAtomic(vault, []), /append-only/);
  await assert.rejects(writeCatchEventsAtomic(vault, [second]), /append-only/);
  await writeCatchEventsAtomic(vault, [first, second]);
  assert.deepEqual(await readCatchEvents(vault), [first, second]);
});
