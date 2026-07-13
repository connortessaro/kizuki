import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

const CATCH_ID_RE = /^cat_[0-9a-f]{12}$/;
const SIGNAL_ID_RE = /^sig_[0-9a-f]{12}$/;
const INSIGHT_ID_RE = /^ins_[0-9a-f]{12}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const INPUT_FIELDS = new Set(["note", "signalId", "insightId"]);
const EVENT_FIELDS = new Set(["version", "event", "catchId", "at", "note", "signalId", "insightId"]);

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(label + " must be an object");
  }
}

function assertKnownFields(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error("unknown " + label + " field " + JSON.stringify(key));
  }
}

function requiredNote(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("catch note must be a non-empty string");
  }
  const normalized = value.trim();
  if (normalized.length > 500) throw new Error("catch note must be at most 500 characters");
  return normalized;
}

function optionalId(value, re, label) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !re.test(value)) {
    throw new Error("invalid " + label + " " + JSON.stringify(value));
  }
  return value;
}

function assertIso(value, label) {
  if (typeof value !== "string" || !ISO_RE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(label + " must be an ISO timestamp");
  }
}

function toIso(now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error("catch event time must be a valid Date");
  }
  return now.toISOString();
}

export function validateCatchInput(input) {
  assertObject(input, "catch");
  assertKnownFields(input, INPUT_FIELDS, "catch");
  return {
    note: requiredNote(input.note),
    signalId: optionalId(input.signalId, SIGNAL_ID_RE, "signal ID"),
    insightId: optionalId(input.insightId, INSIGHT_ID_RE, "insight ID"),
  };
}

export function catchIdentity(input, at) {
  const normalized = validateCatchInput(input);
  assertIso(at, "catch at");
  const catchId = "cat_" + createHash("sha256").update(at + "|" + normalized.note).digest("hex").slice(0, 12);
  return { catchId, catch: normalized };
}

export function reduceCatchEvents(events) {
  if (!Array.isArray(events)) throw new Error("catch events must be an array");
  const states = new Map();
  for (const event of events) {
    assertObject(event, "catch event");
    if (event.version !== 1) throw new Error("invalid catch event version " + JSON.stringify(event.version));
    if (event.event !== "caught") throw new Error("unknown catch event " + JSON.stringify(event.event));
    assertKnownFields(event, EVENT_FIELDS, "catch event");
    if (typeof event.catchId !== "string" || !CATCH_ID_RE.test(event.catchId)) {
      throw new Error("invalid catch ID " + JSON.stringify(event.catchId));
    }
    assertIso(event.at, "catch event at");
    const identity = catchIdentity(
      { note: event.note, signalId: event.signalId, insightId: event.insightId },
      event.at,
    );
    if (identity.catchId !== event.catchId || identity.catch.note !== event.note) {
      throw new Error("catch identity mismatch for " + event.catchId);
    }
    if (states.has(event.catchId)) throw new Error("duplicate catch event for " + event.catchId);
    states.set(event.catchId, {
      catchId: event.catchId,
      at: event.at,
      note: event.note,
      signalId: identity.catch.signalId,
      insightId: identity.catch.insightId,
    });
  }
  return states;
}

export function planCatchCapture(events, input, { now = new Date() } = {}) {
  const states = reduceCatchEvents(events);
  const at = toIso(now);
  const { catchId, catch: normalized } = catchIdentity(input, at);
  const existing = states.get(catchId);
  if (existing) return { catchId, disposition: "exact-repeat", event: null, state: existing };
  const event = {
    version: 1,
    event: "caught",
    catchId,
    at,
    note: normalized.note,
    signalId: normalized.signalId,
    insightId: normalized.insightId,
  };
  const state = reduceCatchEvents([...events, event]).get(catchId);
  return { catchId, disposition: "created", event, state };
}

function eventsPath(vaultDir) {
  return join(vaultDir, "catches", "events.jsonl");
}

export async function readCatchEvents(vaultDir) {
  const path = eventsPath(vaultDir);
  let content;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  if (content === "") return [];
  const lines = content.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const events = [];
  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    if (line.trim() === "") throw new Error(path + ":" + lineNumber + ": blank JSONL line");
    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      throw new Error(path + ":" + lineNumber + ": malformed JSON: " + error.message);
    }
    events.push(event);
    try {
      reduceCatchEvents(events);
    } catch (error) {
      throw new Error(path + ":" + lineNumber + ": " + error.message);
    }
  }
  return events;
}

export async function writeCatchEventsAtomic(vaultDir, events) {
  reduceCatchEvents(events);
  const existing = await readCatchEvents(vaultDir);
  if (
    events.length < existing.length ||
    !existing.every((event, index) => isDeepStrictEqual(event, events[index]))
  ) {
    throw new Error("catch ledger is append-only; existing events cannot be removed or rewritten");
  }

  const dir = join(vaultDir, "catches");
  const path = eventsPath(vaultDir);
  const tempPath = join(dir, ".events.jsonl." + process.pid + "." + randomUUID() + ".tmp");
  const content = events.length === 0
    ? ""
    : events.map((event) => JSON.stringify(event)).join("\n") + "\n";
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(tempPath, content, { encoding: "utf8", flag: "wx" });
    await rename(tempPath, path);
  } catch (error) {
    try {
      await rm(tempPath, { force: true });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "catch ledger write failed and temp cleanup failed",
      );
    }
    throw error;
  }
}
