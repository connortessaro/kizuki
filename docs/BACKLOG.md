# Backlog

Ranked. Each item is gated on the milestone above it — do not start an item
until its gate has evidence. Ideate here freely; one line per idea.

Milestone ladder: works once (v0, done 2026-07-04) → works daily at work (v1)
→ alerts I trust (v2) → dashboard (v3) → public (v4).

## v2 — proactive alerts (gate: one week of real use, ≥1 true catch/week)

- `alerts` array in payload contract (severity/kind enums, path-safe entity,
  evidence, optional draft) — validated in `parsePayload`.
- `lib/alerts.mjs`: append to `alerts/YYYY-MM-DD.md`, exact-line dedup, returns
  only new alerts.
- macOS notification (osascript) for warn/critical, batched per sync;
  "sync failing" notification after 2 consecutive loop failures.
- Prompt: detect cross-team contradiction, blocker, mention-needing-reply,
  slipped deadline — the vision wedge.

## v3 — localhost dashboard (gate: alerts trusted, not muted)

- Zero-dep node http server (`kizuki serve`): alert feed, follow-ups, entity
  browser, day summaries.
- Draft approve/copy queue; "approve" hands off to host-agent chat for sending
  (Kizuki still never sends).
- Shift start/stop button.

## v4 — public (gate: a month of daily use + real catches to tell stories about)

- Landing page: the one-liner + real (anonymized) catch stories.
- Package for others: `npx kizuki init`, setup wizard for agent backend + MCP.
- List it: website, GitHub public, maybe Product Hunt / Show HN.
- Pricing/positioning pass (vision doc: narrow alignment wedge, not horizontal
  org search).

## Unranked ideas (park anything here)

- Vercel eve as hosted runtime for v4 (durable sessions, Slack channels, OAuth
  connections map onto shift-assistant 1:1) — blocked on data-safety story;
  local-first stays for the personal/work version.
- Distribute rituals as an open Agent Skills pack (`npx skills add tessaro/kizuki`)
  — works across Claude Code/Codex/Cursor etc.; cheap once v1 exists.

- LLM-written day summary (deterministic aggregate is v1; prose summary later).
- Slack DM mirror for alerts (work IT permitting).
- Vault write-lock so sync loop + MCP upsert can run concurrently.
- Scope flag for projects/teams in CLI (`--project checkout-v2`), not just person.
- Transcript watcher: auto-sync when a new file lands in `transcripts/`.
- Cross-shift trends ("payments-sandbox creds blocked 3 days running").
- TEE/confidential-compute story from vision doc (enterprise moat).
- Windows/Linux support (launchd → schtasks/systemd seam exists in lib/launchd.mjs).
