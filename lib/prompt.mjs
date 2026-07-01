export const PAYLOAD_SHAPE = {
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
};

export function buildPrompt({ scope, sources, vaultDir }) {
  const scopeLine =
    scope.kind === "person"
      ? `Only process activity involving the person "${scope.name}". Ignore everyone else.`
      : `Process all people, projects, and teams that have new activity.`;

  const serverMap = {
    slack: "slack",
    github: "github",
    atlassian: "atlassian/rovo",
    outlook: "outlook",
  };

  const mcp_servers = sources.map(s => serverMap[s] || s).join(", ");

  return [
    `You are OrgMind's sync agent. Vault directory: ${vaultDir}`,
    ``,
    `Do the following:`,
    `1. Read every file in ${vaultDir}/transcripts/ except the ${vaultDir}/transcripts/processed/ subfolder.`,
    `2. Pull recent work activity ONLY from these sources: ${sources.join(", ")}.`,
    `   Use the matching MCP servers (${mcp_servers}) already configured in ~/.codex/config.toml.`,
    `3. ${scopeLine}`,
    `4. Attribute every item to the correct person, project, or team (kebab-case names).`,
    `5. For each affected entity, produce raw log entries AND an analysis.`,
    ``,
    `Output ONLY a single fenced json code block as your final message, matching this shape:`,
    "```json",
    JSON.stringify(PAYLOAD_SHAPE, null, 2),
    "```",
    ``,
    `Rules:`,
    `- Be faithful. Never invent facts. Use "" or [] when something is unknown.`,
    `- Every "draft" must be ready-to-send text I can copy-paste (a Slack message, a Confluence doc outline, etc.).`,
    `- "consumedTranscripts" must list the basenames of the transcript files you actually read.`,
  ].join("\n");
}
