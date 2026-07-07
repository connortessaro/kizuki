# Kizuki

Personal org-intelligence tool. Pulls your work activity (TalkTrack meeting
transcripts + Slack / GitHub / Atlassian / Outlook via your AI agent's MCP
servers) into a git-tracked markdown vault sorted by person, project, and team, then
rewrites a managed analysis section in each file: status, what each person needs,
what they don't know, follow-ups, and copy-paste-ready recommended actions.

Single-operator tool. It observes and advises — it never sends messages or takes
actions for you. You decide.

## Usage

```
./kizuki init                          # create vault dirs + default kizuki.config.json
./kizuki sync                          # all people/projects/teams, all sources
./kizuki sync bob-smith                # only this person, all sources
./kizuki sync --project staff         # only this project
./kizuki sync --team checkout         # only this team
./kizuki sync --source slack           # all entities, only Slack
./kizuki sync bob-smith --source slack,github
./kizuki sync --dry-run                # show what would change, write nothing
./kizuki watch                         # auto-sync when a transcript lands in transcripts/
./kizuki start                         # begin shift: sync + brief + 30-min background sync
./kizuki stop                          # end shift: final sync + day summary + remove background sync
./kizuki doctor                        # diagnose setup: config, agent binary, smoke test, vault dirs
./kizuki doctor --no-smoke             # skip the agent smoke test (it boots the real agent + MCP, costs tokens)
./kizuki doctor --check-only           # read-only: report missing vault dirs instead of creating them
```

Valid sources: `slack`, `github`, `atlassian` (Jira/Confluence/Rovo), `outlook`.

### First-time setup

```
./kizuki init
./kizuki doctor
node scripts/install-codex-prompts.mjs   # optional: Codex /kizuki-start slash command
```

### Shift rituals (Codex slash commands)

Install ritual prompts to your Codex prompts folder:

```
node scripts/install-codex-prompts.mjs
```

Or copy manually:

```
cp codex/prompts/kizuki-start.md codex/prompts/kizuki-stop.md ~/.codex/prompts/
```

Plain-chat triggers ("start kizuki", "kizuki ima stop") can be added to the work
machine's global AGENTS.md pointing at the same two prompts.

## How it works

```
parseArgs -> buildPrompt -> runAgent -> parsePayload -> applyPayload -> vault
```

Your AI agent does the reading, fetching, and analysis, and returns a single
fenced JSON payload. Deterministic JS then writes the files. The LLM never edits
files directly — so re-runs are idempotent and your hand-written notes (anything
outside the `<!-- KIZUKI:ANALYSIS:START/END -->` markers) are never clobbered.

## Choosing your AI agent

Kizuki spawns whatever agent CLI you configure. The agent must take a prompt,
run non-interactively with your MCP servers/tools, and print its final message
(containing the fenced ```json block) to stdout.

Set the command in `kizuki.config.json` in the repo root:

```
{ "agentCmd": ["claude", "-p"] }      # Claude Code
{ "agentCmd": ["codex", "exec"] }     # OpenAI Codex (this is the default)
{ "agentCmd": ["gemini", "-p"] }      # Gemini CLI
```

The prompt is appended as the final argument. If any array element is the token
`{prompt}`, it is substituted in place instead (e.g. `["myagent", "--input", "{prompt}"]`).
With no config file, Kizuki defaults to `codex exec`. This file is gitignored
(it's machine-specific).

## Vault layout

```
people/<name>.md      # frontmatter: role, team, manager | log + analysis
projects/<name>.md    # frontmatter: status, stakeholders | log + analysis
teams/<name>.md       # frontmatter: members | rollup
transcripts/          # TalkTrack drops transcripts here; consumed ones move to processed/
alerts/               # daily alert files (gitignored); written by sync
```

Open the vault in your editor (Obsidian, VS Code) — or use the local dashboard below.

## Requirements

- Node >= 20
- An AI agent CLI that runs a prompt non-interactively and prints its final
message to stdout, with MCP servers configured for slack / github / atlassian /
outlook (e.g. Codex, Claude Code, Gemini CLI). Set it in `kizuki.config.json`
(see "Choosing your AI agent"); defaults to `codex exec`.
- TalkTrack writing transcript files into `transcripts/`



## Use as an MCP server

Instead of (or alongside) the `kizuki` CLI, you can expose the vault to any AI agent
as MCP tools. The agent does the pulling and analysis with its own MCP servers,
then calls these tools to read and safely persist:

- `list_entities` — people/projects/teams with one-line status
- `read_entity` — full file for one entity
- `list_followups` — every open follow-up + recommended action across the vault
- `search` — substring search across the vault
- `upsert_analysis` — the safe writer: creates the file, dedupes the log, and
rewrites ONLY the managed analysis section (hand-notes are never touched)

`upsert_analysis` reuses the same deterministic write path as the CLI, so the LLM
still never edits files directly — re-runs stay idempotent and notes stay safe.

Setup:

```
cd mcp && npm install
```

Register it. Claude Code (`.mcp.json` or `claude mcp add`):

```
{
  "mcpServers": {
    "kizuki": {
      "command": "node",
      "args": ["/ABS/PATH/kizuki/mcp/server.mjs"],
      "env": { "KIZUKI_VAULT": "/ABS/PATH/kizuki" }
    }
  }
}
```

Codex (`~/.codex/config.toml`):

```
[mcp_servers.kizuki]
command = "node"
args = ["/ABS/PATH/kizuki/mcp/server.mjs"]
env = { KIZUKI_VAULT = "/ABS/PATH/kizuki" }
```

`KIZUKI_VAULT` defaults to the repo root if unset.

## Web dashboard

Read-only localhost dashboard for browsing the vault: **alerts**, **shift status
+ copy queue**, entities, follow-ups, day summaries, search. It never writes vault
files and never sends anything — same rules as everywhere else in Kizuki.

```
cd web && npm install    # once
npm run dev              # http://localhost:3000
```

Reads the vault fresh on every page load. Vault dir comes from `KIZUKI_VAULT`
(defaults to the repo root).

## Roadmap

Ranked milestones (v2 alerts → v3 dashboard → v4 public):
[`docs/ROADMAP.md`](docs/ROADMAP.md). Ideation: [`docs/BACKLOG.md`](docs/BACKLOG.md).

## Development

```
npm test        # node --test, 188 tests (core is zero-dep; mcp/ has its own deps)
```



## Data safety

The vault entity files (`people/`, `projects/`, `teams/`) and `transcripts/` hold
internal work information and are **gitignored** — only the code and empty folder
structure are tracked, so pushing this repo (even to a private remote) never
uploads work data. Keep it that way: do not force-add anything under those
folders.