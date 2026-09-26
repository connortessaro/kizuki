import { appendFile, mkdir, open } from "node:fs/promises";
import { LOG_SCHEMAS, type LogEvents } from "./events";
import { withLock } from "./lock";
import { homePaths, type LogName } from "./paths";

interface CacheEntry {
  mtimeMs: number;
  size: number;
  events: unknown[];
}

const cache = new Map<string, CacheEntry>();

/**
 * Reads every event in one log file, oldest first.
 * A line that is not valid JSON, or does not match the log's schema, stops the
 * read with an error naming the file and line number. Nothing is ever skipped.
 */
export async function readLog<N extends LogName>(home: string, name: N): Promise<LogEvents[N][]> {
  const path = homePaths(home).log(name);
  let handle;
  try {
    handle = await open(path, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  let info;
  let text: string | undefined;
  try {
    info = await handle.stat();
    const hit = cache.get(path);
    if (hit && hit.mtimeMs === info.mtimeMs && hit.size === info.size) return hit.events as LogEvents[N][];
    text = await handle.readFile("utf8");
  } finally {
    await handle.close();
  }

  const schema = LOG_SCHEMAS[name];
  const lines = text.split("\n");
  const events: LogEvents[N][] = [];
  lines.forEach((line, index) => {
    if (line.trim() === "") return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (error) {
      const cutOff = index === lines.length - 1 && !text!.endsWith("\n");
      const fix = cutOff
        ? "The line looks half-written: Kizuki probably stopped while writing it. To fix it, delete that last line and start Kizuki again."
        : "Fix or delete that line and start Kizuki again.";
      throw new Error(`${path}:${index + 1}: not valid JSON (${(error as Error).message}). ${fix}`, { cause: error });
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw new Error(`${path}:${index + 1}: ${parsed.error.message}\nFix or delete that line and start Kizuki again.`);
    events.push(parsed.data as LogEvents[N]);
  });
  cache.set(path, { mtimeMs: info.mtimeMs, size: info.size, events });
  return events;
}

async function endsMidLine(path: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(path, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  try {
    const { size } = await handle.stat();
    if (size === 0) return false;
    const last = Buffer.alloc(1);
    await handle.read(last, 0, 1, size - 1);
    return last[0] !== 0x0a;
  } finally {
    await handle.close();
  }
}

/**
 * Adds events to the end of a log file, one line each, while holding the write lock.
 * Every event is checked against the log's schema first; if any fails, nothing is written.
 */
export async function appendLog<N extends LogName>(home: string, name: N, events: LogEvents[N][]): Promise<void> {
  if (events.length === 0) return;
  const lines = checkedLines(name, events);
  const paths = homePaths(home);
  await mkdir(paths.data, { recursive: true, mode: 0o700 });
  await withLock(paths.lock, () => writeLines(paths.log(name), lines));
}

/** Adds events to a log while {@link withWriteLock} already holds the lock. */
export type LockedAppend = <N extends LogName>(name: N, events: LogEvents[N][]) => Promise<void>;

/**
 * Runs `fn` while holding the write lock, so a check it makes against the logs still holds
 * when it writes: no other write can come between. Write with the `append` it is given.
 */
export async function withWriteLock<T>(home: string, fn: (append: LockedAppend) => Promise<T>): Promise<T> {
  const paths = homePaths(home);
  await mkdir(paths.data, { recursive: true, mode: 0o700 });
  const append: LockedAppend = async (name, events) => {
    if (events.length > 0) await writeLines(paths.log(name), checkedLines(name, events));
  };
  return withLock(paths.lock, () => fn(append));
}

function checkedLines<N extends LogName>(name: N, events: LogEvents[N][]): string[] {
  const schema = LOG_SCHEMAS[name];
  return events.map((event, index) => {
    const parsed = schema.safeParse(event);
    if (!parsed.success) throw new Error(`refusing to write ${name} event ${index + 1}: ${parsed.error.message}`);
    return JSON.stringify(parsed.data);
  });
}

async function writeLines(file: string, lines: string[]): Promise<void> {
  // After a stop mid-write the file can end in half a line. Start on a new line, so only that line is lost.
  const cutOff = await endsMidLine(file);
  await appendFile(file, `${cutOff ? "\n" : ""}${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
}
