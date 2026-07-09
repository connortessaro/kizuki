import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  planSignalIngestion,
  planSignalTransition,
  readSignalEvents,
  reduceSignalEvents,
  signalIdentity,
  writeSignalEventsAtomic,
} from "./signals.mjs";

const NOW = new Date("2026-07-09T18:00:00Z");

function candidate(overrides = {}) {
  return {
    severity: "warn",
    kind: "contradiction",
    type: "project",
    name: "staff",
    topic: "uat-date",
    evidence: "Two sources report different UAT dates.",
    draft: "Can we align on the UAT date?",
    receipts: [
      {
        source: "slack",
        locator: "C123:1752084000.000100",
        observedAt: "2026-07-09T17:55:00Z",
        excerpt: "UAT is July 17.",
      },
    ],
    ...overrides,
  };
}

function ingest(events, next, now = NOW) {
  return planSignalIngestion(events, Array.isArray(next) ? next : [next], { now });
}

function created(next = candidate()) {
  return ingest([], next).events;
}

async function vault() {
  return mkdtemp(join(tmpdir(), "kizuki-signals-"));
}

test("signal identity is stable across evidence and draft wording", () => {
  const first = signalIdentity(candidate());
  const reworded = signalIdentity(candidate({ evidence: "Reworded evidence.", draft: "Reworded draft." }));
  assert.deepEqual(reworded, first);
  assert.match(first.signalId, /^sig_[0-9a-f]{12}$/);
  assert.equal(first.dedupeKey, '["contradiction","project","staff","uat-date"]');
});

test("topic, entity, and kind each affect signal identity", () => {
  const base = signalIdentity(candidate()).signalId;
  assert.notEqual(signalIdentity(candidate({ topic: "launch-date" })).signalId, base);
  assert.notEqual(signalIdentity(candidate({ name: "checkout" })).signalId, base);
  assert.notEqual(signalIdentity(candidate({ kind: "blocker" })).signalId, base);
});

test("candidate validation rejects unsafe names and receipt locators", () => {
  assert.throws(() => signalIdentity(candidate({ name: "staff..archive" })), /path-safe/);
  assert.throws(
    () => signalIdentity(candidate({ receipts: [{ ...candidate().receipts[0], locator: "https://example.com/message?token=secret" }] })),
    /query string or fragment/,
  );
  assert.throws(
    () => signalIdentity(candidate({ receipts: [{ ...candidate().receipts[0], locator: "https://user:pass@example.com/message" }] })),
    /credentials/,
  );
  assert.throws(
    () => signalIdentity(candidate({ receipts: [{ ...candidate().receipts[0], locator: "X-Amz-Signature=secret" }] })),
    /signed parameter/,
  );
});

test("first observation creates an open signal and surfaces it", () => {
  const plan = ingest([], candidate());
  assert.equal(plan.events.length, 1);
  assert.deepEqual(plan.surfaced, [candidate()]);
  assert.equal(plan.events[0].event, "observed");
  assert.equal(plan.events[0].surfaceReason, "created");

  const state = reduceSignalEvents(plan.events).values().next().value;
  assert.equal(state.status, "open");
  assert.equal(state.firstSeenAt, NOW.toISOString());
  assert.equal(state.lastSeenAt, NOW.toISOString());
});

test("exact repeat adds no event", () => {
  const events = created();
  assert.deepEqual(ingest(events, candidate()), { events: [], surfaced: [] });
});

test("evidence and draft rewording alone add no event", () => {
  const events = created();
  const reworded = candidate({ evidence: "Different wording.", draft: "Different wording." });
  assert.deepEqual(ingest(events, reworded), { events: [], surfaced: [] });
});

test("receipt identity uses source and locator", () => {
  const events = created();
  const sameIdentity = candidate({
    receipts: [candidate().receipts[0], { ...candidate().receipts[0], excerpt: "Changed excerpt." }],
  });
  assert.deepEqual(ingest(events, sameIdentity), { events: [], surfaced: [] });

  const newLocator = candidate({
    receipts: [
      candidate().receipts[0],
      {
        source: "slack",
        locator: "C123:1752085000.000200",
        observedAt: "2026-07-09T18:01:00Z",
        excerpt: "UAT is July 10.",
      },
    ],
  });
  const planned = ingest(events, newLocator);
  assert.equal(planned.events.length, 1);
  assert.equal(planned.events[0].surfaceReason, "new-receipt");
  assert.deepEqual(planned.surfaced, [newLocator]);
});

test("severity increase surfaces and decrease records quietly", () => {
  const events = created(candidate({ severity: "info" }));
  const increased = candidate({ severity: "critical" });
  const up = ingest(events, increased);
  assert.equal(up.events[0].surfaceReason, "severity-increased");
  assert.deepEqual(up.surfaced, [increased]);

  const decreased = candidate({ severity: "warn" });
  const down = ingest([...events, ...up.events], decreased);
  assert.equal(down.events[0].surfaceReason, null);
  assert.deepEqual(down.surfaced, []);
  assert.equal(reduceSignalEvents([...events, ...up.events, ...down.events]).values().next().value.severity, "warn");
});

test("acted stays active and quiet until new proof", () => {
  const observed = created();
  const id = observed[0].signalId;
  const acted = planSignalTransition(observed, { signalId: id, to: "acted" }, { now: NOW });
  const active = [...observed, acted];
  assert.deepEqual(ingest(active, candidate()), { events: [], surfaced: [] });

  const newProof = candidate({
    receipts: [
      candidate().receipts[0],
      {
        source: "github",
        locator: "https://github.com/example/repo/issues/12/comments/1",
        observedAt: "2026-07-09T18:02:00Z",
        excerpt: "The release still uses July 10.",
      },
    ],
  });
  const plan = ingest(active, newProof);
  assert.equal(plan.events.length, 1);
  assert.equal(reduceSignalEvents([...active, ...plan.events]).get(id).status, "acted");
  assert.deepEqual(plan.surfaced, [newProof]);
});

for (const terminal of ["dismissed", "resolved"]) {
  test(`new proof reopens ${terminal} while exact repeats remain terminal`, () => {
    const observed = created();
    const id = observed[0].signalId;
    const transition = planSignalTransition(
      observed,
      {
        signalId: id,
        to: terminal,
        ...(terminal === "dismissed" ? { reason: "stale" } : {}),
      },
      { now: NOW },
    );
    const terminalEvents = [...observed, transition];
    assert.deepEqual(ingest(terminalEvents, candidate()), { events: [], surfaced: [] });

    const newProof = candidate({
      receipts: [
        ...candidate().receipts,
        {
          source: "atlassian",
          locator: "ari:cloud:jira:site:issue/123",
          observedAt: "2026-07-09T18:03:00Z",
          excerpt: "Jira now names July 20.",
        },
      ],
    });
    const reopen = ingest(terminalEvents, newProof);
    assert.equal(reopen.events.length, 2);
    assert.equal(reopen.events[1].event, "status_changed");
    assert.equal(reopen.events[1].from, terminal);
    assert.equal(reopen.events[1].to, "open");
    assert.equal(reduceSignalEvents([...terminalEvents, ...reopen.events]).get(id).status, "open");
  });
}

test("manual transition rules require a dismissal reason and allow optional notes", () => {
  const events = created();
  const id = events[0].signalId;
  assert.throws(
    () => planSignalTransition(events, { signalId: id, to: "dismissed" }, { now: NOW }),
    /dismiss reason/,
  );
  const event = planSignalTransition(
    events,
    { signalId: id, to: "dismissed", reason: "false-positive", note: "Dates refer to different phases." },
    { now: NOW },
  );
  assert.equal(event.actor, "user");
  assert.equal(event.note, "Dates refer to different phases.");
  assert.equal(reduceSignalEvents([...events, event]).get(id).status, "dismissed");
});

test("manual transition rejects unknown IDs, repeats, and terminal transitions", () => {
  const events = created();
  const id = events[0].signalId;
  assert.throws(
    () => planSignalTransition(events, { signalId: "sig_000000000000", to: "acted" }, { now: NOW }),
    /unknown signal/,
  );
  const acted = planSignalTransition(events, { signalId: id, to: "acted" }, { now: NOW });
  assert.throws(
    () => planSignalTransition([...events, acted], { signalId: id, to: "acted" }, { now: NOW }),
    /cannot transition/,
  );
  const resolved = planSignalTransition([...events, acted], { signalId: id, to: "resolved" }, { now: NOW });
  assert.throws(
    () => planSignalTransition([...events, acted, resolved], { signalId: id, to: "acted" }, { now: NOW }),
    /cannot transition/,
  );
});

test("reducer rejects unknown IDs, mismatched from, invalid enums, and bad ordering", () => {
  const events = created();
  const id = events[0].signalId;
  assert.throws(
    () => reduceSignalEvents([{ ...planSignalTransition(events, { signalId: id, to: "acted" }, { now: NOW }), signalId: "sig_000000000000" }]),
    /unknown signal/,
  );
  assert.throws(
    () => reduceSignalEvents([...events, { ...planSignalTransition(events, { signalId: id, to: "acted" }, { now: NOW }), from: "acted" }]),
    /mismatched from/,
  );
  assert.throws(() => reduceSignalEvents([{ ...events[0], candidate: candidate({ severity: "urgent" }) }]), /severity/);
  assert.throws(() => reduceSignalEvents([{ ...events[0], event: "invented" }]), /event/);
  assert.throws(() => reduceSignalEvents([{ ...events[0], surfaceReason: "new-receipt" }]), /first observation/);
});

test("reducer detects signal ID collisions", () => {
  const events = created();
  const other = candidate({ topic: "launch-date" });
  const otherIdentity = signalIdentity(other);
  assert.throws(
    () =>
      reduceSignalEvents([
        ...events,
        {
          version: 1,
          event: "observed",
          signalId: events[0].signalId,
          dedupeKey: otherIdentity.dedupeKey,
          at: "2026-07-09T18:05:00.000Z",
          candidate: other,
          surfaceReason: "created",
        },
      ]),
    /hash collision/,
  );
});

test("readSignalEvents returns empty for a missing ledger", async () => {
  const dir = await vault();
  try {
    assert.deepEqual(await readSignalEvents(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readSignalEvents reports malformed JSONL with file and line", async () => {
  const dir = await vault();
  try {
    await mkdir(join(dir, "signals"));
    await writeFile(join(dir, "signals", "events.jsonl"), `${JSON.stringify(created()[0])}\nnot-json\n`);
    await assert.rejects(readSignalEvents(dir), /signals\/events\.jsonl:2/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readSignalEvents reports invalid ordering with file and line", async () => {
  const dir = await vault();
  try {
    const events = created();
    const invalid = { ...planSignalTransition(events, { signalId: events[0].signalId, to: "acted" }, { now: NOW }), from: "acted" };
    await mkdir(join(dir, "signals"));
    await writeFile(join(dir, "signals", "events.jsonl"), `${JSON.stringify(events[0])}\n${JSON.stringify(invalid)}\n`);
    await assert.rejects(readSignalEvents(dir), /signals\/events\.jsonl:2.*mismatched from/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("atomic writer replaces the complete sequence and ends with a newline", async () => {
  const dir = await vault();
  try {
    const events = created();
    await writeSignalEventsAtomic(dir, events);
    const content = await readFile(join(dir, "signals", "events.jsonl"), "utf8");
    assert.equal(content, `${JSON.stringify(events[0])}\n`);
    assert.deepEqual(await readSignalEvents(dir), events);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("atomic writer rejects removal or rewriting of existing events", async () => {
  const dir = await vault();
  try {
    const events = created();
    await writeSignalEventsAtomic(dir, events);
    await assert.rejects(writeSignalEventsAtomic(dir, []), /append-only/);
    await assert.rejects(
      writeSignalEventsAtomic(dir, [{ ...events[0], at: "2026-07-09T18:01:00.000Z" }]),
      /append-only/,
    );
    assert.deepEqual(await readSignalEvents(dir), events);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("atomic writer leaves the previous ledger intact when rename fails", async () => {
  const dir = await vault();
  try {
    const first = created();
    await writeSignalEventsAtomic(dir, first);
    const before = await readFile(join(dir, "signals", "events.jsonl"), "utf8");
    const next = ingest(first, candidate({ severity: "critical" })).events;
    await assert.rejects(
      writeSignalEventsAtomic(dir, [...first, ...next], {
        renameImpl: async () => {
          throw new Error("rename failed");
        },
      }),
      /rename failed/,
    );
    assert.equal(await readFile(join(dir, "signals", "events.jsonl"), "utf8"), before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
