# Kizuki web dashboard (read-only v1) — design

Date: 2026-07-06
Status: approved

## What

A localhost web GUI for browsing the Kizuki vault: entities, follow-ups, day
summaries, search. Read-only in v1 — no buttons that write or execute anything.

This is the backlog v3 "localhost dashboard" item, built ahead of its gate
(v2 alerts trusted) by explicit decision. Alert feed is excluded because v2
alerts do not exist yet; draft approve/copy queue and shift start/stop controls
are deferred to a later cut.

## Decisions made during brainstorming

- **GUI over TUI.** Bubble Tea (Go) considered; rejected because a web GUI in
  the same language reuses `lib/` + `mcp/tools.mjs` directly — no second write
  path, no Go reimplementation of vault parsing, less work.
- **Next.js over zero-dep `node:http`.** Explicit trade: heavier than the
  backlog sketch, but faster to build and iterate. Contained as a subpackage so
  the core zero-dep rule holds.
- **Read-only first.** Smallest useful cut. Writes/controls come later.

## Architecture

- `web/` subpackage with its own `package.json` (Next.js, React,
  `react-markdown`), same dependency-isolation pattern as `mcp/`. Core `lib/`
  stays zero-dep.
- Next.js App Router, TypeScript strict.
- Vault dir from `KIZUKI_VAULT` env; defaults to repo root (same convention as
  `mcp/server.mjs`).
- Localhost only, single user, no auth, no deploy target. Vault data never
  leaves the machine.

## Data flow

Server components only. No API routes, no client-side fetching.

Pages import read functions from `mcp/tools.mjs` — `listEntities`,
`readEntity`, `listFollowups`, `search` — which are SDK-free,
vaultDir-parameterized, path-safe (`assertName`/`assertType`), and already
unit-tested. One new pure helper reads `days/` (list + read day summaries).

Every route sets `dynamic = "force-dynamic"` so each page load reads the vault
fresh from disk. No caching layer; refresh = browser reload.

Markdown renders via `react-markdown` (web-only dependency).

## Pages

| Route | Content |
|---|---|
| `/` | Counts per entity type, latest day summary, open follow-ups preview |
| `/people`, `/projects`, `/teams` | Entity list with one-line status |
| `/entity/[type]/[name]` | Full entity file rendered: frontmatter table, log, analysis |
| `/followups` | All open follow-ups across the vault |
| `/days`, `/days/[date]` | Day summary list and single summary |
| `/search?q=` | Substring search across the vault |

## Error handling

- Missing folders / empty vault → explicit empty states ("no people yet"), not
  blank pages or crashes.
- File read errors surface as a Next error page — never swallowed.
- Entity names from URLs are validated through the existing `assertName`
  guard before touching the filesystem.

## Testing

- Vault read logic stays in `mcp/tools.mjs` (already covered by its suite).
- New pure helpers in `web/` (days reader, any frontmatter parsing) get
  `node:test` tests.
- Pages are thin render-only wrappers; no page-level test framework in v1.
  Verified by running against the real vault.

## Non-goals (v1)

- No writes of any kind (no sync trigger, no shift start/stop, no approve
  queue).
- No alerts feed (v2 alerts not built).
- No auth, no remote deploy.

## Invariants preserved

- LLM/UI never writes vault files; the deterministic JS write path is untouched
  (and unused by this feature).
- Single-writer rule unaffected — dashboard only reads.
- `people/`, `projects/`, `teams/`, `transcripts/`, `days/` data stays
  gitignored; `web/` ships code only.
