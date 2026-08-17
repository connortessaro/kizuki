import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const failuresPath = (vaultDir) => join(vaultDir, "state", "sync-failures.json");

export async function readSyncFailures(vaultDir) {
  try {
    return JSON.parse(await readFile(failuresPath(vaultDir), "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return { consecutive: 0 };
    throw e;
  }
}

export async function recordSyncSuccess(vaultDir) {
  const p = failuresPath(vaultDir);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify({ consecutive: 0 }) + "\n", "utf8");
}

export async function recordSyncFailure(vaultDir, { notifySyncFailing } = {}) {
  const state = await readSyncFailures(vaultDir);
  const consecutive = (state.consecutive ?? 0) + 1;
  const p = failuresPath(vaultDir);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify({ consecutive }) + "\n", "utf8");
  if (consecutive === 2 && notifySyncFailing) await notifySyncFailing();
  return consecutive;
}
