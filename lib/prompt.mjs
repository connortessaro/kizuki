import { PAYLOAD_VERSION } from "./payload.mjs";

export const PAYLOAD_SHAPE = {
  version: PAYLOAD_VERSION,
  entities: [
    {
      type: "person | project | team",
      name: "kebab-case-name",
      rawEntries: [
        { source: "slack", timestamp: "ISO-8601", text: "what was said or done" },
      ],
      analysis: {
        status: "one-line alignment risk or state",
        needs: "",
        doesntKnow: "",
        followUps: [],
        recommendedActions: [],
      },
    },
  ],
  consumedTranscripts: ["meeting-2026-06-30.txt"],
  alerts: [
    {
      severity: "warn | critical",
      kind: "contradiction | blocker | mention | deadline",
      type: "person | project | team",
      name: "kebab-case-name",
      evidence: "one-line citation of what was seen",
      draft: "optional copy-paste-ready action",
    },
  ],
};

export function buildPrompt({ scope, sources, vaultDir }) {
  const scopeLine =
    scope.kind === "person"
      ? `Only process activity involving the person "${scope.name}". Ignore everyone else.`
      : `Process all people, projects, and teams that have new activity.`;

  return [
    `You are Kizuki's sync agent — a personal alignment assistant. Alerts are the primary deliverable (0–3 per run). Entity files are supporting context: log entries plus a one-line status.`,
    `Vault directory: ${vaultDir}`,
    ``,
    `Do the following:`,
    `1. Read every file in ${vaultDir}/transcripts/ except the ${vaultDir}/transcripts/processed/ subfolder.`,
    `2. Pull recent work activity ONLY from these sources: ${sources.join(", ")}.`,
    `   Use your configured MCP servers/tools for these sources.`,
    `3. ${scopeLine}`,
    `4. Attribute every item to the correct person, project, or team (kebab-case names).`,
    `5. For each affected entity: raw log entries + analysis with status only by default (followUps: [], recommendedActions: []).`,
    `6. Emit 0–3 alerts for cross-cutting alignment: contradictions, blockers with downstream impact, unanswered mentions, slipped deadlines. Do not restate open PRs/Jira as alerts.`,
    ``,
    `Output ONLY a single fenced json code block as your final message, matching this shape:`,
    "```json",
    JSON.stringify(PAYLOAD_SHAPE, null, 2),
    "```",
    ``,
    `Rules:`,
    `- Be faithful. Never invent facts. Use "" or [] when something is unknown.`,
    `- Only report entities and alerts directly evidenced in the transcript files or the listed sources. Never derive entities from the vault directory itself, its code, or its docs.`,
    `- Each rawEntry "source" must be the channel the item actually came from. Items read from transcript files always use source "transcript" — never relabel them.`,
    `- Every alert "draft" must be ready-to-send when included.`,
    `- "consumedTranscripts" must list the basenames of the transcript files you actually read.`,
    `- Emit at most 3 alerts; prefer warn/critical for issues needing attention today. If nothing cross-cutting appeared, return alerts: [] (the pipeline may add an all-clear info line).`,
    `- Default every entity to followUps: [] and recommendedActions: []. Only add ONE entity-local follow-up OR ONE recommended action when no alert covers that entity and the item is not already in the log.`,
    `- Do not duplicate alerts in entity follow-ups. Status synthesizes alignment risk, not ticket inventory.`,
  ].join("\n");
}
