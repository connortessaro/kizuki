import { buildCheckPrompt } from "./prompt.mjs";
import { parseCheckPayload } from "./payload.mjs";

export async function runCheck({ draft, scope, vaultDir, runAgent }) {
  const prompt = buildCheckPrompt({ draft, scope, vaultDir });
  const stdout = await runAgent(prompt);
  return parseCheckPayload(stdout);
}

export function formatContradictions({ contradictions }) {
  if (!contradictions.length) return "No contradictions found. Draft aligns with the vault.";
  const rank = { critical: 0, warn: 1 };
  const sorted = [...contradictions].sort((a, b) => rank[a.severity] - rank[b.severity]);
  const lines = sorted.map(
    (c) => `[${c.severity}] ${c.entity.type}/${c.entity.name}: ${c.conflict} (${c.evidence})`,
  );
  return lines.join("\n");
}
