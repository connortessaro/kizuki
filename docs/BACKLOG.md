# Backlog

Ideation parking lot. **Ranked milestones (v2–v4)** live in
[`docs/ROADMAP.md`](ROADMAP.md) — do not duplicate them here.

North star: `docs/vision.md`. Monetization / TEE / team product:
`docs/future-notes.md`.

## Shipped (removed from active backlog)

- Vault write-lock — `lib/lock.mjs`; concurrent sync + MCP upsert safe
- Read-only web dashboard (v3) — Next.js `web/`: entities, follow-ups, days,
  search, `/alerts`, `/shift` copy queue, brand restyle
- v2 alerts, v4 init/landing/skills installer — see `docs/ROADMAP.md`
- CLI `--project` / `--team`, `kizuki watch`, cross-shift trends (`lib/trends.mjs`)

## Unranked ideas

One line per idea. Promote into `docs/ROADMAP.md` when ready to sequence.

- Vercel eve as hosted runtime for v4 (durable sessions, Slack channels, OAuth
  connections map onto shift-assistant 1:1) — blocked on data-safety story;
  local-first stays for the personal/work version.
- Distribute rituals as an open Agent Skills pack (`npx skills add tessaro/kizuki`)
  — partial: `scripts/install-codex-prompts.mjs` for Codex; broader pack TBD.
- LLM-written day summary (deterministic aggregate is v1; prose summary later).
- Slack DM mirror for alerts (work IT permitting).
- TEE/confidential-compute story from vision doc (enterprise moat).
- Windows/Linux support (launchd → schtasks/systemd seam exists in lib/launchd.mjs).
