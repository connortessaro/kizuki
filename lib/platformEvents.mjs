import { isDeepStrictEqual } from "node:util";

export const EVENT_VERSION = 1;
export const CAPTURE_KINDS = Object.freeze([
  "note",
  "correction",
  "decision",
  "hypothesis",
  "question",
]);
export const LOCAL_CONTEXT = Object.freeze({
  workspaceId: "personal",
  principalId: "local-operator",
  sourceOwnerId: "local-operator",
  allowedVisibility: Object.freeze(["private"]),
});

const ENTITY_TYPES = Object.freeze(["person", "project", "team"]);
const INPUT_FIELDS = new Set(["kind", "text", "entity", "visibility", "packIds", "receipts"]);
const EVENT_FIELDS = new Set([
  "version",
  "eventId",
  "type",
  "at",
  "workspaceId",
  "principalId",
  "sourceOwnerId",
  "visibility",
  "packIds",
  "receipts",
  "idempotencyKey",
  "aggregate",
  "payload",
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertOnlyFields(value, fields, label) {
  for (const field of Object.keys(value)) {
    if (!fields.has(field)) throw new Error(`unknown ${label} field ${field}`);
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

function assertUuidId(value, prefix, label) {
  if (typeof value !== "string" || !value.startsWith(prefix) || !UUID_RE.test(value.slice(prefix.length))) {
    throw new Error(`invalid ${label}`);
  }
}

function validateEntity(entity) {
  if (entity === undefined || entity === null) return null;
  assertObject(entity, "capture entity");
  assertOnlyFields(entity, new Set(["type", "name"]), "capture entity");
  if (!ENTITY_TYPES.includes(entity.type)) {
    throw new Error(`invalid capture entity type ${JSON.stringify(entity.type)}`);
  }
  assertNonEmptyString(entity.name, "capture entity name");
  if (entity.name.includes("..") || entity.name.includes("/") || entity.name.includes("\\") || entity.name.includes("\0")) {
    throw new Error("capture entity name is not path-safe");
  }
  return { type: entity.type, name: entity.name.trim() };
}

function validatePackIds(packIds = []) {
  if (!Array.isArray(packIds)) throw new Error("capture packIds must be an array");
  const seen = new Set();
  return packIds.map((packId) => {
    if (typeof packId !== "string" || !KEBAB_RE.test(packId)) {
      throw new Error("capture Pack ID must be lowercase kebab-case");
    }
    if (seen.has(packId)) throw new Error(`duplicate Pack ID ${packId}`);
    seen.add(packId);
    return packId;
  });
}

function assertReceiptLocator(locator) {
  assertNonEmptyString(locator, "capture receipt locator");
  if (locator.includes("?") || locator.includes("#") || locator.includes("\0")) {
    throw new Error("capture receipt locator must not contain a query string or fragment");
  }
  if (/(?:x-amz-signature|signature|sig|token|access_token)=/i.test(locator)) {
    throw new Error("capture receipt locator must not contain a signed parameter");
  }
  try {
    const parsed = new URL(locator, "https://locator.invalid");
    if (parsed.username || parsed.password) {
      throw new Error("capture receipt locator must not contain credentials");
    }
  } catch (error) {
    if (error.message === "capture receipt locator must not contain credentials") throw error;
  }
}

function validateReceipts(receipts = []) {
  if (!Array.isArray(receipts)) throw new Error("capture receipts must be an array");
  return receipts.map((receipt, index) => {
    assertObject(receipt, `capture receipt ${index + 1}`);
    assertOnlyFields(receipt, new Set(["source", "locator", "observedAt", "excerpt"]), "capture receipt");
    assertNonEmptyString(receipt.source, `capture receipt ${index + 1} source`);
    if (!KEBAB_RE.test(receipt.source)) throw new Error("capture receipt source must be lowercase kebab-case");
    assertReceiptLocator(receipt.locator);
    assertIso(receipt.observedAt, `capture receipt ${index + 1} observedAt`);
    assertNonEmptyString(receipt.excerpt, `capture receipt ${index + 1} excerpt`);
    return {
      source: receipt.source,
      locator: receipt.locator,
      observedAt: receipt.observedAt,
      excerpt: receipt.excerpt.trim(),
    };
  });
}

export function validateCaptureInput(input) {
  assertObject(input, "capture input");
  assertOnlyFields(input, INPUT_FIELDS, "capture");
  if (!CAPTURE_KINDS.includes(input.kind)) {
    throw new Error(`invalid capture kind ${JSON.stringify(input.kind)}`);
  }
  assertNonEmptyString(input.text, "capture text");
  const text = input.text.trim();
  if (text.length > 50_000) throw new Error("capture text must be at most 50000 characters");
  const visibility = input.visibility ?? "private";
  if (visibility !== "private") throw new Error("capture visibility must be private");
  return {
    kind: input.kind,
    text,
    entity: validateEntity(input.entity),
    visibility,
    packIds: validatePackIds(input.packIds),
    receipts: validateReceipts(input.receipts),
  };
}

function validateContext(context) {
  assertObject(context, "capture context");
  for (const field of ["workspaceId", "principalId", "sourceOwnerId"]) {
    assertNonEmptyString(context[field], `capture context ${field}`);
  }
  if (!Array.isArray(context.allowedVisibility) || !context.allowedVisibility.includes("private")) {
    throw new Error("capture context does not allow private visibility");
  }
  return context;
}

function commandFingerprint(input, context) {
  return {
    workspaceId: context.workspaceId,
    principalId: context.principalId,
    sourceOwnerId: context.sourceOwnerId,
    visibility: { scope: input.visibility, principalIds: [context.principalId] },
    packIds: input.packIds,
    receipts: input.receipts,
    payload: { kind: input.kind, text: input.text, entity: input.entity },
  };
}

function eventFingerprint(event) {
  return {
    workspaceId: event.workspaceId,
    principalId: event.principalId,
    sourceOwnerId: event.sourceOwnerId,
    visibility: event.visibility,
    packIds: event.packIds,
    receipts: event.receipts,
    payload: event.payload,
  };
}

export function planCaptureEvent(events, rawInput, rawContext, {
  now = new Date(),
  randomUUID,
  idempotencyKey,
} = {}) {
  if (!Array.isArray(events)) throw new Error("platform events must be an array");
  for (const event of events) validatePlatformEvent(event);
  const input = validateCaptureInput(rawInput);
  const context = validateContext(rawContext);
  assertNonEmptyString(idempotencyKey, "capture idempotencyKey");

  const existing = events.find((event) =>
    event.workspaceId === context.workspaceId &&
    event.principalId === context.principalId &&
    event.idempotencyKey === idempotencyKey
  );
  if (existing) {
    if (!isDeepStrictEqual(eventFingerprint(existing), commandFingerprint(input, context))) {
      throw new Error(`idempotency key already used: ${idempotencyKey}`);
    }
    return { disposition: "existing", event: existing };
  }

  if (typeof randomUUID !== "function") throw new Error("capture randomUUID is required");
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) throw new Error("capture now must be a valid Date");
  const event = {
    version: EVENT_VERSION,
    eventId: `evt_${randomUUID()}`,
    type: "capture.recorded",
    at: now.toISOString(),
    ...commandFingerprint(input, context),
    idempotencyKey,
    aggregate: {
      type: "capture",
      id: `cap_${randomUUID()}`,
      version: 1,
    },
  };
  validatePlatformEvent(event);
  return { disposition: "created", event };
}

function validateVisibility(visibility, principalId) {
  assertObject(visibility, "platform event visibility");
  assertOnlyFields(visibility, new Set(["scope", "principalIds"]), "platform event visibility");
  if (visibility.scope !== "private") throw new Error("platform event visibility scope must be private");
  if (!Array.isArray(visibility.principalIds) || visibility.principalIds.length !== 1 || visibility.principalIds[0] !== principalId) {
    throw new Error("private platform event visibility must name its principal");
  }
}

export function validatePlatformEvent(event) {
  assertObject(event, "platform event");
  assertOnlyFields(event, EVENT_FIELDS, "platform event");
  if (event.version !== EVENT_VERSION) throw new Error(`invalid platform event version ${JSON.stringify(event.version)}`);
  assertUuidId(event.eventId, "evt_", "platform event ID");
  if (event.type !== "capture.recorded") throw new Error(`invalid platform event type ${JSON.stringify(event.type)}`);
  assertIso(event.at, "platform event at");
  for (const field of ["workspaceId", "principalId", "sourceOwnerId", "idempotencyKey"]) {
    assertNonEmptyString(event[field], `platform event ${field}`);
  }
  validateVisibility(event.visibility, event.principalId);
  const packIds = validatePackIds(event.packIds);
  const receipts = validateReceipts(event.receipts);
  assertObject(event.aggregate, "platform event aggregate");
  assertOnlyFields(event.aggregate, new Set(["type", "id", "version"]), "platform event aggregate");
  if (event.aggregate.type !== "capture" || event.aggregate.version !== 1) {
    throw new Error("invalid platform event aggregate");
  }
  assertUuidId(event.aggregate.id, "cap_", "platform capture ID");
  assertObject(event.payload, "platform event payload");
  assertOnlyFields(event.payload, new Set(["kind", "text", "entity"]), "platform event payload");
  const input = validateCaptureInput({
    ...event.payload,
    visibility: event.visibility.scope,
    packIds,
    receipts,
  });
  if (!isDeepStrictEqual(event.payload, {
    kind: input.kind,
    text: input.text,
    entity: input.entity,
  })) {
    throw new Error("platform event payload is not normalized");
  }
  return event;
}

export function listCaptureStates(events, { limit = 50 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error("capture limit must be an integer from 1 to 1000");
  }
  if (!Array.isArray(events)) throw new Error("platform events must be an array");
  return events
    .map((event) => validatePlatformEvent(event))
    .filter((event) => event.type === "capture.recorded")
    .sort((a, b) => b.at.localeCompare(a.at) || b.eventId.localeCompare(a.eventId))
    .slice(0, limit)
    .map((event) => ({
      captureId: event.aggregate.id,
      eventId: event.eventId,
      at: event.at,
      kind: event.payload.kind,
      text: event.payload.text,
      entity: event.payload.entity,
      visibility: event.visibility,
      packIds: event.packIds,
      receipts: event.receipts,
    }));
}
