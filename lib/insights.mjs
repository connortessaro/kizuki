import { createHash, randomUUID as defaultRandomUUID } from "node:crypto";
import {
  mkdir as defaultMkdir,
  readFile as defaultReadFile,
  rename as defaultRename,
  rm as defaultRm,
  writeFile as defaultWriteFile,
} from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { assertName, assertType } from "./query.mjs";

export const INSIGHT_KINDS = Object.freeze([
  "decision",
  "learning",
  "hypothesis",
  "question",
]);
export const INSIGHT_STATUSES = Object.freeze(["active", "archived"]);
export const ORIGIN_CLIENTS = Object.freeze(["codex", "cursor", "other"]);

const INSIGHT_ID_RE = /^ins_[0-9a-f]{12}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const INPUT_FIELDS = new Set(["kind", "summary", "context", "entities", "origin"]);
const ENTITY_FIELDS = new Set(["type", "name"]);
const ORIGIN_FIELDS = new Set(["client", "locator"]);
const CAPTURE_EVENT_FIELDS = new Set([
  "version",
  "event",
  "insightId",
  "dedupeKey",
  "at",
  "insight",
]);
const ARCHIVE_EVENT_FIELDS = new Set([
  "version",
  "event",
  "insightId",
  "from",
  "to",
  "at",
  "actor",
  "note",
]);

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

function requiredText(value, label, max) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(label + " must be a non-empty string");
  }
  const normalized = value.trim();
  if (normalized.length > max) throw new Error(label + " must be at most " + max.toLocaleString("en-US") + " characters");
  return normalized;
}

function optionalText(value, label, max) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error(label + " must be a string");
  const normalized = value.trim();
  if (normalized === "") return null;
  if (normalized.length > max) throw new Error(label + " must be at most " + max.toLocaleString("en-US") + " characters");
  return normalized;
}

function transitionNote(value) {
  if (value === undefined || value === null) return null;
  return requiredText(value, "insight archive note", 500);
}

function assertIso(value, label) {
  if (typeof value !== "string" || !ISO_RE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(label + " must be an ISO timestamp");
  }
}

function toIso(now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error("insight event time must be a valid Date");
  }
  return now.toISOString();
}

function assertInsightId(insightId) {
  if (typeof insightId !== "string" || !INSIGHT_ID_RE.test(insightId)) {
    throw new Error("invalid insight ID " + JSON.stringify(insightId));
  }
}

function assertLocator(locator) {
  if (locator.includes("?") || locator.includes("#") || locator.includes("\0")) {
    throw new Error("insight origin locator must not contain a query string, fragment, or NUL");
  }
  if (/(?:x-amz-signature|signature|sig|token|access_token)=/i.test(locator)) {
    throw new Error("insight origin locator must not contain a signed parameter");
  }
  try {
    const parsed = new URL(locator, "https://locator.invalid");
    if (parsed.username || parsed.password) {
      throw new Error("insight origin locator must not contain credentials");
    }
  } catch (error) {
    if (error.message === "insight origin locator must not contain credentials") throw error;
  }
}

export function validateInsightInput(input) {
  assertObject(input, "insight");
  assertKnownFields(input, INPUT_FIELDS, "insight");
  if (!INSIGHT_KINDS.includes(input.kind)) {
    throw new Error("invalid insight kind " + JSON.stringify(input.kind));
  }
  const summary = requiredText(input.summary, "insight summary", 500);
  const context = optionalText(input.context, "insight context", 4000);

  const entities = input.entities ?? [];
  if (!Array.isArray(entities)) throw new Error("insight entities must be an array");
  if (entities.length > 5) throw new Error("insight entities must contain at most 5 references");
  const normalizedEntities = [];
  const entityKeys = new Set();
  for (const [index, entity] of entities.entries()) {
    assertObject(entity, "insight entity " + (index + 1));
    assertKnownFields(entity, ENTITY_FIELDS, "insight entity");
    assertType(entity.type);
    assertName(entity.name);
    const key = entity.type + "/" + entity.name;
    if (entityKeys.has(key)) throw new Error("duplicate insight entity " + key);
    entityKeys.add(key);
    normalizedEntities.push({ type: entity.type, name: entity.name });
  }
  normalizedEntities.sort((left, right) =>
    (left.type + "/" + left.name).localeCompare(right.type + "/" + right.name));

  assertObject(input.origin, "insight origin");
  assertKnownFields(input.origin, ORIGIN_FIELDS, "insight origin");
  if (!ORIGIN_CLIENTS.includes(input.origin.client)) {
    throw new Error("invalid insight origin client " + JSON.stringify(input.origin.client));
  }
  const locator = optionalText(input.origin.locator, "insight origin locator", 2000);
  if (locator !== null) assertLocator(locator);

  return {
    kind: input.kind,
    summary,
    context,
    entities: normalizedEntities,
    origin: { client: input.origin.client, locator },
  };
}

export function insightIdentity(input) {
  const insight = validateInsightInput(input);
  const dedupeKey = JSON.stringify([
    insight.kind,
    insight.summary,
    insight.context ?? "",
    insight.entities,
    insight.origin.client,
    insight.origin.locator,
  ]);
  const insightId =
    "ins_" + createHash("sha256").update(dedupeKey).digest("hex").slice(0, 12);
  return { insightId, dedupeKey, insight };
}

function validateCaptureEvent(event, states, idsByKey) {
  assertKnownFields(event, CAPTURE_EVENT_FIELDS, "captured insight event");
  assertInsightId(event.insightId);
  if (typeof event.dedupeKey !== "string" || event.dedupeKey === "") {
    throw new Error("insight dedupeKey must be a non-empty string");
  }
  assertIso(event.at, "insight event at");

  const existing = states.get(event.insightId);
  if (existing && existing.dedupeKey !== event.dedupeKey) {
    throw new Error("insight hash collision for " + event.insightId);
  }
  const existingId = idsByKey.get(event.dedupeKey);
  if (existingId && existingId !== event.insightId) {
    throw new Error("insight hash collision for " + event.insightId);
  }
  if (existing) throw new Error("duplicate captured event for " + event.insightId);

  const identity = insightIdentity(event.insight);
  if (identity.insightId !== event.insightId || identity.dedupeKey !== event.dedupeKey) {
    throw new Error("insight identity mismatch for " + event.insightId);
  }
  return identity.insight;
}

function validateArchiveEvent(event, states) {
  assertKnownFields(event, ARCHIVE_EVENT_FIELDS, "archived insight event");
  assertInsightId(event.insightId);
  assertIso(event.at, "insight event at");
  const state = states.get(event.insightId);
  if (!state) throw new Error("unknown insight " + event.insightId);
  if (event.from !== state.status) {
    throw new Error(
      "mismatched from status for " + event.insightId + ": expected " + state.status,
    );
  }
  if (event.to !== "archived") throw new Error("invalid insight status " + JSON.stringify(event.to));
  if (event.actor !== "user") throw new Error("invalid insight actor " + JSON.stringify(event.actor));
  transitionNote(event.note);
  if (Date.parse(event.at) < Date.parse(state.lastEventAt)) {
    throw new Error("insight event order is invalid for " + event.insightId);
  }
  return state;
}

export function reduceInsightEvents(events) {
  if (!Array.isArray(events)) throw new Error("insight events must be an array");
  const states = new Map();
  const idsByKey = new Map();
  for (const event of events) {
    assertObject(event, "insight event");
    if (event.version !== 1) throw new Error("invalid insight event version " + JSON.stringify(event.version));
    if (event.event === "captured") {
      const insight = validateCaptureEvent(event, states, idsByKey);
      idsByKey.set(event.dedupeKey, event.insightId);
      states.set(event.insightId, {
        insightId: event.insightId,
        dedupeKey: event.dedupeKey,
        status: "active",
        kind: insight.kind,
        summary: insight.summary,
        context: insight.context,
        entities: insight.entities,
        origin: insight.origin,
        capturedAt: event.at,
        lastEventAt: event.at,
      });
      continue;
    }
    if (event.event === "insight_archived") {
      const state = validateArchiveEvent(event, states);
      states.set(event.insightId, {
        ...state,
        status: "archived",
        lastEventAt: event.at,
      });
      continue;
    }
    throw new Error("unknown insight event " + JSON.stringify(event.event));
  }
  return states;
}

export function planInsightCapture(events, input, { now = new Date() } = {}) {
  const states = reduceInsightEvents(events);
  const { insightId, dedupeKey, insight } = insightIdentity(input);
  const existing = states.get(insightId);
  if (existing) {
    if (existing.dedupeKey !== dedupeKey) throw new Error("insight hash collision for " + insightId);
    return {
      insightId,
      disposition: "exact-repeat",
      event: null,
      state: existing,
    };
  }
  const event = {
    version: 1,
    event: "captured",
    insightId,
    dedupeKey,
    at: toIso(now),
    insight,
  };
  const state = reduceInsightEvents([...events, event]).get(insightId);
  return { insightId, disposition: "created", event, state };
}

export function planInsightArchive(events, transition, { now = new Date() } = {}) {
  assertObject(transition, "insight archive transition");
  assertKnownFields(transition, new Set(["insightId", "note"]), "insight archive");
  assertInsightId(transition.insightId);
  const states = reduceInsightEvents(events);
  const state = states.get(transition.insightId);
  if (!state) throw new Error("unknown insight " + transition.insightId);
  if (state.status === "archived") throw new Error("insight " + transition.insightId + " is already archived");
  const event = {
    version: 1,
    event: "insight_archived",
    insightId: transition.insightId,
    from: state.status,
    to: "archived",
    at: toIso(now),
    actor: "user",
    note: transitionNote(transition.note),
  };
  reduceInsightEvents([...events, event]);
  return event;
}

function eventsPath(vaultDir) {
  return join(vaultDir, "insights", "events.jsonl");
}

export async function readInsightEvents(vaultDir) {
  const path = eventsPath(vaultDir);
  let content;
  try {
    content = await defaultReadFile(path, "utf8");
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
      reduceInsightEvents(events);
    } catch (error) {
      throw new Error(path + ":" + lineNumber + ": " + error.message);
    }
  }
  return events;
}

export async function writeInsightEventsAtomic(
  vaultDir,
  events,
  {
    mkdir = defaultMkdir,
    writeFile = defaultWriteFile,
    rename = defaultRename,
    rm = defaultRm,
    randomUUID = defaultRandomUUID,
  } = {},
) {
  reduceInsightEvents(events);
  const existing = await readInsightEvents(vaultDir);
  if (
    events.length < existing.length ||
    !existing.every((event, index) => isDeepStrictEqual(event, events[index]))
  ) {
    throw new Error("insight ledger is append-only; existing events cannot be removed or rewritten");
  }

  const dir = join(vaultDir, "insights");
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
        "insight ledger write failed and temp cleanup failed",
      );
    }
    throw error;
  }
}
