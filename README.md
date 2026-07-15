# Kizuki

Personal org-intelligence tool. Kizuki pulls your work activity (TalkTrack
meeting transcripts + Slack / GitHub / Atlassian / Outlook via your AI agent's
MCP servers) into a git-tracked markdown vault sorted by person, project, and
team, then rewrites a managed analysis section in each file: status, what each
person needs, what they don't know, follow-ups, and copy-paste-ready recommended
actions.

Single-operator tool. It observes and advises — it never sends messages or takes
actions for you. You decide.

## Works with

| Agent | Setup | Sync sources | Notes |
|---|---|---|---|
| Codex | `kizuki init --agent codex` (default) | slack, github, atlassian, outlook | full sync, check, day-summary |
| Claude Code | `kizuki init --agent claude` | slack, github, atlassian, outlook | full sync, check, day-summary |
| Gemini CLI | `kizuki init --agent gemini` | slack, github, atlassian, outlook | full sync, check, day-summary |
| opencode | `kizuki init --agent opencode` | slack, github, atlassian, outlook | full sync, check, day-summary |
| Any OpenAI-compatible API | `kizuki init --agent http` (writes an `agentHttp` config) | transcript only (`--source transcript`) | `check` and the `stop` day summary work fully — both build a self-contained prompt and never need MCP; full multi-source sync needs one of the CLI agents above |
| Any MCP client | connect to `mcp/server.mjs` (see below) | whatever the client's own MCP servers provide | the client does the pulling/analysis and calls Kizuki's tools to read/write the vault |

See "Choosing your AI agent" for CLI presets and the `agentHttp` config shape,
and "Connect any MCP client" for the MCP-server setup.

Use it in three moments:

- **Start/stop the day:** sync the vault, surface alerts, and write a day summary.
- **Before you send:** run `kizuki check "<draft>"` to catch contradictions
  between a draft message and what the vault already knows.
- **While thinking:** say "Kizuki this" in a connected Codex or Cursor chat to
  save a distilled decision, learning, hypothesis, or question.

Product direction:

- [Product model](docs/PRODUCT.md): the builder north star and operating model.
- [Manifesto](docs/MANIFESTO.md): why Kizuki should exist.
- [Long-form vision](docs/vision.md): strategy, validation gates, and the
  personal Jarvis arc.
- [Roadmap](docs/ROADMAP.md): build order.

## Usage

```
./kizuki init                          # create vault dirs + default kizuki.config.json
./kizuki init --agent claude           # same, pre-configured for a CLI/HTTP agent preset
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
./kizuki doctor                        # diagnose setup: config, agent, vault dirs, daemon
./kizuki doctor --no-smoke             # skip the agent smoke test (it boots the real agent + MCP, costs tokens)
./kizuki doctor --check-only           # read-only: report missing vault dirs instead of creating them
./kizuki daemon install                # install + start the private loopback capture daemon
./kizuki daemon status                 # report whether the daemon is listening
./kizuki daemon uninstall              # stop and remove the daemon service
./kizuki daemon restart                # restart the daemon service
./kizuki capture "<note>"              # record a private local capture through the daemon
./kizuki capture "<note>" --kind decision --project checkout-v2
./kizuki signals                       # list open and acted signals
./kizuki signals --status all --json   # list every lifecycle state as JSON
./kizuki signal show <id> --json       # show reduced state plus event history
./kizuki signal act <id>                # mark an open signal acted on
./kizuki signal dismiss <id> --reason stale
./kizuki signal resolve <id>
./kizuki signals migrate-alerts --dry-run # preview legacy alert import
./kizuki insights                      # list active captured insights
./kizuki insights --status all --json  # list active and archived insights as JSON
./kizuki insight show <id> --json       # show an insight plus event history
./kizuki insight archive <id>           # archive an insight
./kizuki check "<draft>"               # flag where a draft contradicts the vault (read-only)
./kizuki check "<draft>" --person p    # check against one person
./kizuki check "<draft>" --project p   # check against one project
./kizuki check "<draft>" --team t      # check against one team
```

Valid sources: `slack`, `github`, `atlassian` (Jira/Confluence/Rovo), `outlook`.

### First-time setup

```
./kizuki init
./kizuki doctor
./kizuki sync --dry-run                  # optional: verify the agent can read sources without writing
./kizuki check "We are ready for UAT."    # optional: test a draft against the vault
kizuki skills export                      # optional: install shift-ritual skills for your agent(s)
```

## Install the rituals as agent skills

    kizuki skills export                    # installs home copies for every agent that has one
    kizuki skills export --agent codex      # just one agent (claude|codex|cursor|gemini|generic|all)
    kizuki skills export --dist             # regenerate dist/skills/* for every target, dist-only ones included
    kizuki skills export --check            # verify dist/skills/* matches the committed rituals

Claude Code skills land in `~/.claude/skills/<name>/SKILL.md`; Codex prompts in
`~/.codex/prompts/<name>.md`; Gemini CLI custom commands in
`~/.gemini/commands/<name>.toml`. Cursor has no global rules directory — only
project-scoped `.cursor/rules/*.mdc` — so the `cursor` target is **dist-only**:
copy `dist/skills/cursor/<name>.mdc` into a project's `.cursor/rules/`
directory yourself. The plain-markdown `generic` target is dist-only too;
copy `dist/skills/generic/<name>.md` for any agent that just reads markdown.
The rituals invoke the `kizuki` binary, so it must be on your PATH.

Plain-chat triggers ("start kizuki", "kizuki ima stop") can be added to the work
machine's global AGENTS.md pointing at the same rituals.

### Capture ideas from a chat

Connect the Kizuki MCP server, then say "Kizuki this" or explicitly ask the
chat to save an insight. The chat agent distills the useful thought and calls
`capture_insight`; Kizuki does not read the session itself.

```json
{
  "kind": "hypothesis",
  "summary": "STAFF may need per-FC manifests instead of one global pointer.",
  "context": "This came from reasoning about the backend bundle contract.",
  "entities": [{ "type": "project", "name": "staff" }],
  "origin": { "client": "codex", "locator": "optional-stable-turn-id" }
}
```

Kinds preserve certainty: `decision` is a choice you made, `learning` is context
you want later, `hypothesis` still needs evidence, and `question` is unresolved.
Kizuki stores only the distilled capture, never the full chat or tool output.

Captured insights are searchable immediately. Active insights also inform
`sync` and `check`: all-scope runs see every active insight, while entity-scoped
runs see matching entity references. Unscoped captures stay in the inbox until
an all-scope run or direct search. Hypotheses and questions remain explicitly
unverified and cannot create a signal without an external source receipt.

An exact retry returns the same insight without another event. Changed wording,
kind, scope, or origin creates a new insight. Archive is terminal; recapturing
the exact archived item does not reactivate it.

## Local daemon and capture

Everything Kizuki does runs on your machine. Alongside the CLI, Kizuki can run a
small background service — the **daemon** — that exposes an authenticated,
loopback-only HTTP API so the CLI, the MCP server, and the web dashboard can all
record captures through one shared, private endpoint. It never listens on a
public interface and never sends anything off the machine — same observe-and-advise
rule as the rest of Kizuki.

### Architecture

```
kizuki capture ─┐
MCP capture_context ─┼─► daemon (127.0.0.1, bearer-token auth) ─► events/events.jsonl
web /capture ─┘
```

`kizuki init` creates the `events/` store and writes a daemon config to
`state/daemon.json` (a random 32-byte token, host, and port), but it does not
start or install the service. Install the background service explicitly:

```
./kizuki daemon install     # launchd (macOS) or systemd --user (Linux); starts on login
./kizuki daemon status      # "running at ..." or "not running (...)"
./kizuki daemon restart     # reload after config changes
./kizuki daemon uninstall   # stop and remove the service
```

`daemon install` requires macOS or Linux. `kizuki doctor` adds a `daemon-config`
check (config present and valid) and a `daemon-health` check (the service is
actually listening); run `kizuki daemon install` if `daemon-health` reports the
daemon is not running.

### API address

The daemon binds to `127.0.0.1` (loopback only) on port `4247` by default. Both
values come from `state/daemon.json`; edit that file and `kizuki daemon restart`
to change them. The host is pinned to `127.0.0.1` — the API is never exposed to
the network. Every request needs an `Authorization: Bearer <token>` header, so
only processes that can read your local config can talk to it.

### Token secrecy

The bearer token lives only in `state/daemon.json`, which is written with `0600`
permissions and is gitignored. Kizuki never prints the token — not in
`kizuki doctor` output, not in logs, and not in the init report. If the token
leaks, delete `state/daemon.json` and re-run `kizuki init` (or
`kizuki daemon install`) to mint a new one, then `kizuki daemon restart`.

### Recording a capture

A capture is one distilled note, correction, decision, hypothesis, or question.
There are three ways in, all going through the same daemon:

- **CLI:** `kizuki capture "<text>" [--kind note|correction|decision|hypothesis|question]
  [--person <name> | --project <name> | --team <name>]`
- **MCP:** call the `capture_context` tool from any connected MCP client (say
  "Kizuki this" in a chat). Kizuki records only the distilled thought — never the
  full conversation or raw tool output.
- **Web:** open `/capture` on the dashboard and submit the form.

Captures are private to you on this machine. Kizuki stores the distilled capture
in `events/events.jsonl` and never sends messages or takes action.

## How it works

```
parseArgs -> buildPrompt -> runAgent -> parsePayload -> applyPayload -> signal ledger + vault
```

Your AI agent does the reading, fetching, and analysis, and returns a single
fenced JSON payload. Deterministic JS then writes the files. The LLM never edits
files directly — so re-runs are idempotent and your hand-written notes (anything
outside the `<!-- KIZUKI:ANALYSIS:START/END -->` markers) are never clobbered.

Payload version 3 asks the agent for signal candidates with a stable semantic
topic and source receipts. Deterministic JS assigns the signal ID, appends
events to `signals/events.jsonl`, and decides whether the candidate should
surface. Payload versions 1 and 2 still parse for compatibility. Version 2
alerts use exact-evidence identity and print a warning so you can update the
configured agent.

The signal ledger is the source of truth. Kizuki still writes surfaced
candidates to `alerts/YYYY-MM-DD.md` so existing dashboard and notification
flows keep working. A run with no candidates prints `no signals` and does not
store an all-clear record.

`kizuki check` uses the same vault as source of truth, but it never writes. It
passes your draft to the agent, parses the fenced JSON result, and prints only
the contradictions it can cite.

## Choosing your AI agent

Kizuki spawns whatever agent CLI you configure, or talks to any
OpenAI-compatible chat-completions API directly with no CLI and no MCP at all.
A CLI agent must take a prompt, run non-interactively with your MCP
servers/tools, and print its final message (containing the fenced ```json
block) to stdout.

The easiest setup is `kizuki init --agent <preset>`, which writes
`kizuki.config.json` for you:

```
./kizuki init --agent codex      # OpenAI Codex (default)
./kizuki init --agent claude     # Claude Code
./kizuki init --agent gemini     # Gemini CLI
./kizuki init --agent opencode   # opencode
./kizuki init --agent http       # any OpenAI-compatible HTTP API — see below
```

Or set the command by hand in `kizuki.config.json` in the repo root:

```
{ "agentCmd": ["claude", "-p"] }      # Claude Code
{ "agentCmd": ["codex", "exec"] }     # OpenAI Codex (this is the default)
{ "agentCmd": ["gemini", "-p"] }      # Gemini CLI
{ "agentCmd": ["opencode", "run"] }   # opencode
```

The prompt is appended as the final argument. If any array element is the token
`{prompt}`, it is substituted in place instead (e.g. `["myagent", "--input", "{prompt}"]`).
With no config file, Kizuki defaults to `codex exec`. This file is gitignored
(it's machine-specific).

### Any OpenAI-compatible API (no CLI, no MCP)

Point Kizuki straight at any OpenAI-compatible `/chat/completions` endpoint
instead of spawning a CLI:

```
{
  "agentHttp": {
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-5.4",
    "apiKeyEnv": "OPENAI_API_KEY"
  }
}
```

`apiKeyEnv` names an environment variable Kizuki reads the key from at call
time — the key itself never goes in the config file or in logs. Set exactly
one of `agentCmd` or `agentHttp`, never both.

An HTTP agent has no MCP servers, so it can't pull Slack/GitHub/Atlassian/Outlook
itself:

- `kizuki sync --source transcript` is the only sync source it supports.
  Kizuki inlines pending `transcripts/*` files directly into the prompt
  (capped at 200,000 characters combined — archive old transcripts or switch
  to a CLI agent if you hit the cap). Requesting any other source fails loudly
  before the agent is called.
- `kizuki check` and the `kizuki stop` day summary work fully regardless of
  agent kind — both build a self-contained prompt from the vault and never
  need MCP.

## Vault layout

```
people/<name>.md      # frontmatter: role, team, manager | log + analysis
projects/<name>.md    # frontmatter: status, stakeholders | log + analysis
teams/<name>.md       # frontmatter: members | rollup
transcripts/          # TalkTrack drops transcripts here; consumed ones move to processed/
signals/events.jsonl  # canonical append-only signal history (gitignored)
insights/events.jsonl # explicit, append-only chat insight inbox (gitignored)
events/events.jsonl   # canonical append-only capture history via the daemon (gitignored)
alerts/               # daily compatibility view for dashboard and notifications
days/                 # generated day summaries (gitignored)
state/                # lock, shift, sync-failure, and daemon config (gitignored)
```

Open the vault in your editor (Obsidian, VS Code) — or use the local dashboard below.

### Signal lifecycle

Signals start `open`. Use `act` after you take the recommended action,
`dismiss` when the signal is wrong or not useful, and `resolve` when the issue
no longer needs attention. Acted signals remain active. Dismissed and resolved
signals stay terminal until a sync finds a new receipt or higher severity.

Dismiss reasons are `false-positive`, `stale`, `duplicate`, `not-actionable`,
and `low-value`. Notes are optional on every manual transition.

### Import existing alert history

Migration is manual. Preview it first, then import and inspect the resolved
history:

```bash
./kizuki signals migrate-alerts --dry-run
./kizuki signals migrate-alerts
./kizuki signals --status resolved
```

Migration reads `alerts/YYYY-MM-DD.md` without changing those files. Re-running
it adds no duplicate events.

## Requirements

- Node >= 20
- An AI agent CLI that runs a prompt non-interactively and prints its final
message to stdout, with MCP servers configured for slack / github / atlassian /
outlook (e.g. Codex, Claude Code, Gemini CLI). Set it in `kizuki.config.json`
(see "Choosing your AI agent"); defaults to `codex exec`.
- TalkTrack writing transcript files into `transcripts/`

## Connect any MCP client

Instead of (or alongside) the `kizuki` CLI, you can expose the vault to any
MCP client — any agent or IDE that speaks MCP, not just the CLI presets above —
as MCP tools served by `mcp/server.mjs`. The client does the pulling and
analysis with its own MCP servers, then calls these tools to read and safely
persist:

- `list_entities` — people/projects/teams with one-line status
- `read_entity` — full file for one entity
- `list_followups` — every open follow-up + recommended action across the vault
- `search` — substring search across the vault and active insights
- `upsert_analysis` — the safe writer: creates the file, dedupes the log, and
rewrites ONLY the managed analysis section (hand-notes are never touched)
- `capture_insight` — validate and save one distilled thought
- `list_insights` — list active, archived, or all captured insights
- `read_insight` — read one insight and its event history
- `archive_insight` — archive one active insight

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

Any other MCP client (Cursor, Windsurf, LM Studio, or anything else that reads
a standard `mcpServers` map) takes the exact same JSON shape as the Claude Code
block above — add that same object to that client's own MCP config file.

`KIZUKI_VAULT` defaults to the repo root if unset.

## Web dashboard

Read-only localhost dashboard for browsing the vault: **alerts**, **shift status
+ copy queue**, entities, follow-ups, day summaries, search. It never writes vault
files and never sends anything — same rules as everywhere else in Kizuki.

```
cd web && npm install    # once
npm run dev              # http://localhost:3000
KIZUKI_DEMO=1 npm run dev # synthetic demo vault; no private data
```

Reads the vault fresh on every page load. Vault dir comes from `KIZUKI_VAULT`
(defaults to the repo root). `KIZUKI_DEMO=1` switches the dashboard to
`web/demo-vault/`, which shows the pre-send UAT-date contradiction story without
using real work data.

## Roadmap

Ranked milestones (v2 alerts → v3 dashboard → v4 public):
[`docs/ROADMAP.md`](docs/ROADMAP.md). Ideation: [`docs/BACKLOG.md`](docs/BACKLOG.md).

## Development

```
npm test        # node --test (core is zero-dep; mcp/ has its own deps)
```

## Data safety

The vault entity files and local runtime data under `people/`, `projects/`,
`teams/`, `transcripts/`, `alerts/`, `signals/`, `insights/`, `events/`,
`days/`, and `state/` contain internal work information and are **gitignored**.
`state/daemon.json` additionally holds the daemon's bearer token (written
`0600`). Pushing the repository does not include that data unless someone
force-adds it. Do not force-add files from those folders.
