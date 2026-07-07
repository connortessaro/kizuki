export const PAYLOAD_VERSION = 2;

const ENTITY_TYPES = ["person", "project", "team"];
const SUPPORTED_VERSIONS = [1, 2];
const SEVERITIES = ["info", "warn", "critical"];
const KINDS = ["contradiction", "blocker", "mention", "deadline"];

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

function validateAlert(alert) {
  if (!SEVERITIES.includes(alert.severity)) {
    throw new Error(`invalid alert severity: ${JSON.stringify(alert.severity)}`);
  }
  if (!KINDS.includes(alert.kind)) {
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
      `payload version ${JSON.stringify(data.version)} not supported (expected 1 or 2)`,
    );
  }
  for (const e of data.entities) validateEntity(e);
  if (data.alerts !== undefined) {
    if (!Array.isArray(data.alerts)) throw new Error("alerts must be an array");
    for (const a of data.alerts) validateAlert(a);
  } else {
    data.alerts = [];
  }
  data.consumedTranscripts ??= [];
  return data;
}
