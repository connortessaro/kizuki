import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { readAlertsForDate, parseAlertLine } from "./alerts.mjs";

export function dateKey(d) {
  return d.toISOString().slice(0, 10);
}

export async function listAlertDates(vaultDir) {
  const dir = join(vaultDir, "alerts");
  try {
    const files = await readdir(dir);
    return files
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort((a, b) => b.localeCompare(a));
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}

export async function alertTrends(vaultDir, { days = 7, now = new Date() } = {}) {
  const counts = new Map();
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const key = dateKey(d);
    const content = await readAlertsForDate(vaultDir, key);
    if (!content) continue;
    const seenDay = new Set();
    for (const line of content.split("\n")) {
      const alert = parseAlertLine(line);
      if (!alert) continue;
      const id = `${alert.type}/${alert.name}:${alert.kind}`;
      if (seenDay.has(id)) continue;
      seenDay.add(id);
      const prev = counts.get(id) ?? {
        type: alert.type,
        name: alert.name,
        kind: alert.kind,
        severity: alert.severity,
        days: [],
        latestEvidence: alert.evidence,
      };
      prev.days.push(key);
      prev.latestEvidence = alert.evidence;
      if (alert.severity === "critical") prev.severity = "critical";
      else if (alert.severity === "warn" && prev.severity !== "critical") prev.severity = "warn";
      counts.set(id, prev);
    }
  }
  return [...counts.values()]
    .filter((t) => t.days.length >= 2)
    .sort((a, b) => b.days.length - a.days.length || a.name.localeCompare(b.name));
}
