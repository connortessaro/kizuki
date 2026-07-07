# Month-day-year date display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kizuki-rendered display dates become month-day-year English (`July 4, 2026` / `July 4, 2026, 9:32 AM`); file names, URLs, and raw timestamps stay ISO.

**Architecture:** New zero-dep `lib/format.mjs` (`formatDate` string-based, `formatDateTime` local-component-based); applied at the three render sites (`renderAnalysis`, `renderBrief`, `renderDaySummary`) and the two dashboard link texts; `web/lib/data.mjs` re-exports `formatDate`.

**Tech Stack:** Node built-ins only (ESM `.mjs`), `node:test` + `node:assert/strict`; Next.js pages in `web/` (display text only).

Spec: `docs/superpowers/specs/2026-07-07-date-format-design.md`

## Global Constraints

- Zero runtime dependencies in `lib/`. ESM `.mjs`, Node built-ins only.
- TDD: failing test first. `npm test` green before every commit claim.
- `formatDate` is a pure string transform — never construct a `Date` from the ISO date string (timezone day-shift). Throws on input not starting `YYYY-MM-DD` or with month outside 01–12 — no silent garbage.
- `formatDateTime` uses LOCAL `Date` getters. 12-hour clock, no leading zero on hour, zero-padded minutes, `AM`/`PM`. Midnight = `12:xx AM`, noon = `12:xx PM`.
- Tests for `formatDateTime` construct dates from local components (`new Date(2026, 6, 4, 9, 32)`) so they pass in any timezone.
- Stays ISO: `days/<date>.md` filenames, `/days/<date>` URL params + hrefs, `state/*.json` timestamps, agent log-entry timestamps, `renderDaySummary`'s `dateStr` param and its `l.includes(dateStr)` activity filter.

---

### Task 1: `lib/format.mjs`

**Files:**
- Create: `lib/format.mjs`
- Create: `lib/format.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `formatDate(isoDate: string) -> string` (`"2026-07-04"` → `"July 4, 2026"`; accepts full ISO timestamps, uses the date prefix) and `formatDateTime(date: Date) -> string` (`"July 4, 2026, 9:32 AM"`). Tasks 2–3 import these.

- [ ] **Step 1: Write the failing tests**

Create `lib/format.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDate, formatDateTime } from "./format.mjs";

test("formatDate renders month-day-year", () => {
  assert.equal(formatDate("2026-07-04"), "July 4, 2026");
  assert.equal(formatDate("2026-12-25"), "December 25, 2026");
  assert.equal(formatDate("2026-01-09"), "January 9, 2026");
});

test("formatDate accepts a full ISO timestamp, uses the date prefix", () => {
  assert.equal(formatDate("2026-07-04T09:32:00.000Z"), "July 4, 2026");
});

test("formatDate throws on non-ISO input", () => {
  assert.throws(() => formatDate("07/04/2026"), /invalid ISO date/);
  assert.throws(() => formatDate(""), /invalid ISO date/);
  assert.throws(() => formatDate("2026-13-01"), /invalid ISO date/);
});

test("formatDateTime renders local components 12-hour", () => {
  assert.equal(formatDateTime(new Date(2026, 6, 4, 9, 32)), "July 4, 2026, 9:32 AM");
  assert.equal(formatDateTime(new Date(2026, 6, 4, 15, 5)), "July 4, 2026, 3:05 PM");
});

test("formatDateTime midnight and noon edges", () => {
  assert.equal(formatDateTime(new Date(2026, 0, 1, 0, 5)), "January 1, 2026, 12:05 AM");
  assert.equal(formatDateTime(new Date(2026, 6, 4, 12, 0)), "July 4, 2026, 12:00 PM");
  assert.equal(formatDateTime(new Date(2026, 6, 4, 23, 59)), "July 4, 2026, 11:59 PM");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test lib/format.test.mjs`
Expected: FAIL — `Cannot find module './format.mjs'`.

- [ ] **Step 3: Create `lib/format.mjs`**

```js
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function formatDate(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate ?? "");
  const month = m && Number(m[2]);
  if (!m || month < 1 || month > 12) throw new Error(`invalid ISO date: ${JSON.stringify(isoDate)}`);
  return `${MONTHS[month - 1]} ${Number(m[3])}, ${m[1]}`;
}

export function formatDateTime(date) {
  const h24 = date.getHours();
  const hour = h24 % 12 || 12;
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const ampm = h24 < 12 ? "AM" : "PM";
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}, ${hour}:${minutes} ${ampm}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test lib/format.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Run full suite and commit**

Run: `npm test`
Expected: all pass.

```bash
git add lib/format.mjs lib/format.test.mjs
git commit -m "feat(format): month-day-year date formatters"
```

---

### Task 2: apply at the lib render sites

**Files:**
- Modify: `lib/vault.mjs:60` (`renderAnalysis` Updated line)
- Modify: `lib/shift.mjs:32,57` (brief + day-summary headers)
- Test: `lib/vault.test.mjs`, `lib/shift.test.mjs`

**Interfaces:**
- Consumes: `formatDate`, `formatDateTime` from `lib/format.mjs` (Task 1).
- Produces: rendered output changes only; no signature changes. `renderDaySummary(vaultDir, dateStr)` keeps its ISO `dateStr` param and ISO activity filter.

- [ ] **Step 1: Write the failing tests**

Append to `lib/vault.test.mjs`:

```js
test("renderAnalysis stamps Updated in month-day-year local time", () => {
  const md = renderAnalysis({ type: "person", name: "b", analysis: {} }, new Date(2026, 6, 4, 9, 32));
  assert.match(md, /_Updated July 4, 2026, 9:32 AM_/);
});
```

In `lib/shift.test.mjs`, update the two header assertions:
- `assert.match(brief, /# Kizuki brief — 2026-07-06/);` → `assert.match(brief, /# Kizuki brief — July 6, 2026/);`
- `assert.match(md, /# 2026-07-06 — day summary/);` → `assert.match(md, /# July 6, 2026 — day summary/);`

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test lib/vault.test.mjs lib/shift.test.mjs`
Expected: FAIL — the new vault assertion and both updated shift assertions mismatch (output still ISO).

- [ ] **Step 3: Apply the formatters**

`lib/vault.mjs`: add `import { formatDateTime } from "./format.mjs";` and change the Updated line in `renderAnalysis`:

```js
const out = [`_Updated ${formatDateTime(now)}_`, ""];
```

`lib/shift.mjs`: add `import { formatDate } from "./format.mjs";` and change the two headers:

```js
const out = [`# Kizuki brief — ${formatDate(now.toISOString().slice(0, 10))}`, "", "## Changed since last shift"];
```

```js
const out = [`# ${formatDate(dateStr)} — day summary`, "", "## Activity"];
```

(Everything else in both functions is untouched — in particular the `l.includes(dateStr)` filter and `writeDaySummary`'s ISO filename.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test lib/vault.test.mjs lib/shift.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run full suite and commit**

Run: `npm test`
Expected: all pass (if any other test asserts the old ISO strings, update it to the new format and note it in your report).

```bash
git add lib/vault.mjs lib/shift.mjs lib/vault.test.mjs lib/shift.test.mjs
git commit -m "feat: month-day-year dates in analysis, brief, day summary"
```

---

### Task 3: dashboard link text

**Files:**
- Modify: `web/lib/data.mjs` (re-export), `web/app/days/page.tsx`, `web/app/page.tsx`
- Test: `web/lib/data.test.mjs`

**Interfaces:**
- Consumes: `formatDate` from `lib/format.mjs` (Task 1).
- Produces: dashboard shows `July 4, 2026` as day link text; hrefs stay `/days/2026-07-04`.

- [ ] **Step 1: Write the failing test**

Append to `web/lib/data.test.mjs` (add `formatDate` to the existing import from `./data.mjs`):

```js
test("re-exports formatDate for pages", () => {
  assert.equal(formatDate("2026-07-04"), "July 4, 2026");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test web/lib/data.test.mjs`
Expected: FAIL — `formatDate` is not exported.

- [ ] **Step 3: Implement**

Append to `web/lib/data.mjs`:

```js
export { formatDate } from "../../lib/format.mjs";
```

`web/app/days/page.tsx`: import becomes `import { vaultDir, listDays, formatDate } from "../../lib/data.mjs";` and the list item becomes:

```tsx
{days.map((d) => <li key={d}><Link href={`/days/${d}`}>{formatDate(d)}</Link></li>)}
```

`web/app/page.tsx`: import becomes `import { vaultDir, listByType, followups, listDays, formatDate } from "../lib/data.mjs";` and the latest-day line becomes:

```tsx
<p><Link href={`/days/${days[0]}`}>{formatDate(days[0])}</Link></p>
```

- [ ] **Step 4: Run tests and build**

Run: `node --test web/lib/data.test.mjs`
Expected: PASS.

Run: `cd web && npm run build`
Expected: build succeeds (typecheck covers the page edits). If `node_modules` is missing in the worktree, run `npm install` in `web/` first.

- [ ] **Step 5: Run full suite and commit**

Run: `npm test` (from repo root)
Expected: all pass.

```bash
git add web/lib/data.mjs web/lib/data.test.mjs web/app/days/page.tsx web/app/page.tsx
git commit -m "feat(web): month-day-year day links"
```
