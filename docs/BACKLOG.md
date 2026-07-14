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

## Open work (needs doing)

Concrete pending items with a home. Move to Shipped when done.

- **Platform foundation, tasks 6–10** (plan:
  `docs/superpowers/plans/2026-07-14-kizuki-platform-foundation.md`; tasks 1–6
  committed through `3a77c5b`):
  - ~~T6 CLI API client + capture/daemon commands~~ — **done** (`3a77c5b`,
    444/444 tests green, pushed to origin/main)
  - T7 MCP capture adapter
  - T8 writable web evidence canvas
  - T9 init/doctor wiring + usage documentation
  - T10 end-to-end local proof (completion gate)
- **v1→v2 gate evidence (measuring phase)** — daily `./kizuki start`/`stop` at
  work, record true catches with `kizuki catch`, Friday `kizuki gate` report.
  Direction locked 2026-07-14: validate catches before building more.
- **Branding founder tasks** — hanko mark, etymology/name-story page
  (`docs/BRAND.md`).

## Unranked ideas

One line per idea. Promote into `docs/ROADMAP.md` when ready to sequence.

- Vercel eve as hosted runtime for v4 (durable sessions, Slack channels, OAuth
  connections map onto shift-assistant 1:1) — full multi-user runtime blocked on
  data-safety story; local-first stays for the personal/work version.
  **Public synthetic-data demo shipped** (`web/demo-vault/` + `KIZUKI_DEMO`).
- Distribute rituals as an open Agent Skills pack — **shipped**
  (`kizuki skills export`, committed `dist/skills/`).
- ~~LLM-written day summary~~ — **shipped** (`lib/shift.mjs`: prose on top of the deterministic aggregate at `stop`).
- **Presence layer (Jarvis)** — ideation captured in `docs/2026-07-07-jarvis-presence-ideation.md`; A-path north star in `docs/vision.md`. First buildable slice = `kizuki check` (spec: `docs/superpowers/specs/2026-07-07-kizuki-check-design.md`), which doubles as v1→v2 wedge validation. Rest gated on real-use evidence.
- ~~Slack DM mirror for alerts~~ — **dropped 2026-07** (no work Slack admin);
  revisit only if IT grants an app.
- TEE/confidential-compute story from vision doc (enterprise moat).
- Windows/Linux support (launchd → schtasks/systemd seam exists in lib/launchd.mjs).
