# Month-day-year date display — design

Date: 2026-07-07
Status: approved

## What

Kizuki-rendered display dates change from ISO (`2026-07-04`,
`2026-07-04T09:32:00.000Z`) to month-day-year English: `July 4, 2026` and
`July 4, 2026, 9:32 AM`. Display strings only — file names, URLs, log-entry
timestamps, and state JSON stay ISO.

## Decisions

- **Pure string/component formatting, no timezone conversion for dates.**
  `formatDate("2026-07-04")` splits the ISO string and maps the month name —
  parsing via `Date` would shift days across timezones.
- **Local-time components for datetimes.** `formatDateTime(date)` takes a
  `Date` and uses local getters (`getMonth()` etc.), so `_Updated_` shows
  Connor's wall-clock time instead of UTC. Tests construct dates from local
  components (`new Date(2026, 6, 4, 9, 32)`) so they pass in any timezone.
- **What stays ISO:** `days/<date>.md` filenames and `/days/<date>` URL params
  (sortable, regex-validated), `state/*.json` timestamps, raw log-entry
  timestamps from the agent, the day-summary activity filter
  (`l.includes(dateStr)` matches agent ISO timestamps).

## Architecture

- **`lib/format.mjs`** — new zero-dep module:
  - `formatDate(isoDate)` — `"2026-07-04"` → `"July 4, 2026"`. Throws on
    strings not matching `/^\d{4}-\d{2}-\d{2}/` (no silent garbage).
  - `formatDateTime(date)` — `Date` → `"July 4, 2026, 9:32 AM"` (12-hour,
    no leading zero on hour, zero-padded minutes, AM/PM).
- **Display sites changed:**
  - `lib/vault.mjs` `renderAnalysis`: `_Updated ${formatDateTime(now)}_`.
  - `lib/shift.mjs` `renderBrief` header: `# Kizuki brief — July 6, 2026`.
  - `lib/shift.mjs` `renderDaySummary` header:
    `# July 6, 2026 — day summary` (the `dateStr` param and activity filter
    stay ISO).
  - `web/`: days list and home latest-day link **text** becomes
    `formatDate(d)`; hrefs stay ISO. `web/lib/data.mjs` re-exports
    `formatDate` so pages keep importing from the one adapter.
- Day page (`/days/[date]`) and entity page need no change — they render file
  content, whose headers/timestamps are formatted at the source.

## Testing

- `lib/format.test.mjs`: formatDate happy path + invalid input throws;
  formatDateTime morning/afternoon/midnight/noon edges, minute padding.
- Update `lib/shift.test.mjs` header assertions to the new strings.
- `web/lib/data.test.mjs`: one re-export smoke assertion.

## Non-goals

- No locale configurability. No timezone configurability. No change to what
  the agent writes in log entries.
