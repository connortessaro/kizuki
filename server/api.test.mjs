import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listenApiServer } from "./api.mjs";

const TOKEN = "test-token-that-is-at-least-32-characters";

async function makeVault() {
  const vaultDir = await mkdtemp(join(tmpdir(), "kizuki-api-"));
  await mkdir(join(vaultDir, "state"), { recursive: true });
  return vaultDir;
}

async function startServer(t, options = {}) {
  const vaultDir = await makeVault();
  const running = await listenApiServer({
    vaultDir,
    host: "127.0.0.1",
    port: 0,
    token: TOKEN,
    ...options,
  });
  t.after(() => running.close());
  return { ...running, vaultDir };
}

function authHeaders(extra = {}) {
  return { authorization: `Bearer ${TOKEN}`, ...extra };
}

async function json(response) {
  return response.json();
}

test("API rejects missing and incorrect bearer auth", async (t) => {
  const running = await startServer(t);
  const missing = await fetch(`${running.url}/v1/health`);
  const wrong = await fetch(`${running.url}/v1/health`, {
    headers: { authorization: "Bearer wrong-token-that-is-at-least-32-characters" },
  });
  assert.equal(missing.status, 401);
  assert.equal(wrong.status, 401);
  assert.deepEqual(await json(missing), {
    error: { code: "unauthorized", message: "valid bearer token required" },
  });
});

test("health and OpenAPI routes require auth and return contracts", async (t) => {
  const running = await startServer(t);
  const health = await fetch(`${running.url}/v1/health`, { headers: authHeaders() });
  assert.equal(health.status, 200);
  assert.deepEqual(await json(health), { data: { status: "ok", version: 1 } });

  const openapi = await fetch(`${running.url}/openapi.json`, { headers: authHeaders() });
  assert.equal(openapi.status, 200);
  const schema = await json(openapi);
  assert.equal(schema.openapi, "3.1.0");
  assert.ok(schema.paths["/v1/captures"].post);
  assert.ok(schema.components.securitySchemes.bearerAuth);
});

test("capture route creates, lists, and dedupes one capture", async (t) => {
  const running = await startServer(t);
  const request = {
    method: "POST",
    headers: authHeaders({
      "content-type": "application/json",
      "idempotency-key": "api-1",
    }),
    body: JSON.stringify({
      kind: "decision",
      text: "API works.",
      entity: { type: "project", name: "kizuki" },
    }),
  };
  const created = await fetch(`${running.url}/v1/captures`, request);
  assert.equal(created.status, 201);
  const first = await json(created);
  assert.equal(first.data.disposition, "created");
  assert.equal(first.data.event.type, "capture.recorded");
  assert.equal(first.data.event.workspaceId, "personal");

  const retry = await fetch(`${running.url}/v1/captures`, request);
  assert.equal(retry.status, 200);
  assert.equal((await json(retry)).data.disposition, "existing");

  const listed = await fetch(`${running.url}/v1/captures?limit=10`, { headers: authHeaders() });
  assert.equal(listed.status, 200);
  const captures = (await json(listed)).data;
  assert.equal(captures.length, 1);
  assert.equal(captures[0].text, "API works.");
});

test("capture route rejects authority spoofing and idempotency conflicts", async (t) => {
  const running = await startServer(t);
  const headers = authHeaders({
    "content-type": "application/json",
    "idempotency-key": "api-conflict",
  });
  const spoofed = await fetch(`${running.url}/v1/captures`, {
    method: "POST",
    headers,
    body: JSON.stringify({ kind: "note", text: "x", principalId: "attacker" }),
  });
  assert.equal(spoofed.status, 400);
  assert.equal((await json(spoofed)).error.code, "invalid_request");

  const first = await fetch(`${running.url}/v1/captures`, {
    method: "POST",
    headers,
    body: JSON.stringify({ kind: "note", text: "first" }),
  });
  assert.equal(first.status, 201);
  const conflict = await fetch(`${running.url}/v1/captures`, {
    method: "POST",
    headers,
    body: JSON.stringify({ kind: "note", text: "second" }),
  });
  assert.equal(conflict.status, 409);
  assert.deepEqual(await json(conflict), {
    error: {
      code: "idempotency_conflict",
      message: "idempotency key already used: api-conflict",
    },
  });
});

test("API returns stable request error envelopes", async (t) => {
  const running = await startServer(t);
  const cases = [
    [{
      path: "/v1/captures",
      init: { method: "POST", headers: authHeaders({ "content-type": "application/json", "idempotency-key": "bad-json" }), body: "{" },
    }, 400, "invalid_json"],
    [{
      path: "/v1/captures",
      init: { method: "POST", headers: authHeaders({ "content-type": "text/plain", "idempotency-key": "bad-type" }), body: "x" },
    }, 415, "unsupported_media_type"],
    [{
      path: "/v1/captures",
      init: { method: "POST", headers: authHeaders({ "content-type": "application/json" }), body: JSON.stringify({ kind: "note", text: "x" }) },
    }, 400, "missing_idempotency_key"],
    [{ path: "/v1/captures?limit=0", init: { headers: authHeaders() } }, 400, "invalid_request"],
    [{ path: "/missing", init: { headers: authHeaders() } }, 404, "not_found"],
    [{ path: "/v1/health", init: { method: "POST", headers: authHeaders() } }, 405, "method_not_allowed"],
  ];
  for (const [{ path, init }, status, code] of cases) {
    const response = await fetch(running.url + path, init);
    assert.equal(response.status, status, path);
    assert.equal((await json(response)).error.code, code, path);
  }
});

test("API rejects JSON bodies above 64 KiB", async (t) => {
  const running = await startServer(t);
  const response = await fetch(`${running.url}/v1/captures`, {
    method: "POST",
    headers: authHeaders({
      "content-type": "application/json",
      "idempotency-key": "large",
    }),
    body: JSON.stringify({ kind: "note", text: "x".repeat(70_000) }),
  });
  assert.equal(response.status, 413);
  assert.equal((await json(response)).error.code, "body_too_large");
});

test("SSE stream announces readiness and broadcasts created capture", async (t) => {
  const running = await startServer(t);
  const controller = new AbortController();
  t.after(() => controller.abort());
  const stream = await fetch(`${running.url}/v1/events/stream`, {
    headers: authHeaders(),
    signal: controller.signal,
  });
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get("content-type"), /text\/event-stream/);
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let received = "";
  while (!received.includes("event: ready")) {
    const { value } = await reader.read();
    received += decoder.decode(value, { stream: true });
  }

  const created = await fetch(`${running.url}/v1/captures`, {
    method: "POST",
    headers: authHeaders({
      "content-type": "application/json",
      "idempotency-key": "sse-1",
    }),
    body: JSON.stringify({ kind: "note", text: "stream me" }),
  });
  assert.equal(created.status, 201);
  while (!received.includes("event: capture.recorded")) {
    const { value } = await reader.read();
    received += decoder.decode(value, { stream: true });
  }
  assert.match(received, /"text":"stream me"/);
  await reader.cancel();
});
