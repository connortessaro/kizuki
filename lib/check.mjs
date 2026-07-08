import { buildCheckPrompt } from "./prompt.mjs";
import { parseCheckPayload } from "./payload.mjs";
import { makeRunAgent as defaultMakeRunAgent } from "./agent.mjs";
import { assertName, eachEntity } from "./query.mjs";

export function makeRunCheckAgent(cmd, timeoutMs, { makeRunAgent = defaultMakeRunAgent } = {}) {
  return makeRunAgent(cmd, timeoutMs, { captureStderr: true });
}

export async function checkVaultContext(vaultDir, scope) {
  const filterType = scope.kind === "all" ? undefined : scope.kind;
  if (scope.kind !== "all") assertName(scope.name);
  const entities = (await eachEntity(vaultDir, filterType)).filter((e) => scope.kind === "all" || e.name === scope.name);
  if (!entities.length) return "(no matching entity files found)";
  return entities.map((e) => `## ${e.type}/${e.name}\n${e.content.trim()}`).join("\n\n---\n\n");
}

export async function runCheck({ draft, scope, vaultDir, runAgent }) {
  const vaultContext = await checkVaultContext(vaultDir, scope);
  const prompt = buildCheckPrompt({ draft, scope, vaultDir, vaultContext });
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
