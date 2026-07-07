import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const LOCK_WAIT_MS = 30000;
export const LOCK_POLL_MS = 500;

const lockPath = (vaultDir) => join(vaultDir, "state", "vault.lock");

const defaultPidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const unlinkIfPresent = async (path) => {
  try {
    await unlink(path);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
};

async function readHolder(path) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
  try {
    const data = JSON.parse(raw);
    if (Number.isInteger(data.pid)) return data;
  } catch {
    // unparsable lock file — fall through to the stale marker
  }
  return { corrupt: true };
}

export async function withVaultLock(vaultDir, fn, {
  tool = "sync",
  waitMs = LOCK_WAIT_MS,
  pollMs = LOCK_POLL_MS,
  pidAlive = defaultPidAlive,
  now = new Date(),
} = {}) {
  const path = lockPath(vaultDir);
  const meta = JSON.stringify({ pid: process.pid, tool, startedAt: now.toISOString() }) + "\n";
  await mkdir(join(vaultDir, "state"), { recursive: true });
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      await writeFile(path, meta, { flag: "wx" });
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    const holder = await readHolder(path);
    if (holder === null) continue;
    if (holder.corrupt || !pidAlive(holder.pid)) {
      await unlinkIfPresent(path);
      continue;
    }
    if (Date.now() >= deadline) {
      throw new Error(`vault locked by ${holder.tool} (pid ${holder.pid}) since ${holder.startedAt}`);
    }
    await sleep(pollMs);
  }
  try {
    return await fn();
  } finally {
    const holder = await readHolder(path);
    if (holder !== null && holder.pid === process.pid) await unlinkIfPresent(path);
  }
}
