import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export function formatAlertLine(alert) {
  return `- **[${alert.severity}] ${alert.kind}** ${alert.type}/${alert.name}: ${alert.evidence}`;
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
