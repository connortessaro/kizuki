import { createServer } from "node:http";
import { randomUUID as defaultRandomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { capturePlatformEvent, listPlatformCaptures } from "../lib/platformEventStore.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OPENAPI_PATH = join(__dirname, "openapi.json");
const MAX_BODY_BYTES = 64 * 1024;
const HEARTBEAT_MS = 25_000;
const BEARER_PREFIX = "Bearer ";

class BodyTooLargeError extends Error {
  constructor() {
    super("request body exceeds 64KiB limit");
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function sendError(res, status, code, message) {
  sendJson(res, status, { error: { code, message } });
}

function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function isAuthorized(req, token) {
  const header = req.headers.authorization;
  if (typeof header !== "string" || !header.startsWith(BEARER_PREFIX)) return false;
  return timingSafeStringEqual(header.slice(BEARER_PREFIX.length), token);
}

async function readJsonBody(req, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new BodyTooLargeError();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function createApiHandler({
  vaultDir,
  token,
  now = () => new Date(),
  randomUUID = defaultRandomUUID,
  capture = capturePlatformEvent,
  listCaptures = listPlatformCaptures,
  openapiPath = DEFAULT_OPENAPI_PATH,
} = {}) {
  if (typeof vaultDir !== "string" || vaultDir === "") throw new Error("api handler requires vaultDir");
  if (typeof token !== "string" || token.length < 32) {
    throw new Error("api handler requires a token of at least 32 characters");
  }

  const sseClients = new Set();

  function broadcastCapture(event) {
    const frame = `event: capture.recorded\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(frame);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  async function handleHealth(req, res) {
    if (req.method !== "GET") return sendError(res, 405, "method_not_allowed", "method not allowed");
    return sendJson(res, 200, { data: { status: "ok", version: 1 } });
  }

  async function handleOpenapi(req, res) {
    if (req.method !== "GET") return sendError(res, 405, "method_not_allowed", "method not allowed");
    const schema = await readFile(openapiPath, "utf8");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(schema);
  }

  async function handleListCaptures(req, res, url) {
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam === null ? 50 : Number(limitParam);
    let captures;
    try {
      captures = await listCaptures(vaultDir, { limit });
    } catch (error) {
      return sendError(res, 400, "invalid_request", error.message);
    }
    return sendJson(res, 200, { data: captures });
  }

  async function handleCreateCapture(req, res) {
    let raw;
    try {
      raw = await readJsonBody(req, MAX_BODY_BYTES);
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        res.shouldKeepAlive = false;
        return sendError(res, 413, "body_too_large", error.message);
      }
      throw error;
    }

    const contentType = String(req.headers["content-type"] ?? "").split(";")[0].trim();
    if (contentType !== "application/json") {
      return sendError(res, 415, "unsupported_media_type", "Content-Type must be application/json");
    }

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return sendError(res, 400, "invalid_json", "request body must be valid JSON");
    }

    const idempotencyKey = req.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string" || idempotencyKey.trim() === "") {
      return sendError(res, 400, "missing_idempotency_key", "Idempotency-Key header is required");
    }

    let result;
    try {
      result = await capture(vaultDir, body, { now: now(), randomUUID, idempotencyKey });
    } catch (error) {
      if (/^idempotency key already used:/.test(error.message)) {
        return sendError(res, 409, "idempotency_conflict", error.message);
      }
      return sendError(res, 400, "invalid_request", error.message);
    }

    if (result.disposition === "created") broadcastCapture(result.event);
    return sendJson(res, result.disposition === "created" ? 201 : 200, { data: result });
  }

  function handleStream(req, res) {
    if (req.method !== "GET") return sendError(res, 405, "method_not_allowed", "method not allowed");
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write("event: ready\ndata: {}\n\n");
    sseClients.add(res);
    const heartbeat = setInterval(() => {
      try {
        res.write(": heartbeat\n\n");
      } catch {
        // connection already gone; the close handler below reaps it
      }
    }, HEARTBEAT_MS);
    heartbeat.unref?.();
    req.on("close", () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
  }

  return async function handleRequest(req, res) {
    let url;
    try {
      url = new URL(req.url, "http://api.local");
    } catch {
      return sendError(res, 400, "invalid_request", "invalid request URL");
    }

    if (!isAuthorized(req, token)) {
      return sendError(res, 401, "unauthorized", "valid bearer token required");
    }

    try {
      if (url.pathname === "/v1/health") return await handleHealth(req, res);
      if (url.pathname === "/openapi.json") return await handleOpenapi(req, res);
      if (url.pathname === "/v1/captures") {
        if (req.method === "GET") return await handleListCaptures(req, res, url);
        if (req.method === "POST") return await handleCreateCapture(req, res);
        return sendError(res, 405, "method_not_allowed", "method not allowed");
      }
      if (url.pathname === "/v1/events/stream") return handleStream(req, res);
      return sendError(res, 404, "not_found", "route not found");
    } catch (error) {
      return sendError(res, 500, "internal_error", error.message);
    }
  };
}

export function createApiServer(options) {
  return createServer(createApiHandler(options));
}

export function listenApiServer({ host = "127.0.0.1", port = 4247, ...options } = {}) {
  return new Promise((resolve, reject) => {
    const server = createApiServer(options);
    const sockets = new Set();
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address();
      resolve({
        server,
        host,
        port: address.port,
        url: `http://${host}:${address.port}`,
        close: () => new Promise((resolveClose, rejectClose) => {
          for (const socket of sockets) socket.destroy();
          server.close((error) => (error ? rejectClose(error) : resolveClose()));
        }),
      });
    });
  });
}
