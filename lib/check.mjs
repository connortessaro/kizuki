import { buildCheckPrompt } from "./prompt.mjs";
import { parseCheckPayload } from "./payload.mjs";
import { makeRunAgent as defaultMakeRunAgent } from "./agent.mjs";
import { assertName, eachEntity } from "./query.mjs";
import { activeInsightsForScope, formatInsightContext } from "./insightContext.mjs";

export function makeRunCheckAgent(cmd, timeoutMs, { makeRunAgent = defaultMakeRunAgent } = {}) {
  return makeRunAgent(cmd, timeoutMs, { captureStderr: true });
}

export function parseCheckArgs(argv) {
  let personName = null;
  let projectName = null;
  let teamName = null;
  const positionals = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--person") {
      const v = argv[++i];
      if (!v) throw new Error("--person requires a value");
      if (personName) throw new Error("only one --person can be specified");
      personName = v;
    } else if (a === "--project") {
      const v = argv[++i];
      if (!v) throw new Error("--project requires a value");
      if (projectName) throw new Error("only one --project can be specified");
      projectName = v;
    } else if (a === "--team") {
      const v = argv[++i];
      if (!v) throw new Error("--team requires a value");
      if (teamName) throw new Error("only one --team can be specified");
      teamName = v;
    } else if (a === "--json") {
      continue;
    } else if (a.startsWith("--")) {
      throw new Error(`unknown flag: ${a}`);
    } else {
      positionals.push(a);
    }
  }

  const scopes = [
    personName ? "person" : null,
    projectName ? "project" : null,
    teamName ? "team" : null,
  ].filter(Boolean);
  if (scopes.length > 1) throw new Error("specify only one of: --person, --project, --team");

  let scope = { kind: "all" };
  if (personName) scope = { kind: "person", name: personName };
  else if (projectName) scope = { kind: "project", name: projectName };
  else if (teamName) scope = { kind: "team", name: teamName };

  return { scope, draftArg: positionals.join(" ").trim() };
}

function normalizedWords(text) {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

function mentionsEntity(draft, name) {
  if (!draft) return false;
  return normalizedWords(draft).includes(normalizedWords(name.replaceAll("-", " ")));
}

export async function checkVaultContext(vaultDir, scope, draft = "") {
  if (scope.kind !== "all") assertName(scope.name);
  const entities = (await eachEntity(vaultDir)).filter(
    (e) => scope.kind === "all" || (e.type === scope.kind && e.name === scope.name) || mentionsEntity(draft, e.name),
  );
  const insightContext = formatInsightContext(
    await activeInsightsForScope(vaultDir, scope),
  );
  const blocks = entities.map((e) => `## ${e.type}/${e.name}\n${e.content.trim()}`);
  if (insightContext) blocks.push(insightContext);
  if (!blocks.length) return "(no matching entity files or active insights found)";
  return blocks.join("\n\n---\n\n");
}

export async function runCheck({ draft, scope, vaultDir, runAgent }) {
  const vaultContext = await checkVaultContext(vaultDir, scope, draft);
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
