# Kizuki — public Vercel demo (synthetic vault)

**Date:** 2026-07-07
**Status:** design approved, pre-implementation
**Backlog origin:** `docs/BACKLOG.md` — "Vercel eve as hosted runtime for v4 …
blocked on data-safety story." Scope reduced to a **public demo on synthetic
data**, which removes the data-safety blocker entirely.

## Goal

Deploy the existing read-only Next.js dashboard (`web/`) to Vercel, backed by a
committed synthetic vault, so anyone can see the product without any real work
data leaving the operator's machine.

## Safety guardrail (why this is unblocked)

Real vault dirs — `people/ projects/ teams/ transcripts/ days/ alerts/ state/` —
are all gitignored. Vercel builds from the git checkout, so these are physically
absent from every deploy. Exposing real work data through this demo is
impossible by construction. The deploy carries only the committed `demo-vault/`.

## Components

### `web/demo-vault/` (new, committed — NOT gitignored)

Hand-authored synthetic fixture, obviously fake (Acme-style names). Enough to
populate every dashboard view:

- `people/` — ~5 people (varied `**Status:**`, follow-ups, recommended actions,
  at least one with a fenced draft for the copy queue).
- `projects/` — 3 projects (one `at risk`).
- `teams/` — 1 team.
- `days/YYYY-MM-DD.md` — one day summary including a prose `## Summary` section.
- `alerts/YYYY-MM-DD.md` — a handful of alerts spanning severities, one with a
  draft.

Entity files follow the exact on-disk contract (frontmatter `type`/`name`, `## Log`
lines, `KIZUKI:ANALYSIS` markers) so existing `lib/query.mjs` helpers parse them.

### `web/lib/data.mjs`

`vaultDir()` precedence becomes:

1. `process.env.KIZUKI_VAULT` (explicit override — unchanged, highest priority)
2. if `process.env.KIZUKI_DEMO` → bundled `../demo-vault` (relative to this file)
3. else repo root (current default)

Local `./kizuki` use sets neither env var → behavior unchanged.

### `web/next.config.mjs`

Add `outputFileTracingIncludes` for `demo-vault/**` so the fixture files ship
inside the serverless function bundle (dynamic `fs` reads are not auto-traced).

### `web/app/layout.tsx`

When `process.env.KIZUKI_DEMO` is set, render a thin banner above `<nav>`:
"Demo — synthetic data, read-only." No banner when unset (local use).

### Vercel

Set `KIZUKI_DEMO=1` in the project env; deploy; capture the URL.

## Testing (`web/lib/data.test.mjs`)

- With `KIZUKI_DEMO` set (and `KIZUKI_VAULT` unset), `vaultDir()` resolves to the
  `web/demo-vault` path; restore env after.
- `KIZUKI_VAULT` still wins when both are set.
- The committed `demo-vault` parses through the data helpers: `listByType`,
  `followups`, and `alertsForDate`/`listDays` return non-empty results.

## Non-goals

- No hosted real vault, no multi-user runtime, no auth/OAuth/Slack (the full
  "eve" vision stays post-v4, gated on the data-safety story in
  `docs/future-notes.md`).
- No writes (dashboard stays read-only — observe-and-advise holds).
- No new npm dependencies.
