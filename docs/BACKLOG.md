# Backlog

Ideation parking lot. **Ranked milestones (v2–v4)** live in
[`docs/ROADMAP.md`](ROADMAP.md) — do not duplicate them here.

North star: `docs/vision.md`. Monetization / TEE / team product:
`docs/future-notes.md`.

## Shipped (removed from active backlog)

- Vault write-lock — `lib/lock.mjs`; concurrent sync + MCP upsert safe
- Read-only web dashboard (partial v3) — Next.js subpackage `web/`; entity
  browser, follow-ups, day summaries, search, auto-refresh, last-updated

## Unranked ideas

One line per idea. Promote into `docs/ROADMAP.md` when ready to sequence.

- Vercel eve as hosted runtime for v4 (durable sessions, Slack channels, OAuth
  connections map onto shift-assistant 1:1) — blocked on data-safety story;
  local-first stays for the personal/work version.
- Distribute rituals as an open Agent Skills pack (`npx skills add tessaro/kizuki`)
  — works across Claude Code/Codex/Cursor etc.; cheap once v1 exists.
- LLM-written day summary (deterministic aggregate is v1; prose summary later).
- Slack DM mirror for alerts (work IT permitting).
- Scope flag for projects/teams in CLI (`--project checkout-v2`), not just person.
- Transcript watcher: auto-sync when a new file lands in `transcripts/`.
- Cross-shift trends ("payments-sandbox creds blocked 3 days running").
- TEE/confidential-compute story from vision doc (enterprise moat).
- Windows/Linux support (launchd → schtasks/systemd seam exists in lib/launchd.mjs).
