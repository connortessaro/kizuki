import { readFile, readdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { entityDir, ANALYSIS_START, ANALYSIS_END } from "./vault.mjs";

export const TYPES = ["person", "project", "team"];

export function managedSection(content) {
  const s = content.indexOf(ANALYSIS_START);
  const e = content.indexOf(ANALYSIS_END);
  if (s === -1 || e === -1 || e < s) return "";
  return content.slice(s + ANALYSIS_START.length, e);
}

export async function eachEntity(vaultDir, filterType) {
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
      const path = join(dir, f);
      const content = await readFile(path, "utf8");
      out.push({ type, name: basename(f, ".md"), content, path });
    }
  }
  return out;
}

export function bulletsUnder(section, heading) {
  const lines = section.split("\n");
  const out = [];
  let active = false;
  for (const line of lines) {
    if (/^\*\*.+:\*\*/.test(line)) active = line.startsWith(heading);
    else if (active && line.trimStart().startsWith("- ")) out.push(line.trim().slice(2).trim());
  }
  return out;
}

export async function followupsByEntity(vaultDir) {
  const groups = [];
  for (const e of await eachEntity(vaultDir)) {
    const section = managedSection(e.content);
    const followUps = bulletsUnder(section, "**Follow-ups:");
    const actions = bulletsUnder(section, "**Recommended actions:");
    if (followUps.length || actions.length) groups.push({ type: e.type, name: e.name, followUps, actions });
  }
  return groups;
}

export function priorityItems(groups, limit = 5) {
  const items = [];
  for (const g of groups) {
    for (const text of g.actions) items.push({ type: g.type, name: g.name, kind: "action", text });
    for (const text of g.followUps) items.push({ type: g.type, name: g.name, kind: "follow-up", text });
  }
  return { shown: items.slice(0, limit), total: items.length };
}

export const assertType = (type) => {
  if (!TYPES.includes(type)) throw new Error(`invalid type: ${JSON.stringify(type)} (expected person|project|team)`);
};

export const assertName = (name) => {
  if (!name || typeof name !== "string") throw new Error("name is required");
  if (/[/\\]|\.\./.test(name)) throw new Error(`invalid entity name: ${JSON.stringify(name)}`);
};

export function statusOf(content) {
  const m = managedSection(content).match(/^\*\*Status:\*\* (.*)$/m);
  return m ? m[1].trim() : "";
}
