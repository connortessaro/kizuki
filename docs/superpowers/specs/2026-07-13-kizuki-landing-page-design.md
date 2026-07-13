# Kizuki — kizuki.dev landing page (Next.js)

**Date:** 2026-07-13
**Status:** design approved, pre-implementation

## Goal

Replace the single-card static landing (`web/public/landing.html`) with a full
marketing page served as a Next.js route in the existing `web/` subpackage.
One Vercel project keeps hosting both domains: `kizuki.dev` shows the landing,
`demo.kizuki.dev` keeps the synthetic-data dashboard.

Positioning: lead with the agent-memory story (PRODUCT.md). The alignment
wedge becomes a proof section below the fold.

## Structure

### Route groups

Route groups do not change URLs; this split gives the landing its own chrome.

- `web/app/layout.tsx` slims to: `globals.css` import, font preconnects,
  `<html>`/`<body>`, base metadata. No nav, no AutoRefresh, no demo banner.
- `web/app/(dashboard)/layout.tsx` (new) takes the nav, `AutoRefresh`, and the
  `KIZUKI_DEMO` banner from the old root layout. Every existing page and its
  helpers move into `(dashboard)/`: `page.tsx`, `[section]/`, `alerts/`,
  `days/`, `entity/`, `followups/`, `search/`, `shift/`, `error.tsx`,
  `not-found.tsx`, `auto-refresh.tsx`, `copy-button.tsx`. Import paths update
  mechanically; dashboard URLs stay identical.
- `web/app/(landing)/landing/page.tsx` (new) is the marketing page: a server
  component with static content only. It must not import `web/lib/data.mjs` or
  read the vault; the landing renders identically with or without a vault and
  with `KIZUKI_DEMO` set.
- Landing metadata (in the landing page): title
  `Kizuki — shared memory for your AI agents`, description from the hero
  one-liner, OG title/description (no custom OG image in v1).

### Routing

`web/proxy.ts`: for host `kizuki.dev` / `www.kizuki.dev`, rewrite every path to
`/landing` (same catch-all behavior as today's `landing.html` rewrite). All
other hosts fall through to the dashboard. The malformed-URI guard stays.

### Deletions

- `web/public/landing.html` (superseded by the route)
- `site/index.html` and `site/` (stale earlier landing; plan step greps for
  references before removal)

## Page content

Brand system per `docs/BRAND.md`: washi `--paper`, sumi `--ink`, andon amber
`--kizuki`/`--kizuki-deep`, hairline `--rule`, Shippori Mincho display, Zen
Kaku Gothic New body, mono eyebrows. Calm single-column document scroll, thin
section rules, generous margins. The em dash stays only in brand strings
("Kizuki — the noticing"); body copy avoids it.

Copy below is the approved draft (stop-slop pass applied). Implementation may
tighten spacing/markup but ships this text unless the operator edits it.

### 1. Hero

- 気づき kanji display (as today), `Kizuki — the noticing`
- One-liner: **Your agents share one memory.**
- Sub: "Kizuki holds the facts, decisions, and open questions your AI agents
  need, so the next session starts where the last one stopped. Nothing goes
  out without you."
- CTAs: `GitHub` (repo), `Live demo` (https://demo.kizuki.dev)

### 2. Problem

Eyebrow: `THE GAP`

"Each chat starts blank. The decision you made with one agent never reaches
the next. A third drafts a message that contradicts both. More agents move
work faster and pull it further apart. The context that would stop the drift
exists. It lives in the chat you closed yesterday."

### 3. The loop

Eyebrow: `HOW IT WORKS` — five document steps, thin rules between:

1. **Capture** — "Say 'Kizuki this' in any connected chat. The agent distills
   one decision, learning, hypothesis, or question."
2. **Validate** — "Deterministic code checks identity, provenance, and
   lifecycle before anything touches disk. The model never writes files."
3. **Remember** — "A git-tracked vault of people, projects, and teams.
   Append-only ledgers for signals and insights."
4. **Retrieve** — "Any connected agent searches and reads the same state over
   MCP instead of asking you to repeat it."
5. **Advise** — "Kizuki surfaces contradictions, stale follow-ups, and
   evidence gaps, each with a draft ready. It sends nothing."

### 4. What it catches

Eyebrow: `THE NOTICING` — the andon motif: a short stack of muted lines with
one amber-highlighted line, then one sentence.

Muted lines (examples, synthetic):
- "Sandbox credentials blocked ops since Tuesday."
- "Perf sits at 520ms against a 400ms budget."

Amber line:
- "Mobile cut guest checkout in standup. Web is still building against it."

Sentence: "Kizuki reads your meetings, threads, and tickets, then lights the
one line you would have missed."

A placeholder note (HTML comment, not rendered) reserves this section for real
anonymized catch stories once the gate wave produces them.

### 5. Boundaries

Eyebrow: `WHAT IT REFUSES` — four short rules:

- "It never sends. Every outward action is a draft you approve."
- "It never scores people. It aligns work."
- "It runs on your machine. The vault is a git repo you own."
- "Deterministic code owns every durable write."

### 6. Install

Eyebrow: `RUN IT` — code block copied verbatim from the README's real install
steps at implementation time (no invented `npm i -g`; the package is not
published). Mention: open source, MCP server included, works with Codex,
Claude Code, and Cursor.

### 7. Footer

Momonga mascot spot (secondary placement per BRAND.md), links: GitHub, live
demo, `Kizuki 気づき` seal line.

## Styling

Landing styles live in `globals.css` under a `.landing` scope (the page wraps
content in `<div className="landing">`), reusing the existing tokens. No new
dependencies, no client components on the landing page.

## Testing / verification

- Root `npm test` stays green (web `data.mjs` tests unaffected).
- Landing page renders with no vault present (guards the static-only rule).
- Visual verify via playwright/browsermcp against `npm run dev` in `web/`:
  `/landing` directly, plus host-based rewrite via
  `curl -H "Host: kizuki.dev" http://localhost:3000/` returning the landing
  markup and default host returning the dashboard.
- Dashboard smoke: `/`, `/alerts`, `/shift` still render after the route-group
  move.
- `frontend-design` skill guides the implementation pass.

## Non-goals

- No custom OG image, no analytics, no blog/docs pages (docs page is a later
  slice), no dashboard feature changes beyond the layout move, no writes.
