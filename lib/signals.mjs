import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

export const SIGNAL_STATUSES = Object.freeze(["open", "acted", "dismissed", "resolved"]);
export const DISMISS_REASONS = Object.freeze([
  "false-positive",
  "stale",
  "duplicate",
  "not-actionable",
  "low-value",
]);
export const AGENT_RECEIPT_SOURCES = Object.freeze([
  "slack",
  "github",
  "atlassian",
  "outlook",
  "transcript",
]);
export const PERSISTED_RECEIPT_SOURCES = Object.freeze([
  ...AGENT_RECEIPT_SOURCES,
  "legacy-alert",
  "legacy-v2",
]);

const SEVERITIES = Object.freeze(["info", "warn", "critical"]);
const TYPES = Object.freeze(["person", "project", "team"]);
const SEVERITY_RANK = Object.freeze({ info: 0, warn: 1, critical: 2 });
const TOPIC_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SIGNAL_ID_RE = /^sig_[0-9a-f]{12}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertIso(value, label) {
  if (typeof value !== "string" || !ISO_RE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be an ISO timestamp`);
  }
}

function assertName(name) {
  assertNonEmptyString(name, "signal candidate name");
  if (name.includes("..") || name.includes("/") || name.includes("\\") || name.includes("\0")) {
    throw new Error("signal candidate name is not path-safe");
  }
}

function assertLocator(locator) {
  assertNonEmptyString(locator, "signal receipt locator");
  if (locator.includes("?") || locator.includes("#") || locator.includes("\0")) {
    throw new Error("signal receipt locator must not contain a query string or fragment");
  }
  if (/(?:x-amz-signature|signature|sig|token|access_token)=/i.test(locator)) {
    throw new Error("signal receipt locator must not contain a signed parameter");
  }
  try {
    const parsed = new URL(locator, "https://locator.invalid");
    if (parsed.username || parsed.password) {
      throw new Error("signal receipt locator must not contain credentials");
    }
  } catch (error) {
    if (error.message === "signal receipt locator must not contain credentials") throw error;
  }
}

export function validateSignalCandidate(candidate, { receiptSources = PERSISTED_RECEIPT_SOURCES } = {}) {
  assertObject(candidate, "signal candidate");
  if (!SEVERITIES.includes(candidate.severity)) {
    throw new Error(`invalid signal severity ${JSON.stringify(candidate.severity)}`);
  }
  assertNonEmptyString(candidate.kind, "signal candidate kind");
  if (!TOPIC_RE.test(candidate.kind)) throw new Error("signal candidate kind must be lowercase kebab-case");
  if (!TYPES.includes(candidate.type)) {
    throw new Error(`invalid signal entity type ${JSON.stringify(candidate.type)}`);
  }
  assertName(candidate.name);
  if (typeof candidate.topic !== "string" || !TOPIC_RE.test(candidate.topic)) {
    throw new Error("signal topic must be lowercase kebab-case");
  }
  assertNonEmptyString(candidate.evidence, "signal candidate evidence");
  if (candidate.draft !== undefined && candidate.draft !== null) {
    assertNonEmptyString(candidate.draft, "signal candidate draft");
  }
  if (!Array.isArray(candidate.receipts) || candidate.receipts.length === 0) {
    throw new Error("signal candidate requires at least one receipt");
  }
  for (const [index, receipt] of candidate.receipts.entries()) {
    assertObject(receipt, `signal receipt ${index + 1}`);
    if (!receiptSources.includes(receipt.source)) {
      throw new Error(`invalid signal receipt source ${JSON.stringify(receipt.source)}`);
    }
    assertLocator(receipt.locator);
    assertIso(receipt.observedAt, `signal receipt ${index + 1} observedAt`);
    assertNonEmptyString(receipt.excerpt, `signal receipt ${index + 1} excerpt`);
  }
  return candidate;
}

export function signalIdentity(candidate) {
  validateSignalCandidate(candidate);
  const dedupeKey = JSON.stringify([candidate.kind, candidate.type, candidate.name, candidate.topic]);
  const signalId = `sig_${createHash("sha256").update(dedupeKey).digest("hex").slice(0, 12)}`;
  return { signalId, dedupeKey };
}

function receiptKey(receipt) {
  return JSON.stringify([receipt.source, receipt.locator]);
}

function newReceipts(state, candidate) {
  if (!state) return [...candidate.receipts];
  const known = new Set(state.receipts.map(receiptKey));
  return candidate.receipts.filter((receipt) => !known.has(receiptKey(receipt)));
}

function mergeReceipts(existing, incoming) {
  const merged = [...existing];
  const known = new Set(existing.map(receiptKey));
  for (const receipt of incoming) {
    const key = receiptKey(receipt);
    if (!known.has(key)) {
      known.add(key);
      merged.push(receipt);
    }
  }
  return merged;
}

function assertSignalId(signalId) {
  if (typeof signalId !== "string" || !SIGNAL_ID_RE.test(signalId)) {
    throw new Error(`invalid signal ID ${JSON.stringify(signalId)}`);
  }
}

function expectedObservationReason(state, candidate) {
  if (!state) return "created";
  const severityChange = SEVERITY_RANK[candidate.severity] - SEVERITY_RANK[state.severity];
  const addedReceipts = newReceipts(state, candidate);
  if (severityChange > 0) return "severity-increased";
  if (addedReceipts.length > 0) return "new-receipt";
  if (severityChange < 0) return null;
  throw new Error("exact repeat observation is invalid");
}

function validateObservedEvent(event, states, idsByKey) {
  assertSignalId(event.signalId);
  assertNonEmptyString(event.dedupeKey, "signal dedupeKey");
  assertIso(event.at, "signal event at");
  validateSignalCandidate(event.candidate);

  const existing = states.get(event.signalId);
  if (existing && existing.dedupeKey !== event.dedupeKey) {
    throw new Error(`signal hash collision for ${event.signalId}`);
  }
  const identity = signalIdentity(event.candidate);
  if (event.dedupeKey !== identity.dedupeKey || event.signalId !== identity.signalId) {
    throw new Error(`signal identity mismatch for ${event.signalId}`);
  }
  const existingId = idsByKey.get(event.dedupeKey);
  if (existingId && existingId !== event.signalId) {
    throw new Error(`signal hash collision for ${event.signalId}`);
  }
  const expectedReason = expectedObservationReason(existing, event.candidate);
  if (event.surfaceReason !== expectedReason) {
    if (!existing) throw new Error("first observation must use surfaceReason created");
    throw new Error(`invalid observation surfaceReason for ${event.signalId}`);
  }
  if (existing && Date.parse(event.at) < Date.parse(existing.lastEventAt)) {
    throw new Error(`signal event order is invalid for ${event.signalId}`);
  }
  return existing;
}

function applyObservedEvent(event, existing) {
  const receipts = mergeReceipts(existing?.receipts ?? [], event.candidate.receipts);
  return {
    signalId: event.signalId,
    dedupeKey: event.dedupeKey,
    status: existing?.status ?? "open",
    severity: event.candidate.severity,
    kind: event.candidate.kind,
    type: event.candidate.type,
    name: event.candidate.name,
    topic: event.candidate.topic,
    evidence: event.candidate.evidence,
    draft: event.candidate.draft ?? null,
    candidate: event.candidate,
    receipts,
    firstSeenAt: existing?.firstSeenAt ?? event.at,
    lastSeenAt: event.at,
    lastSurfacedAt: event.surfaceReason === null ? existing?.lastSurfacedAt ?? null : event.at,
    lastEventAt: event.at,
  };
}

function validStatusChange(event, state) {
  if (event.from !== state.status) {
    throw new Error(`mismatched from status for ${event.signalId}: expected ${state.status}`);
  }
  if (!SIGNAL_STATUSES.includes(event.to)) {
    throw new Error(`invalid signal status ${JSON.stringify(event.to)}`);
  }
  if (!["user", "system"].includes(event.actor)) {
    throw new Error(`invalid signal actor ${JSON.stringify(event.actor)}`);
  }
  if (event.note !== null && event.note !== undefined) {
    assertNonEmptyString(event.note, "signal transition note");
  }

  if (event.actor === "user") {
    const allowed =
      (event.from === "open" && ["acted", "dismissed", "resolved"].includes(event.to)) ||
      (event.from === "acted" && ["dismissed", "resolved"].includes(event.to));
    if (!allowed) throw new Error(`cannot transition signal from ${event.from} to ${event.to}`);
    if (event.to === "dismissed") {
      if (!DISMISS_REASONS.includes(event.reason)) throw new Error("dismiss reason is required and must be valid");
    } else if (event.reason !== null && event.reason !== undefined) {
      throw new Error(`transition to ${event.to} must not include a reason`);
    }
    return;
  }

  const reopening =
    ["dismissed", "resolved"].includes(event.from) &&
    event.to === "open" &&
    ["new-proof", "higher-severity"].includes(event.reason);
  const legacyImport =
    event.to === "resolved" && event.from !== "resolved" && event.reason === "legacy-import";
  if (!reopening && !legacyImport) {
    throw new Error(`cannot transition signal from ${event.from} to ${event.to}`);
  }
}

function validateStatusEvent(event, states) {
  assertSignalId(event.signalId);
  assertIso(event.at, "signal event at");
  const state = states.get(event.signalId);
  if (!state) throw new Error(`unknown signal ${event.signalId}`);
  if (Date.parse(event.at) < Date.parse(state.lastEventAt)) {
    throw new Error(`signal event order is invalid for ${event.signalId}`);
  }
  validStatusChange(event, state);
  return state;
}

export function reduceSignalEvents(events) {
  if (!Array.isArray(events)) throw new Error("signal events must be an array");
  const states = new Map();
  const idsByKey = new Map();

  for (const event of events) {
    assertObject(event, "signal event");
    if (event.version !== 1) throw new Error(`invalid signal event version ${JSON.stringify(event.version)}`);
    if (event.event === "observed") {
      const existing = validateObservedEvent(event, states, idsByKey);
      states.set(event.signalId, applyObservedEvent(event, existing));
      idsByKey.set(event.dedupeKey, event.signalId);
      continue;
    }
    if (event.event === "status_changed") {
      const state = validateStatusEvent(event, states);
      states.set(event.signalId, {
        ...state,
        status: event.to,
        lastEventAt: event.at,
      });
      continue;
    }
    throw new Error(`invalid signal event ${JSON.stringify(event.event)}`);
  }
  return states;
}

function toIso(now) {
  const value = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(value.getTime())) throw new Error("now must be a valid date");
  return value.toISOString();
}

function observationEvent(candidate, state, at) {
  const { signalId, dedupeKey } = signalIdentity(candidate);
  return {
    version: 1,
    event: "observed",
    signalId,
    dedupeKey,
    at,
    candidate,
    surfaceReason: expectedObservationReason(state, candidate),
  };
}

function automaticReopenEvent(state, at, surfaceReason) {
  return {
    version: 1,
    event: "status_changed",
    signalId: state.signalId,
    from: state.status,
    to: "open",
    at,
    actor: "system",
    reason: surfaceReason === "severity-increased" ? "higher-severity" : "new-proof",
    note: null,
  };
}

export function planSignalIngestion(
  events,
  candidates,
  { now = new Date(), reopenTerminal = true } = {},
) {
  if (!Array.isArray(candidates)) throw new Error("signal candidates must be an array");
  const at = toIso(now);
  const planned = [];
  const surfaced = [];
  let states = reduceSignalEvents(events);

  for (const candidate of candidates) {
    validateSignalCandidate(candidate);
    const { signalId } = signalIdentity(candidate);
    const state = states.get(signalId);
    let observed;
    try {
      observed = observationEvent(candidate, state, at);
    } catch (error) {
      if (error.message === "exact repeat observation is invalid") continue;
      throw error;
    }
    planned.push(observed);
    if (observed.surfaceReason !== null) surfaced.push(candidate);

    if (
      state &&
      reopenTerminal &&
      ["dismissed", "resolved"].includes(state.status) &&
      ["new-receipt", "severity-increased"].includes(observed.surfaceReason)
    ) {
      planned.push(automaticReopenEvent(state, at, observed.surfaceReason));
    }
    states = reduceSignalEvents([...events, ...planned]);
  }
  return { events: planned, surfaced };
}

export function planSignalTransition(events, transition, { now = new Date() } = {}) {
  assertObject(transition, "signal transition");
  assertSignalId(transition.signalId);
  const states = reduceSignalEvents(events);
  const state = states.get(transition.signalId);
  if (!state) throw new Error(`unknown signal ${transition.signalId}`);
  const event = {
    version: 1,
    event: "status_changed",
    signalId: transition.signalId,
    from: state.status,
    to: transition.to,
    at: toIso(now),
    actor: transition.actor ?? "user",
    reason: transition.reason ?? null,
    note: transition.note ?? null,
  };
  reduceSignalEvents([...events, event]);
  return event;
}

function eventsPath(vaultDir) {
  return join(vaultDir, "signals", "events.jsonl");
}

export async function readSignalEvents(vaultDir) {
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
    if (line.trim() === "") throw new Error(`${path}:${lineNumber}: blank JSONL line`);
    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      throw new Error(`${path}:${lineNumber}: malformed JSON: ${error.message}`);
    }
    events.push(event);
    try {
      reduceSignalEvents(events);
    } catch (error) {
      throw new Error(`${path}:${lineNumber}: ${error.message}`);
    }
  }
  return events;
}

export async function writeSignalEventsAtomic(
  vaultDir,
  events,
  { writeFileImpl = writeFile, renameImpl = rename, rmImpl = rm } = {},
) {
  reduceSignalEvents(events);
  const existing = await readSignalEvents(vaultDir);
  if (events.length < existing.length || !existing.every((event, index) => isDeepStrictEqual(event, events[index]))) {
    throw new Error("signal ledger is append-only; existing events cannot be removed or rewritten");
  }

  const dir = join(vaultDir, "signals");
  const path = eventsPath(vaultDir);
  const tempPath = join(dir, `.events.jsonl.${process.pid}.${randomUUID()}.tmp`);
  const content = events.length === 0 ? "" : `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
  await mkdir(dir, { recursive: true });
  try {
    await writeFileImpl(tempPath, content, { encoding: "utf8", flag: "wx" });
    await renameImpl(tempPath, path);
  } catch (error) {
    try {
      await rmImpl(tempPath, { force: true });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "signal ledger write failed and temp cleanup failed",
      );
    }
    throw error;
  }
}
