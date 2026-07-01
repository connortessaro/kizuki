import { readFile, readdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { entityDir, entityPath, ANALYSIS_START, ANALYSIS_END } from "../lib/vault.mjs";
import { applyPayload } from "../lib/apply.mjs";

export const TYPES = ["person", "project", "team"];
export const CHARACTER_LIMIT = 25000;

const assertType = (type) => {
  if (!TYPES.includes(type)) throw new Error(`invalid type: ${JSON.stringify(type)} (expected person|project|team)`);
};
const assertName = (name) => {
  if (!name || typeof name !== "string") throw new Error("name is required");
  if (/[/\\]|\.\./.test(name)) throw new Error(`invalid entity name: ${JSON.stringify(name)}`);
};

const truncate = (s) => (s.length > CHARACTER_LIMIT ? s.slice(0, CHARACTER_LIMIT) + "\n…(truncated)" : s);

const readIfExists = (p) => readFile(p, "utf8").then((c) => c, (e) => (e.code === "ENOENT" ? null : Promise.reject(e)));

function managedSection(content) {
  const s = content.indexOf(ANALYSIS_START);
  const e = content.indexOf(ANALYSIS_END);
  if (s === -1 || e === -1 || e < s) return "";
  return content.slice(s + ANALYSIS_START.length, e);
}

function statusOf(content) {
  const m = managedSection(content).match(/^\*\*Status:\*\* (.*)$/m);
  return m ? m[1].trim() : "";
}

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

async function eachEntity(vaultDir, filterType) {
  const out = [];
  for (const type of filterType ? [filterType] : TYPES) {
    const dir = join(vaultDir, entityDir(type));
    let files;
    try {
      files = await readdir(dir);
    } catch (e) {
      if (e.code === "ENOENT") continue;
      throw e;
    }
    for (const f of files.filter((f) => f.endsWith(".md"))) {
      const content = await readFile(join(dir, f), "utf8");
      out.push({ type, name: basename(f, ".md"), content });
    }
  }
  return out;
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

function bulletsUnder(section, heading) {
  const lines = section.split("\n");
  const out = [];
  let active = false;
  for (const line of lines) {
    if (/^\*\*.+:\*\*/.test(line)) active = line.startsWith(heading);
    else if (active && line.trimStart().startsWith("- ")) out.push(line.trim().slice(2).trim());
  }
  return out;
}

export async function listFollowups(vaultDir) {
  const entities = await eachEntity(vaultDir);
  const blocks = [];
  for (const e of entities) {
    const section = managedSection(e.content);
    const followUps = bulletsUnder(section, "**Follow-ups:");
    const actions = bulletsUnder(section, "**Recommended actions:");
    if (!followUps.length && !actions.length) continue;
    const parts = [`${e.type}/${e.name}`];
    for (const f of followUps) parts.push(`  - [follow-up] ${f}`);
    for (const a of actions) parts.push(`  - [action] ${a}`);
    blocks.push(parts.join("\n"));
  }
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
