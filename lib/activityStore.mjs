import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withVaultLock } from "./lock.mjs";
import { validateActivityEvent } from "./activityEvents.mjs";

const DIR = "activity";
const FILE = "events.jsonl";

export const activityEventsPath = (vaultDir) => join(vaultDir, DIR, FILE);

function parseLine(path, line, lineNumber) {
  if (line.trim() === "") throw new Error(path + ":" + lineNumber + ": blank JSONL line");
  let event;
  try {
    event = JSON.parse(line);
  } catch (error) {
    throw new Error(path + ":" + lineNumber + ": malformed JSON: " + error.message);
  }
  try {
    return validateActivityEvent(event);
  } catch (error) {
    throw new Error(path + ":" + lineNumber + ": " + error.message);
  }
}

export async function readActivityEvents(vaultDir) {
  const path = activityEventsPath(vaultDir);
  let content;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  if (content === "") return [];
  const lines = content.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const events = [];
  const seen = new Set();
  for (const [index, line] of lines.entries()) {
    const event = parseLine(path, line, index + 1);
    if (seen.has(event.commitId)) {
      throw new Error(path + ":" + (index + 1) + ": duplicate activity event for " + event.commitId);
    }
    seen.add(event.commitId);
    events.push(event);
  }
  return events;
}

export function planActivityAppend(existing, candidates) {
  const seen = new Set(existing.map((event) => event.commitId));
  const append = [];
  let skipped = 0;
  for (const candidate of candidates) {
    validateActivityEvent(candidate);
    if (seen.has(candidate.commitId)) {
      skipped += 1;
      continue;
    }
    seen.add(candidate.commitId);
    append.push(candidate);
  }
  return { append, skipped };
}

async function appendLines(vaultDir, events) {
  const dir = join(vaultDir, DIR);
  const path = activityEventsPath(vaultDir);
  const content = events.map((event) => JSON.stringify(event)).join("\n") + "\n";
  await mkdir(dir, { recursive: true });
  const tempPath = join(dir, "." + FILE + "." + process.pid + "." + randomUUID() + ".tmp");
  try {
    let head = "";
    try {
      head = await readFile(path, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await writeFile(tempPath, head + content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(tempPath, path);
  } catch (error) {
    try {
      await rm(tempPath, { force: true });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "activity ledger write failed and temp cleanup failed",
      );
    }
    throw error;
  }
}

export async function appendActivityEvents(vaultDir, candidates, { lock = withVaultLock } = {}) {
  return lock(vaultDir, async () => {
    const existing = await readActivityEvents(vaultDir);
    const { append, skipped } = planActivityAppend(existing, candidates);
    if (append.length > 0) await appendLines(vaultDir, append);
    return { appended: append.length, skipped, total: existing.length + append.length };
  });
}
