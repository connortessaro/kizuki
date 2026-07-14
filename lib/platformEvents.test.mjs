import test from "node:test";
import assert from "node:assert/strict";
import {
  CAPTURE_KINDS,
  EVENT_VERSION,
  LOCAL_CONTEXT,
  listCaptureStates,
  planCaptureEvent,
  validateCaptureInput,
  validatePlatformEvent,
} from "./platformEvents.mjs";

const FIXED = new Date("2026-07-14T12:00:00.000Z");
const INPUT = Object.freeze({ kind: "note", text: "API first." });

function sequenceUUID(...values) {
  let index = 0;
  return () => values[index++];
}

function plan(events = [], input = INPUT, overrides = {}) {
  return planCaptureEvent(events, input, LOCAL_CONTEXT, {
    now: FIXED,
    randomUUID: sequenceUUID(
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ),
    idempotencyKey: "cli-1",
    ...overrides,
  });
}

test("exports the capture contract enums", () => {
  assert.equal(EVENT_VERSION, 1);
  assert.deepEqual(CAPTURE_KINDS, [
    "note",
    "correction",
    "decision",
    "hypothesis",
    "question",
  ]);
});

test("planCaptureEvent creates a private local capture", () => {
  const result = plan([], {
    kind: "decision",
    text: "Ship the loopback API first.",
    entity: { type: "project", name: "kizuki" },
  });

  assert.equal(result.disposition, "created");
  assert.deepEqual(result.event, {
    version: 1,
    eventId: "evt_11111111-1111-4111-8111-111111111111",
    type: "capture.recorded",
    at: "2026-07-14T12:00:00.000Z",
    workspaceId: "personal",
    principalId: "local-operator",
    sourceOwnerId: "local-operator",
    visibility: {
      scope: "private",
      principalIds: ["local-operator"],
    },
    packIds: [],
    receipts: [],
    idempotencyKey: "cli-1",
    aggregate: {
      type: "capture",
      id: "cap_22222222-2222-4222-8222-222222222222",
      version: 1,
    },
    payload: {
      kind: "decision",
      text: "Ship the loopback API first.",
      entity: { type: "project", name: "kizuki" },
    },
  });
  assert.equal(validatePlatformEvent(result.event), result.event);
});

test("planCaptureEvent normalizes optional input", () => {
  const result = plan([], {
    kind: "note",
    text: "  keep whitespace inside  ",
    visibility: "private",
    packIds: ["personal", "work"],
    receipts: [{
      source: "transcript",
      locator: "transcripts/meeting.md",
      observedAt: "2026-07-14T11:00:00.000Z",
      excerpt: "Decision recorded",
    }],
  });
  assert.equal(result.event.payload.text, "keep whitespace inside");
  assert.deepEqual(result.event.packIds, ["personal", "work"]);
  assert.equal(result.event.receipts.length, 1);
  assert.equal(result.event.payload.entity, null);
});

test("planCaptureEvent returns the existing event for an exact retry", () => {
  const first = plan();
  const retry = plan([first.event]);
  assert.equal(retry.disposition, "existing");
  assert.equal(retry.event, first.event);
});

test("planCaptureEvent rejects reuse of an idempotency key", () => {
  const first = plan();
  assert.throws(
    () => plan([first.event], { ...INPUT, text: "Different." }),
    /idempotency key already used/,
  );
});

test("validateCaptureInput rejects malformed or unsafe input", () => {
  const invalid = [
    [{ kind: "other", text: "x" }, /invalid capture kind/],
    [{ kind: "note", text: " " }, /text must be a non-empty string/],
    [{ kind: "note", text: "x".repeat(50_001) }, /text must be at most 50000 characters/],
    [{ kind: "note", text: "x", extra: true }, /unknown capture field extra/],
    [{ kind: "note", text: "x", entity: { type: "project", name: "../x" } }, /not path-safe/],
    [{ kind: "note", text: "x", entity: { type: "other", name: "x" } }, /invalid capture entity type/],
    [{ kind: "note", text: "x", visibility: "workspace" }, /visibility must be private/],
    [{ kind: "note", text: "x", packIds: ["work", "work"] }, /duplicate Pack ID/],
    [{ kind: "note", text: "x", packIds: ["Bad Pack"] }, /Pack ID must be lowercase kebab-case/],
    [{
      kind: "note",
      text: "x",
      receipts: [{
        source: "github",
        locator: "https://example.com/item?token=secret",
        observedAt: "2026-07-14T11:00:00.000Z",
        excerpt: "x",
      }],
    }, /receipt locator must not contain a query string or fragment/],
  ];
  for (const [input, pattern] of invalid) {
    assert.throws(() => validateCaptureInput(input), pattern);
  }
});

test("planCaptureEvent rejects client-owned authority fields", () => {
  for (const field of ["workspaceId", "principalId", "sourceOwnerId"]) {
    assert.throws(
      () => plan([], { ...INPUT, [field]: "attacker" }),
      new RegExp(`unknown capture field ${field}`),
    );
  }
});

test("validatePlatformEvent rejects tampering", () => {
  const { event } = plan();
  assert.throws(
    () => validatePlatformEvent({ ...event, workspaceId: "" }),
    /workspaceId must be a non-empty string/,
  );
  assert.throws(
    () => validatePlatformEvent({ ...event, eventId: "bad" }),
    /invalid platform event ID/,
  );
  assert.throws(
    () => validatePlatformEvent({ ...event, type: "unknown" }),
    /invalid platform event type/,
  );
});

test("listCaptureStates returns newest first and enforces limit", () => {
  const first = plan().event;
  const second = planCaptureEvent([first], {
    kind: "question",
    text: "Who owns launch?",
  }, LOCAL_CONTEXT, {
    now: new Date("2026-07-14T13:00:00.000Z"),
    randomUUID: sequenceUUID(
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
    ),
    idempotencyKey: "cli-2",
  }).event;

  assert.deepEqual(listCaptureStates([first, second], { limit: 1 }), [{
    captureId: second.aggregate.id,
    eventId: second.eventId,
    at: second.at,
    kind: "question",
    text: "Who owns launch?",
    entity: null,
    visibility: second.visibility,
    packIds: [],
    receipts: [],
  }]);
  assert.throws(() => listCaptureStates([first], { limit: 0 }), /limit must be an integer from 1 to 1000/);
});
