import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export function formatAlertLine(alert) {
  return `- **[${alert.severity}] ${alert.kind}** ${alert.type}/${alert.name}: ${alert.evidence}`;
}

const ALERT_LINE_RE = /^- \*\*\[(\w+)\] (\w+)\*\* (\w+)\/([^:]+): (.+)$/;

export function parseAlertLine(line) {
  const m = line.trim().match(ALERT_LINE_RE);
  if (!m) return null;
  return { severity: m[1], kind: m[2], type: m[3], name: m[4], evidence: m[5] };
}

export function parseAlertsWithDrafts(content) {
  if (!content?.trim()) return [];
  const lines = content.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const alert = parseAlertLine(lines[i]);
    if (!alert) continue;
    let draft = null;
    if (lines[i + 1]?.trim() === "```") {
      const parts = [];
      for (let j = i + 2; j < lines.length && lines[j].trim() !== "```"; j++) parts.push(lines[j]);
      draft = parts.join("\n").trim() || null;
    }
    out.push({ ...alert, draft });
  }
  return out;
}

function formatAlertBlock(alert) {
  const line = formatAlertLine(alert);
  if (!alert.draft) return `${line}\n`;
  return `${line}\n  \`\`\`\n  ${alert.draft}\n  \`\`\`\n`;
}

export async function readAlertsForDate(vaultDir, dateStr) {
  try {
    return await readFile(join(vaultDir, "alerts", `${dateStr}.md`), "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

export async function appendAlerts(vaultDir, alerts, { now = new Date() } = {}) {
  if (!alerts.length) return [];
  const dateStr = now.toISOString().slice(0, 10);
  const filePath = join(vaultDir, "alerts", `${dateStr}.md`);
  let existing = "";
  try {
    existing = await readFile(filePath, "utf8");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const existingLines = new Set(existing.split("\n"));
  const added = [];
  const blocks = [];
  for (const alert of alerts) {
    const line = formatAlertLine(alert);
    if (existingLines.has(line)) continue;
    existingLines.add(line);
    blocks.push(formatAlertBlock(alert));
    added.push(alert);
  }
  if (!blocks.length) return [];
  const prefix = existing.length && !existing.endsWith("\n") ? "\n" : "";
  const body = `${existing}${prefix}${blocks.join("")}`;
  await mkdir(join(vaultDir, "alerts"), { recursive: true });
  await writeFile(filePath, body, "utf8");
  return added;
}
