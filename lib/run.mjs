// lib/run.mjs
import { parseArgs } from "./args.mjs";
import { buildPrompt } from "./prompt.mjs";
import { parsePayload } from "./payload.mjs";
import { applyPayload } from "./apply.mjs";
import { notifyAlerts } from "./notify.mjs";
import { activeInsightsForScope, formatInsightContext } from "./insightContext.mjs";

export async function runSync({ argv, vaultDir, runAgent, notify = notifyAlerts }) {
  const { scope, sources, dryRun } = parseArgs(argv);
  const insightContext = formatInsightContext(
    await activeInsightsForScope(vaultDir, scope),
  );
  const prompt = buildPrompt({ scope, sources, vaultDir, insightContext });
  const stdout = await runAgent(prompt);
  const payload = parsePayload(stdout);
  const applied = await applyPayload(vaultDir, payload, { dryRun });
  if (!dryRun) await notify(applied.newAlerts);
  return { scope, sources, dryRun, ...applied };
}
