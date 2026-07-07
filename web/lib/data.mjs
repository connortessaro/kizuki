import { readFile, readdir, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { entityPath } from "../../lib/vault.mjs";
import {
  TYPES, eachEntity, followupsByEntity, assertType, assertName, statusOf,
} from "../../lib/query.mjs";

export { TYPES };
export { formatDate } from "../../lib/format.mjs";
export { formatDateTime } from "../../lib/format.mjs";

export async function lastUpdated(dir) {
  let latest = 0;
  for (const e of await eachEntity(dir)) {
    const { mtimeMs } = await stat(e.path);
    if (mtimeMs > latest) latest = mtimeMs;
  }
  return latest ? new Date(latest) : null;
}

export const vaultDir = () =>
  process.env.KIZUKI_VAULT || join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function parseEntityFile(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return { frontmatter: /** @type {[string, string][]} */ ([]), body: content };
  /** @type {[string, string][]} */
  const frontmatter = m[1]
    .split("\n")
    .filter((l) => l.trim())
    .map((line) => {
      const i = line.indexOf(":");
      return i === -1 ? [line.trim(), ""] : [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    });
  return { frontmatter, body: content.slice(m[0].length) };
}

export async function listByType(dir) {
  /** @type {Record<"person" | "project" | "team", { name: string, status: string }[]>} */
  const out = { person: [], project: [], team: [] };
  for (const e of await eachEntity(dir)) out[e.type].push({ name: e.name, status: statusOf(e.content) });
  for (const type of TYPES) out[type].sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export async function getEntity(dir, type, name) {
  assertType(type);
  assertName(name);
  let content;
  try {
    content = await readFile(entityPath(dir, type, name), "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
  const { frontmatter, body } = parseEntityFile(content);
  return { type, name, frontmatter, body };
}

export const followups = (dir) => followupsByEntity(dir);

export async function searchVault(dir, query) {
  const needle = query.toLowerCase();
  const hits = [];
  for (const e of await eachEntity(dir)) {
    e.content.split("\n").forEach((text, i) => {
      if (text.toLowerCase().includes(needle)) {
        hits.push({ type: e.type, name: e.name, line: i + 1, text: text.trim() });
      }
    });
  }
  return hits;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function listDays(dir) {
  let files;
  try {
    files = await readdir(join(dir, "days"));
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  return files
    .filter((f) => f.endsWith(".md") && DATE_RE.test(f.slice(0, -3)))
    .map((f) => f.slice(0, -3))
    .sort()
    .reverse();
}

export async function readDay(dir, date) {
  if (!DATE_RE.test(date)) throw new Error(`invalid date: ${JSON.stringify(date)}`);
  try {
    return await readFile(join(dir, "days", `${date}.md`), "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
