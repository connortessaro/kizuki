export const PAYLOAD_VERSION = 1;

const ENTITY_TYPES = ["person", "project", "team"];

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
  if (data.version !== undefined && data.version !== PAYLOAD_VERSION) {
    throw new Error(`payload version ${JSON.stringify(data.version)} not supported (expected ${PAYLOAD_VERSION})`);
  }
  for (const e of data.entities) {
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
  data.consumedTranscripts ??= [];
  return data;
}
