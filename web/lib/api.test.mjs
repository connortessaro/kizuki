import test from "node:test";
import assert from "node:assert/strict";
import { captureFromWeb } from "./api.mjs";

const EVENT = {
  version: 1,
  eventId: "evt_11111111-1111-4111-8111-111111111111",
  type: "capture.recorded",
  at: "2026-07-14T12:00:00.000Z",
  workspaceId: "personal",
  principalId: "local-operator",
  sourceOwnerId: "local-operator",
  visibility: { scope: "private", principalIds: ["local-operator"] },
  packIds: [],
  receipts: [],
  idempotencyKey: "web-11111111-1111-4111-8111-111111111111",
  aggregate: { type: "capture", id: "cap_22222222-2222-4222-8222-222222222222", version: 1 },
  payload: { kind: "correction", text: "Launch date changed.", entity: null },
};

test("captureFromWeb uses a web idempotency key", async () => {
  const calls = [];
  const result = await captureFromWeb("/vault", {
    kind: "correction",
    text: "Launch date changed.",
  }, {
    randomUUID: () => "11111111-1111-4111-8111-111111111111",
    makeClient: async () => ({
      capture: async (input, options) => {
        calls.push([input, options]);
        return { disposition: "created", event: EVENT };
      },
    }),
  });
  assert.equal(calls[0][1].idempotencyKey, "web-11111111-1111-4111-8111-111111111111");
  assert.equal(result.event.aggregate.id, EVENT.aggregate.id);
});

test("captureFromWeb forwards the input unchanged to the client", async () => {
  const calls = [];
  const input = { kind: "decision", text: "Ship it", entity: { type: "project", name: "kizuki" } };
  await captureFromWeb("/vault", input, {
    randomUUID: () => "11111111-1111-4111-8111-111111111111",
    makeClient: async () => ({
      capture: async (received) => {
        calls.push(received);
        return { disposition: "created", event: EVENT };
      },
    }),
  });
  assert.deepEqual(calls[0], input);
});

test("captureFromWeb passes vaultDir to the client factory", async () => {
  const seen = [];
  await captureFromWeb("/vault", { kind: "note", text: "hi" }, {
    randomUUID: () => "11111111-1111-4111-8111-111111111111",
    makeClient: async (vaultDir) => {
      seen.push(vaultDir);
      return { capture: async () => ({ disposition: "created", event: EVENT }) };
    },
  });
  assert.deepEqual(seen, ["/vault"]);
});
