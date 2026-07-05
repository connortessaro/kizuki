import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join, dirname } from "node:path";

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
