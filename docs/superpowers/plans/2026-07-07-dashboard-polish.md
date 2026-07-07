# Dashboard polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dashboard auto-refreshes every 60s and home shows "Last vault update" in month-day-year format. Read-only throughout.

**Architecture:** One `"use client"` `AutoRefresh` component (`router.refresh()` on an interval) mounted in the layout; `lastUpdated` vault reader in `web/lib/data.mjs` (newest entity mtime) displayed on home via the existing `formatDateTime`.

**Tech Stack:** Next.js App Router (existing `web/` subpackage), `node:test` for `data.mjs`.

Spec: `docs/superpowers/specs/2026-07-07-dashboard-polish-design.md`

## Global Constraints

- **No writes** — dashboard stays read-only (observe-and-advise rule).
- `web/lib/data.mjs` remains the only module pages import vault helpers from.
- Zero new npm dependencies.
- TDD for `data.mjs`; page/layout/component changes verified by `cd web && npm run build`. Root `npm test` green before every commit claim.

---

### Task 1: `lastUpdated` + home display

**Files:**
- Modify: `web/lib/data.mjs`, `web/app/page.tsx`
- Test: `web/lib/data.test.mjs`

**Interfaces:**
- Consumes: `eachEntity` from `lib/query.mjs` (already imported in data.mjs; entities carry `.path`), `formatDateTime` from `lib/format.mjs`.
- Produces: `lastUpdated(dir) -> Promise<Date | null>`; `formatDateTime` re-exported from `web/lib/data.mjs`.

- [ ] **Step 1: Write the failing tests**

Append to `web/lib/data.test.mjs` (add `lastUpdated, formatDateTime` to the existing `./data.mjs` import; reuse the file's existing temp-vault fixture helper for a vault dir):

```js
test("lastUpdated is null on an empty vault", async () => {
  const dir = await emptyVault();
  assert.equal(await lastUpdated(dir), null);
});

test("lastUpdated returns the newest entity mtime", async () => {
  const dir = await emptyVault();
  const before = Date.now() - 1000;
  await writeFile(join(dir, "people", "bob.md"), "# bob\n", "utf8");
  const updated = await lastUpdated(dir);
  assert.ok(updated instanceof Date);
  assert.ok(updated.getTime() >= before);
});

test("re-exports formatDateTime for pages", () => {
  assert.equal(formatDateTime(new Date(2026, 6, 4, 9, 32)), "July 4, 2026, 9:32 AM");
});
```

(If the test file's fixture helper has a different name than `emptyVault`, use that helper — it must create the standard vault folders including `people/`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test web/lib/data.test.mjs`
Expected: FAIL — `lastUpdated` / `formatDateTime` not exported.

- [ ] **Step 3: Implement**

`web/lib/data.mjs` — extend the `node:fs/promises` import with `stat`, add the re-export next to the existing `formatDate` one, and add:

```js
export { formatDateTime } from "../../lib/format.mjs";

export async function lastUpdated(dir) {
  let latest = 0;
  for (const e of await eachEntity(dir)) {
    const { mtimeMs } = await stat(e.path);
    if (mtimeMs > latest) latest = mtimeMs;
  }
  return latest ? new Date(latest) : null;
}
```

`web/app/page.tsx` — add `lastUpdated, formatDateTime` to the data.mjs import, fetch it in the existing `Promise.all`, and render under the `<h1>`:

```tsx
const [byType, groups, days, updated] = await Promise.all([listByType(dir), followups(dir), listDays(dir), lastUpdated(dir)]);
```

```tsx
<h1>Dashboard</h1>
{updated ? <p className="muted">Last vault update: {formatDateTime(updated)}</p> : null}
```

- [ ] **Step 4: Run tests + build**

Run: `node --test web/lib/data.test.mjs`
Expected: PASS.

Run: `cd web && npm run build`
Expected: build succeeds (run `npm install` in `web/` first if `node_modules` is missing in the worktree).

- [ ] **Step 5: Run full suite and commit**

Run: `npm test` (repo root)
Expected: all pass.

```bash
git add web/lib/data.mjs web/lib/data.test.mjs web/app/page.tsx
git commit -m "feat(web): last-vault-update line on home"
```

---

### Task 2: 60s auto-refresh

**Files:**
- Create: `web/app/auto-refresh.tsx`
- Modify: `web/app/layout.tsx`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `<AutoRefresh seconds={60} />` mounted in the root layout — every page re-runs its server components each minute.

- [ ] **Step 1: Create the client component**

Create `web/app/auto-refresh.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
```

- [ ] **Step 2: Mount it in the layout**

`web/app/layout.tsx` — add `import AutoRefresh from "./auto-refresh";` and render it inside `<body>` before `<nav>`:

```tsx
<body>
  <AutoRefresh seconds={60} />
  <nav>
```

- [ ] **Step 3: Build + manual verify**

Run: `cd web && npm run build`
Expected: build succeeds.

Manual check (dev server against the worktree's empty vault is fine): `cd web && npm run dev` — load `/`, confirm no console errors and the page keeps working; stop the server. (The 60s refresh itself is verified by code review + build; don't wait a minute watching it.)

- [ ] **Step 4: Run full suite and commit**

Run: `npm test` (repo root)
Expected: all pass (no root-suite changes in this task).

```bash
git add web/app/auto-refresh.tsx web/app/layout.tsx
git commit -m "feat(web): 60s auto-refresh"
```
