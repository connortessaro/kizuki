import { test } from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  insightIdentity,
  planInsightArchive,
  planInsightCapture,
  readInsightEvents,
  reduceInsightEvents,
  validateInsightInput,
  writeInsightEventsAtomic,
} from "./insights.mjs";

const FIXED = new Date("2026-07-09T20:00:00Z");
const LATER = new Date("2026-07-09T21:00:00Z");
const BASE = {
  kind: "hypothesis",
  summary: "STAFF may need per-FC manifests.",
  context: "Reasoning from the bundle contract.",
  entities: [{ type: "project", name: "staff" }],
  origin: { client: "codex", locator: "thread-1/turn-2" },
};

const exists = (path) => access(path).then(() => true, () => false);

function captured(input = BASE, now = FIXED) {
  return planInsightCapture([], input, { now }).event;
}

test("identity trims text and sorts entity references without mutating input", () => {
  const entities = [
    { type: "team", name: "ors" },
    { type: "project", name: "staff" },
  ];
  const leftInput = {
    ...BASE,
    summary: "  STAFF may need per-FC manifests.  ",
    context: "  Reasoning from the bundle contract.  ",
    entities,
  };
  const left = insightIdentity(leftInput);
  const right = insightIdentity({
    ...BASE,
    entities: [...entities].reverse(),
  });
  assert.equal(left.insightId, right.insightId);
  assert.equal(left.dedupeKey, right.dedupeKey);
  assert.deepEqual(entities, [
    { type: "team", name: "ors" },
    { type: "project", name: "staff" },
  ]);
});

test("kind, wording, entities, client, and locator each change identity", () => {
  const base = insightIdentity(BASE).insightId;
  const variants = [
    { ...BASE, kind: "question" },
    { ...BASE, summary: "STAFF needs per-FC manifests." },
    { ...BASE, entities: [{ type: "team", name: "ors" }] },
    { ...BASE, origin: { ...BASE.origin, client: "cursor" } },
    { ...BASE, origin: { ...BASE.origin, locator: "thread-1/turn-3" } },
  ];
  for (const variant of variants) assert.notEqual(insightIdentity(variant).insightId, base);
});

test("validation normalizes optional fields and rejects unknown fields", () => {
  assert.deepEqual(validateInsightInput({
    kind: "learning",
    summary: "  Useful context  ",
    origin: { client: "cursor" },
  }), {
    kind: "learning",
    summary: "Useful context",
    context: null,
    entities: [],
    origin: { client: "cursor", locator: null },
  });
  assert.throws(() => validateInsightInput({ ...BASE, extra: true }), /unknown insight field/);
  assert.throws(
    () => validateInsightInput({ ...BASE, origin: { ...BASE.origin, extra: true } }),
    /unknown insight origin field/,
  );
  assert.throws(
    () => validateInsightInput({ ...BASE, entities: [{ type: "project", name: "staff", extra: true }] }),
    /unknown insight entity field/,
  );
});

test("validation enforces kinds, clients, text limits, and entity rules", () => {
  assert.throws(() => validateInsightInput({ ...BASE, kind: "idea" }), /invalid insight kind/);
  assert.throws(
    () => validateInsightInput({ ...BASE, origin: { client: "chatgpt" } }),
    /invalid insight origin client/,
  );
  assert.throws(() => validateInsightInput({ ...BASE, summary: " " }), /summary/);
  assert.throws(() => validateInsightInput({ ...BASE, summary: "x".repeat(501) }), /500/);
  assert.throws(() => validateInsightInput({ ...BASE, context: "x".repeat(4001) }), /4,000/);
  assert.throws(
    () => validateInsightInput({
      ...BASE,
      entities: Array.from({ length: 6 }, (_, index) => ({ type: "project", name: "p" + index })),
    }),
    /at most 5/,
  );
  assert.throws(
    () => validateInsightInput({
      ...BASE,
      entities: [
        { type: "project", name: "staff" },
        { type: "project", name: "staff" },
      ],
    }),
    /duplicate insight entity/,
  );
  assert.throws(
    () => validateInsightInput({ ...BASE, entities: [{ type: "robot", name: "staff" }] }),
    /invalid type/,
  );
  assert.throws(
    () => validateInsightInput({ ...BASE, entities: [{ type: "project", name: "../staff" }] }),
    /invalid entity name/,
  );
});

test("validation rejects unsafe origin locators", () => {
  const locators = [
    "https://example.com/thread?token=secret",
    "https://example.com/thread#turn",
    "https://user:pass@example.com/thread",
    "//user:pass@example.com/thread",
    "thread\0turn",
  ];
  for (const locator of locators) {
    assert.throws(
      () => validateInsightInput({ ...BASE, origin: { client: "codex", locator } }),
      /locator/,
    );
  }
});

test("first capture creates active state and exact retry adds no event", () => {
  const first = planInsightCapture([], BASE, { now: FIXED });
  assert.equal(first.disposition, "created");
  assert.equal(first.event.event, "captured");
  const states = reduceInsightEvents([first.event]);
  const state = states.get(first.insightId);
  assert.equal(state.status, "active");
  assert.equal(state.capturedAt, FIXED.toISOString());

  const retry = planInsightCapture([first.event], BASE, { now: LATER });
  assert.equal(retry.disposition, "exact-repeat");
  assert.equal(retry.event, null);
  assert.equal(retry.state.status, "active");
});

test("archive is terminal and exact recapture remains archived", () => {
  const first = planInsightCapture([], BASE, { now: FIXED });
  const archived = planInsightArchive([first.event], {
    insightId: first.insightId,
    note: "  no longer useful  ",
  }, { now: LATER });
  assert.equal(archived.note, "no longer useful");
  const events = [first.event, archived];
  assert.equal(reduceInsightEvents(events).get(first.insightId).status, "archived");
  const retry = planInsightCapture(events, BASE, { now: LATER });
  assert.equal(retry.disposition, "exact-repeat");
  assert.equal(retry.state.status, "archived");
  assert.throws(
    () => planInsightArchive(events, { insightId: first.insightId }, { now: LATER }),
    /already archived/,
  );
});

test("archive validates ID, note, event order, and known state", () => {
  const first = captured();
  assert.throws(
    () => planInsightArchive([first], { insightId: "ins_000000000000", note: null }, { now: LATER }),
    /unknown insight/,
  );
  assert.throws(
    () => planInsightArchive([first], { insightId: first.insightId, note: " " }, { now: LATER }),
    /note/,
  );
  assert.throws(
    () => planInsightArchive([first], { insightId: first.insightId, note: "x".repeat(501) }, { now: LATER }),
    /500/,
  );
  assert.throws(
    () => planInsightArchive([first], { insightId: first.insightId }, {
      now: new Date("2026-07-09T19:59:59Z"),
    }),
    /order/,
  );
});

test("reducer rejects malformed event protocol", () => {
  const first = captured();
  assert.throws(() => reduceInsightEvents([{ ...first, version: 2 }]), /version/);
  assert.throws(() => reduceInsightEvents([{ ...first, insightId: "bad" }]), /ID/);
  assert.throws(() => reduceInsightEvents([{ ...first, dedupeKey: "wrong" }]), /identity/);
  assert.throws(
    () => reduceInsightEvents([first, {
      version: 1,
      event: "insight_archived",
      insightId: "ins_000000000000",
      from: "active",
      to: "archived",
      at: LATER.toISOString(),
      actor: "user",
      note: null,
    }]),
    /unknown insight/,
  );
  assert.throws(
    () => reduceInsightEvents([first, {
      version: 1,
      event: "insight_archived",
      insightId: first.insightId,
      from: "archived",
      to: "archived",
      at: LATER.toISOString(),
      actor: "user",
      note: null,
    }]),
    /mismatched from/,
  );
  assert.throws(() => reduceInsightEvents([{ ...first, event: "other" }]), /unknown insight event/);
});

test("reducer detects ID collisions", () => {
  const first = captured();
  const second = captured({ ...BASE, summary: "Another thought" });
  assert.throws(
    () => reduceInsightEvents([first, { ...second, insightId: first.insightId }]),
    /collision/,
  );
});

test("readInsightEvents returns empty for a missing ledger", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-insights-"));
  assert.deepEqual(await readInsightEvents(vault), []);
});

test("readInsightEvents reports malformed JSONL and ordering with file and line", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-insights-"));
  await mkdir(join(vault, "insights"), { recursive: true });
  const path = join(vault, "insights", "events.jsonl");
  await writeFile(path, JSON.stringify(captured()) + "\n{bad}\n", "utf8");
  await assert.rejects(readInsightEvents(vault), /events\.jsonl:2:/);

  await writeFile(path, JSON.stringify({
    version: 1,
    event: "insight_archived",
    insightId: "ins_000000000000",
    from: "active",
    to: "archived",
    at: LATER.toISOString(),
    actor: "user",
    note: null,
  }) + "\n", "utf8");
  await assert.rejects(readInsightEvents(vault), /events\.jsonl:1: unknown insight/);
});

test("atomic writer writes complete immutable sequence with terminal newline", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-insights-"));
  const first = captured();
  await writeInsightEventsAtomic(vault, [first]);
  const archived = planInsightArchive([first], { insightId: first.insightId }, { now: LATER });
  await writeInsightEventsAtomic(vault, [first, archived]);
  const path = join(vault, "insights", "events.jsonl");
  const content = await readFile(path, "utf8");
  assert.equal(content.endsWith("\n"), true);
  assert.deepEqual(await readInsightEvents(vault), [first, archived]);
  const replacement = captured({ ...BASE, summary: "Replacement thought" });
  await assert.rejects(
    writeInsightEventsAtomic(vault, [replacement]),
    /append-only/,
  );
  await assert.rejects(
    writeInsightEventsAtomic(vault, [{ ...first, at: LATER.toISOString() }, archived]),
    /append-only|order/,
  );
});

test("atomic writer leaves prior ledger intact when rename fails", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-insights-"));
  const first = captured();
  await writeInsightEventsAtomic(vault, [first]);
  const before = await readFile(join(vault, "insights", "events.jsonl"), "utf8");
  const archived = planInsightArchive([first], { insightId: first.insightId }, { now: LATER });
  await assert.rejects(
    writeInsightEventsAtomic(vault, [first, archived], {
      rename: async () => { throw new Error("rename failed"); },
    }),
    /rename failed/,
  );
  assert.equal(await readFile(join(vault, "insights", "events.jsonl"), "utf8"), before);
  assert.deepEqual(await readdir(join(vault, "insights")), ["events.jsonl"]);
});

test("atomic writer reports write and cleanup failures", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-insights-"));
  await assert.rejects(
    writeInsightEventsAtomic(vault, [captured()], {
      writeFile: async () => { throw new Error("write failed"); },
      rm: async () => { throw new Error("cleanup failed"); },
    }),
    (error) => {
      assert.equal(error instanceof AggregateError, true);
      assert.match(error.message, /cleanup failed/);
      return true;
    },
  );
  assert.equal(await exists(join(vault, "insights", "events.jsonl")), false);
});
