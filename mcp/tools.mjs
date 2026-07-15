import { readFile } from "node:fs/promises";
import { randomUUID as defaultRandomUUID } from "node:crypto";
import { entityPath } from "../lib/vault.mjs";
import { applyPayload } from "../lib/apply.mjs";
import { TYPES, eachEntity, followupsByEntity, assertType, assertName, statusOf } from "../lib/query.mjs";
import {
  archiveInsight,
  captureInsight,
  readInsight,
  runInsightsCommand,
} from "../lib/insightCommands.mjs";
import { searchActiveInsights } from "../lib/insightContext.mjs";
import { readDaemonConfig } from "../lib/daemonConfig.mjs";
import { makePlatformApiClient } from "../lib/platformApiClient.mjs";

export { TYPES };
export const CHARACTER_LIMIT = 25000;

const truncate = (s) => (s.length > CHARACTER_LIMIT ? s.slice(0, CHARACTER_LIMIT) + "\n…(truncated)" : s);

const readIfExists = (p) => readFile(p, "utf8").then((c) => c, (e) => (e.code === "ENOENT" ? null : Promise.reject(e)));

export async function upsertAnalysis(vaultDir, { type, name, analysis = {}, rawEntries = [] }, applyOpts = {}) {
  assertType(type);
  assertName(name);
  const payload = { entities: [{ type, name, rawEntries, analysis }], consumedTranscripts: [], alerts: [] };
  const { changes } = await applyPayload(vaultDir, payload, { ...applyOpts, tool: "mcp" });
  return `Updated ${type}/${name} at ${changes[0].path}`;
}

export async function readEntity(vaultDir, type, name) {
  assertType(type);
  assertName(name);
  const content = await readIfExists(entityPath(vaultDir, type, name));
  if (content === null) throw new Error(`${type}/${name} not found`);
  return truncate(content);
}

export async function listEntities(vaultDir, type) {
  if (type) assertType(type);
  const entities = await eachEntity(vaultDir, type);
  if (!entities.length) return "No entities yet.";
  const lines = entities
    .sort((a, b) => `${a.type}/${a.name}`.localeCompare(`${b.type}/${b.name}`))
    .map((e) => `- ${e.type}/${e.name} — ${statusOf(e.content) || "(no status)"}`);
  return truncate(lines.join("\n"));
}

export async function listFollowups(vaultDir) {
  const groups = await followupsByEntity(vaultDir);
  const blocks = groups.map((g) =>
    [
      `${g.type}/${g.name}`,
      ...g.followUps.map((f) => `  - [follow-up] ${f}`),
      ...g.actions.map((a) => `  - [action] ${a}`),
    ].join("\n"),
  );
  if (!blocks.length) return "No open follow-ups or actions.";
  return truncate(blocks.join("\n\n"));
}

export async function search(vaultDir, query) {
  if (!query) throw new Error("query is required");
  const needle = query.toLowerCase();
  const entities = await eachEntity(vaultDir);
  const hits = [];
  for (const e of entities) {
    e.content.split("\n").forEach((line, i) => {
      if (line.toLowerCase().includes(needle)) hits.push(`${e.type}/${e.name}:${i + 1}: ${line.trim()}`);
    });
  }
  for (const insight of await searchActiveInsights(vaultDir, query)) {
    hits.push(`insight/${insight.insightId}: [${insight.kind}] ${insight.summary}`);
  }
  if (!hits.length) return `No matches for ${JSON.stringify(query)}.`;
  return truncate(hits.join("\n"));
}

async function defaultCaptureClient(vaultDir) {
  const config = await readDaemonConfig(vaultDir);
  return makePlatformApiClient(config);
}

export async function captureContextTool(vaultDir, { kind, text, entity = null }, {
  randomUUID = defaultRandomUUID,
  idempotencyKey,
  makeClient = defaultCaptureClient,
} = {}) {
  const key = idempotencyKey ?? `mcp-${randomUUID()}`;
  const client = await makeClient(vaultDir);
  const result = await client.capture({ kind, text, entity }, { idempotencyKey: key });
  return `Captured ${result.event.aggregate.id} [${result.event.payload.kind}]`;
}

export async function captureInsightTool(vaultDir, input, options = {}) {
  const result = await captureInsight(vaultDir, input, options);
  if (result.disposition === "exact-repeat") {
    return `Existing ${result.insightId} [${result.state.kind}] ${result.state.status} (exact-repeat)`;
  }
  return `Captured ${result.insightId} [${result.state.kind}] ${result.state.status}`;
}

export async function listInsightsTool(vaultDir, { status = "active" } = {}) {
  return truncate(await runInsightsCommand(vaultDir, ["--status", status]));
}

export async function readInsightTool(vaultDir, { insightId }) {
  return truncate(JSON.stringify(await readInsight(vaultDir, insightId), null, 2));
}

export async function archiveInsightTool(
  vaultDir,
  { insightId, note = null },
  options = {},
) {
  const event = await archiveInsight(vaultDir, { insightId, note }, options);
  return insightId + " " + event.from + " -> " + event.to;
}
