import { open, readFile, stat, unlink } from "node:fs/promises";

/** Options for {@link withLock}. */
export interface LockOptions {
  /** How long to wait for another holder before giving up. Default 30 seconds. */
  timeoutMs?: number;
  /** How often to try again while waiting. Default 25 ms. */
  retryMs?: number;
}

interface Holder {
  pid: number;
  at: string;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readHolder(path: string): Promise<Holder | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Holder;
  } catch {
    return null;
  }
}

/**
 * True if the lock file has no holder written in it and is older than a write takes, which
 * means its process stopped between creating the file and writing its number.
 */
async function leftEmpty(path: string): Promise<boolean> {
  const info = await stat(path).catch(() => null);
  return info !== null && Date.now() - info.mtimeMs > 5_000;
}

/**
 * Removes a lock left by a process that stopped. Only one waiter may do it: the one that
 * claims the breaker file next to the lock. It looks at the lock again first, so it never
 * removes a lock another waiter has just taken. A breaker file left by a crash is cleared
 * after a few seconds.
 */
async function breakStale(path: string, stale: Holder | null): Promise<void> {
  const breaker = `${path}.break`;
  let claim;
  try {
    claim = await open(breaker, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (await leftEmpty(breaker)) await unlink(breaker).catch(() => {});
    return;
  }
  try {
    const now = await readHolder(path);
    const same = stale ? now?.pid === stale.pid && now?.at === stale.at : now === null;
    if (same) await unlink(path).catch(() => {});
  } finally {
    await claim.close();
    await unlink(breaker).catch(() => {});
  }
}

/**
 * Runs `fn` while holding a lock file, so writers take turns.
 * A lock left by a process that has exited is taken over. Waiting longer than
 * the timeout throws an error naming the process that holds the lock.
 */
export async function withLock<T>(path: string, fn: () => Promise<T>, options: LockOptions = {}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const retryMs = options.retryMs ?? 25;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      const handle = await open(path, "wx");
      await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      await handle.close();
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const holder = await readHolder(path);
      if ((holder && !isAlive(holder.pid)) || (!holder && (await leftEmpty(path)))) {
        await breakStale(path, holder);
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `lock ${path} is held by process ${holder?.pid ?? "unknown"} since ${holder?.at ?? "unknown"}. If no other Kizuki is running, delete ${path} and try again.`,
          { cause: error },
        );
      }
      await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
  }

  try {
    return await fn();
  } finally {
    await unlink(path).catch(() => {});
  }
}
