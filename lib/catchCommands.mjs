import { withVaultLock } from "./lock.mjs";
import {
  planCatchCapture,
  readCatchEvents,
  reduceCatchEvents,
  validateCatchInput,
  writeCatchEventsAtomic,
} from "./catches.mjs";
import { readSignalEvents, reduceSignalEvents } from "./signals.mjs";
import { readInsightEvents, reduceInsightEvents } from "./insights.mjs";

function requireValue(argv, index, option) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(option + " requires a value");
  }
  return value;
}

function parseCatchArgs(argv) {
  let note = null;
  let signalId = null;
  let insightId = null;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--signal") {
      signalId = requireValue(argv, index, arg);
      index++;
      continue;
    }
    if (arg === "--insight") {
      insightId = requireValue(argv, index, arg);
      index++;
      continue;
    }
    if (arg.startsWith("--")) throw new Error("unknown option for catch: " + arg);
    if (note !== null) throw new Error("catch takes one note argument");
    note = arg;
  }
  if (note === null) throw new Error('catch requires a note — kizuki catch "<note>"');
  return { note, signalId, insightId };
}

async function assertLinksExist(vaultDir, input) {
  if (input.signalId) {
    const states = reduceSignalEvents(await readSignalEvents(vaultDir));
    if (!states.has(input.signalId)) throw new Error("unknown signal " + input.signalId);
  }
  if (input.insightId) {
    const states = reduceInsightEvents(await readInsightEvents(vaultDir));
    if (!states.has(input.insightId)) throw new Error("unknown insight " + input.insightId);
  }
}

export async function recordCatch(vaultDir, input, { now = new Date(), lock = {} } = {}) {
  const normalized = validateCatchInput(input);
  await assertLinksExist(vaultDir, normalized);
  return withVaultLock(vaultDir, async () => {
    const events = await readCatchEvents(vaultDir);
    const planned = planCatchCapture(events, normalized, { now });
    if (planned.event) await writeCatchEventsAtomic(vaultDir, [...events, planned.event]);
    return planned;
  }, { ...lock, tool: "catch-capture", now });
}

function oneLine(text) {
  return text.replace(/\s+/g, " ").trim();
}

function formatCatchLine(state) {
  const parts = [state.catchId, state.at, oneLine(state.note)];
  if (state.signalId) parts.push("signal:" + state.signalId);
  if (state.insightId) parts.push("insight:" + state.insightId);
  return parts.join(" ");
}

export async function runCatchCommand(vaultDir, argv, { now = new Date(), lock = {} } = {}) {
  const parsed = parseCatchArgs(argv);
  const planned = await recordCatch(vaultDir, parsed, { now, lock });
  return planned.catchId + (planned.disposition === "created" ? " recorded" : " already recorded");
}

export async function runCatchesCommand(vaultDir, argv) {
  let json = false;
  for (const arg of argv) {
    if (arg === "--json") json = true;
    else throw new Error("unknown option for catches: " + arg);
  }
  const states = [...reduceCatchEvents(await readCatchEvents(vaultDir)).values()].sort(
    (left, right) =>
      Date.parse(right.at) - Date.parse(left.at) || left.catchId.localeCompare(right.catchId),
  );
  if (json) return JSON.stringify(states, null, 2);
  if (!states.length) return "No catches.";
  return states.map(formatCatchLine).join("\n");
}
