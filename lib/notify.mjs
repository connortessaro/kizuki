import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function escapeOsascript(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function notifyAlerts(newAlerts, { runOsascript, platform = process.platform } = {}) {
  if (platform !== "darwin" || !newAlerts.length) return;
  const run = runOsascript ?? defaultRunOsascript;
  for (const alert of newAlerts) {
    if (alert.severity !== "warn" && alert.severity !== "critical") continue;
    const title = `Kizuki ${alert.severity}: ${alert.kind}`;
    const body = alert.evidence;
    try {
      await run(
        `display notification "${escapeOsascript(body)}" with title "${escapeOsascript(title)}"`,
      );
    } catch (e) {
      console.error(`kizuki notify failed: ${e.message}`);
    }
  }
}

export async function notifySyncFailing({ runOsascript, platform = process.platform } = {}) {
  if (platform !== "darwin") return;
  const run = runOsascript ?? defaultRunOsascript;
  try {
    await run(
      'display notification "Background sync failed twice in a row. Check state/sync.log." with title "Kizuki sync failing"',
    );
  } catch (e) {
    console.error(`kizuki notify failed: ${e.message}`);
  }
}

async function defaultRunOsascript(script) {
  await execFileAsync("osascript", ["-e", script]);
}
