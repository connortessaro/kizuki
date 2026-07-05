import { readFile, writeFile, mkdir, rm, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { eachEntity, followupsByEntity } from "./query.mjs";

const stateDir = (vaultDir) => join(vaultDir, "state");
const shiftPath = (vaultDir) => join(stateDir(vaultDir), "shift.json");
const lastStopPath = (vaultDir) => join(stateDir(vaultDir), "last-stop.json");

async function readJsonOrNull(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

async function writeJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data) + "\n", "utf8");
}

export const readShift = (vaultDir) => readJsonOrNull(shiftPath(vaultDir));
export const startShift = (vaultDir, now = new Date()) =>
  writeJson(shiftPath(vaultDir), { started: now.toISOString() });
export const endShift = (vaultDir) => rm(shiftPath(vaultDir), { force: true });
export const readLastStop = (vaultDir) => readJsonOrNull(lastStopPath(vaultDir));
export const recordStop = (vaultDir, now = new Date()) =>
  writeJson(lastStopPath(vaultDir), { stopped: now.toISOString() });

export async function renderBrief(vaultDir, now = new Date()) {
  const out = [`# Vigil brief — ${now.toISOString().slice(0, 10)}`, "", "## Changed since last shift"];
  const last = await readLastStop(vaultDir);
  const entities = await eachEntity(vaultDir);
  let changed;
  if (last) {
    const cutoff = Date.parse(last.stopped);
    changed = [];
    for (const e of entities) {
      if ((await stat(e.path)).mtimeMs > cutoff) changed.push(e);
    }
  } else {
    changed = entities;
  }
  out.push(...(changed.length ? changed.map((e) => `- ${e.type}/${e.name}`) : ["(none)"]), "");
  out.push("## Open follow-ups");
  const groups = await followupsByEntity(vaultDir);
  if (!groups.length) out.push("(none)");
  for (const g of groups) {
    out.push(...g.followUps.map((f) => `- ${g.type}/${g.name}: [follow-up] ${f}`));
    out.push(...g.actions.map((a) => `- ${g.type}/${g.name}: [action] ${a}`));
  }
  return out.join("\n").trimEnd() + "\n";
}
