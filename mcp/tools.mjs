import { readFile } from "node:fs/promises";
import { entityPath } from "../lib/vault.mjs";
import { applyPayload } from "../lib/apply.mjs";
import { TYPES, eachEntity, bulletsUnder, followupsByEntity, assertType, assertName, statusOf } from "../lib/query.mjs";

export { TYPES };
export const CHARACTER_LIMIT = 25000;

const truncate = (s) => (s.length > CHARACTER_LIMIT ? s.slice(0, CHARACTER_LIMIT) + "\n…(truncated)" : s);

const readIfExists = (p) => readFile(p, "utf8").then((c) => c, (e) => (e.code === "ENOENT" ? null : Promise.reject(e)));

export async function upsertAnalysis(vaultDir, { type, name, analysis = {}, rawEntries = [] }) {
  assertType(type);
  assertName(name);
  const payload = { entities: [{ type, name, rawEntries, analysis }], consumedTranscripts: [] };
  const changes = await applyPayload(vaultDir, payload, {});
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
  if (!hits.length) return `No matches for ${JSON.stringify(query)}.`;
  return truncate(hits.join("\n"));
}
