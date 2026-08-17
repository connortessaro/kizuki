import { createHash } from "node:crypto";
import { AGENT_RECEIPT_SOURCES, validateSignalCandidate } from "./signals.mjs";

export const PAYLOAD_VERSION = 3;
export const MAX_ALERTS = 3;

const ENTITY_TYPES = ["person", "project", "team"];
const SUPPORTED_VERSIONS = [1, 2, 3];
const SEVERITIES = ["info", "warn", "critical"];
const LEGACY_KINDS = ["contradiction", "blocker", "mention", "deadline", "clear"];
const SIGNAL_KINDS = ["contradiction", "blocker", "mention", "deadline"];
const SEVERITY_RANK = { critical: 0, warn: 1, info: 2 };
const V2_WARNING = "Payload version 2 alerts use exact-evidence compatibility identity; emit version 3 signals.";
const V2_CLEAR_WARNING = "Payload version 2 clear alert ignored; zero-signal runs are CLI output only.";

export function extractJsonBlock(stdout) {
  const fenceRe = /```json\s*([\s\S]*?)```/gi;
  let m;
  let last = null;
  while ((m = fenceRe.exec(stdout)) !== null) last = m[1];
  if (last !== null) return last.trim();

  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start !== -1 && end > start) return stdout.slice(start, end + 1);

  throw new Error("no JSON found in codex output");
}

function validateLegacyAlert(alert) {
  if (!SEVERITIES.includes(alert.severity)) {
    throw new Error(`invalid alert severity: ${JSON.stringify(alert.severity)}`);
  }
  if (!LEGACY_KINDS.includes(alert.kind)) {
    throw new Error(`invalid alert kind: ${JSON.stringify(alert.kind)}`);
  }
  if (!ENTITY_TYPES.includes(alert.type)) {
    throw new Error(`invalid alert type: ${JSON.stringify(alert.type)}`);
  }
  if (!alert.name || typeof alert.name !== "string") {
    throw new Error("alert missing name");
  }
  if (/[/\\]|\.\./.test(alert.name)) {
    throw new Error(`invalid alert name: ${JSON.stringify(alert.name)}`);
  }
  if (!alert.evidence || typeof alert.evidence !== "string") {
    throw new Error("alert missing evidence");
  }
  if (alert.draft !== undefined && typeof alert.draft !== "string") {
    throw new Error("alert draft must be a string");
  }
}

function validateV3Alert(alert) {
  if (!SIGNAL_KINDS.includes(alert?.kind)) {
    throw new Error(`invalid alert kind: ${JSON.stringify(alert?.kind)}`);
  }
  validateSignalCandidate(alert, { receiptSources: AGENT_RECEIPT_SOURCES });
}

function legacyAlertCandidate(alert) {
  const evidenceHash = createHash("sha256").update(alert.evidence).digest("hex");
  const candidate = {
    ...alert,
    topic: `legacy-${evidenceHash.slice(0, 12)}`,
    receipts: [{
      source: "legacy-v2",
      locator: `legacy-v2:${evidenceHash}`,
      observedAt: "1970-01-01T00:00:00Z",
      excerpt: alert.evidence,
    }],
  };
  if (candidate.draft?.trim() === "") delete candidate.draft;
  return candidate;
}

function validateEntity(e) {
  if (!ENTITY_TYPES.includes(e.type)) {
    throw new Error(`invalid entity type: ${JSON.stringify(e.type)}`);
  }
  if (!e.name || typeof e.name !== "string") {
    throw new Error("entity missing name");
  }
  if (/[/\\]|\.\./.test(e.name)) {
    throw new Error(`invalid entity name: ${JSON.stringify(e.name)}`);
  }
  e.rawEntries ??= [];
  e.analysis ??= {};
}

export function trimAlerts(alerts, limit = MAX_ALERTS) {
  return [...alerts]
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    .slice(0, limit);
}

function entityHasAlert(alerts, entity) {
  return alerts.some((a) => a.type === entity.type && a.name === entity.name);
}

export function normalizeEntityAnalysis(entity, alerts) {
  entity.analysis ??= {};
  if (entityHasAlert(alerts, entity)) {
    entity.analysis.followUps = [];
    entity.analysis.recommendedActions = [];
    return;
  }
  const followUps = (entity.analysis.followUps ?? []).slice(0, 1);
  const actions = (entity.analysis.recommendedActions ?? []).slice(0, 1);
  if (followUps.length) {
    entity.analysis.followUps = followUps;
    entity.analysis.recommendedActions = [];
  } else {
    entity.analysis.followUps = [];
    entity.analysis.recommendedActions = actions;
  }
}

export function finalizePayload(data) {
  data.alerts = trimAlerts(data.alerts ?? []);
  for (const e of data.entities) normalizeEntityAnalysis(e, data.alerts);
  return data;
}

const CHECK_SEVERITIES = ["warn", "critical"];

function validateContradiction(c) {
  if (!CHECK_SEVERITIES.includes(c.severity)) {
    throw new Error(`invalid contradiction severity: ${JSON.stringify(c.severity)}`);
  }
  if (!c.entity || !ENTITY_TYPES.includes(c.entity.type)) {
    throw new Error(`invalid contradiction entity type: ${JSON.stringify(c.entity?.type)}`);
  }
  if (!c.entity.name || typeof c.entity.name !== "string") {
    throw new Error("contradiction missing entity name");
  }
  if (/[/\\]|\.\./.test(c.entity.name)) {
    throw new Error(`invalid contradiction entity name: ${JSON.stringify(c.entity.name)}`);
  }
  for (const key of ["draftClaim", "conflict", "evidence"]) {
    if (!c[key] || typeof c[key] !== "string") {
      throw new Error(`contradiction missing ${key}`);
    }
  }
}

export function parseCheckPayload(stdout) {
  const block = extractJsonBlock(stdout);
  let data;
  try {
    data = JSON.parse(block);
  } catch (e) {
    throw new Error(`check output was not valid JSON: ${e.message}`);
  }
  if (!data || !Array.isArray(data.contradictions)) {
    throw new Error("check payload missing contradictions array");
  }
  for (const c of data.contradictions) validateContradiction(c);
  return { contradictions: data.contradictions };
}

export function parsePayload(stdout) {
  const block = extractJsonBlock(stdout);
  let data;
  try {
    data = JSON.parse(block);
  } catch (e) {
    throw new Error(`codex output was not valid JSON: ${e.message}`);
  }
  if (!data || !Array.isArray(data.entities)) {
    throw new Error("payload missing entities array");
  }
  const version = data.version ?? 1;
  if (!SUPPORTED_VERSIONS.includes(version)) {
    throw new Error(
      `payload version ${JSON.stringify(data.version)} not supported (expected 1, 2, or 3)`,
    );
  }
  data.version = version;
  data.warnings = [];
  for (const e of data.entities) validateEntity(e);
  if (data.alerts !== undefined) {
    if (!Array.isArray(data.alerts)) throw new Error("alerts must be an array");
    if (version === 3) {
      for (const alert of data.alerts) validateV3Alert(alert);
    } else {
      for (const alert of data.alerts) validateLegacyAlert(alert);
      const hasClear = data.alerts.some((alert) => alert.kind === "clear");
      const legacyAlerts = data.alerts.filter((alert) => alert.kind !== "clear");
      if (version === 2 && legacyAlerts.length) data.warnings.push(V2_WARNING);
      if (version === 2 && hasClear) data.warnings.push(V2_CLEAR_WARNING);
      data.alerts = legacyAlerts.map(legacyAlertCandidate);
    }
  } else {
    data.alerts = [];
  }
  data.consumedTranscripts ??= [];
  return finalizePayload(data);
}
