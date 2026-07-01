// lib/run.mjs
import { parseArgs } from "./args.mjs";
import { buildPrompt } from "./prompt.mjs";
import { parsePayload } from "./payload.mjs";
import { applyPayload } from "./apply.mjs";

export async function runSync({ argv, vaultDir, runCodex }) {
  const { scope, sources, dryRun } = parseArgs(argv);
  const prompt = buildPrompt({ scope, sources, vaultDir });
  const stdout = await runCodex(prompt);
  const payload = parsePayload(stdout);
  const changes = await applyPayload(vaultDir, payload, { dryRun });
  return { scope, sources, dryRun, changes };
}
