# Kizuki.dev Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-card static landing with a full marketing page served as a Next.js route at kizuki.dev, agent-memory positioning, without touching dashboard behavior.

**Architecture:** Route-group split inside `web/app/` — existing dashboard pages move into `(dashboard)/` with the nav/AutoRefresh/demo-banner chrome; a new `(landing)/landing/page.tsx` static server component carries the marketing page; `web/proxy.ts` host-rewrites kizuki.dev to `/landing`. URLs never change (route groups don't affect paths).

**Tech Stack:** Next.js 16 App Router (existing `web/` subpackage), plain CSS in `globals.css`, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-13-kizuki-landing-page-design.md`.

## Global Constraints

- No new npm packages. Server components only — no client components on the landing page.
- The landing page must not import `web/lib/data.mjs` or read the vault; it renders identically with and without `KIZUKI_DEMO`.
- Ship the spec's copy verbatim (it already had the stop-slop pass). Em dash only in brand strings ("Kizuki — the noticing").
- Brand tokens from `globals.css` `:root` (`--paper`, `--ink`, `--stone`, `--rule`, `--kizuki`, `--kizuki-deep`, `--display`, `--body`, `--mono`). No new colors.
- Dashboard URLs and behavior unchanged; root `npm test` (353 tests) stays green.
- Verification is typecheck + running server + browser (no unit-test surface for TSX pages in this repo).
- One deliberate deviation from the spec's move list: `error.tsx` and `not-found.tsx` stay at `web/app/` root — a root `not-found.tsx` is what catches unmatched top-level URLs in Next; moving it into the group would break global 404s. Record this in the commit body of Task 1.

---

### Task 1: Route-group split — dashboard chrome into `(dashboard)/`

**Files:**
- Create: `web/app/(dashboard)/layout.tsx`
- Modify: `web/app/layout.tsx`
- Move (git mv): `web/app/page.tsx`, `web/app/[section]/`, `web/app/alerts/`, `web/app/days/`, `web/app/entity/`, `web/app/followups/`, `web/app/search/`, `web/app/shift/`, `web/app/auto-refresh.tsx`, `web/app/copy-button.tsx` → all into `web/app/(dashboard)/`
- Keep at root: `web/app/globals.css`, `web/app/error.tsx`, `web/app/not-found.tsx`

**Interfaces:**
- Consumes: existing `AutoRefresh` component, `globals.css`.
- Produces: slim root layout (fonts + body only) that Task 2's landing renders inside; dashboard chrome isolated in the group layout.

- [ ] **Step 1: Move the dashboard files**

```bash
cd web/app && mkdir "(dashboard)"
git mv page.tsx "[section]" alerts days entity followups search shift auto-refresh.tsx copy-button.tsx "(dashboard)/"
```

- [ ] **Step 2: Write the group layout**

Create `web/app/(dashboard)/layout.tsx` (the old root layout's chrome, minus `<html>`/`<head>`):

```tsx
import Link from "next/link";
import type { ReactNode } from "react";
import AutoRefresh from "./auto-refresh";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AutoRefresh seconds={60} />
      {process.env.KIZUKI_DEMO ? (
        <div className="demo-banner">
          Demo — synthetic data, read-only. Kizuki runs locally against your real vault.
        </div>
      ) : null}
      <nav>
        <Link href="/" className="brand">気づき</Link>
        <Link href="/alerts">Alerts</Link>
        <Link href="/shift">Shift</Link>
        <Link href="/people">People</Link>
        <Link href="/projects">Projects</Link>
        <Link href="/teams">Teams</Link>
        <Link href="/followups">Follow-ups</Link>
        <Link href="/days">Days</Link>
        <form action="/search">
          <input name="q" placeholder="Search vault…" aria-label="Search vault" />
        </form>
      </nav>
      <main>{children}</main>
    </>
  );
}
```

- [ ] **Step 3: Slim the root layout**

Replace `web/app/layout.tsx` with:

```tsx
import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "Kizuki" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 4: Verify**

Run: `cd web && npm run typecheck`
Expected: clean exit.

Run: `cd web && KIZUKI_DEMO=1 npm run dev` (background), then:
`curl -s localhost:3000/ | grep -c "気づき"` → ≥ 1 (nav renders)
`curl -s localhost:3000/alerts | grep -ci alerts` → ≥ 1
`curl -s localhost:3000/shift | grep -ci shift` → ≥ 1
`curl -s -o /dev/null -w "%{http_code}" localhost:3000/nonexistent` → 404

Run: `npm test` (repo root)
Expected: 353 pass.

- [ ] **Step 5: Commit**

```bash
git add web/app
git commit -m "refactor(web): isolate dashboard chrome in a route group

error.tsx and not-found.tsx stay at the app root deliberately (spec listed
them in the move set): a root not-found.tsx is required for global 404s."
```

---

### Task 2: Landing route + styles

**Files:**
- Create: `web/app/(landing)/landing/page.tsx`
- Modify: `web/app/globals.css` (append `.landing` block)
- Copy: `brand/seal-ki.svg`, `brand/momonga.svg` → `web/public/`

**Interfaces:**
- Consumes: root layout from Task 1, brand tokens in `globals.css`.
- Produces: `/landing` route that Task 3's proxy rewrite targets.

- [ ] **Step 1: Copy brand assets**

```bash
cp brand/seal-ki.svg brand/momonga.svg web/public/
```

- [ ] **Step 2: Write the landing page**

Create `web/app/(landing)/landing/page.tsx`:

```tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Kizuki — shared memory for your AI agents",
  description:
    "Kizuki holds the facts, decisions, and open questions your AI agents need, so the next session starts where the last one stopped. Nothing goes out without you.",
  openGraph: {
    title: "Kizuki — shared memory for your AI agents",
    description:
      "Your agents share one memory. You keep authority over every outward action.",
    url: "https://kizuki.dev",
    siteName: "Kizuki",
  },
};

const LOOP = [
  ["Capture", "Say 'Kizuki this' in any connected chat. The agent distills one decision, learning, hypothesis, or question."],
  ["Validate", "Deterministic code checks identity, provenance, and lifecycle before anything touches disk. The model never writes files."],
  ["Remember", "A git-tracked vault of people, projects, and teams. Append-only ledgers for signals and insights."],
  ["Retrieve", "Any connected agent searches and reads the same state over MCP instead of asking you to repeat it."],
  ["Advise", "Kizuki surfaces contradictions, stale follow-ups, and evidence gaps, each with a draft ready. It sends nothing."],
];

const REFUSALS = [
  "It never sends. Every outward action is a draft you approve.",
  "It never scores people. It aligns work.",
  "It runs on your machine. The vault is a git repo you own.",
  "Deterministic code owns every durable write.",
];

export default function LandingPage() {
  return (
    <div className="landing">
      <header className="hero">
        <div className="kanji" aria-hidden="true">気づき</div>
        <h1>
          Kizuki<span>the noticing</span>
        </h1>
        <p className="one-liner">Your agents share one memory.</p>
        <p className="sub">
          Kizuki holds the facts, decisions, and open questions your AI agents
          need, so the next session starts where the last one stopped. Nothing
          goes out without you.
        </p>
        <p className="ctas">
          <a href="https://github.com/ctessaro/kizuki">GitHub</a>
          <a href="https://demo.kizuki.dev">Live demo</a>
        </p>
      </header>

      <section>
        <p className="eyebrow">THE GAP</p>
        <p>
          Each chat starts blank. The decision you made with one agent never
          reaches the next. A third drafts a message that contradicts both.
          More agents move work faster and pull it further apart. The context
          that would stop the drift exists. It lives in the chat you closed
          yesterday.
        </p>
      </section>

      <section>
        <p className="eyebrow">HOW IT WORKS</p>
        <ol className="loop">
          {LOOP.map(([name, text]) => (
            <li key={name}>
              <strong>{name}</strong>
              <p>{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <p className="eyebrow">THE NOTICING</p>
        <ul className="andon">
          <li>Sandbox credentials blocked ops since Tuesday.</li>
          <li className="lit">
            Mobile cut guest checkout in standup. Web is still building
            against it.
          </li>
          <li>Perf sits at 520ms against a 400ms budget.</li>
        </ul>
        {/* Reserved: replace synthetic lines with anonymized real catch stories once the gate wave produces them. */}
        <p>
          Kizuki reads your meetings, threads, and tickets, then lights the one
          line you would have missed.
        </p>
      </section>

      <section>
        <p className="eyebrow">WHAT IT REFUSES</p>
        <ul className="refusals">
          {REFUSALS.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </section>

      <section>
        <p className="eyebrow">RUN IT</p>
        <pre>
          <code>{`git clone https://github.com/ctessaro/kizuki
cd kizuki
./kizuki init
./kizuki doctor
./kizuki start`}</code>
        </pre>
        <p>
          Open source. MCP server included. Works with Codex, Claude Code, and
          Cursor.
        </p>
      </section>

      <footer>
        <img src="/momonga.svg" alt="" width="48" height="48" />
        <p>
          Kizuki 気づき — the noticing ·{" "}
          <a href="https://github.com/ctessaro/kizuki">GitHub</a> ·{" "}
          <a href="https://demo.kizuki.dev">Live demo</a>
        </p>
      </footer>
    </div>
  );
}
```

- [ ] **Step 3: Append landing styles to `web/app/globals.css`**

```css
/* landing (kizuki.dev) */
.landing {
  max-width: 40rem;
  margin: 0 auto;
  padding: 4rem 1.4rem 3rem;
  font-size: 17px;
  line-height: 1.7;
}
.landing section { border-top: 1px solid var(--rule); margin-top: 3rem; padding-top: 2.2rem; }
.landing .eyebrow { font-family: var(--mono); font-size: 12px; letter-spacing: 0.14em; color: var(--stone); margin: 0 0 1rem; }
.landing .kanji { font-family: var(--display); font-weight: 500; font-size: clamp(56px, 12vw, 88px); line-height: 1.1; letter-spacing: 0.04em; }
.landing h1 { font-family: var(--display); font-weight: 600; font-size: 26px; margin: 20px 0 0; letter-spacing: 0.02em; }
.landing h1 span { color: var(--stone); font-weight: 400; font-family: var(--body); font-size: 16px; margin-left: 10px; letter-spacing: 0; }
.landing .one-liner { font-family: var(--display); font-size: 22px; margin: 1.6rem 0 0; }
.landing .sub { color: var(--stone); margin-top: 0.8rem; }
.landing .ctas { margin-top: 1.6rem; display: flex; gap: 1.2rem; }
.landing .ctas a { font-family: var(--mono); font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--kizuki-deep); text-decoration: underline; text-underline-offset: 3px; }
.landing .ctas a:hover { color: var(--kizuki); }
.landing p { color: var(--ink); }
.landing section > p { color: var(--stone); }
.landing .loop { list-style: none; margin: 0; padding: 0; }
.landing .loop li { border-top: 1px solid var(--rule); padding: 0.9rem 0; }
.landing .loop li:first-child { border-top: none; padding-top: 0; }
.landing .loop strong { font-family: var(--display); font-weight: 600; }
.landing .loop p { margin: 0.2rem 0 0; color: var(--stone); }
.landing .andon { list-style: none; margin: 0 0 1.2rem; padding: 0; }
.landing .andon li { color: var(--stone); padding: 0.35rem 0 0.35rem 14px; border-left: 3px solid var(--rule); margin: 0.3rem 0; }
.landing .andon li.lit { color: var(--ink); border-left-color: var(--kizuki); }
.landing .refusals { list-style: none; margin: 0; padding: 0; }
.landing .refusals li { padding: 0.45rem 0; border-top: 1px solid var(--rule); }
.landing .refusals li:first-child { border-top: none; }
.landing pre { background: #f5f3ec; border: 1px solid var(--rule); padding: 1rem 1.2rem; overflow-x: auto; }
.landing footer { border-top: 1px solid var(--rule); margin-top: 3rem; padding-top: 1.6rem; color: var(--stone); font-size: 14px; }
.landing footer a { color: var(--kizuki-deep); }
```

- [ ] **Step 4: Verify**

Run: `cd web && npm run typecheck` → clean.
With the dev server running: `curl -s localhost:3000/landing | grep -c "Your agents share one memory."` → 1; `curl -s localhost:3000/landing | grep -c "demo-banner"` → 0 (landing free of dashboard chrome even with `KIZUKI_DEMO=1`).

- [ ] **Step 5: Commit**

```bash
git add web/app web/public/seal-ki.svg web/public/momonga.svg
git commit -m "feat(web): add kizuki.dev landing route"
```

---

### Task 3: Host routing + deletions

**Files:**
- Modify: `web/proxy.ts`
- Delete: `web/public/landing.html`, `site/` (whole dir)

**Interfaces:**
- Consumes: `/landing` route from Task 2.
- Produces: kizuki.dev serving the new page; no stale landing artifacts.

- [ ] **Step 1: Point the rewrite at the route**

In `web/proxy.ts`, replace the rewrite line:

```ts
  if (host === "kizuki.dev" || host === "www.kizuki.dev") {
    return NextResponse.rewrite(new URL("/landing", request.url));
  }
```

(The malformed-URI guard and matcher stay unchanged.)

- [ ] **Step 2: Delete stale artifacts, grep for references first**

```bash
grep -rn "landing.html\|site/index" README.md CLAUDE.md AGENTS.md docs/ web/ package.json --include="*.md" --include="*.json" --include="*.ts" --include="*.mjs" | grep -v docs/superpowers || true
git rm web/public/landing.html
git rm -r site
```

Update any hit outside `docs/superpowers/` (historical specs/plans stay untouched).

- [ ] **Step 3: Verify host routing**

With the dev server running:
`curl -s -H "Host: kizuki.dev" localhost:3000/ | grep -c "Your agents share one memory."` → 1
`curl -s -H "Host: kizuki.dev" localhost:3000/anything | grep -c "Your agents share one memory."` → 1 (catch-all)
`curl -s localhost:3000/ | grep -c "気づき"` → ≥ 1 (default host still dashboard)

Run: `npm test` (root) → 353 pass.

- [ ] **Step 4: Commit**

```bash
git add web/proxy.ts
git commit -m "feat(web): route kizuki.dev to the landing route"
```

(`git rm` deletions from Step 2 are already staged; include them.)

---

### Task 4: Visual verification + design pass

**Files:**
- Possibly modify: `web/app/globals.css`, `web/app/(landing)/landing/page.tsx` (polish only)

**Interfaces:**
- Consumes: everything above, running under `cd web && KIZUKI_DEMO=1 npm run dev`.
- Produces: browser-verified page; screenshots for Connor.

- [ ] **Step 1: Browser check (playwright MCP or browsermcp — NOT agent-browser, per Connor's global config)**

Open `http://localhost:3000/landing`:
- Hero: kanji, "Kizuki — the noticing", one-liner, two CTAs.
- Five loop steps with thin rules; andon stack shows exactly one amber-lit line.
- No nav bar, no demo banner, no auto-refresh.
- Narrow viewport (390px): kanji clamps, no horizontal scroll.

Open `http://localhost:3000/` and `/alerts`: dashboard chrome intact.

- [ ] **Step 2: Design pass**

Invoke the `frontend-design` skill; adjust spacing/type only within the brand system (BRAND.md: calm document, thin rules, one amber accent). No new colors, no animation library.

- [ ] **Step 3: Full suite + typecheck one last time**

Run: `npm test && cd web && npm run typecheck` → 353 pass, clean typecheck.

- [ ] **Step 4: Commit any polish**

```bash
git add web/app
git commit -m "polish(web): landing design pass"
```

(Skip the commit if Step 2 changed nothing.)

---

## Deploy note (after Connor reviews locally)

Production deploy is the existing Vercel project (`web/`); `vercel.json` sets `KIZUKI_DEMO=1`, which the landing ignores by design. No config change needed — kizuki.dev already points at this project; the proxy rewrite takes over from `landing.html` on the next deploy. Deploy only on Connor's go.
