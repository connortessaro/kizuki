# Kizuki shift assistant — design (v0 + v1)

Date: 2026-07-04
Status: approved scope — v0 + v1 only. Everything else lives in `docs/BACKLOG.md`
and is gated on the milestone above it.

## One-liner (the vision anchor)

**Kizuki watches your org while you work, surfaces what you're missing, and
drafts your next move — you approve everything.**

## Decisions made in brainstorming

- **Name:** OrgMind → **Kizuki** (renamed repo-wide 2026-07-04, commit `df217f5`).
- **Action model:** propose → Connor approves → the *host agent* (Codex at work)
  executes via its own MCP tools. Kizuki's code never sends anything; the
  observe-only invariant holds at the code layer.
- **Interaction:** pull first (ask Codex, it reads the vault via MCP); proactive
  alerts and a localhost dashboard are backlog items gated on v0/v1 evidence.
- **Host:** Codex CLI on the work machine; agent backend stays pluggable
  (`kizuki.config.json` `agentCmd`).

## v0 — prove the pipeline on real data (mostly done)

Ran first-ever end-to-end sync 2026-07-04 on this laptop (Claude backend, since
the laptop's codex install is broken — pluggable agent config proved itself):

- Planted a fake standup transcript containing a cross-team misalignment
  (feature cut; another team's OKR still assumes it ships).
- Result: pipeline green end-to-end; analysis **caught the planted conflict**,
  flagged the unassigned "tell mobile before Wednesday" follow-up, produced a
  copy-paste-ready escalation draft. Transcript archived to
  `transcripts/processed/`.
- Observed weakness: run-to-run LLM variance (one dry-run invented a
  `projects/kizuki` entity from repo context; entity sets differ slightly
  between runs).
- Observed weakness #2 (re-run test): same facts re-emitted with source
  relabeled `slack` instead of `transcript` — invented attribution defeats
  exact-line dedup, leaving semantic duplicates in the log.

Remaining v0 work:

1. **Agent timeout** — `makeRunAgent` gets a configurable timeout
   (`timeoutMs` in `kizuki.config.json`, default 300000); on expiry, kill the
   child and reject loudly.
2. **Evidence guard in prompt** — payload rules: only emit entities directly
   evidenced in transcripts or the named sources, never from the vault repo
   itself; `source` must be the channel an item actually came from (transcript
   files are always `"transcript"` — never relabel).
3. **Real-data gate at work:** one week of real transcripts through `./sync`.
   Gate to v2+ (alerts, dashboard): analysis surfaces ≥1 true thing per week
   Connor would have missed.

## v1 — shift rituals

`sync` executable becomes `kizuki` with subcommands (`kizuki sync` keeps today's
semantics; `kizuki serve` reserved for backlog):

- **`kizuki start`** — writes `state/shift.json` (gitignored); runs first sync;
  installs launchd job `com.tessaro.kizuki.sync` (every 30 min, runs
  `kizuki sync --loop`, which exits silently unless the shift flag is on);
  prints a morning brief rendered deterministically from the vault: open
  follow-ups (reuses `listFollowups` logic), entities changed since last shift.
- **`kizuki stop`** — final sync; writes `days/YYYY-MM-DD.md` (deterministic
  aggregate: day's log entries, follow-ups, changed entities); removes the
  launchd job; clears the shift flag.
- **Codex integration:** `codex/prompts/kizuki-start.md` + `kizuki-stop.md`
  (copied to `~/.codex/prompts` on the work machine) plus trigger lines in the
  work AGENTS.md so "start kizuki" / "kizuki ima stop" work in plain chat: run
  the command, read the brief/summary, discuss.

Note: the 30-minute background sync ships in v1 as plumbing (launchd + `--loop`
flag) because `start`/`stop` own its lifecycle; the *alerts* it will one day
raise are v2/backlog. Until then background syncs just keep the vault fresh for
pull-style questions.

## Components touched

- `lib/agent.mjs` — timeout in `makeRunAgent`; `timeoutMs` config key.
- `lib/prompt.mjs` — evidence-guard rule line.
- `kizuki` executable (renamed from `sync`) — subcommand dispatch; `start`/
  `stop`/`sync`; brief + day-summary renderers as pure functions in
  `lib/shift.mjs` (vault-dir-parameterized, unit-testable, same pattern as
  `mcp/tools.mjs`).
- `lib/launchd.mjs` — plist template write/load/unload via `launchctl`;
  no-ops with a loud error on non-darwin.
- `state/`, `days/` — new gitignored vault dirs.

## Error handling

- Agent timeout kills child, rejects with named error; `sync` exits 1.
- `--loop` mode: failures append one line to `state/sync.log`; never silent.
- `launchctl` failures surface with the command output; `stop` always clears
  the shift flag even if unload fails (and says so).

## Testing

- node:test as today, zero new deps in core. `lib/shift.mjs` pure renderers
  tested with fixture vaults; `--loop` flag-off short-circuit tested; timeout
  tested with a stub child (fake `agentCmd` like `["sleep","10"]` + small
  `timeoutMs`).
- launchd wiring gets a `--dry-run`-style seam (print plist + commands) so
  tests never touch real launchctl.

## Out of scope (see docs/BACKLOG.md)

Alerts + notifications, dashboard, LLM day-summary, approve-queue, website /
public listing, multi-user, TEE/confidential mode.
