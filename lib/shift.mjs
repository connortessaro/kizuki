import { readFile, writeFile, mkdir, rm, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { eachEntity, followupsByEntity, priorityItems } from "./query.mjs";
import { formatDate } from "./format.mjs";
import { parseAlertLine, readAlertsForDate } from "./alerts.mjs";
import { alertTrends } from "./trends.mjs";
import { gateWeekLine } from "./gateCommands.mjs";

export const BRIEF_PRIORITY_LIMIT = 5;
export const BRIEF_ALERT_LIMIT = 5;

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

function renderBriefAlerts(alerts, dateStr) {
  if (!alerts?.trim()) return ["(none)"];
  const lines = alerts.split("\n").filter((line) => parseAlertLine(line));
  if (!lines.length) return [alerts.trim()];
  const shown = lines.slice(0, BRIEF_ALERT_LIMIT);
  const more = lines.length - shown.length;
  if (more > 0) shown.push(`(${more} more ${more === 1 ? "alert" : "alerts"} today — open alerts/${dateStr}.md)`);
  return shown;
}

export async function renderBrief(vaultDir, now = new Date()) {
  const dateStr = now.toISOString().slice(0, 10);
  const out = [`# Kizuki brief — ${formatDate(dateStr)}`, ""];

  out.push("## Alerts today");
  const alerts = await readAlertsForDate(vaultDir, dateStr);
  out.push(...renderBriefAlerts(alerts, dateStr), "");

  out.push("## Changed since last shift");
  const last = await readLastStop(vaultDir);
  const entities = await eachEntity(vaultDir);
  let changed;
  if (last) {
    const cutoff = Date.parse(last.stopped);
    changed = [];
    for (const e of entities) {
      if ((await stat(e.path)).mtimeMs > cutoff) changed.push(e);
    }
  } else {
    changed = entities;
  }
  out.push(...(changed.length ? changed.map((e) => `- ${e.type}/${e.name}`) : ["(none)"]), "");

  out.push("## Recurring alerts (7d)");
  const trends = await alertTrends(vaultDir, { days: 7, now });
  if (!trends.length) out.push("(none)", "");
  else {
    for (const t of trends.slice(0, 5)) {
      out.push(`- [${t.severity}] ${t.kind} ${t.type}/${t.name} — ${t.days.length} days — ${t.latestEvidence}`);
    }
    out.push("");
  }

  const groups = await followupsByEntity(vaultDir);
  const { shown, total } = priorityItems(groups, BRIEF_PRIORITY_LIMIT);
  out.push(`## Priority actions (top ${BRIEF_PRIORITY_LIMIT})`);
  if (!shown.length) out.push("(none)");
  else {
    for (const item of shown) {
      out.push(`- ${item.type}/${item.name}: [${item.kind}] ${item.text}`);
    }
    if (total > shown.length) out.push(`(${total - shown.length} more in vault — open follow-ups page or vault files)`);
  }
  out.push("", await gateWeekLine(vaultDir, now));
  return out.join("\n").trimEnd() + "\n";
}

export async function renderDaySummary(vaultDir, dateStr) {
  const out = [`# ${formatDate(dateStr)} — day summary`, "", "## Activity"];
  let any = false;
  for (const e of await eachEntity(vaultDir)) {
    const lines = e.content
      .split("\n")
      .filter((l) => l.startsWith("- **") && l.includes(dateStr));
    if (!lines.length) continue;
    any = true;
    out.push(`### ${e.type}/${e.name}`, ...lines, "");
  }
  if (!any) out.push("(no logged activity)", "");

  out.push("## Alerts");
  const alerts = await readAlertsForDate(vaultDir, dateStr);
  out.push(alerts?.trim() ? alerts.trim() : "(none)", "");

  out.push("## Open follow-ups");
  const groups = await followupsByEntity(vaultDir);
  if (!groups.length) out.push("(none)");
  for (const g of groups) {
    out.push(...g.followUps.map((f) => `- ${g.type}/${g.name}: ${f}`));
    out.push(...g.actions.map((a) => `- ${g.type}/${g.name}: [action] ${a}`));
  }
  out.push("", "## Gate", await gateWeekLine(vaultDir, new Date(dateStr + "T12:00:00")));
  return out.join("\n").trimEnd() + "\n";
}

export function buildDaySummaryPrompt(factsMarkdown) {
  return [
    "You are summarizing one work day for a single operator.",
    "Below are the day's logged facts (activity, alerts, open follow-ups).",
    "Write 1-2 short paragraphs of prose: what happened across people and",
    "projects, and what is at risk or slipping. Then end with a single line",
    'starting "Tomorrow:" naming 2-3 concrete priorities.',
    "Cite only what appears in the facts — add no outside information.",
    "Return plain prose only: no fenced code, no JSON, no markdown headings.",
    "",
    "--- FACTS ---",
    factsMarkdown,
  ].join("\n");
}

export async function writeDaySummary(vaultDir, arg = {}) {
  const { now = new Date(), runAgent } =
    arg instanceof Date ? { now: arg } : arg;
  const dateStr = now.toISOString().slice(0, 10);
  const dir = join(vaultDir, "days");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${dateStr}.md`);
  const facts = await renderDaySummary(vaultDir, dateStr);
  const hasActivity = !facts.includes("(no logged activity)");
  let body = facts;
  if (runAgent && hasActivity) {
    try {
      const prose = (await runAgent(buildDaySummaryPrompt(facts))).trim();
      if (prose) body = `## Summary\n\n${prose}\n\n${facts}`;
    } catch (e) {
      console.error(`kizuki day summary: prose generation failed: ${e.message}`);
    }
  }
  await writeFile(path, body, "utf8");
  return path;
}
