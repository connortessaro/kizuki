# OrgMind

Personal org-intelligence tool. Pulls your work activity (TalkTrack meeting
transcripts + Slack / GitHub / Atlassian / Outlook via your AI agent's MCP
servers) into a git-tracked markdown vault sorted by person, project, and team, then
rewrites a managed analysis section in each file: status, what each person needs,
what they don't know, follow-ups, and copy-paste-ready recommended actions.

Single-operator tool. It observes and advises — it never sends messages or takes
actions for you. You decide.

## Usage

    ./sync                          # all people/projects/teams, all sources
    ./sync bob-smith                # only this person, all sources
    ./sync --source slack           # all entities, only Slack
    ./sync bob-smith --source slack,github
    ./sync --dry-run                # show what would change, write nothing

Valid sources: `slack`, `github`, `atlassian` (Jira/Confluence/Rovo), `outlook`.

## How it works

    parseArgs -> buildPrompt -> runAgent -> parsePayload -> applyPayload -> vault

Your AI agent does the reading, fetching, and analysis, and returns a single
fenced JSON payload. Deterministic JS then writes the files. The LLM never edits
files directly — so re-runs are idempotent and your hand-written notes (anything
outside the `<!-- ORGMIND:ANALYSIS:START/END -->` markers) are never clobbered.

## Choosing your AI agent

OrgMind spawns whatever agent CLI you configure. The agent must take a prompt,
run non-interactively with your MCP servers/tools, and print its final message
(containing the fenced ```json block) to stdout.

Set the command in `orgmind.config.json` in the repo root:

    { "agentCmd": ["claude", "-p"] }      # Claude Code
    { "agentCmd": ["codex", "exec"] }     # OpenAI Codex (this is the default)
    { "agentCmd": ["gemini", "-p"] }      # Gemini CLI

The prompt is appended as the final argument. If any array element is the token
`{prompt}`, it is substituted in place instead (e.g. `["myagent", "--input", "{prompt}"]`).
With no config file, OrgMind defaults to `codex exec`. This file is gitignored
(it's machine-specific).

## Vault layout

    people/<name>.md      # frontmatter: role, team, manager | log + analysis
    projects/<name>.md    # frontmatter: status, stakeholders | log + analysis
    teams/<name>.md       # frontmatter: members | rollup
    transcripts/          # TalkTrack drops transcripts here; consumed ones move to processed/

Open the vault in your editor (Obsidian, VS Code). There is no separate UI.

## Requirements

- Node >= 20
- An AI agent CLI that runs a prompt non-interactively and prints its final
  message to stdout, with MCP servers configured for slack / github / atlassian /
  outlook (e.g. Codex, Claude Code, Gemini CLI). Set it in `orgmind.config.json`
  (see "Choosing your AI agent"); defaults to `codex exec`.
- TalkTrack writing transcript files into `transcripts/`

## Development

    npm test        # node --test, 46 tests, zero runtime dependencies

## Data safety

The vault entity files (`people/`, `projects/`, `teams/`) and `transcripts/` hold
internal work information and are **gitignored** — only the code and empty folder
structure are tracked, so pushing this repo (even to a private remote) never
uploads work data. Keep it that way: do not force-add anything under those
folders.
