# Shared Branding (Ringi + Kizuki) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the sibling design systems from `docs/superpowers/specs/2026-07-07-shared-branding-design.md`: a `BRAND.md` per repo, mascot SVGs, motion-grammar prototype cards, a voice lint, and a DesignSync gallery.

**Architecture:** Two deliberately-duplicated design-system docs (kizuki + ringi), a shared family base (washi/sumi/type) plus per-product layers (seal red + discrete motion for ringi; andon amber + continuous motion for kizuki). Brand pieces are built as self-contained HTML preview cards in `kizuki/brand/gallery/` and synced to a claude.ai/design project. No new runtime dependencies anywhere.

**Tech Stack:** Plain markdown, hand-authored SVG, single-file HTML/CSS (IntersectionObserver, scroll-snap, keyframes), `node:test` for the voice lint, DesignSync tool for the gallery.

## Global Constraints

- Kizuki repo: ESM `.mjs`, Node built-ins only, **zero runtime dependencies** — do not add npm packages.
- Ringi repo work touches only `site/`, `docs/`, `scripts/`, `brand/` — never `apps/slack` logic.
- Family tokens (exact values): `--paper: #FAFAF7`, `--ink: #1A1A18`, `--stone: #6B6B66`, `--rule: #E7E4DB`.
- Ringi accent: `--seal: #C8402E`. Kizuki accent: `--kizuki: #C4761F`, dark variant `--kizuki-deep: #9A5A14` for text ≤ 18px (WCAG AA on `--paper`).
- Fonts: Shippori Mincho (display), **Zen Kaku Gothic New** (body), monospace for eyebrows/labels.
- Mascot style (hard rule): minimal sumi-e line art, flat, exactly one accent color per animal (amber eye-glint on momonga, red crown on tancho). No gradients, no kawaii-vector style.
- Motion tokens: ringi = `discrete` (event-triggered, snap easing `cubic-bezier(.2,1.4,.4,1)`, ≤ 400ms); kizuki = `continuous` (ambient loops ≥ 4s, no entrance events). No shared easing curves across products.
- Every animation requires a `prefers-reduced-motion: reduce` fallback.
- Voice: ringi copy in ringi-sho memo register; kizuki copy as field notes — no superlatives, no CTAs.
- Gallery cards: first line must be `<!-- @dsCard group="..." -->`; each card fully self-contained (inline CSS/SVG, no external fetches except Google Fonts).
- Kizuki web dashboard restyle is **out of scope** (spec).

**Repo paths:** kizuki = `/Users/tessaro/kizuki` (this repo, plan lives here), ringi = `/Users/tessaro/ringi` (separate git repo — commit ringi files there with `git -C /Users/tessaro/ringi`).

---

### Task 1: `kizuki/docs/BRAND.md`

**Files:**
- Create: `/Users/tessaro/kizuki/docs/BRAND.md`

**Interfaces:**
- Consumes: spec `docs/superpowers/specs/2026-07-07-shared-branding-design.md`
- Produces: token names (`--paper`, `--ink`, `--stone`, `--rule`, `--kizuki`, `--kizuki-deep`) and motion-token vocabulary (`continuous`) used verbatim by Tasks 4–7.

- [ ] **Step 1: Write the file**

```markdown
# Kizuki Brand

Sibling doc: `ringi/docs/BRAND.md` shares the Family base section verbatim.
Edits to the base propagate by hand — update both.

## Meaning

Kizuki (気づき) — the noticing. The kaizen moment of seeing what was
already there but unseen. Kizuki observes and advises; humans decide.
The brand behaves the same way: quiet field, one thing surfaced.

## Family base (shared with ringi)

Both products are paper documents. Ringi is the circulating proposal;
kizuki is the field notebook.

| Token     | Value     | Use                |
| --------- | --------- | ------------------ |
| `--paper` | `#FAFAF7` | background (washi) |
| `--ink`   | `#1A1A18` | text (sumi)        |
| `--stone` | `#6B6B66` | secondary text     |
| `--rule`  | `#E7E4DB` | hairline borders   |

Type: Shippori Mincho (display), Zen Kaku Gothic New (body — native
kana/kanji, 気づき renders in the body font), monospace for eyebrows and
labels. Layout: thin rules, generous margins, calm document composition.
Focus ring in the product accent.

## Kizuki layer

- Accent: andon amber `--kizuki: #C4761F`; text ≤ 18px uses
  `--kizuki-deep: #9A5A14` (WCAG AA on paper). Andon: notice a problem,
  the amber lamp lights, humans decide.
- Motif: one amber-highlighted line among muted lines.
- Mascot: ezo momonga — primary mark (header, favicon, future landing
  page). Sumi-e line art, flat, single amber eye-glint. Never
  kawaii-vector.

## Motion grammar: `continuous`

Kizuki moves as ambient drift — ongoing vigilance, never events.

- Muted lines breathe: `opacity 0.85 ↔ 1`, ~6s ease-in-out infinite.
- THE noticed line: persistent low-frequency amber pulse (≥ 4s cycle),
  no entrance animation.
- Banned: entrance transitions, snap easing, anything under 4s.
- `prefers-reduced-motion: reduce`: no animation; noticed line gets a
  static amber left border.
- Empty state: calm field with no pulsing line — nothing needs attention.

## Brand behavior

- **Diegetic mascot:** the momonga renders only when a real
  misalignment/follow-up exists (`hasSignal()` gate over the followups
  query). "No momonga" is a query readout. Log every appearance
  (entity, date, what it flagged) as a signal-quality self-audit.
- **Voice — field notes:** understated observation. No superlatives, no
  CTAs, never a pitch. Empty state: "checked N threads, nothing needs
  your attention."
- **Night diary:** in dark mode / late hours the momonga is awake
  (nocturnal) and offers one diary page about what it noticed today.
  Never announced in marketing.

## Etymology

`/notes/kizuki` page (when public site exists): sourced kaizen/andon
mapping, credited native-speaker review, standing correction invite with
public correction changelog.
```

- [ ] **Step 2: Verify rendering + token consistency**

Run: `grep -c '#C4761F\|#9A5A14\|#FAFAF7' /Users/tessaro/kizuki/docs/BRAND.md`
Expected: `3` or more (all three hexes present)

- [ ] **Step 3: Commit**

```bash
git -C /Users/tessaro/kizuki add docs/BRAND.md
git -C /Users/tessaro/kizuki commit -m "docs: kizuki BRAND.md (family base + kizuki layer + behavior)"
```

---

### Task 2: `ringi/docs/BRAND.md`

**Files:**
- Create: `/Users/tessaro/ringi/docs/BRAND.md`

**Interfaces:**
- Consumes: spec; family base identical to Task 1's Family base section.
- Produces: token names (`--paper`, `--ink`, `--stone`, `--rule`, `--seal`) and motion vocabulary (`discrete`) used by Tasks 3–7; voice register rules consumed by Task 8 (lint).

- [ ] **Step 1: Write the file**

```markdown
# Ringi Brand

Sibling doc: `kizuki/docs/BRAND.md` shares the Family base section
verbatim. Edits to the base propagate by hand — update both.

## Meaning

Ringi (稟議) — bottom-up consensus. A proposal document (ringi-sho)
circulates; each stakeholder stamps their hanko. The decision is the
accumulated, visible approvals. The brand is that document.

## Family base (shared with kizuki)

Both products are paper documents. Ringi is the circulating proposal;
kizuki is the field notebook.

| Token     | Value     | Use                |
| --------- | --------- | ------------------ |
| `--paper` | `#FAFAF7` | background (washi) |
| `--ink`   | `#1A1A18` | text (sumi)        |
| `--stone` | `#6B6B66` | secondary text     |
| `--rule`  | `#E7E4DB` | hairline borders   |

Type: Shippori Mincho (display), Zen Kaku Gothic New (body — native
kana/kanji, 稟議 renders in the body font), monospace for eyebrows and
labels. Layout: thin rules, generous margins, calm document composition.
Focus ring in the product accent.

## Ringi layer

- Accent: seal vermilion `--seal: #C8402E` — hanko ink (shu). Accent
  only; body text stays ink on paper.
- Motif: the ringi-sho approval strip. Primary logo mark is the hanko
  stamp — eventually a scan of the real carved seal (see Founder tasks),
  3–4 impressions with different ink bleed, rotated across uses.
- Mascot: tancho crane — secondary placement only (favicon, footer,
  empty states, 404, Slack bot avatar; never the landing hero). Sumi-e
  line art, flat, single red crown dot.

## Motion grammar: `discrete`

Ringi moves in deliberate, sequenced events — ceremony, one beat at a
time.

- Stamps land one at a time: IntersectionObserver-triggered,
  `scale 1.18 → 1`, easing `cubic-bezier(.2,1.4,.4,1)`, ≤ 400ms.
- Sections advance as a document chain (scroll-snap), single column.
- Banned: ambient loops, idle breathing, parallax drift.
- `prefers-reduced-motion: reduce`: stamps render settled, no animation.
- Empty state: an unfilled stamp strip — a ritual not yet begun.
- 404: a memo bounced back unstamped for revision (差し戻し — no seal
  affixed, dated).

## Brand behavior

- **Diegetic mascot:** the crane walks the approval-stamp strip as the
  progress indicator — remove the bird, lose the progress state.
- **Voice — ringi-sho memo register:** routing, seals, dates, revision
  marks. Every user-facing string carries a routing/date/seal noun.
  Banned SaaS words enforced by `scripts/voice-lint.mjs`.

## Etymology

`/about/ringi-sho` page: sourced mapping of the real ringi-sho
circulation process to the product mechanics, credited native-speaker
review, standing correction invite with public correction changelog.
```

- [ ] **Step 2: Verify base parity with kizuki**

Run: `diff <(sed -n '/## Family base/,/## /p' /Users/tessaro/kizuki/docs/BRAND.md | grep '^|') <(sed -n '/## Family base/,/## /p' /Users/tessaro/ringi/docs/BRAND.md | grep '^|')`
Expected: empty output (token tables identical)

- [ ] **Step 3: Commit (ringi repo)**

```bash
git -C /Users/tessaro/ringi add docs/BRAND.md
git -C /Users/tessaro/ringi commit -m "docs: BRAND.md (family base + ringi layer + behavior)"
```

---

### Task 3: Ringi site font swap (Inter → Zen Kaku Gothic New)

**Files:**
- Modify: `/Users/tessaro/ringi/site/index.html` (Google Fonts `<link>` + `--body` token, both near the top of the file)

**Interfaces:**
- Consumes: font decision from Task 2's Family base.
- Produces: the reference implementation matches BRAND.md.

- [ ] **Step 1: Swap the font link**

In `site/index.html`, replace:

```html
<link href="https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
```

with:

```html
<link href="https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@500;600;700&family=Zen+Kaku+Gothic+New:wght@400;500;700&display=swap" rel="stylesheet">
```

- [ ] **Step 2: Swap the token**

Replace:

```css
--body:"Inter",system-ui,sans-serif;
```

with:

```css
--body:"Zen Kaku Gothic New",system-ui,sans-serif;
```

- [ ] **Step 3: Verify no Inter remains**

Run: `grep -c Inter /Users/tessaro/ringi/site/index.html`
Expected: `0`

- [ ] **Step 4: Visual check**

Open the page and screenshot it (agent-browser: `file:///Users/tessaro/ringi/site/index.html`). Confirm body text renders in Zen Kaku Gothic New (rounder terminals than Inter) and nothing reflows brokenly.

- [ ] **Step 5: Commit (ringi repo)**

```bash
git -C /Users/tessaro/ringi add site/index.html
git -C /Users/tessaro/ringi commit -m "feat(site): body font Zen Kaku Gothic New per BRAND.md"
```

---

### Task 4: Mascot SVGs (placeholder line art until commissioned)

**Files:**
- Create: `/Users/tessaro/kizuki/brand/momonga.svg`
- Create: `/Users/tessaro/ringi/brand/tancho.svg`

**Interfaces:**
- Produces: canonical SVG sources; Task 6 inlines them into gallery cards.

Both: `stroke: #1A1A18`, `fill: none`, `stroke-width: 3`, round caps, one accent element each. These are hand-authored placeholders — Founder task replaces them with commissioned ink illustration, same constraints.

- [ ] **Step 1: Write `momonga.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" role="img" aria-label="Ezo momonga">
  <g stroke="#1A1A18" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M60 14 C28 14 18 44 20 68 C22 94 40 106 60 106 C80 106 98 94 100 68 C102 44 92 14 60 14 Z"/>
    <path d="M20 68 Q12 76 16 88"/>
    <path d="M100 68 Q108 76 104 88"/>
    <circle cx="44" cy="56" r="11"/>
    <circle cx="76" cy="56" r="11"/>
    <path d="M56 76 Q60 80 64 76"/>
    <path d="M52 12 Q54 4 60 8"/>
    <path d="M68 12 Q66 4 60 8"/>
  </g>
  <circle cx="47" cy="53" r="3.5" fill="#C4761F"/>
  <circle cx="79" cy="53" r="3.5" fill="#C4761F"/>
  <circle cx="44" cy="57" r="5" fill="#1A1A18"/>
  <circle cx="76" cy="57" r="5" fill="#1A1A18"/>
</svg>
```

- [ ] **Step 2: Write `tancho.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" role="img" aria-label="Tancho crane">
  <g stroke="#1A1A18" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M78 22 Q90 20 92 30 Q92 36 84 36 L74 34"/>
    <path d="M74 34 Q64 38 62 52 Q60 68 44 74 Q28 80 30 94"/>
    <path d="M62 52 Q78 58 74 76 Q70 90 52 92 Q38 93 30 94"/>
    <path d="M52 92 L52 112"/>
    <path d="M44 96 L44 112"/>
    <path d="M92 30 L104 26"/>
  </g>
  <circle cx="80" cy="20" r="5" fill="#C8402E"/>
  <circle cx="84" cy="28" r="1.8" fill="#1A1A18"/>
</svg>
```

- [ ] **Step 3: Verify both render**

Open each file in the browser (agent-browser `file://` URL), screenshot. Momonga must read as a round gliding squirrel with oversized eyes + amber glints; tancho as a standing crane with red crown. If either reads as noise, adjust paths until the silhouette lands — the style constraints (stroke 3, ink, one accent) are fixed; geometry is not.

- [ ] **Step 4: Commit (both repos)**

```bash
git -C /Users/tessaro/kizuki add brand/momonga.svg
git -C /Users/tessaro/kizuki commit -m "feat(brand): momonga mascot SVG (placeholder line art)"
git -C /Users/tessaro/ringi add brand/tancho.svg
git -C /Users/tessaro/ringi commit -m "feat(brand): tancho mascot SVG (placeholder line art)"
```

---

### Task 5: Motion prototype cards (discrete vs continuous)

**Files:**
- Create: `/Users/tessaro/kizuki/brand/gallery/motion-discrete.html`
- Create: `/Users/tessaro/kizuki/brand/gallery/motion-continuous.html`

**Interfaces:**
- Consumes: motion tokens from Tasks 1–2.
- Produces: permanent gallery cards; the side-by-side eyeball test that validates the spec's core contrast.

- [ ] **Step 1: Write `motion-discrete.html`**

```html
<!-- @dsCard group="Motion" -->
<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ringi motion: discrete</title>
<style>
  :root{--paper:#FAFAF7;--ink:#1A1A18;--stone:#6B6B66;--rule:#E7E4DB;--seal:#C8402E}
  body{background:var(--paper);color:var(--ink);font-family:"Zen Kaku Gothic New",system-ui,sans-serif;margin:0}
  main{height:100vh;overflow-y:auto;scroll-snap-type:y mandatory}
  section{height:100vh;scroll-snap-align:start;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:24px;border-bottom:1px solid var(--rule)}
  .label{font-family:ui-monospace,monospace;font-size:13px;letter-spacing:.08em;color:var(--stone)}
  .seal{width:64px;height:64px;border:3px solid var(--seal);border-radius:50%;color:var(--seal);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:20px;opacity:0;transform:scale(1.18) rotate(-6deg)}
  .stamped .seal{animation:land .35s cubic-bezier(.2,1.4,.4,1) forwards}
  @keyframes land{to{opacity:1;transform:scale(1) rotate(-6deg)}}
  @media (prefers-reduced-motion:reduce){
    main{scroll-snap-type:none}
    .seal{animation:none;opacity:1;transform:scale(1) rotate(-6deg)}
  }
</style></head><body><main>
  <section><div class="label">RINGI — DISCRETE / one beat at a time</div><div class="seal">承</div></section>
  <section><div class="label">SECOND APPROVAL</div><div class="seal">認</div></section>
  <section><div class="label">FINAL SEAL</div><div class="seal">決</div></section>
</main>
<script>
  const io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && e.target.classList.add("stamped")), {threshold: 0.6});
  document.querySelectorAll("section").forEach(s => io.observe(s));
</script>
</body></html>
```

- [ ] **Step 2: Write `motion-continuous.html`**

```html
<!-- @dsCard group="Motion" -->
<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kizuki motion: continuous</title>
<style>
  :root{--paper:#FAFAF7;--ink:#1A1A18;--stone:#6B6B66;--rule:#E7E4DB;--kizuki:#C4761F}
  body{background:var(--paper);color:var(--ink);font-family:"Zen Kaku Gothic New",system-ui,sans-serif;margin:0;padding:48px}
  .label{font-family:ui-monospace,monospace;font-size:13px;letter-spacing:.08em;color:var(--stone);margin-bottom:24px}
  .line{padding:12px 16px;border-bottom:1px solid var(--rule);color:var(--stone);animation:breathe 6s ease-in-out infinite}
  .line:nth-child(odd){animation-delay:3s}
  .noticed{color:var(--ink);animation:pulse 4.5s ease-in-out infinite;border-left:3px solid transparent}
  @keyframes breathe{0%,100%{opacity:.85}50%{opacity:1}}
  @keyframes pulse{0%,100%{box-shadow:inset 4px 0 0 -1px var(--kizuki);background:transparent}
    50%{box-shadow:inset 4px 0 0 -1px var(--kizuki);background:rgba(196,118,31,.07)}}
  @media (prefers-reduced-motion:reduce){
    .line,.noticed{animation:none;opacity:1}
    .noticed{border-left:3px solid var(--kizuki)}
  }
</style></head><body>
  <div class="label">KIZUKI — CONTINUOUS / ongoing vigilance</div>
  <div class="line">payments-team · nothing new</div>
  <div class="line">checkout-v2 · status unchanged</div>
  <div class="line noticed">mobile-team · scope assumption diverged 3 days ago</div>
  <div class="line">infra · nothing new</div>
  <div class="line">design-sys · status unchanged</div>
</body></html>
```

- [ ] **Step 3: Side-by-side eyeball test (the spec's validation gate)**

Open both files in the browser (agent-browser, two tabs or sequential screenshots + one with `prefers-reduced-motion` emulated). Checks:
- Discrete: stamps land as separate events while scrolling; nothing loops.
- Continuous: field visibly breathes; the noticed line pulses slowly and reads as **watching, not broken/loading**. If it reads as loading, lengthen the cycle or reduce the background delta before proceeding.
- Reduced-motion: discrete = settled stamps; continuous = static amber left border.

- [ ] **Step 4: Commit**

```bash
git -C /Users/tessaro/kizuki add brand/gallery/motion-discrete.html brand/gallery/motion-continuous.html
git -C /Users/tessaro/kizuki commit -m "feat(brand): motion grammar prototype cards (discrete vs continuous)"
```

---

### Task 6: Remaining gallery cards (tokens, mascots, voice)

**Files:**
- Create: `/Users/tessaro/kizuki/brand/gallery/tokens.html`
- Create: `/Users/tessaro/kizuki/brand/gallery/mascot-momonga.html`
- Create: `/Users/tessaro/kizuki/brand/gallery/mascot-tancho.html`
- Create: `/Users/tessaro/kizuki/brand/gallery/voice.html`

**Interfaces:**
- Consumes: SVGs from Task 4 (inline the full `<svg>...</svg>` markup into the mascot cards — cards must be self-contained), tokens from Tasks 1–2.

All four share this shell (repeated per file, values changed as noted):

```html
<!-- @dsCard group="GROUP" -->
<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TITLE</title>
<link href="https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@600;700&family=Zen+Kaku+Gothic+New:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  :root{--paper:#FAFAF7;--ink:#1A1A18;--stone:#6B6B66;--rule:#E7E4DB;--seal:#C8402E;--kizuki:#C4761F;--kizuki-deep:#9A5A14}
  body{background:var(--paper);color:var(--ink);font-family:"Zen Kaku Gothic New",system-ui,sans-serif;margin:0;padding:40px}
  h1{font-family:"Shippori Mincho",serif;font-size:22px;margin:0 0 6px}
  .eyebrow{font-family:ui-monospace,monospace;font-size:12px;letter-spacing:.08em;color:var(--stone);margin-bottom:20px}
</style></head><body>
<!-- CARD BODY -->
</body></html>
```

- [ ] **Step 1: `tokens.html`** — group `Foundations`, title `Family tokens`. Card body:

```html
<h1>Family tokens</h1><div class="eyebrow">WASHI / SUMI / SEAL / ANDON</div>
<style>.sw{display:flex;gap:12px;flex-wrap:wrap}.sw div{width:120px;border:1px solid var(--rule);border-radius:6px;overflow:hidden}
.sw .c{height:64px}.sw .t{font-family:ui-monospace,monospace;font-size:11px;padding:6px 8px}</style>
<div class="sw">
  <div><div class="c" style="background:#FAFAF7;border-bottom:1px solid #E7E4DB"></div><div class="t">--paper #FAFAF7</div></div>
  <div><div class="c" style="background:#1A1A18"></div><div class="t">--ink #1A1A18</div></div>
  <div><div class="c" style="background:#6B6B66"></div><div class="t">--stone #6B6B66</div></div>
  <div><div class="c" style="background:#E7E4DB"></div><div class="t">--rule #E7E4DB</div></div>
  <div><div class="c" style="background:#C8402E"></div><div class="t">--seal #C8402E (ringi)</div></div>
  <div><div class="c" style="background:#C4761F"></div><div class="t">--kizuki #C4761F</div></div>
  <div><div class="c" style="background:#9A5A14"></div><div class="t">--kizuki-deep #9A5A14</div></div>
</div>
<p style="max-width:52ch;color:var(--stone)">Display: Shippori Mincho. Body: Zen Kaku Gothic New (native 稟議 / 気づき). Accents never carry body text; text ≤ 18px in amber uses --kizuki-deep.</p>
```

- [ ] **Step 2: `mascot-momonga.html`** — group `Mascots`, title `Ezo momonga (kizuki, primary)`. Card body: `<h1>` + eyebrow `KIZUKI — THE NOTICING ANIMAL / PRIMARY MARK`, then the full inline SVG from `/Users/tessaro/kizuki/brand/momonga.svg` at `width="200"`, then one `--stone` paragraph stating the diegetic rule: renders only when `hasSignal()` is true.

- [ ] **Step 3: `mascot-tancho.html`** — group `Mascots`, title `Tancho crane (ringi, secondary)`. Same shape: eyebrow `RINGI — CONSENSUS ANIMAL / SECONDARY ONLY`, inline SVG from `/Users/tessaro/ringi/brand/tancho.svg`, paragraph stating placement rule (favicon/footer/empty/404/bot avatar; never hero — the hanko is the logo).

- [ ] **Step 4: `voice.html`** — group `Voice`, title `Voice registers`. Card body:

```html
<h1>Voice registers</h1><div class="eyebrow">MEMO REGISTER vs FIELD NOTES</div>
<style>.v{display:grid;grid-template-columns:1fr 1fr;gap:24px;max-width:860px}
.v h2{font-family:"Shippori Mincho",serif;font-size:16px}.v .ex{border:1px solid var(--rule);border-radius:6px;padding:14px 16px;background:#fff;font-size:14px}
.bad{color:var(--stone);text-decoration:line-through}</style>
<div class="v">
  <div><h2>Ringi — ringi-sho memo</h2>
    <div class="ex">差し戻し — bounced for revision. July 7, 2026. No seal affixed.</div>
    <div class="ex">Routed to 4 stakeholders. 2 seals affixed. Awaiting: mobile, infra.</div>
    <div class="ex bad">Streamline your team's decisions!</div>
    <p style="color:var(--stone);font-size:13px">Every string carries a routing/date/seal noun. Banned SaaS verbs enforced by scripts/voice-lint.mjs.</p></div>
  <div><h2>Kizuki — field notes</h2>
    <div class="ex">Checked 6 threads. Nothing needs your attention.</div>
    <div class="ex">mobile-team's scope assumption diverged from checkout-v2 three days ago.</div>
    <div class="ex bad">Unlock powerful insights across your org!</div>
    <p style="color:var(--stone);font-size:13px">Observation, never pitch. No superlatives, no CTAs.</p></div>
</div>
```

- [ ] **Step 5: Verify all cards render**

Open each of the four files (agent-browser), screenshot. Every card: paper bg, correct fonts, first line `@dsCard` comment intact.

- [ ] **Step 6: Commit**

```bash
git -C /Users/tessaro/kizuki add brand/gallery/
git -C /Users/tessaro/kizuki commit -m "feat(brand): gallery cards — tokens, mascots, voice registers"
```

---

### Task 7: Ringi voice lint (TDD)

**Files:**
- Create: `/Users/tessaro/ringi/scripts/voice-lint.mjs`
- Test: `/Users/tessaro/ringi/scripts/voice-lint.test.mjs`

**Interfaces:**
- Produces: `lintVoice(html) -> string[]` (array of violation messages, empty = clean) and a CLI entry (`node scripts/voice-lint.mjs site/index.html`, exit 1 on violations). Zero dependencies — Node built-ins only, `node:test`.

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert";
import { lintVoice } from "./voice-lint.mjs";

test("clean memo-register copy passes", () => {
  assert.deepEqual(lintVoice("<p>Routed to 4 stakeholders. 2 seals affixed.</p>"), []);
});

test("banned SaaS verbs are flagged with the word named", () => {
  const out = lintVoice("<p>Streamline your team's decisions and unlock insights.</p>");
  assert.equal(out.length, 2);
  assert.match(out[0], /streamline/i);
  assert.match(out[1], /unlock/i);
});

test("script and style contents are ignored", () => {
  assert.deepEqual(lintVoice("<style>.seamless{}</style><script>let unlock=1</script><p>Seal affixed.</p>"), []);
});

test("matching is word-bounded, not substring", () => {
  assert.deepEqual(lintVoice("<p>The sealant on the empowerment-studies memo.</p>"), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test /Users/tessaro/ringi/scripts/voice-lint.test.mjs`
Expected: FAIL — `Cannot find module ... voice-lint.mjs`

- [ ] **Step 3: Write the implementation**

```js
import { readFileSync } from "node:fs";

const BANNED = [
  "streamline", "unlock", "seamless", "supercharge", "empower",
  "revolutionize", "effortless", "game-changing", "leverage", "elevate",
];

export function lintVoice(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  const violations = [];
  for (const word of BANNED) {
    const re = new RegExp(`\\b${word}\\b`, "gi");
    for (const m of text.matchAll(re)) {
      violations.push(`banned word "${m[0]}" (memo register: routing, seals, dates — not SaaS pitch)`);
    }
  }
  return violations;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node scripts/voice-lint.mjs <file.html>");
    process.exit(2);
  }
  const violations = lintVoice(readFileSync(file, "utf8"));
  for (const v of violations) console.error(`${file}: ${v}`);
  process.exit(violations.length ? 1 : 0);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test /Users/tessaro/ringi/scripts/voice-lint.test.mjs`
Expected: 4 pass, 0 fail

- [ ] **Step 5: Run against the real landing page**

Run: `node /Users/tessaro/ringi/scripts/voice-lint.mjs /Users/tessaro/ringi/site/index.html; echo "exit: $?"`
Expected: `exit: 0` — if violations print, fix the copy in `site/index.html` (rewrite in memo register), re-run until clean, and include those copy edits in this task's commit.

- [ ] **Step 6: Commit (ringi repo)**

```bash
git -C /Users/tessaro/ringi add scripts/voice-lint.mjs scripts/voice-lint.test.mjs site/index.html
git -C /Users/tessaro/ringi commit -m "feat: voice lint — ban SaaS pitch words from ringi copy"
```

---

### Task 8: DesignSync gallery sync (run inline, user present)

**Files:**
- Reads: `/Users/tessaro/kizuki/brand/gallery/*.html` (6 cards from Tasks 5–6)

**Interfaces:**
- Consumes: the six gallery cards. DesignSync requires claude.ai login permission prompts — do NOT dispatch this task to a subagent; run it in the main session with the user present.

- [ ] **Step 1: Find or create the project**

Call `DesignSync` `list_projects`. If a suitable design-system project exists, confirm the target with the user; otherwise `create_project` with name `Ringi + Kizuki Brand`.

- [ ] **Step 2: Finalize the plan**

`finalize_plan` with `localDir: /Users/tessaro/kizuki/brand/gallery`, `writes: ["gallery/*.html"]` mapped as below.

- [ ] **Step 3: Write files**

`write_files` with the `planId`, six entries, `localPath` for each:
`tokens.html → gallery/tokens.html`, `motion-discrete.html → gallery/motion-discrete.html`, `motion-continuous.html → gallery/motion-continuous.html`, `mascot-momonga.html → gallery/mascot-momonga.html`, `mascot-tancho.html → gallery/mascot-tancho.html`, `voice.html → gallery/voice.html`.
Cards carry `@dsCard` first-line markers — no `register_assets` needed.

- [ ] **Step 4: Verify**

`list_files` on the project. Expected: all six paths present. Ask the user to open claude.ai/design and confirm the cards render grouped (Foundations / Motion / Mascots / Voice).

---

### Task 9: Founder tasks (not code — tracked here, done by Connor)

- [ ] Order two carved hanko from the same engraver (Rakuten/Etsy, boxwood, ~¥3,000–8,000 each): 稟 (ringi), 気 (kizuki). Confirm turnaround first — physical object should be in motion before more visual polish.
- [ ] On arrival: stamp on real washi with shuniku ink, scan at 600dpi, keep 3–4 impressions per seal with different bleed. Clean up with ImageMagick/`sips`; save to `ringi/brand/seal-scans/` and `kizuki/brand/seal-scans/`. Replace the vector seal on the ringi site with rotating scans.
- [ ] Etymology pages: draft `/about/ringi-sho` (ringi site) and `/notes/kizuki` (when kizuki has a public page) — sourced, footnoted; run copy through stop-slop/humanizer; pay a native speaker (italki/Preply, ~$50) to review; credit them by name; publish with standing correction invite + public correction changelog.
- [ ] Commission original ink illustrations of both mascots (same illustrator, credited); replace the placeholder SVGs under the same style constraints.

---

## Deferred (spec: out of scope, revisit later)

- Kizuki dashboard restyle (token refactor, dark mode, momonga `hasSignal()` gate, night diary) — happens when the dashboard adopts BRAND.md; night diary and `hasSignal()` land with it.
- Kizuki voice lint — no public kizuki copy exists yet; reuse Task 7's `lintVoice` shape when it does.
