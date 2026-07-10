import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { formatAlertLine, parseAlertLine } from "./alerts.mjs";
import { withVaultLock } from "./lock.mjs";
import {
  DISMISS_REASONS,
  planSignalIngestion,
  planSignalTransition,
  readSignalEvents,
  reduceSignalEvents,
  signalIdentity,
  validateSignalCandidate,
  writeSignalEventsAtomic,
} from "./signals.mjs";

const SIGNAL_ID_RE = /^sig_[0-9a-f]{12}$/;
const LIST_STATUSES = ["active", "open", "acted", "dismissed", "resolved", "all"];
const STATUS_RANK = { open: 0, acted: 1, dismissed: 2, resolved: 3 };
const SEVERITY_RANK = { critical: 0, warn: 1, info: 2 };

function requireValue(argv, index, option) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

function assertSignalId(signalId) {
  if (!SIGNAL_ID_RE.test(signalId ?? "")) throw new Error(`invalid signal ID ${JSON.stringify(signalId)}`);
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
    throw new Error(`unknown option for signals: ${arg}`);
  }
  if (!LIST_STATUSES.includes(status)) {
    throw new Error(`invalid signal status filter ${JSON.stringify(status)}`);
  }
  return { status, json };
}

function parseMigrationOptions(argv) {
  let dryRun = false;
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
    else throw new Error(`unknown option for signals migrate-alerts: ${arg}`);
  }
  return { dryRun };
}

function parseActionOptions(action, argv) {
  let note = null;
  let reason = null;
  let json = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--json" && action === "show") {
      json = true;
      continue;
    }
    if (arg === "--note" && action !== "show") {
      note = requireValue(argv, index, arg);
      index++;
      continue;
    }
    if (arg === "--reason" && action === "dismiss") {
      reason = requireValue(argv, index, arg);
      index++;
      continue;
    }
    throw new Error(`unknown option for signal ${action}: ${arg}`);
  }
  if (action === "dismiss" && !DISMISS_REASONS.includes(reason)) {
    throw new Error(`dismiss reason is required (${DISMISS_REASONS.join("|")})`);
  }
  return { note, reason, json };
}

function matchesStatus(state, filter) {
  if (filter === "all") return true;
  if (filter === "active") return state.status === "open" || state.status === "acted";
  return state.status === filter;
}

function sortStates(states) {
  return states.sort((left, right) =>
    STATUS_RANK[left.status] - STATUS_RANK[right.status] ||
    SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] ||
    Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt) ||
    left.signalId.localeCompare(right.signalId));
}

function formatSignalLine(state) {
  return `${state.signalId} ${state.status} [${state.severity}] ${state.kind} ${state.type}/${state.name} ${state.topic} ${state.lastSeenAt}`;
}

function formatSignalDetails(state, history) {
  const lines = [
    state.signalId,
    `status: ${state.status}`,
    `severity: ${state.severity}`,
    `kind: ${state.kind}`,
    `entity: ${state.type}/${state.name}`,
    `topic: ${state.topic}`,
    `first seen: ${state.firstSeenAt}`,
    `last seen: ${state.lastSeenAt}`,
    `evidence: ${state.evidence}`,
  ];
  if (state.draft) lines.push(`draft: ${state.draft}`);
  lines.push("receipts:");
  for (const receipt of state.receipts) {
    lines.push(`- ${receipt.source} ${receipt.locator} ${receipt.observedAt}: ${receipt.excerpt}`);
  }
  lines.push(`history events: ${history.length}`);
  return lines.join("\n");
}

async function listSignals(vaultDir, options) {
  const states = sortStates(
    [...reduceSignalEvents(await readSignalEvents(vaultDir)).values()]
      .filter((state) => matchesStatus(state, options.status)),
  );
  if (options.json) return JSON.stringify(states, null, 2);
  if (!states.length) return "No signals.";
  return states.map(formatSignalLine).join("\n");
}

async function showSignal(vaultDir, signalId, { json }) {
  const events = await readSignalEvents(vaultDir);
  const state = reduceSignalEvents(events).get(signalId);
  if (!state) throw new Error(`unknown signal ${signalId}`);
  const history = events.filter((event) => event.signalId === signalId);
  if (json) return JSON.stringify({ ...state, history }, null, 2);
  return formatSignalDetails(state, history);
}

async function transitionSignal(vaultDir, transition, { now, lock }) {
  return withVaultLock(vaultDir, async () => {
    const events = await readSignalEvents(vaultDir);
    const event = planSignalTransition(events, transition, { now });
    await writeSignalEventsAtomic(vaultDir, [...events, event]);
    return event;
  }, { ...lock, tool: "signal-transition", now });
}

function legacyTopic(line) {
  return `legacy-${createHash("sha256").update(line).digest("hex").slice(0, 12)}`;
}

function migrationCandidate(alert, { relativePath, lineNumber, date, draft }) {
  const line = formatAlertLine(alert);
  const candidate = {
    ...alert,
    topic: legacyTopic(line),
    receipts: [{
      source: "legacy-alert",
      locator: `${relativePath}:${lineNumber}`,
      observedAt: `${date}T00:00:00Z`,
      excerpt: alert.evidence,
    }],
  };
  if (draft) candidate.draft = draft;
  validateSignalCandidate(candidate);
  return candidate;
}

async function scanLegacyAlerts(vaultDir) {
  const alertsDir = join(vaultDir, "alerts");
  let names;
  try {
    names = await readdir(alertsDir);
  } catch (error) {
    if (error.code === "ENOENT") return { files: [], candidates: [], skippedClear: 0 };
    throw error;
  }
  const files = names.filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name)).sort();
  const candidates = [];
  let skippedClear = 0;

  for (const name of files) {
    const relativePath = `alerts/${name}`;
    const content = await readFile(join(alertsDir, name), "utf8");
    const lines = content.split("\n");
    for (let index = 0; index < lines.length; index++) {
      const raw = lines[index];
      const alertLineNumber = index + 1;
      const alert = parseAlertLine(raw);
      if (!alert) {
        if (raw.trim().startsWith("- **[")) {
          throw new Error(`${relativePath}:${index + 1}: malformed alert line`);
        }
        continue;
      }

      let draft = null;
      if (lines[index + 1]?.trim() === "```") {
        const draftLines = [];
        let closing = -1;
        for (let cursor = index + 2; cursor < lines.length; cursor++) {
          if (lines[cursor].trim() === "```") {
            closing = cursor;
            break;
          }
          draftLines.push(lines[cursor]);
        }
        if (closing === -1) throw new Error(`${relativePath}:${index + 2}: unclosed alert draft`);
        draft = draftLines.join("\n").trim() || null;
        index = closing;
      }

      if (alert.kind === "clear") {
        skippedClear++;
        continue;
      }
      try {
        candidates.push(migrationCandidate(alert, {
          relativePath,
          lineNumber: alertLineNumber,
          date: name.slice(0, 10),
          draft,
        }));
      } catch (error) {
        throw new Error(`${relativePath}:${alertLineNumber}: ${error.message}`);
      }
    }
  }
  return { files, candidates, skippedClear };
}

function groupMigrationCandidates(candidates) {
  const groups = new Map();
  for (const candidate of candidates) {
    const { signalId } = signalIdentity(candidate);
    const existing = groups.get(signalId);
    if (!existing) {
      groups.set(signalId, { ...candidate, receipts: [...candidate.receipts] });
      continue;
    }
    existing.receipts.push(...candidate.receipts);
  }
  return groups;
}

function receiptKey(receipt) {
  return JSON.stringify([receipt.source, receipt.locator]);
}

async function planMigration(vaultDir, { dryRun, now }) {
  const scan = await scanLegacyAlerts(vaultDir);
  const groups = groupMigrationCandidates(scan.candidates);
  const originalEvents = await readSignalEvents(vaultDir);
  let events = [...originalEvents];
  let alreadyImportedReceipts = 0;
  let newReceipts = 0;

  for (const candidate of groups.values()) {
    const signalId = signalIdentity(candidate).signalId;
    const before = reduceSignalEvents(events).get(signalId);
    const known = new Set((before?.receipts ?? []).map(receiptKey));
    alreadyImportedReceipts += candidate.receipts.filter((item) => known.has(receiptKey(item))).length;
    newReceipts += candidate.receipts.filter((item) => !known.has(receiptKey(item))).length;

    const ingestion = planSignalIngestion(events, [candidate], { now, reopenTerminal: false });
    events.push(...ingestion.events);
    const state = reduceSignalEvents(events).get(signalId);
    if (state.status !== "resolved") {
      events.push(planSignalTransition(events, {
        signalId,
        to: "resolved",
        actor: "system",
        reason: "legacy-import",
      }, { now }));
    }
  }

  const report = {
    dryRun,
    files: scan.files.length,
    candidateAlerts: scan.candidates.length,
    uniqueSignals: groups.size,
    skippedClear: scan.skippedClear,
    alreadyImportedReceipts,
    newReceipts,
    eventsWritten: events.length - originalEvents.length,
  };
  return { report, originalEvents, events };
}

async function migrateLegacyAlerts(vaultDir, options) {
  if (options.dryRun) return (await planMigration(vaultDir, options)).report;
  return withVaultLock(vaultDir, async () => {
    const planned = await planMigration(vaultDir, options);
    if (planned.report.eventsWritten) await writeSignalEventsAtomic(vaultDir, planned.events);
    return planned.report;
  }, { ...options.lock, tool: "migrate-alerts", now: options.now });
}

function formatMigrationReport(report) {
  return [
    `Legacy alert migration${report.dryRun ? " (dry-run)" : ""}`,
    `files: ${report.files}`,
    `candidate alerts: ${report.candidateAlerts}`,
    `unique signals: ${report.uniqueSignals}`,
    `skipped clear: ${report.skippedClear}`,
    `already imported receipts: ${report.alreadyImportedReceipts}`,
    `new receipts: ${report.newReceipts}`,
    `events written: ${report.eventsWritten}`,
  ].join("\n");
}

export async function runSignalsCommand(
  vaultDir,
  argv,
  { now = new Date(), lock = {}, returnResult = false } = {},
) {
  if (argv[0] === "migrate-alerts") {
    const parsed = parseMigrationOptions(argv.slice(1));
    const report = await migrateLegacyAlerts(vaultDir, { ...parsed, now, lock });
    return returnResult ? report : formatMigrationReport(report);
  }
  return listSignals(vaultDir, parseListOptions(argv));
}

export async function runSignalCommand(
  vaultDir,
  argv,
  { now = new Date(), lock = {} } = {},
) {
  const [action, signalId, ...rest] = argv;
  if (!action || !["show", "act", "dismiss", "resolve"].includes(action)) {
    throw new Error(`unknown signal command ${JSON.stringify(action)}`);
  }
  if (!signalId) throw new Error(`signal ${action} requires an ID`);
  assertSignalId(signalId);
  const options = parseActionOptions(action, rest);
  if (action === "show") return showSignal(vaultDir, signalId, options);

  const to = action === "act" ? "acted" : action === "dismiss" ? "dismissed" : "resolved";
  const event = await transitionSignal(vaultDir, {
    signalId,
    to,
    note: options.note,
    reason: options.reason,
  }, { now, lock });
  return `${signalId} ${event.from} -> ${event.to}`;
}
