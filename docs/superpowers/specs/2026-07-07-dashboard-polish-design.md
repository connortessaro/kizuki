# Dashboard polish (read-only) — design

Date: 2026-07-07
Status: approved

## What

Two read-only dashboard improvements: pages auto-refresh every 60 seconds,
and the home page shows when the vault last changed, in month-day-year
format. The approve-copy queue idea is explicitly excluded — it is a write
and would violate the observe-and-advise rule; separate decision later.

## Decisions

- **Auto-refresh via `router.refresh()`,** not `<meta http-equiv="refresh">`:
  re-runs the server components in place (pages are `force-dynamic`, so every
  refresh re-reads the vault) without a full page reload — no scroll loss, no
  form-state loss in the search box. One tiny client component; everything
  else stays server-rendered.
- **"Last vault update" = newest entity-file mtime.** Truthful "when did the
  vault last change" signal that works without shift state; formatted with the
  existing `formatDateTime` (month-day-year, local time). Empty vault shows
  nothing.

## Architecture

- **`web/app/auto-refresh.tsx`** — `"use client"` component: `useEffect` +
  `setInterval(() => router.refresh(), seconds * 1000)` with cleanup; renders
  `null`. Mounted once in `web/app/layout.tsx` with `seconds={60}` so every
  page refreshes.
- **`web/lib/data.mjs`** — new `lastUpdated(dir) -> Promise<Date | null>`:
  max `mtimeMs` across `eachEntity(dir)` paths (reuses `lib/query.mjs`),
  `null` for an empty vault. Re-exports `formatDateTime` from
  `lib/format.mjs` (same pattern as the existing `formatDate` re-export).
- **`web/app/page.tsx`** — under the heading, muted line:
  `Last vault update: July 7, 2026, 3:31 AM` when `lastUpdated` is non-null.

## Testing

- `web/lib/data.test.mjs`: `lastUpdated` returns `null` on an empty vault;
  returns a `Date` at/after a just-written entity's time; picks the newest of
  two files. Re-export smoke assertion for `formatDateTime`.
- Client component + layout verified by `npm run build` (typecheck); no
  page-level test framework in v1 (unchanged policy).

## Non-goals

- No writes of any kind (approve-copy queue explicitly deferred — needs an
  observe-and-advise decision first). No configurable interval. No
  websocket/live updates.
