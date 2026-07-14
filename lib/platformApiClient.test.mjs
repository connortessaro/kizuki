import test from "node:test";
import assert from "node:assert/strict";
import { makePlatformApiClient } from "./platformApiClient.mjs";

const CONFIG = { host: "127.0.0.1", port: 4247, token: "x".repeat(32) };

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
  idempotencyKey: "api-1",
  aggregate: { type: "capture", id: "cap_22222222-2222-4222-8222-222222222222", version: 1 },
  payload: { kind: "note", text: "API works.", entity: null },
};

function fakeFetch(responses) {
  const calls = [];
  const queue = [...responses];
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push([url, init]);
      const response = queue.shift();
      return {
        ok: response.status < 400,
        status: response.status,
        json: async () => response.body,
      };
    },
  };
}

test("makePlatformApiClient rejects a config with a short token", () => {
  assert.throws(() => makePlatformApiClient({ ...CONFIG, token: "short" }), /token/);
});

test("makePlatformApiClient rejects a missing host or invalid port", () => {
  assert.throws(() => makePlatformApiClient({ ...CONFIG, host: "" }), /host/);
  assert.throws(() => makePlatformApiClient({ ...CONFIG, port: 99 }), /port/);
});

test("client health sends bearer auth and returns the data envelope", async () => {
  const { calls, fetchImpl } = fakeFetch([{ status: 200, body: { data: { status: "ok", version: 1 } } }]);
  const client = makePlatformApiClient(CONFIG, { fetchImpl });
  const result = await client.health();
  assert.deepEqual(result, { status: "ok", version: 1 });
  assert.equal(calls[0][0], "http://127.0.0.1:4247/v1/health");
  assert.equal(calls[0][1].headers.authorization, `Bearer ${CONFIG.token}`);
});

test("client capture sends the idempotency header and a JSON body", async () => {
  const { calls, fetchImpl } = fakeFetch([{ status: 201, body: { data: { disposition: "created", event: EVENT } } }]);
  const client = makePlatformApiClient(CONFIG, { fetchImpl });
  const result = await client.capture({ kind: "note", text: "API works." }, { idempotencyKey: "api-1" });
  assert.equal(result.disposition, "created");
  assert.equal(result.event.aggregate.id, EVENT.aggregate.id);
  const [url, init] = calls[0];
  assert.equal(url, "http://127.0.0.1:4247/v1/captures");
  assert.equal(init.method, "POST");
  assert.equal(init.headers["idempotency-key"], "api-1");
  assert.equal(init.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(init.body), { kind: "note", text: "API works." });
});

test("client capture requires a non-empty idempotencyKey", async () => {
  const client = makePlatformApiClient(CONFIG, { fetchImpl: async () => { throw new Error("must not fetch"); } });
  await assert.rejects(client.capture({ kind: "note", text: "x" }, {}), /idempotencyKey/);
  await assert.rejects(client.capture({ kind: "note", text: "x" }, { idempotencyKey: "  " }), /idempotencyKey/);
});

test("client listCaptures forwards a limit query parameter", async () => {
  const { calls, fetchImpl } = fakeFetch([{ status: 200, body: { data: [] } }]);
  const client = makePlatformApiClient(CONFIG, { fetchImpl });
  await client.listCaptures({ limit: 5 });
  assert.equal(calls[0][0], "http://127.0.0.1:4247/v1/captures?limit=5");
});

test("client listCaptures omits the query parameter when limit is not given", async () => {
  const { calls, fetchImpl } = fakeFetch([{ status: 200, body: { data: [] } }]);
  const client = makePlatformApiClient(CONFIG, { fetchImpl });
  await client.listCaptures();
  assert.equal(calls[0][0], "http://127.0.0.1:4247/v1/captures");
});

test("client throws an error carrying the API error code and status", async () => {
  const { fetchImpl } = fakeFetch([{ status: 401, body: { error: { code: "unauthorized", message: "valid bearer token required" } } }]);
  const client = makePlatformApiClient(CONFIG, { fetchImpl });
  await assert.rejects(client.health(), (error) => {
    assert.equal(error.code, "unauthorized");
    assert.equal(error.message, "valid bearer token required");
    assert.equal(error.status, 401);
    return true;
  });
});
