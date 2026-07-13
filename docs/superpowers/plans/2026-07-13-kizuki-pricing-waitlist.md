# Kizuki Pricing + Waitlist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a two-tier pricing section (Free local / Pro hosted waitlist) to the kizuki.dev landing — marketing only, no billing or backend.

**Architecture:** One new section in the static landing server component + a `.landing .tiers` CSS block. Waitlist CTA is an external link (mailto fallback until Connor supplies a form URL).

**Tech Stack:** Existing `web/` Next.js subpackage; no new dependencies, no client components.

**Spec:** `docs/superpowers/specs/2026-07-13-kizuki-pricing-waitlist-design.md`.

## Global Constraints

- Landing stays static: no vault reads, no API routes, no client components, no writes.
- Ship the spec's copy verbatim; brand tokens only, no new colors.
- Root `npm test` (353) green; `cd web && npm run typecheck` clean.
- Do NOT deploy — Connor's go required.

---

### Task 1: Pricing section + tier styles

**Files:**
- Modify: `web/app/(landing)/landing/page.tsx`, `web/app/globals.css`

**Interfaces:**
- Consumes: existing `.landing` layout/CSS from the landing plan.
- Produces: `#pricing` section; `WAITLIST_URL` constant (one-line swappable).

- [ ] **Step 1: Add the section**

At the top of `web/app/(landing)/landing/page.tsx` (module scope, after imports):

```tsx
const WAITLIST_URL = "mailto:tessaro.c@northeastern.edu?subject=Kizuki%20Pro%20waitlist";
```

Insert between the WHAT IT REFUSES section and the RUN IT section:

```tsx
      <section id="pricing">
        <p className="eyebrow">PRICING</p>
        <div className="tiers">
          <div className="tier">
            <h2>Free</h2>
            <p>
              Everything you saw above. The CLI, the vault, the dashboard, the
              MCP server. Runs on your machine. Open source, no account.
            </p>
            <a href="https://github.com/ctessaro/kizuki">GitHub</a>
          </div>
          <div className="tier pro">
            <h2>
              Pro <span>hosted</span>
            </h2>
            <p>
              Kizuki that runs without your laptop: hosted sync, ambient watch,
              same rules. It still sends nothing without you. In development.
            </p>
            <a href={WAITLIST_URL}>Join the waitlist</a>
          </div>
        </div>
      </section>
```

In the RUN IT section, extend the closing paragraph sentence to:

```tsx
        <p>
          Open source. MCP server included. Works with Codex, Claude Code,
          Gemini CLI, Cursor, and any OpenAI-compatible API.
        </p>
```

- [ ] **Step 2: Append tier styles to `web/app/globals.css`** (inside the landing block, after `.landing .refusals` rules)

```css
.landing .tiers { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
@media (max-width: 640px) { .landing .tiers { grid-template-columns: 1fr; } }
.landing .tier { border: 1px solid var(--rule); padding: 1.2rem 1.4rem; }
.landing .tier.pro { border-top: 3px solid var(--kizuki); }
.landing .tier h2 { font-family: var(--display); font-size: 20px; font-weight: 600; margin: 0 0 0.6rem; }
.landing .tier h2 span { color: var(--stone); font-family: var(--body); font-weight: 400; font-size: 14px; margin-left: 8px; }
.landing .tier p { color: var(--stone); margin: 0 0 1rem; }
.landing .tier a { font-family: var(--mono); font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--kizuki-deep); text-decoration: underline; text-underline-offset: 3px; }
.landing .tier a:hover { color: var(--kizuki); }
```

- [ ] **Step 3: Verify**

Run: `cd web && npm run typecheck` → clean.
With `KIZUKI_DEMO=1 npm run dev` running: `curl -s localhost:3000/landing | grep -c "PRICING"` → ≥ 1, `grep -c "Join the waitlist"` → ≥ 1. Kill the server.
Playwright screenshots at 1280 and 390 widths — cards side-by-side then stacked, Pro card carries the amber top rule.
Run root `npm test` → 353 pass.

- [ ] **Step 4: Commit**

```bash
git add web/app
git commit -m "feat(web): add pricing tiers and waitlist CTA"
```

## Deploy note

After Connor reviews (and optionally swaps `WAITLIST_URL` for a real form URL): `vercel deploy --prod` from repo root, then `curl -s https://kizuki.dev | grep -c PRICING` ≥ 1. Only on his go.
