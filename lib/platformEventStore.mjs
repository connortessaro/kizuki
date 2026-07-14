import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { withVaultLock } from "./lock.mjs";
import {
  LOCAL_CONTEXT,
  listCaptureStates,
  planCaptureEvent,
  validatePlatformEvent,
} from "./platformEvents.mjs";

const EVENTS_DIR = "events";
const EVENTS_FILE = "events/events.jsonl";

export const platformEventsPath = (vaultDir) => join(vaultDir, EVENTS_DIR, "events.jsonl");

export async function readPlatformEvents(vaultDir) {
  let raw;
  try {
    raw = await readFile(platformEventsPath(vaultDir), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  if (raw === "") return [];
  const lines = raw.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const events = [];
  for (const [index, line] of lines.entries()) {
    if (line === "") throw new Error(`${EVENTS_FILE} line ${index + 1}: blank line`);
    try {
      events.push(validatePlatformEvent(JSON.parse(line)));
    } catch (error) {
      throw new Error(`${EVENTS_FILE} line ${index + 1}: ${error.message}`);
    }
  }
  return events;
}

function assertAppendOnly(existing, next) {
  if (next.length < existing.length) throw new Error("cannot remove existing platform events");
  for (let index = 0; index < existing.length; index++) {
    if (!isDeepStrictEqual(next[index], existing[index])) {
      throw new Error(`cannot rewrite existing platform events at index ${index}`);
    }
  }
}

export async function writePlatformEventsAtomic(vaultDir, events, {
  tempId = randomUUID(),
} = {}) {
  if (!Array.isArray(events)) throw new Error("platform events must be an array");
  for (const event of events) validatePlatformEvent(event);
  const existing = await readPlatformEvents(vaultDir);
  assertAppendOnly(existing, events);

  const dir = join(vaultDir, EVENTS_DIR);
  const path = platformEventsPath(vaultDir);
  const tempPath = join(dir, `.events-${process.pid}-${tempId}.tmp`);
  await mkdir(dir, { recursive: true });
  const content = events.length ? `${events.map((event) => JSON.stringify(event)).join("\n")}\n` : "";
  try {
    await writeFile(tempPath, content, { encoding: "utf8", mode: 0o600 });
    await rename(tempPath, path);
  } catch (error) {
    try {
      await rm(tempPath, { force: true });
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "platform event write and cleanup failed");
    }
    throw error;
  }
}

export async function capturePlatformEvent(vaultDir, input, {
  context = LOCAL_CONTEXT,
  now = new Date(),
  randomUUID: makeUUID = randomUUID,
  idempotencyKey,
  lock = {},
} = {}) {
  return withVaultLock(vaultDir, async () => {
    const events = await readPlatformEvents(vaultDir);
    const result = planCaptureEvent(events, input, context, {
      now,
      randomUUID: makeUUID,
      idempotencyKey,
    });
    if (result.disposition === "created") {
      await writePlatformEventsAtomic(vaultDir, [...events, result.event]);
    }
    return result;
  }, { tool: "capture", ...lock });
}

export async function listPlatformCaptures(vaultDir, options = {}) {
  return listCaptureStates(await readPlatformEvents(vaultDir), options);
}
