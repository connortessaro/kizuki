import { withVaultLock } from "./lock.mjs";
import {
  planInsightArchive,
  planInsightCapture,
  readInsightEvents,
  reduceInsightEvents,
  validateInsightInput,
  writeInsightEventsAtomic,
} from "./insights.mjs";

const INSIGHT_ID_RE = /^ins_[0-9a-f]{12}$/;
const LIST_STATUSES = ["active", "archived", "all"];

function assertInsightId(insightId) {
  if (typeof insightId !== "string" || !INSIGHT_ID_RE.test(insightId)) {
    throw new Error("invalid insight ID " + JSON.stringify(insightId));
  }
}

function requireValue(argv, index, option) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(option + " requires a value");
  }
  return value;
}

function parseListOptions(argv) {
  let status = "active";
  let json = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--status") {
      status = requireValue(argv, index, arg);
      index++;
      continue;
    }
    throw new Error("unknown option for insights: " + arg);
  }
  if (!LIST_STATUSES.includes(status)) {
    throw new Error("invalid insight status filter " + JSON.stringify(status));
  }
  return { status, json };
}

function parseActionOptions(action, argv) {
  let json = false;
  let note = null;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--json" && action === "show") {
      json = true;
      continue;
    }
    if (arg === "--note" && action === "archive") {
      note = requireValue(argv, index, arg);
      index++;
      continue;
    }
    throw new Error("unknown option for insight " + action + ": " + arg);
  }
  return { json, note };
}

function sortStates(states) {
  return states.sort((left, right) =>
    Date.parse(right.capturedAt) - Date.parse(left.capturedAt) ||
    left.insightId.localeCompare(right.insightId));
}

function matchesStatus(state, status) {
  return status === "all" || state.status === status;
}

function entityLabel(state) {
  return state.entities.length
    ? state.entities.map((entity) => entity.type + "/" + entity.name).join(",")
    : "unscoped";
}

function oneLine(text) {
  return text.replace(/\s+/g, " ").trim();
}

function formatInsightLine(state) {
  return [
    state.insightId,
    state.status,
    "[" + state.kind + "]",
    entityLabel(state),
    state.origin.client,
    state.capturedAt,
    oneLine(state.summary),
  ].join(" ");
}

function formatInsightDetails(state, history) {
  const lines = [
    state.insightId,
    "status: " + state.status,
    "kind: " + state.kind,
    "captured: " + state.capturedAt,
    "summary: " + state.summary,
  ];
  if (state.context) lines.push("context: " + state.context);
  lines.push("entities:");
  if (state.entities.length) {
    for (const entity of state.entities) lines.push("- " + entity.type + "/" + entity.name);
  } else {
    lines.push("- unscoped");
  }
  lines.push("origin: " + state.origin.client);
  if (state.origin.locator) lines.push("origin locator: " + state.origin.locator);
  lines.push("history events: " + history.length);
  return lines.join("\n");
}

export async function captureInsight(
  vaultDir,
  input,
  { now = new Date(), lock = {} } = {},
) {
  validateInsightInput(input);
  return withVaultLock(vaultDir, async () => {
    const events = await readInsightEvents(vaultDir);
    const planned = planInsightCapture(events, input, { now });
    if (planned.event) {
      await writeInsightEventsAtomic(vaultDir, [...events, planned.event]);
    }
    return planned;
  }, { ...lock, tool: "insight-capture", now });
}

export async function listInsightStates(
  vaultDir,
  { status = "active" } = {},
) {
  if (!LIST_STATUSES.includes(status)) {
    throw new Error("invalid insight status filter " + JSON.stringify(status));
  }
  const states = [...reduceInsightEvents(await readInsightEvents(vaultDir)).values()]
    .filter((state) => matchesStatus(state, status));
  return sortStates(states);
}

export async function readInsight(vaultDir, insightId) {
  assertInsightId(insightId);
  const events = await readInsightEvents(vaultDir);
  const state = reduceInsightEvents(events).get(insightId);
  if (!state) throw new Error("unknown insight " + insightId);
  return {
    ...state,
    history: events.filter((event) => event.insightId === insightId),
  };
}

export async function archiveInsight(
  vaultDir,
  { insightId, note = null },
  { now = new Date(), lock = {} } = {},
) {
  assertInsightId(insightId);
  return withVaultLock(vaultDir, async () => {
    const events = await readInsightEvents(vaultDir);
    const event = planInsightArchive(events, { insightId, note }, { now });
    await writeInsightEventsAtomic(vaultDir, [...events, event]);
    return event;
  }, { ...lock, tool: "insight-archive", now });
}

export async function runInsightsCommand(vaultDir, argv) {
  const options = parseListOptions(argv);
  const states = await listInsightStates(vaultDir, options);
  if (options.json) return JSON.stringify(states, null, 2);
  if (!states.length) return "No insights.";
  return states.map(formatInsightLine).join("\n");
}

export async function runInsightCommand(
  vaultDir,
  argv,
  { now = new Date(), lock = {} } = {},
) {
  const [action, insightId, ...rest] = argv;
  if (!action || !["show", "archive"].includes(action)) {
    throw new Error("unknown insight command " + JSON.stringify(action));
  }
  if (!insightId) throw new Error("insight " + action + " requires an ID");
  assertInsightId(insightId);
  const options = parseActionOptions(action, rest);
  if (action === "show") {
    const result = await readInsight(vaultDir, insightId);
    if (options.json) return JSON.stringify(result, null, 2);
    return formatInsightDetails(result, result.history);
  }
  const event = await archiveInsight(
    vaultDir,
    { insightId, note: options.note },
    { now, lock },
  );
  return insightId + " " + event.from + " -> " + event.to;
}
