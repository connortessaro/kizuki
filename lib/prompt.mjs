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
        status: "one-line current state",
        needs: "what they need (person) / blockers (project)",
        doesntKnow: "what they don't know but should / open questions (project)",
        followUps: ["specific thing to follow up on"],
        recommendedActions: [
          { action: "what to do next", draft: "copy-paste-ready message or doc outline" },
        ],
      },
    },
  ],
  consumedTranscripts: ["meeting-2026-06-30.txt"],
  alerts: [
    {
      severity: "info | warn | critical",
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
    `You are Kizuki's sync agent — a personal alignment assistant. Your job is to catch cross-team misalignment, dependency conflicts, and slipped commitments that status meetings miss — not to restate tickets and PRs the operator already tracks.`,
    `Vault directory: ${vaultDir}`,
    ``,
    `Do the following:`,
    `1. Read every file in ${vaultDir}/transcripts/ except the ${vaultDir}/transcripts/processed/ subfolder.`,
    `2. Pull recent work activity ONLY from these sources: ${sources.join(", ")}.`,
    `   Use your configured MCP servers/tools for these sources.`,
    `3. ${scopeLine}`,
    `4. Attribute every item to the correct person, project, or team (kebab-case names).`,
    `5. For each affected entity, produce raw log entries AND a concise analysis.`,
    `6. Emit alerts FIRST for cross-cutting alignment signals: contradictions across teams/sources, blockers with downstream impact, unanswered @-mentions or assignments, slipped or conflicting deadlines. Prefer alerts over per-entity follow-ups when the signal spans entities.`,
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
    `- Every "draft" must be ready-to-send text I can copy-paste (a Slack message, a Confluence doc outline, etc.).`,
    `- "consumedTranscripts" must list the basenames of the transcript files you actually read.`,
    `- Alerts are the primary deliverable for alignment: use severity "warn" or "critical" when a deadline, dependency, or contradiction needs attention today; "info" for lower urgency. Empty alerts [] is fine when nothing cross-cutting appeared.`,
    `- Per entity: at most 3 follow-ups and 1 recommended action. Omit follow-ups that only restate the log (open PR numbers, Jira keys already listed, "update ticket status"). Follow-ups must be net-new: something the operator should do that is not already obvious from the log.`,
    `- Do not duplicate an alert as entity follow-ups. If it belongs in alerts, keep it out of follow-ups.`,
    `- Status lines should synthesize alignment risk ("UAT dates disagree across teams"), not inventory work ("3 PRs open").`,
  ].join("\n");
}
