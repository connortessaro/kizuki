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
      severity: "info | warn | critical",
      kind: "contradiction | blocker | mention | deadline",
      type: "person | project | team",
      name: "kebab-case-name",
      topic: "stable-lowercase-kebab-case-subject",
      evidence: "one-line citation of what was seen",
      draft: "optional copy-paste-ready action",
      receipts: [
        {
          source: "slack | github | atlassian | outlook | transcript",
          locator: "stable source-native ID or canonical URL",
          observedAt: "ISO-8601 timestamp",
          excerpt: "short supporting excerpt",
        },
      ],
    },
  ],
};

export const CHECK_PAYLOAD_SHAPE = {
  contradictions: [
    {
      severity: "warn | critical",
      entity: { type: "person | project | team", name: "kebab-case-name" },
      draftClaim: "what the draft says or assumes",
      conflict: "what the vault knows that contradicts it",
      evidence: "the source fact / decision the vault holds",
    },
  ],
};

export function buildCheckPrompt({ draft, scope, vaultDir, vaultContext }) {
  const scopeLine =
    scope.kind === "person"
      ? `Consider the person "${scope.name}"${vaultContext ? ", and also consider any other entity sections included because the draft names them" : ""}.`
      : scope.kind === "project"
        ? `Consider the project "${scope.name}"${vaultContext ? ", and also consider any other entity sections included because the draft names them" : ""}.`
        : scope.kind === "team"
          ? `Consider the team "${scope.name}"${vaultContext ? ", and also consider any other entity sections included because the draft names them" : ""}.`
          : `Consider all people, projects, and teams in the vault.`;

  return [
    `You are Kizuki's pre-send check — a personal alignment assistant. The vault is the source of truth.`,
    `Vault directory: ${vaultDir}`,
    vaultContext
      ? `Use only the vault context included below. Do not call tools, read files, or fetch external sources for this check.`
      : null,
    ``,
    `The user is about to send this DRAFT:`,
    `"""`,
    draft,
    `"""`,
    ``,
    vaultContext ? `Vault context:` : null,
    vaultContext ? "```md" : null,
    vaultContext || null,
    vaultContext ? "```" : null,
    vaultContext ? `` : null,
    `Do the following:`,
    vaultContext
      ? `1. Compare the draft against the provided vault context, especially managed analysis sections (status, what they don't know yet, follow-ups).`
      : `1. Read the entity files in ${vaultDir}/people, ${vaultDir}/projects, ${vaultDir}/teams — especially the managed analysis sections (status, what they don't know yet, follow-ups).`,
    `2. ${scopeLine}`,
    `3. Find only CONTRADICTIONS: where the draft asserts or assumes something the vault contradicts, or states something a recipient does not yet know. No style notes, no general feedback.`,
    `4. Cite the specific vault fact/decision as evidence for each contradiction.`,
    ``,
    `Output ONLY a single fenced json code block as your final message, matching this shape:`,
    "```json",
    JSON.stringify(CHECK_PAYLOAD_SHAPE, null, 2),
    "```",
    ``,
    `Rules:`,
    `- Be faithful. Never invent facts. Only report contradictions directly evidenced in the vault entity files or captured decisions and learnings.`,
    `- Captured decisions record user intent and captured learnings provide context. You must not treat captured hypotheses or questions as established facts.`,
    `- If a draft depends on or conflicts with a captured hypothesis or question, report an evidence gap rather than a factual contradiction.`,
    `- If the scoped context is too narrow to verify a broader project/team/person claim in the draft, return a warn contradiction with conflict "evidence gap" instead of passing it as aligned.`,
    `- Treat "I am checking/responding to approval asks" as assuming those approval asks are still open; flag a contradiction when vault context says the work is merged, landed, approved, or complete.`,
    `- If the draft contradicts nothing the vault knows, return contradictions: [].`,
    `- You never send anything. This is advice; the human decides.`,
  ].filter((line) => line !== null).join("\n");
}

export function buildPrompt({ scope, sources, vaultDir, insightContext = "" }) {
  const scopeLine =
    scope.kind === "person"
      ? `Only process activity involving the person "${scope.name}". Ignore everyone else.`
      : scope.kind === "project"
        ? `Only process activity involving the project "${scope.name}". Ignore all other projects, people, and teams unless they directly block this project.`
        : scope.kind === "team"
          ? `Only process activity involving the team "${scope.name}". Ignore all other teams, people, and projects unless they directly block this team.`
          : `Process all people, projects, and teams that have new activity.`;

  return [
    `You are Kizuki's sync agent — a personal alignment assistant. Alerts are the primary deliverable (0–3 per run). Entity files are supporting context: log entries plus a one-line status.`,
    `Vault directory: ${vaultDir}`,
    insightContext ? `` : null,
    insightContext || null,
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
    `- Only report entities and alerts directly evidenced in the transcript files, listed sources, or captured insight context. Never derive entities from the vault directory itself, its code, or its docs.`,
    `- Captured decisions record user intent and captured learnings provide context. Captured hypotheses and questions remain unverified and must not be stated as established facts.`,
    `- Each rawEntry "source" must be the channel the item actually came from. An insight-derived rawEntry must use source "insight", the capture timestamp, and text naming the insight ID and kind. Items read from transcript files always use source "transcript" — never relabel them.`,
    `- Every alert "draft" must be ready-to-send when included.`,
    `- Every alert "topic" must be a stable lowercase kebab-case semantic subject. Reuse it when evidence or draft wording changes.`,
    `- Every alert requires at least one receipt from slack, github, atlassian, outlook, or transcript. Receipt locators identify one specific item and must not contain query strings, fragments, credentials, or signed parameters.`,
    `- A captured insight cannot support a signal receipt by itself. Do not emit an alert without a Slack, GitHub, Atlassian, Outlook, or transcript receipt.`,
    `- If evidence is contested or incomplete, write alert drafts as questions that ask for confirmation; do not state the stronger claim as fact.`,
    `- "consumedTranscripts" must list the basenames of the transcript files you actually read.`,
    `- Emit at most 3 alerts; prefer warn/critical for issues needing attention today. If nothing cross-cutting appeared, return alerts: [].`,
    `- Default every entity to followUps: [] and recommendedActions: []. Only add ONE entity-local follow-up OR ONE recommended action when no alert covers that entity and the item is not already in the log.`,
    `- Do not duplicate alerts in entity follow-ups. Status synthesizes alignment risk, not ticket inventory.`,
  ].filter((line) => line !== null).join("\n");
}
