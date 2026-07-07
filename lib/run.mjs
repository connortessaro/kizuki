// lib/run.mjs
import { parseArgs } from "./args.mjs";
import { buildPrompt } from "./prompt.mjs";
import { parsePayload } from "./payload.mjs";
import { applyPayload } from "./apply.mjs";
import { notifyAlerts } from "./notify.mjs";

export async function runSync({ argv, vaultDir, runAgent, notify = notifyAlerts }) {
  const { scope, sources, dryRun } = parseArgs(argv);
  const prompt = buildPrompt({ scope, sources, vaultDir });
  const stdout = await runAgent(prompt);
  const payload = parsePayload(stdout);
  const { changes, newAlerts } = await applyPayload(vaultDir, payload, { dryRun });
  if (!dryRun) await notify(newAlerts);
  return { scope, sources, dryRun, changes, newAlerts };
}
