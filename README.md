# Kizuki

Kizuki is an agent-neutral intelligence layer over your work. It understands
what a business, a team, and a person need — what changed, what matters now,
what conflicts, what's missing — and prepares you and your AI agents to respond.

It pulls your work activity (meeting transcripts plus Slack, GitHub, Atlassian,
and Outlook through your AI agent's own connectors) into a local, git-tracked
markdown vault sorted by person, project, and team. For each entity it keeps a
managed analysis section current: status, what each person needs, what they
don't know yet, open follow-ups, and copy-ready recommended actions.

Kizuki observes and advises. It never sends a message, changes a source system,
or makes a commitment on your behalf. You decide what to do; Kizuki makes sure
you and your agents know enough to decide well.

## Give your agent understanding

The fastest way in is to give your existing AI agent access to the vault over
MCP. One command for Claude Code:

```bash
claude mcp add kizuki -- npx -y kizuki mcp        # Claude Code
```

Cursor (`.cursor/mcp.json`) and Codex (`~/.codex/config.toml`) use the same
`npx -y kizuki mcp` command; drop it into their MCP config in the shape each
client expects:

```jsonc
// Cursor — .cursor/mcp.json
{
  "mcpServers": {
    "kizuki": { "command": "npx", "args": ["-y", "kizuki", "mcp"] }
  }
}
```

```toml
# Codex — ~/.codex/config.toml
[mcp_servers.kizuki]
command = "npx"
args = ["-y", "kizuki", "mcp"]
```

Once connected, the agent can list and read entities, search the vault, record a
distilled thought, and safely rewrite the managed analysis section. The full
tool set is in [Connect any MCP client](#connect-any-mcp-client). Point the
server at a vault with `KIZUKI_VAULT`; it defaults to the repo root (the
directory Kizuki is installed in).

## Quickstart

Prefer the CLI? Install it globally (`npm i -g kizuki`) so the `kizuki` command
is on your PATH, or prefix each command with `npx kizuki`.

```bash
npx kizuki init --agent claude   # create the vault dirs + a Claude Code config
kizuki doctor                    # check config, agent binary, and vault structure
kizuki sync                      # pull activity and rewrite the analysis sections
kizuki start                     # begin a shift: sync + brief + 30-min background sync
kizuki stop                      # end the shift: final sync + day summary
```

`kizuki init --agent <preset>` writes a `kizuki.config.json` for one of
`codex`, `claude`, `gemini`, `opencode`, or `http`. Run
[`kizuki doctor`](#requirements) any time setup feels off — it reports config,
agent binary, vault dirs, and daemon health, and tells you exactly what to fix.

## What it answers

Kizuki is built to answer the questions that document search and generic recall
tools cannot:

- What changed?
- What matters now?
- What conflicts with prior understanding?
- What information is missing?
- Who is affected?
- What needs a decision?
- What should an authorized agent know before helping?

The answers live in the vault as durable, evidence-backed analysis, so both you
and any agent you authorize start from the same understanding instead of
re-deriving it from raw activity every time.

## How it stays trustworthy

- **Deterministic writes.** The agent returns one structured JSON payload;
  plain JS writes the files. The model never edits the vault directly, so
  re-runs are idempotent and your hand-written notes are never clobbered.
- **Evidence receipts.** Every surfaced signal carries a stable topic and at
  least one source receipt. Conclusions cite where they came from.
- **Observe and advise, never act.** Kizuki proposes; you approve. It does not
  send messages, mutate source systems, or take outward action.
- **Local-first vault.** Everything runs on your machine. Work data stays in a
  gitignored vault and never leaves unless you explicitly push it somewhere.
- **Append-only ledgers.** Signals, insights, captures, and catches are recorded
  as append-only JSONL. New evidence supersedes old claims without erasing
  history.

## How it works

```
parseArgs -> buildPrompt -> runAgent -> parsePayload -> applyPayload -> signal ledger + vault
```

Your AI agent does the reading, fetching, and analysis, and returns a single
fenced JSON payload. Deterministic JS then writes the files. The model never
edits files directly, so re-runs are idempotent and your hand-written notes
(anything outside the `<!-- KIZUKI:ANALYSIS:START/END -->` markers) are never
touched.

The signal ledger (`signals/events.jsonl`) is the source of truth. The agent
proposes signal candidates with a stable semantic topic and source receipts;
deterministic JS assigns the signal ID, appends events, and decides whether a
candidate should surface. Kizuki also writes surfaced candidates to
`alerts/YYYY-MM-DD.md` as a compatibility view for the dashboard and
notifications. A run with no candidates prints `no signals` and stores nothing.

`kizuki check "<draft>"` uses the same vault as its source of truth but never
writes. It passes your draft to the agent, parses the result, and prints only
the contradictions it can cite against what the vault already knows.

## Choosing your AI agent

Kizuki spawns whatever agent CLI you configure, or talks to any
OpenAI-compatible chat-completions API directly with no CLI and no MCP at all. A
CLI agent must take a prompt, run non-interactively with your MCP servers/tools,
and print its final message (containing the fenced ```json block) to stdout.

The easiest setup is `kizuki init --agent <preset>`, which writes
`kizuki.config.json` for you:

```bash
kizuki init --agent codex      # OpenAI Codex (default)
kizuki init --agent claude     # Claude Code
kizuki init --agent gemini     # Gemini CLI
kizuki init --agent opencode   # opencode
kizuki init --agent http       # any OpenAI-compatible HTTP API (see below)
```

Or set the command by hand in `kizuki.config.json`:

```jsonc
{ "agentCmd": ["claude", "-p"] }      // Claude Code
{ "agentCmd": ["codex", "exec"] }     // OpenAI Codex (the default)
{ "agentCmd": ["gemini", "-p"] }      // Gemini CLI
{ "agentCmd": ["opencode", "run"] }   // opencode
```

The prompt is appended as the final argument. If any array element is the token
`{prompt}`, it is substituted in place instead (e.g.
`["myagent", "--input", "{prompt}"]`). With no config file, Kizuki defaults to
`codex exec`. The config file is gitignored because it is machine-specific.

### Any OpenAI-compatible API (no CLI, no MCP)

Point Kizuki straight at any OpenAI-compatible `/chat/completions` endpoint
instead of spawning a CLI:

```json
{
  "agentHttp": {
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-5.4",
    "apiKeyEnv": "OPENAI_API_KEY"
  }
}
```

`apiKeyEnv` names an environment variable Kizuki reads the key from at call time.
The key itself never goes in the config file or in logs. Set exactly one of
`agentCmd` or `agentHttp`, never both.

An HTTP agent has no MCP servers, so it can't pull Slack/GitHub/Atlassian/Outlook
itself:

- `kizuki sync --source transcript` is the only sync source it supports. Kizuki
  inlines pending `transcripts/*` files into the prompt (capped at 200,000
  characters combined; archive old transcripts or switch to a CLI agent if you
  hit the cap). Requesting any other source fails loudly before the agent runs.
- `kizuki check` and the `kizuki stop` day summary work fully regardless of agent
  kind, because both build a self-contained prompt from the vault and never need
  MCP.

Valid sync sources: `slack`, `github`, `atlassian` (Jira/Confluence/Rovo),
`outlook`, and `transcript`.

## Connect any MCP client

Instead of (or alongside) the CLI, expose the vault to any MCP client as tools.
The client does the pulling and analysis with its own connectors, then calls
these tools to read and safely persist:

- `list_entities` — people/projects/teams with one-line status
- `read_entity` — full file for one entity
- `list_followups` — every open follow-up and recommended action across the vault
- `search` — substring search across the vault and active insights
- `upsert_analysis` — the safe writer: creates the file, dedupes the log, and
  rewrites ONLY the managed analysis section (hand-notes are never touched)
- `capture_context` — record one distilled capture through the local daemon
- `capture_insight` — validate and save one distilled thought
- `list_insights` — list active, archived, or all captured insights
- `read_insight` — read one insight and its event history
- `archive_insight` — archive one active insight

`upsert_analysis` reuses the same deterministic write path as the CLI, so the
model still never edits files directly. Re-runs stay idempotent and notes stay
safe.

The headline `npx -y kizuki mcp` command boots this server over stdio. If you
are running from a checkout instead, point the client at `mcp/server.mjs`:

```json
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

`KIZUKI_VAULT` defaults to the repo root if unset. Any client that reads
a standard `mcpServers` map (Cursor, Windsurf, LM Studio, and others) takes the
same JSON shape.

## Local capture and the daemon

Everything Kizuki does runs on your machine. Alongside the CLI, Kizuki can run a
small background service — the daemon — that exposes an authenticated,
loopback-only HTTP API so the CLI, the MCP server, and the web dashboard can all
record captures through one shared, private endpoint. It never listens on a
public interface and never sends anything off the machine.

```
kizuki capture ─┐
MCP capture_context ─┼─► daemon (127.0.0.1, bearer-token auth) ─► events/events.jsonl
web /capture ─┘
```

`kizuki init` creates the `events/` store and writes a daemon config to
`state/daemon.json` (a random 32-byte token, host, and port) but does not start
the service. Install it explicitly:

```bash
kizuki daemon install     # launchd (macOS) or systemd --user (Linux); starts on login
kizuki daemon status      # "running at ..." or "not running (...)"
kizuki daemon restart     # reload after config changes
kizuki daemon uninstall   # stop and remove the service
```

`daemon install` requires macOS or Linux. `kizuki doctor` adds a `daemon-config`
check (config present and valid) and a `daemon-health` check (the service is
listening); run `kizuki daemon install` if `daemon-health` reports the daemon is
not running.

The daemon binds to `127.0.0.1` on port `4247` by default. Both values come from
`state/daemon.json`; edit that file and `kizuki daemon restart` to change them.
The host is pinned to loopback, so the API is never exposed to the network.
Every request needs an `Authorization: Bearer <token>` header. The token lives
only in `state/daemon.json`, written with `0600` permissions and gitignored;
Kizuki never prints it. If it leaks, delete `state/daemon.json`, re-run
`kizuki init`, and `kizuki daemon restart` to mint a new one.

A capture is one distilled note, correction, decision, hypothesis, or question.
Three ways in, all through the same daemon:

- **CLI:** `kizuki capture "<text>" [--kind note|correction|decision|hypothesis|question]
  [--person <name> | --project <name> | --team <name>]`
- **MCP:** call `capture_context` from any connected client (say "Kizuki this"
  in a chat). Kizuki records only the distilled thought, never the full
  conversation or raw tool output.
- **Web:** open `/capture` on the dashboard and submit the form.

Captures are private to you on this machine, stored in `events/events.jsonl`.

## Capture ideas from a chat

Connect the Kizuki MCP server, then say "Kizuki this" or ask the chat to save an
insight. The agent distills the useful thought and calls `capture_insight`;
Kizuki does not read the session itself.

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
for later, `hypothesis` still needs evidence, and `question` is unresolved.
Captured insights are searchable immediately and inform `sync` and `check`.
Hypotheses and questions stay explicitly unverified and cannot create a signal
without an external source receipt. An exact retry returns the same insight
without a new event; changed wording, kind, scope, or origin creates a new one.
Archive is terminal.

## Vault layout

```
people/<name>.md      # frontmatter: role, team, manager | log + analysis
projects/<name>.md    # frontmatter: status, stakeholders | log + analysis
teams/<name>.md       # frontmatter: members | rollup
transcripts/          # meeting transcripts land here; consumed ones move to processed/
signals/events.jsonl  # canonical append-only signal history (gitignored)
insights/events.jsonl # explicit, append-only chat insight inbox (gitignored)
events/events.jsonl   # canonical append-only capture history via the daemon (gitignored)
alerts/               # daily compatibility view for dashboard and notifications
days/                 # generated day summaries (gitignored)
state/                # lock, shift, sync-failure, and daemon config (gitignored)
```

Open the vault in your editor (Obsidian, VS Code) or browse it with the local
dashboard below.

### Signal lifecycle

Signals start `open`. Use `act` after you take the recommended action, `dismiss`
when a signal is wrong or unhelpful, and `resolve` when the issue no longer needs
attention. Acted signals stay active; dismissed and resolved signals stay
terminal until a sync finds a new receipt or higher severity. Dismiss reasons are
`false-positive`, `stale`, `duplicate`, `not-actionable`, and `low-value`. Notes
are optional on every manual transition.

```bash
kizuki signals                       # list open and acted signals
kizuki signals --status all --json   # every lifecycle state as JSON
kizuki signal show <id>              # reduced state plus event history
kizuki signal act <id>               # mark an open signal acted on
kizuki signal dismiss <id> --reason stale
kizuki signal resolve <id>
kizuki signals migrate-alerts --dry-run   # preview importing legacy alert history
```

Migration reads `alerts/YYYY-MM-DD.md` without changing those files, and re-runs
add no duplicate events.

## Install the rituals as agent skills

```bash
kizuki skills export                    # installs home copies for every agent that has one
kizuki skills export --agent codex      # just one agent (claude|codex|cursor|gemini|generic|all)
kizuki skills export --dist             # regenerate dist/skills/* for every target
kizuki skills export --check            # verify dist/skills/* matches the committed rituals
```

Claude Code skills land in `~/.claude/skills/<name>/SKILL.md`, Codex prompts in
`~/.codex/prompts/<name>.md`, and Gemini CLI commands in
`~/.gemini/commands/<name>.toml`. Cursor and the plain-markdown `generic` target
are dist-only: copy `dist/skills/cursor/<name>.mdc` into a project's
`.cursor/rules/`, or `dist/skills/generic/<name>.md` for any agent that just
reads markdown. The rituals invoke the `kizuki` binary, so it must be on your
PATH.

## Web dashboard

Read-only localhost dashboard for browsing the vault: alerts, shift status and
copy queue, entities, follow-ups, day summaries, search. It never writes vault
files and never sends anything.

```bash
cd web && npm install    # once
npm run dev              # http://localhost:3000
KIZUKI_DEMO=1 npm run dev # synthetic demo vault; no private data
```

It reads the vault fresh on every page load. Vault dir comes from `KIZUKI_VAULT`
(defaults to the repo root). `KIZUKI_DEMO=1` switches to `web/demo-vault/`, which
shows the pre-send contradiction story without using real work data.

## Requirements

- Node >= 20
- One of: an AI agent CLI that runs a prompt non-interactively and prints its
  final message to stdout, with MCP servers configured for
  slack/github/atlassian/outlook (Codex, Claude Code, Gemini CLI, opencode); or
  an OpenAI-compatible HTTP endpoint (transcript-only sync). Set it in
  `kizuki.config.json`; defaults to `codex exec`.
- Meeting transcripts written into `transcripts/` for transcript-based sync.

`kizuki doctor` verifies config, the agent binary, vault dirs, and daemon health,
and runs an optional agent smoke test (`--no-smoke` to skip; `--check-only` for a
read-only report).

## Editions

Every edition shares one engine and differs through hosting, operations,
permissions, and governance.

| Edition | Offer | Price direction |
|---|---|---|
| Free OSS | Complete local product, one operator, BYO agent/model, Packs, portable export | Free |
| Concierge beta | Dedicated instance, onboarding, 3–5 sources, configured Founder or Consultant Pack, weekly review, direct support | $49–99/mo |
| Hosted Pro | Managed sync, reasoning, connectors, backups, remote web + MCP, model allowance, premium Packs | $29/mo or $290/yr |
| Team | Shared workspace, private+shared evidence, roles, team briefs, agent and Pack grants | $25–40 per active user/mo with minimum |
| Enterprise | Dedicated or customer-controlled deployment, governance, SSO/SCIM, audit, residency | Custom annual |

Free OSS is this repository. Concierge beta is the first paid tier; join the
founding cohort at [kizuki.dev](https://kizuki.dev). Hosted Pro and Team are on
the waitlist there, and Enterprise is a direct conversation.

## Demo

Browse a live, read-only dashboard on synthetic data (no real work data):
[demo.kizuki.dev](https://demo.kizuki.dev). To run the same demo locally, use
`KIZUKI_DEMO=1 npm run dev` from `web/`.

## Development

```bash
npm test        # node --test; the core is import-clean, the package ships the MCP SDK + zod
```

The vault entity files and runtime data under `people/`, `projects/`, `teams/`,
`transcripts/`, `alerts/`, `signals/`, `insights/`, `events/`, `days/`, and
`state/` hold internal work information and are gitignored. `state/daemon.json`
also holds the daemon's bearer token (written `0600`). Pushing the repository
never includes that data unless someone force-adds it, so don't.

## License

[Apache-2.0](LICENSE).
