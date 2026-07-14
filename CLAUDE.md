# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

Kizuki — a personal, single-operator org-intelligence CLI. It pulls the user's
work activity (TalkTrack meeting transcripts + Slack/GitHub/Atlassian/Outlook via
the configured AI agent's MCP servers) into a git-tracked markdown vault sorted by
person/project/team, and rewrites a managed analysis section per file (status,
needs, what they don't know, follow-ups, recommended actions with drafts).

It observes and advises only — it never sends messages or takes actions. Humans
decide. Do not add autonomous action-taking without revisiting this.

Design + plan: `docs/2026-06-30-kizuki-design.md`,
`docs/superpowers/plans/2026-06-30-kizuki-v1.md`.
Roadmap (v2–v4): `docs/ROADMAP.md`. Ideation: `docs/BACKLOG.md`.

## Commands

```bash
npm test                              # node --test full suite
node --test lib/vault.test.mjs        # one test file
./kizuki init                         # create vault dirs + default config
./kizuki init --agent <preset>        # same, preset: codex|claude|gemini|opencode|http
./kizuki sync                         # run the CLI (calls configured agent)
./kizuki sync <person> --source slack # scoped run
./kizuki sync --project <name>        # project scope
./kizuki sync --team <name>           # team scope
./kizuki sync --dry-run               # compute changes, write nothing
./kizuki watch                        # auto-sync on new transcripts
./kizuki start                        # begin shift: sync + brief + 30-min background sync
./kizuki stop                          # end shift: final sync + day summary + remove background sync
./kizuki doctor                        # diagnose setup: config, agent binary, smoke test, vault dirs
./kizuki doctor --no-smoke             # skip the agent smoke test (it boots the real agent + MCP, costs tokens)
./kizuki doctor --check-only           # read-only: report missing vault dirs instead of creating them
./kizuki signals                        # list open and acted signals
./kizuki signals --status all --json    # list all states as JSON
./kizuki signal show <id> [--json]      # show current state and history
./kizuki signal act <id> [--note <text>]
./kizuki signal dismiss <id> --reason <reason> [--note <text>]
./kizuki signal resolve <id> [--note <text>]
./kizuki signals migrate-alerts [--dry-run]
./kizuki insights [--status active|archived|all] [--json]
./kizuki insight show <id> [--json]
./kizuki insight archive <id> [--note <text>]
./kizuki check "<draft>"               # flag where a draft contradicts the vault (read-only, sends nothing)
./kizuki catch "<note>" [--signal <id>] [--insight <id>]   record a true catch (gate evidence)
./kizuki catches [--json]               list recorded catches
./kizuki gate [--weeks n] [--json]      weekly gate-evidence report
./kizuki skills export [--agent claude|codex|cursor|gemini|generic|all] [--check] [--dist]   install ritual skills
```

## Architecture

Data flow: `parseArgs → buildPrompt → runAgent → parsePayload → applyPayload → vault helpers` (+ `notifyAlerts` after apply when not dry-run).

The central design decision: **the AI agent returns one fenced JSON payload;
deterministic JS writes the files.** The LLM never edits files directly. This is
what makes re-runs idempotent and guarantees hand-written notes are never
clobbered. Preserve this boundary — do not move file-writing into the prompt.

The agent is pluggable: `runAgent(prompt) -> Promise<string>` is injected into
`runSync`, so tests never spawn a process. The `kizuki` executable builds the real
`runAgent` from `kizuki.config.json` (see `lib/agent.mjs`). The prompt is
agent-agnostic — it names the sources but not any one agent's MCP config path.

- **`lib/args.mjs`** — `parseArgs(argv)` → `{scope, sources, dryRun}`. `VALID_SOURCES`.
- **`lib/prompt.mjs`** — `buildPrompt({scope,sources,vaultDir})` and `PAYLOAD_SHAPE`
  (the JSON contract embedded in the prompt). This contract is the source of truth
  the parser and renderer must agree with. Kept agent-agnostic (no codex-specific
  config path).
- **`lib/agent.mjs`** — `AGENT_PRESETS` (codex/claude/gemini/opencode CLI
  commands). `resolveAgent(vaultDir)` reads `kizuki.config.json` and returns a
  discriminated result: `{kind: "cmd", cmd, timeoutMs}` (`agentCmd` array;
  defaults to `["codex","exec"]`) or `{kind: "http", http: {baseUrl, model,
  apiKeyEnv}, timeoutMs}` (`agentHttp`) — exactly one of `agentCmd`/`agentHttp`
  may be set, never both. `buildAgentArgv(cmd,prompt)` substitutes a `{prompt}`
  token or appends the prompt; `makeRunAgent(cmd)` returns the real spawner;
  `makeConfiguredRunAgent(resolved)` picks the right runner for either kind.
  Invalid config throws — no silent fallback.
- **`lib/agentHttp.mjs`** — `makeRunAgentHttp({baseUrl, model, apiKeyEnv},
  timeoutMs)` posts one `chat/completions` request to any OpenAI-compatible
  endpoint and returns the message content. Loud errors on missing key
  (`apiKeyEnv`, read at call time, never logged or stored), non-2xx, non-JSON,
  or empty completion content; aborts and throws on timeout.
- **`lib/payload.mjs`:** `parsePayload(stdout)` / `extractJsonBlock`. Payload
  version 3 validates signal topics and source receipts. Versions 1 and 2 stay
  parseable through deterministic compatibility normalization.
- **`lib/vault.mjs`** — pure string/path helpers. `spliceManagedSection` (only
  touches text between the `KIZUKI:ANALYSIS` markers), `appendLog` (exact-line
  dedup so re-runs don't duplicate), `renderAnalysis(entity, now)` (`now` injected
  for deterministic tests).
- **`lib/apply.mjs`:** `applyPayload(vaultDir, payload, {dryRun, now})`. Plans
  signal ingestion before entity writes, updates the daily compatibility view,
  commits the ledger, then archives consumed transcripts.
- **`lib/signals.mjs`:** stable signal identity, event validation and reduction,
  ingestion and transition planning, plus atomic append-only ledger writes to
  `signals/events.jsonl`.
- **`lib/signalCommands.mjs`:** read-only list/show commands, locked lifecycle
  transitions, and manual legacy alert migration.
- **`lib/insights.mjs`:** stable insight identity, event validation/reduction,
  capture/archive planning, and atomic append-only writes to
  `insights/events.jsonl`.
- **`lib/insightCommands.mjs`:** CLI services and formatting for capture state,
  list/show, and locked archive transitions.
- **`lib/insightContext.mjs`:** active-insight scope selection, prompt context,
  and local search.
- **`lib/catches.mjs`** — stable catch identity, event validation/reduction,
  capture planning, atomic append-only writes to `catches/events.jsonl`.
- **`lib/catchCommands.mjs`** — catch capture (cross-ledger link validation,
  locked) and read-only listing.
- **`lib/gate.mjs`** — pure weekly gate-report compute + render (Monday-start
  local weeks, injected `now`).
- **`lib/gateCommands.mjs`** — reads the three ledgers for `kizuki gate` and
  the brief/day-summary gate line.
- **`lib/skills.mjs`** — ritual parsing (`skills/*/ritual.md`) and per-agent
  rendering/export (`dist/skills/`, home installs).
- **`lib/alerts.mjs`:** daily compatibility view with exact-line dedup. The
  dashboard and notification path still read this format.
- **`lib/notify.mjs`** — macOS osascript notifications for warn/critical alerts and
  sync-failure batching (darwin-only; no-op elsewhere).
- **`lib/syncFailures.mjs`** — consecutive `--loop` failure counter in
  `state/sync-failures.json`.
- **`lib/run.mjs`** — `runSync({argv, vaultDir, runAgent, agentKind = "cmd"})`.
  `runAgent` is injected so tests never spawn a process or hit the network.
  When `agentKind` is `"http"`, sync is gated to `--source transcript` only —
  pending `transcripts/*` files are inlined into the prompt (capped at 200,000
  chars) and any other requested source throws before `runAgent` is called.
- **`kizuki`:** executable. Dispatches sync, shift, signal, check, doctor, and
  init commands.
  Resolves the agent from config and spawns it (plain mode, NOT `--json`: plain
  mode prints only the final agent message, which holds the ```json block).
  `start`/`stop` wire in shift state, brief/day-summary rendering (`lib/shift.mjs`),
  and the background launchd job (`lib/launchd.mjs`).

## MCP server (`mcp/`)

`mcp/` is a separate subpackage that exposes the vault to any agent as MCP tools
(`list_entities`, `read_entity`, `list_followups`, `search`, `upsert_analysis`,
`capture_insight`, `list_insights`, `read_insight`, `archive_insight`).
It is the conversational/interactive alternative to the `kizuki` CLI.

- **`mcp/tools.mjs`** — handler logic (pure-ish, `vaultDir`-parameterized, unit
  tested). `upsert_analysis` reuses `lib/apply.mjs` + `lib/vault.mjs`, so the
  managed-section splice / log dedup / path-safety guarantees hold identically to
  the CLI. The LLM never edits files directly here either.
- **`mcp/server.mjs`** — thin `@modelcontextprotocol/sdk` wiring (McpServer +
  StdioServerTransport + zod schemas). Vault dir from `KIZUKI_VAULT`, defaults to
  repo root. Read tools are annotated read-only; `upsert_analysis` is idempotent,
  non-destructive.
- **Dependency isolation:** `mcp/` has its own `package.json` (SDK + zod). The
  root/core `lib/` stays zero-dep. Do not pull the SDK into `lib/`.
- Path safety + type validation live in `mcp/tools.mjs` (`assertName`/`assertType`)
  before anything hits the filesystem — same guard as `parsePayload`.

## Web dashboard (`web/`)

`web/` is a Next.js subpackage (own `package.json` — Next/React/react-markdown
stay out of the zero-dep core, same isolation as `mcp/`). Read-only browser UI
for the vault: entity browser, follow-ups, day summaries, search.

- **`web/lib/data.mjs`** — the only module that touches the vault. Plain `.mjs`
  reusing `lib/query.mjs`/`lib/vault.mjs` (guards included); `node:test`-tested,
  picked up by the root suite.
- Pages are thin server components with `dynamic = "force-dynamic"` (fresh read
  per load). No API routes, no client fetching, **no writes** — adding any
  write/action to the dashboard requires revisiting the observe-and-advise rule.
- Entity/date URL params are validated (`assertName`-equivalent guard + date
  regex) before touching the filesystem.

## Conventions (match these)

- **ESM `.mjs`, Node built-ins only. Zero runtime dependencies.** Do not add npm
  packages. Tests use `node:test` + `node:assert`.
- **TDD.** Every change: failing test first, then implementation. Keep the suite
  green (`npm test`) before claiming done.
- No comments unless non-obvious. Pure functions where possible.
- **No silent failures.** Parser/pipeline throw loudly; the only intentional
  "coerce missing to ""/[]" is the faithful-render contract in vault/render.

## Safety invariants (do not break)

- `spliceManagedSection` must never modify content outside the analysis markers.
- `appendLog` dedup uses **exact full-line** match (not substring) — a new entry
  that is a prefix of an existing line must still be appended.
- Entity names are validated path-safe in `parsePayload` before ever hitting the
  filesystem in `entityPath`/`applyPayload`.
- `signals/events.jsonl` is the canonical signal record. Daily markdown alerts
  are a compatibility view for the dashboard and notifications.
- Payload version 3 signal candidates require a stable lowercase kebab-case
  topic and at least one source receipt. Versions 1 and 2 remain compatibility
  inputs.
- Signal lifecycle mutations hold `state/vault.lock`. Kizuki never acts on a
  signal or sends its draft; the operator records `acted`, `dismissed`, or
  `resolved` explicitly.
- `insights/events.jsonl` is the canonical captured-insight record. Capture is
  explicit: a caller distills one thought and deterministic JS validates and
  writes it. Never scan sessions or store full chats/tool output.
- Insight capture/archive mutations hold `state/vault.lock`. Preserve insight
  kind: hypotheses/questions are unverified and cannot support a signal without
  an external receipt.
- `catches/events.jsonl` is the canonical catch record — append-only,
  mutations hold `state/vault.lock`; a catch is operator-recorded evidence
  about Kizuki's usefulness and never upgrades a signal or insight.

## Data safety

`people/`, `projects/`, `teams/`, `transcripts/`, `alerts/`, `signals/`,
`insights/`, `catches/`, `days/`, and `state/` are gitignored because they hold internal work data. Never
force-add files under those folders or push work data to a remote.

## Skills

- `grill-me` / `grilling` — global skill (not project-specific), installed in
  `~/.claude/skills/`. Interviews the operator one question at a time to
  stress-test a plan/design before acting on it. Invoke on any "grill me"
  trigger phrase.

## Parallel work (Connor + agents simultaneously)

- One git worktree per task: `git worktree add ../kizuki-wt-<topic> -b <topic>`
  (or Claude Code's built-in worktree isolation). Zero-dep core means no install
  step per worktree; `npm test` runs anywhere. Merge to main only with the suite
  green.
- Vault data (`people/`, `projects/`, `teams/`, `transcripts/`, `alerts/`,
  `signals/`, `insights/`, `catches/`, `days/`, `state/`) exists only in the main checkout. Gitignored
  data does not appear in worktrees.
- **Write lock.** `applyPayload` serializes writers through `state/vault.lock`
  (waits up to 30s, then fails naming the holder; stale locks stolen by PID
  liveness). Concurrent `./kizuki sync`, MCP `upsert_analysis`, and insight
  mutations are safe.
- `AGENTS.md` mirrors this file for non-Claude agents (Codex at work). Keep the
  two in sync when either changes.
