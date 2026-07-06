# Kizuki Web Dashboard (read-only v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A localhost Next.js dashboard (`web/` subpackage) for browsing the Kizuki vault read-only: entities, follow-ups, day summaries, search.

**Architecture:** `web/` is a dependency-isolated subpackage (like `mcp/`); core `lib/` stays zero-dep. All vault reads flow through one plain-`.mjs` adapter (`web/lib/data.mjs`) that reuses `lib/query.mjs` / `lib/vault.mjs`, so it is testable with `node --test` and the root suite picks it up automatically. Pages are thin App Router server components with `dynamic = "force-dynamic"` (every page load reads the vault fresh). No API routes, no client fetching, no writes.

**Tech Stack:** Next.js (App Router, TypeScript strict), React, react-markdown. Adapter + tests in plain ESM `.mjs` with `node:test`.

**Spec:** `docs/superpowers/specs/2026-07-06-kizuki-web-dashboard-design.md`

## Global Constraints

- Core `lib/` stays **zero runtime dependencies**; npm packages live only in `web/package.json` (same isolation as `mcp/`).
- Read-only: no route may write vault files or spawn processes.
- Vault dir from `KIZUKI_VAULT` env, defaulting to repo root (same convention as `mcp/server.mjs`).
- Entity names/types from URLs are validated (`assertName`/`assertType` guards) before touching the filesystem.
- No silent failures: `null` returns are reserved for "not found" (→ `notFound()`); every other error propagates.
- TDD; keep `npm test` (root, `node --test`) green at every commit.
- No comments unless non-obvious.
- Node >= 20 (repo floor).

---

### Task 1: Lift `assertName`/`assertType`/`statusOf` into `lib/query.mjs`

`mcp/tools.mjs` defines these privately; `web/` needs the same guards and status parsing. Move them to `lib/query.mjs` so both subpackages share one copy.

**Files:**
- Modify: `lib/query.mjs`
- Modify: `lib/query.test.mjs`
- Modify: `mcp/tools.mjs`

**Interfaces:**
- Consumes: existing `TYPES`, `managedSection` in `lib/query.mjs`.
- Produces: `assertType(type): void` (throws on non-member of `TYPES`), `assertName(name): void` (throws on falsy/non-string or `/`, `\`, `..`), `statusOf(content: string): string` (Status line from managed section, `""` if absent) — all exported from `lib/query.mjs`. Task 3 imports all three.

- [ ] **Step 1: Write failing tests**

Append to `lib/query.test.mjs` (match its existing import/test style):

```js
test("assertType accepts valid types and rejects others", () => {
  for (const t of ["person", "project", "team"]) assert.doesNotThrow(() => assertType(t));
  assert.throws(() => assertType("company"), /invalid type/);
  assert.throws(() => assertType(undefined), /invalid type/);
});

test("assertName rejects path-unsafe and empty names", () => {
  assert.doesNotThrow(() => assertName("bob-smith"));
  assert.throws(() => assertName("a/b"), /invalid entity name/);
  assert.throws(() => assertName("a\\b"), /invalid entity name/);
  assert.throws(() => assertName(".."), /invalid entity name/);
  assert.throws(() => assertName(""), /name is required/);
  assert.throws(() => assertName(null), /name is required/);
});

test("statusOf extracts Status line from managed section", () => {
  const content = [
    "# x", "",
    "<!-- KIZUKI:ANALYSIS:START -->",
    "**Status:** on track",
    "<!-- KIZUKI:ANALYSIS:END -->", "",
  ].join("\n");
  assert.equal(statusOf(content), "on track");
  assert.equal(statusOf("# x\n"), "");
});
```

Add `assertType, assertName, statusOf` to the file's import from `./query.mjs`.

- [ ] **Step 2: Run to verify failure**

Run: `node --test lib/query.test.mjs`
Expected: FAIL — `assertType` etc. not exported.

- [ ] **Step 3: Implement in `lib/query.mjs`**

Add (verbatim moves from `mcp/tools.mjs:9-24`):

```js
export const assertType = (type) => {
  if (!TYPES.includes(type)) throw new Error(`invalid type: ${JSON.stringify(type)} (expected person|project|team)`);
};

export const assertName = (name) => {
  if (!name || typeof name !== "string") throw new Error("name is required");
  if (/[/\\]|\.\./.test(name)) throw new Error(`invalid entity name: ${JSON.stringify(name)}`);
};

export function statusOf(content) {
  const m = managedSection(content).match(/^\*\*Status:\*\* (.*)$/m);
  return m ? m[1].trim() : "";
}
```

In `mcp/tools.mjs`: delete its local `assertType`, `assertName`, `statusOf` definitions and extend the existing `lib/query.mjs` import to:

```js
import { TYPES, managedSection, eachEntity, bulletsUnder, followupsByEntity, assertType, assertName, statusOf } from "../lib/query.mjs";
```

(`managedSection` stays imported only if still used elsewhere in the file — after the move it no longer is; drop it if unused.)

- [ ] **Step 4: Run full suite**

Run: `npm test`
Expected: PASS (all tests, including `mcp/tools.test.mjs`, green).

- [ ] **Step 5: Commit**

```bash
git add lib/query.mjs lib/query.test.mjs mcp/tools.mjs
git commit -m "refactor: lift assertName/assertType/statusOf into lib/query"
```

---

### Task 2: Scaffold `web/` Next.js subpackage

Manual scaffold (no create-next-app) so contents are exactly specified. Deliverable: `npm run build` succeeds and `/` renders a placeholder.

**Files:**
- Create: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `web/next.config.mjs`
- Create: `web/app/layout.tsx`
- Create: `web/app/globals.css`
- Create: `web/app/page.tsx` (placeholder, replaced in Task 4)
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: a building Next app; nav layout with links `/`, `/people`, `/projects`, `/teams`, `/followups`, `/days` and a search form posting GET to `/search`. Tasks 4–6 add pages under `web/app/`.

- [ ] **Step 1: Write `web/package.json`**

```json
{
  "name": "kizuki-web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "next": "^16.1.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "react-markdown": "^10.1.0"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.6.0"
  }
}
```

(If `next@^16.1.0` does not resolve, fall back to the latest stable major: `npm view next version`, pin caret to that major, and note it in the commit message.)

- [ ] **Step 2: Write `web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", "lib/**/*.mjs", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`allowJs` is required: pages import the `.mjs` adapter and TS infers its types from source.

- [ ] **Step 3: Write `web/next.config.mjs`**

The adapter imports `../../lib/query.mjs` — outside `web/`. Point the workspace root at the repo so webpack/turbopack allow it:

```js
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export default {
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
};
```

- [ ] **Step 4: Write layout, globals.css, placeholder page**

`web/app/layout.tsx`:

```tsx
import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = { title: "Kizuki" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav>
          <Link href="/" className="brand">Kizuki</Link>
          <Link href="/people">People</Link>
          <Link href="/projects">Projects</Link>
          <Link href="/teams">Teams</Link>
          <Link href="/followups">Follow-ups</Link>
          <Link href="/days">Days</Link>
          <form action="/search">
            <input name="q" placeholder="Search vault…" />
          </form>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
```

`web/app/globals.css`:

```css
* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  color: #1a1a1a;
  background: #fafafa;
  line-height: 1.55;
}

nav {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.6rem 1.2rem;
  background: #fff;
  border-bottom: 1px solid #e2e2e2;
}

nav a { color: #444; text-decoration: none; }
nav a:hover { color: #000; }
nav .brand { font-weight: 700; color: #000; }
nav form { margin-left: auto; }

nav input {
  padding: 0.35rem 0.6rem;
  border: 1px solid #ccc;
  border-radius: 6px;
  font-size: 0.9rem;
}

main { max-width: 52rem; margin: 0 auto; padding: 1.5rem 1.2rem 4rem; }

h1 { font-size: 1.4rem; }
h2 { font-size: 1.1rem; margin-top: 2rem; }

table { border-collapse: collapse; margin: 0.5rem 0; }
th, td { border: 1px solid #e2e2e2; padding: 0.3rem 0.7rem; text-align: left; }
th { background: #f2f2f2; font-weight: 600; }

ul { padding-left: 1.3rem; }
li { margin: 0.15rem 0; }

pre {
  background: #f2f2f2;
  border: 1px solid #e2e2e2;
  border-radius: 6px;
  padding: 0.7rem;
  overflow-x: auto;
  font-size: 0.85rem;
}

code { background: #f2f2f2; padding: 0.1rem 0.3rem; border-radius: 4px; font-size: 0.9em; }
pre code { background: none; padding: 0; }

.muted { color: #777; }
.empty { color: #777; font-style: italic; margin: 1rem 0; }
.cards { display: flex; gap: 1rem; flex-wrap: wrap; }

.card {
  background: #fff;
  border: 1px solid #e2e2e2;
  border-radius: 8px;
  padding: 0.8rem 1.2rem;
  min-width: 8rem;
}

.card .count { font-size: 1.6rem; font-weight: 700; display: block; }
```

`web/app/page.tsx` (placeholder):

```tsx
export default function Home() {
  return <h1>Kizuki dashboard</h1>;
}
```

- [ ] **Step 5: Add build artifacts to `.gitignore`**

Append to root `.gitignore`:

```
# Next.js build output (web/)
web/.next/
web/next-env.d.ts
```

(`node_modules/` is already ignored at any depth.)

- [ ] **Step 6: Install and verify build**

Run: `cd web && npm install && npm run build`
Expected: build completes, `/` listed as a route. Then `npm test` at repo root still green (node --test must not pick up anything under `web/node_modules`; it doesn't by default).

- [ ] **Step 7: Commit**

```bash
git add web/package.json web/package-lock.json web/tsconfig.json web/next.config.mjs web/app .gitignore
git commit -m "feat(web): scaffold Next.js dashboard subpackage"
```

---

### Task 3: Vault data adapter `web/lib/data.mjs`

All vault access for the app, in plain ESM reusing `lib/`. Tested with `node:test` against a temp-dir fixture vault; the root suite discovers the test file automatically.

**Files:**
- Create: `web/lib/data.mjs`
- Test: `web/lib/data.test.mjs`

**Interfaces:**
- Consumes: `TYPES`, `eachEntity`, `followupsByEntity`, `assertType`, `assertName`, `statusOf` from `lib/query.mjs` (Task 1); `entityPath` from `lib/vault.mjs`.
- Produces (imported by Tasks 4–6):
  - `TYPES: string[]` (re-export)
  - `vaultDir(): string` — `KIZUKI_VAULT` or repo root
  - `parseEntityFile(content: string): { frontmatter: [string, string][], body: string }`
  - `listByType(dir): Promise<Record<"person"|"project"|"team", {name: string, status: string}[]>>` (sorted by name)
  - `getEntity(dir, type, name): Promise<{type, name, frontmatter, body} | null>` (null = not found; throws on invalid type/name)
  - `followups(dir): Promise<{type, name, followUps: string[], actions: string[]}[]>`
  - `searchVault(dir, query): Promise<{type, name, line: number, text: string}[]>`
  - `listDays(dir): Promise<string[]>` (dates, newest first)
  - `readDay(dir, date): Promise<string | null>` (null = not found; throws on non-`YYYY-MM-DD` date)

- [ ] **Step 1: Write failing tests `web/lib/data.test.mjs`**

```js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseEntityFile, listByType, getEntity, followups, searchVault, listDays, readDay,
} from "./data.mjs";

async function makeVault() {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-web-"));
  await mkdir(join(dir, "people"), { recursive: true });
  await mkdir(join(dir, "projects"), { recursive: true });
  await mkdir(join(dir, "days"), { recursive: true });
  await writeFile(
    join(dir, "people", "bob-smith.md"),
    [
      "---", "type: person", "name: bob-smith", 'role: "eng"', 'team: "checkout"', 'manager: ""', "---",
      "", "# bob-smith", "", "## Log", "",
      "- **slack** 2026-07-04T10:00:00Z: shipped checkout fix", "",
      "<!-- KIZUKI:ANALYSIS:START -->",
      "**Status:** on track",
      "",
      "**Follow-ups:**",
      "- ask about sandbox creds",
      "<!-- KIZUKI:ANALYSIS:END -->", "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(join(dir, "days", "2026-07-04.md"), "# 2026-07-04 — day summary\n", "utf8");
  return dir;
}

test("parseEntityFile splits frontmatter pairs and body", () => {
  const { frontmatter, body } = parseEntityFile("---\ntype: person\nrole: \"eng\"\n---\n\n# bob\n");
  assert.deepEqual(frontmatter, [["type", "person"], ["role", '"eng"']]);
  assert.equal(body, "\n# bob\n");
});

test("parseEntityFile without frontmatter returns whole content as body", () => {
  const { frontmatter, body } = parseEntityFile("# bob\n");
  assert.deepEqual(frontmatter, []);
  assert.equal(body, "# bob\n");
});

test("listByType groups entities with status", async () => {
  const dir = await makeVault();
  try {
    const byType = await listByType(dir);
    assert.deepEqual(byType.person, [{ name: "bob-smith", status: "on track" }]);
    assert.deepEqual(byType.project, []);
    assert.deepEqual(byType.team, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("getEntity returns parsed entity, null when missing, throws on unsafe name", async () => {
  const dir = await makeVault();
  try {
    const e = await getEntity(dir, "person", "bob-smith");
    assert.equal(e.name, "bob-smith");
    assert.ok(e.frontmatter.some(([k, v]) => k === "role" && v === '"eng"'));
    assert.match(e.body, /## Log/);
    assert.equal(await getEntity(dir, "person", "nobody"), null);
    await assert.rejects(() => getEntity(dir, "person", "../etc"), /invalid entity name/);
    await assert.rejects(() => getEntity(dir, "company", "bob-smith"), /invalid type/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("followups returns structured groups", async () => {
  const dir = await makeVault();
  try {
    const groups = await followups(dir);
    assert.deepEqual(groups, [
      { type: "person", name: "bob-smith", followUps: ["ask about sandbox creds"], actions: [] },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("searchVault returns structured case-insensitive hits", async () => {
  const dir = await makeVault();
  try {
    const hits = await searchVault(dir, "CHECKOUT FIX");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].type, "person");
    assert.equal(hits[0].name, "bob-smith");
    assert.ok(hits[0].line > 0);
    assert.match(hits[0].text, /checkout fix/);
    assert.deepEqual(await searchVault(dir, "zzz-no-match"), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("listDays newest first; empty when days/ missing", async () => {
  const dir = await makeVault();
  try {
    await writeFile(join(dir, "days", "2026-07-05.md"), "# later\n", "utf8");
    await writeFile(join(dir, "days", "notes.md"), "not a day\n", "utf8");
    assert.deepEqual(await listDays(dir), ["2026-07-05", "2026-07-04"]);
    const empty = await mkdtemp(join(tmpdir(), "kizuki-empty-"));
    try {
      assert.deepEqual(await listDays(empty), []);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readDay returns content, null when missing, throws on bad date", async () => {
  const dir = await makeVault();
  try {
    assert.match(await readDay(dir, "2026-07-04"), /day summary/);
    assert.equal(await readDay(dir, "2026-01-01"), null);
    await assert.rejects(() => readDay(dir, "../secrets"), /invalid date/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test web/lib/data.test.mjs`
Expected: FAIL — `data.mjs` does not exist.

- [ ] **Step 3: Implement `web/lib/data.mjs`**

```js
import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { entityPath } from "../../lib/vault.mjs";
import {
  TYPES, eachEntity, followupsByEntity, assertType, assertName, statusOf,
} from "../../lib/query.mjs";

export { TYPES };

export const vaultDir = () =>
  process.env.KIZUKI_VAULT || join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function parseEntityFile(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return { frontmatter: [], body: content };
  const frontmatter = m[1]
    .split("\n")
    .filter((l) => l.trim())
    .map((line) => {
      const i = line.indexOf(":");
      return i === -1 ? [line.trim(), ""] : [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    });
  return { frontmatter, body: content.slice(m[0].length) };
}

export async function listByType(dir) {
  const out = { person: [], project: [], team: [] };
  for (const e of await eachEntity(dir)) out[e.type].push({ name: e.name, status: statusOf(e.content) });
  for (const type of TYPES) out[type].sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export async function getEntity(dir, type, name) {
  assertType(type);
  assertName(name);
  let content;
  try {
    content = await readFile(entityPath(dir, type, name), "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
  const { frontmatter, body } = parseEntityFile(content);
  return { type, name, frontmatter, body };
}

export const followups = (dir) => followupsByEntity(dir);

export async function searchVault(dir, query) {
  const needle = query.toLowerCase();
  const hits = [];
  for (const e of await eachEntity(dir)) {
    e.content.split("\n").forEach((text, i) => {
      if (text.toLowerCase().includes(needle)) {
        hits.push({ type: e.type, name: e.name, line: i + 1, text: text.trim() });
      }
    });
  }
  return hits;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function listDays(dir) {
  let files;
  try {
    files = await readdir(join(dir, "days"));
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  return files
    .filter((f) => f.endsWith(".md") && DATE_RE.test(f.slice(0, -3)))
    .map((f) => f.slice(0, -3))
    .sort()
    .reverse();
}

export async function readDay(dir, date) {
  if (!DATE_RE.test(date)) throw new Error(`invalid date: ${JSON.stringify(date)}`);
  try {
    return await readFile(join(dir, "days", `${date}.md`), "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `node --test web/lib/data.test.mjs` then `npm test` at root.
Expected: both PASS (root suite now includes the new file).

- [ ] **Step 5: Commit**

```bash
git add web/lib/data.mjs web/lib/data.test.mjs
git commit -m "feat(web): vault data adapter reusing lib/query"
```

---

### Task 4: Home page + error/not-found pages

**Files:**
- Modify: `web/app/page.tsx` (replace placeholder)
- Create: `web/app/error.tsx`
- Create: `web/app/not-found.tsx`

**Interfaces:**
- Consumes: `vaultDir`, `listByType`, `followups`, `listDays` from `web/lib/data.mjs` (Task 3).
- Produces: `/` dashboard. Link conventions used across all pages: entity detail = `/entity/{type}/{name}` (singular type), day = `/days/{date}`.

- [ ] **Step 1: Write `web/app/page.tsx`**

```tsx
import Link from "next/link";
import { vaultDir, listByType, followups, listDays } from "../lib/data.mjs";

export const dynamic = "force-dynamic";

export default async function Home() {
  const dir = vaultDir();
  const [byType, groups, days] = await Promise.all([listByType(dir), followups(dir), listDays(dir)]);
  const preview = groups.slice(0, 5);
  return (
    <>
      <h1>Dashboard</h1>
      <div className="cards">
        <Link className="card" href="/people"><span className="count">{byType.person.length}</span>people</Link>
        <Link className="card" href="/projects"><span className="count">{byType.project.length}</span>projects</Link>
        <Link className="card" href="/teams"><span className="count">{byType.team.length}</span>teams</Link>
      </div>

      <h2>Latest day summary</h2>
      {days.length ? (
        <p><Link href={`/days/${days[0]}`}>{days[0]}</Link></p>
      ) : (
        <p className="empty">No day summaries yet.</p>
      )}

      <h2>Open follow-ups {groups.length ? <Link className="muted" href="/followups">(all)</Link> : null}</h2>
      {preview.length ? (
        <ul>
          {preview.map((g) =>
            [...g.followUps.map((f) => ({ kind: "follow-up", text: f })), ...g.actions.map((a) => ({ kind: "action", text: a }))].map((item, i) => (
              <li key={`${g.type}/${g.name}/${i}`}>
                <Link href={`/entity/${g.type}/${g.name}`}>{g.type}/{g.name}</Link>
                {" "}<span className="muted">[{item.kind}]</span> {item.text}
              </li>
            )),
          )}
        </ul>
      ) : (
        <p className="empty">No open follow-ups.</p>
      )}
    </>
  );
}
```

- [ ] **Step 2: Write error + not-found pages**

`web/app/error.tsx`:

```tsx
"use client";

export default function Error({ error }: { error: Error }) {
  return (
    <>
      <h1>Something broke</h1>
      <pre>{error.message}</pre>
    </>
  );
}
```

`web/app/not-found.tsx`:

```tsx
import Link from "next/link";

export default function NotFound() {
  return (
    <>
      <h1>Not found</h1>
      <p><Link href="/">Back to dashboard</Link></p>
    </>
  );
}
```

- [ ] **Step 3: Verify**

Run: `cd web && npm run typecheck && npm run build`
Expected: both succeed. Then `npm run dev`, open `http://localhost:3000/` — counts render (zeros/empty states on an empty vault are correct).

- [ ] **Step 4: Commit**

```bash
git add web/app/page.tsx web/app/error.tsx web/app/not-found.tsx
git commit -m "feat(web): dashboard home, error and not-found pages"
```

---

### Task 5: Entity list pages + entity detail page

**Files:**
- Create: `web/app/[section]/page.tsx` (serves `/people`, `/projects`, `/teams`)
- Create: `web/app/entity/[type]/[name]/page.tsx`

**Interfaces:**
- Consumes: `vaultDir`, `listByType`, `getEntity`, `TYPES` from `web/lib/data.mjs`; link conventions from Task 4.
- Produces: `/people|projects|teams` lists; `/entity/{type}/{name}` detail. Static routes (`/followups`, `/days`, `/search`) win over `[section]` in Next routing, so no conflicts.

- [ ] **Step 1: Write `web/app/[section]/page.tsx`**

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { vaultDir, listByType } from "../../lib/data.mjs";

export const dynamic = "force-dynamic";

const TYPE_BY_SECTION: Record<string, "person" | "project" | "team"> = {
  people: "person",
  projects: "project",
  teams: "team",
};

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const type = TYPE_BY_SECTION[section];
  if (!type) notFound();
  const entities = (await listByType(vaultDir()))[type];
  return (
    <>
      <h1>{section}</h1>
      {entities.length ? (
        <ul>
          {entities.map((e) => (
            <li key={e.name}>
              <Link href={`/entity/${type}/${encodeURIComponent(e.name)}`}>{e.name}</Link>
              {e.status ? <span className="muted"> — {e.status}</span> : <span className="muted"> — (no status)</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">No {section} yet.</p>
      )}
    </>
  );
}
```

- [ ] **Step 2: Write `web/app/entity/[type]/[name]/page.tsx`**

```tsx
import Markdown from "react-markdown";
import { notFound } from "next/navigation";
import { vaultDir, getEntity, TYPES } from "../../../../lib/data.mjs";

export const dynamic = "force-dynamic";

export default async function EntityPage({ params }: { params: Promise<{ type: string; name: string }> }) {
  const { type, name: rawName } = await params;
  const name = decodeURIComponent(rawName);
  if (!TYPES.includes(type) || !name || /[/\\]|\.\./.test(name)) notFound();
  const entity = await getEntity(vaultDir(), type, name);
  if (!entity) notFound();
  return (
    <>
      <h1>{entity.type}/{entity.name}</h1>
      {entity.frontmatter.length ? (
        <table>
          <tbody>
            {entity.frontmatter.map(([k, v]) => (
              <tr key={k}><th>{k}</th><td>{v}</td></tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <Markdown>{entity.body}</Markdown>
    </>
  );
}
```

(URL guard mirrors `assertName` so a hostile URL yields 404, not a 500; `getEntity` still enforces the same guard underneath.)

- [ ] **Step 3: Verify**

Run: `cd web && npm run typecheck && npm run build`
Expected: succeed. With `npm run dev`: `/people` lists entities (or empty state); clicking one renders frontmatter table + markdown body with the analysis section; `/people/../..` style URLs and `/entity/person/none` return 404.

- [ ] **Step 4: Commit**

```bash
git add "web/app/[section]" web/app/entity
git commit -m "feat(web): entity list and detail pages"
```

---

### Task 6: Follow-ups, days, and search pages

**Files:**
- Create: `web/app/followups/page.tsx`
- Create: `web/app/days/page.tsx`
- Create: `web/app/days/[date]/page.tsx`
- Create: `web/app/search/page.tsx`

**Interfaces:**
- Consumes: `vaultDir`, `followups`, `listDays`, `readDay`, `searchVault` from `web/lib/data.mjs`; link conventions from Task 4.
- Produces: `/followups`, `/days`, `/days/{date}`, `/search?q=`.

- [ ] **Step 1: Write `web/app/followups/page.tsx`**

```tsx
import Link from "next/link";
import { vaultDir, followups } from "../../lib/data.mjs";

export const dynamic = "force-dynamic";

export default async function FollowupsPage() {
  const groups = await followups(vaultDir());
  return (
    <>
      <h1>Open follow-ups</h1>
      {groups.length ? (
        groups.map((g) => (
          <section key={`${g.type}/${g.name}`}>
            <h2><Link href={`/entity/${g.type}/${encodeURIComponent(g.name)}`}>{g.type}/{g.name}</Link></h2>
            <ul>
              {g.followUps.map((f, i) => <li key={`f${i}`}><span className="muted">[follow-up]</span> {f}</li>)}
              {g.actions.map((a, i) => <li key={`a${i}`}><span className="muted">[action]</span> {a}</li>)}
            </ul>
          </section>
        ))
      ) : (
        <p className="empty">No open follow-ups or actions.</p>
      )}
    </>
  );
}
```

- [ ] **Step 2: Write days pages**

`web/app/days/page.tsx`:

```tsx
import Link from "next/link";
import { vaultDir, listDays } from "../../lib/data.mjs";

export const dynamic = "force-dynamic";

export default async function DaysPage() {
  const days = await listDays(vaultDir());
  return (
    <>
      <h1>Day summaries</h1>
      {days.length ? (
        <ul>
          {days.map((d) => <li key={d}><Link href={`/days/${d}`}>{d}</Link></li>)}
        </ul>
      ) : (
        <p className="empty">No day summaries yet.</p>
      )}
    </>
  );
}
```

`web/app/days/[date]/page.tsx`:

```tsx
import Markdown from "react-markdown";
import { notFound } from "next/navigation";
import { vaultDir, readDay } from "../../../lib/data.mjs";

export const dynamic = "force-dynamic";

export default async function DayPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();
  const content = await readDay(vaultDir(), date);
  if (content === null) notFound();
  return <Markdown>{content}</Markdown>;
}
```

- [ ] **Step 3: Write `web/app/search/page.tsx`**

```tsx
import Link from "next/link";
import { vaultDir, searchVault } from "../../lib/data.mjs";

export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const hits = query ? await searchVault(vaultDir(), query) : [];
  return (
    <>
      <h1>Search{query ? `: ${query}` : ""}</h1>
      {!query ? (
        <p className="empty">Type a query in the search box.</p>
      ) : hits.length ? (
        <ul>
          {hits.map((h, i) => (
            <li key={i}>
              <Link href={`/entity/${h.type}/${encodeURIComponent(h.name)}`}>{h.type}/{h.name}</Link>
              <span className="muted">:{h.line}</span> {h.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">No matches for “{query}”.</p>
      )}
    </>
  );
}
```

- [ ] **Step 4: Verify**

Run: `cd web && npm run typecheck && npm run build`
Expected: succeed. With `npm run dev`: `/followups` groups render; `/days` lists and `/days/<date>` renders markdown; `/days/evil` 404s; `/search?q=x` returns hits linking to entities; empty query shows hint.

- [ ] **Step 5: Commit**

```bash
git add web/app/followups web/app/days web/app/search
git commit -m "feat(web): followups, day summaries, and search pages"
```

---

### Task 7: Real-vault verification + docs

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: everything above.
- Produces: documented, verified feature on main-ready branch.

- [ ] **Step 1: Verify against the real vault**

From repo root (main checkout, where vault data lives):

```bash
cd web && npm run build && npm run start &
sleep 3
curl -s http://localhost:3000/ | grep -o "<h1>[^<]*</h1>"
curl -s http://localhost:3000/people | head -c 400
curl -s http://localhost:3000/followups | head -c 400
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/entity/person/does-not-exist"   # expect 404
kill %1
```

Expected: 200s with real content on the first three; 404 on the last. If executing in a worktree (empty vault), verify empty states render and defer the real-data check to the main checkout, noting it in the report.

- [ ] **Step 2: Update `README.md`**

In the README, replace the line
`Open the vault in your editor (Obsidian, VS Code). There is no separate UI.`
with
`Open the vault in your editor (Obsidian, VS Code) — or use the local dashboard below.`
and add a new section after "Use as an MCP server":

```markdown
## Web dashboard

Read-only localhost dashboard for browsing the vault: entities, follow-ups,
day summaries, search. It never writes vault files and never sends anything —
same rules as everywhere else in Kizuki.

    cd web && npm install    # once
    npm run dev              # http://localhost:3000

Reads the vault fresh on every page load. Vault dir comes from `KIZUKI_VAULT`
(defaults to the repo root).
```

Also update the Development section's test count ("64 tests") to the new total
reported by `npm test`.

- [ ] **Step 3: Update `CLAUDE.md` and `AGENTS.md` (keep in sync)**

Add to CLAUDE.md after the MCP server section, and mirror the same text in AGENTS.md:

```markdown
## Web dashboard (`web/`)

`web/` is a Next.js subpackage (own `package.json` — Next/React/react-markdown
stay out of the zero-dep core, same isolation as `mcp/`). Read-only browser UI
for the vault: entity browser, follow-ups, day summaries, search.

- **`web/lib/data.mjs`** — the only module that touches the vault. Plain `.mjs`
  reusing `lib/query.mjs`/`lib/vault.mjs` (guards included); `node:test`-tested,
  picked up by the root suite.
- Pages are thin server components with `dynamic = "force-dynamic"` (fresh read
  per load). No API routes, no client fetching, **no writes** — adding any
  write/action to the dashboard requires revisiting the observe-and-advise rule.
- Entity/date URL params are validated (`assertName`-equivalent guard + date
  regex) before touching the filesystem.
```

- [ ] **Step 4: Full suite + commit**

```bash
npm test
git add README.md CLAUDE.md AGENTS.md
git commit -m "docs: web dashboard setup and architecture notes"
```

Expected: suite green.
