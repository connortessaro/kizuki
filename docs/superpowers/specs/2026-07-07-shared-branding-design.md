# Shared Branding: Ringi + Kizuki — Design

Date: July 7, 2026
Status: approved design, pre-implementation

## Intent

Ringi and kizuki are sibling products — both Japanese-named alignment tools.
They get **separate design systems that are very similar**: a shared family
base expressing "calm paper document," plus a product layer that expresses
each name's meaning. Each repo carries its own self-contained `docs/BRAND.md`;
this spec is the source both are written from.

The meanings drive everything:

- **Ringi (稟議)** — bottom-up consensus. A proposal document (ringi-sho)
  circulates; each stakeholder stamps their hanko. The decision is the
  accumulated, visible approvals.
- **Kizuki (気づき)** — the noticing. The kaizen moment of seeing what was
  already there but unseen.

## Family base (shared layer, duplicated per repo)

Both products are paper documents. Ringi is the circulating proposal;
kizuki is the field notebook.

| Token     | Value       | Use                          |
| --------- | ----------- | ---------------------------- |
| `--paper` | `#FAFAF7`   | background (washi)           |
| `--ink`   | `#1A1A18`   | text (sumi)                  |
| `--stone` | `#6B6B66`   | secondary text               |
| `--rule`  | `#E7E4DB`   | hairline borders             |

Type: **Shippori Mincho** (display), **Zen Kaku Gothic New** (body — Japanese-designed sans with native kana/kanji, so 稟議/気づき labels render in the body font), monospace for
eyebrows/labels/annotations. Layout: thin rules, generous margins, calm
document composition. Focus ring in the product's accent color.

Voice: terse, declarative. Japanese term as a mono eyebrow label
(pattern already on the ringi landing page).

## Ringi product layer

- **Accent:** seal vermilion `#C8402E` — hanko ink (shu).
- **Motif:** the ringi-sho approval strip with stamp animation
  (already implemented on `site/index.html`).
- **Mascot:** tancho crane (red-crowned crane, Hokkaido).
  - Red crown = the seal-red dot; the bird carries its own hanko.
  - Orizuru: folded paper crane echoes the paper-document motif.
  - Coordinated group movement and ceremonial dance = formal decision ritual.
- **Mascot placement — secondary only.** The hanko stamp remains ringi's
  primary logo mark. Crane appears at favicon, footer, empty states, 404,
  and as the Slack bot avatar. Never the landing-page hero.

## Kizuki product layer

- **Accent:** andon amber `#C4761F` on paper; darker variant `#9A5A14`
  where small text needs AA contrast. Andon: the worker who
  notices a problem pulls the cord, the amber lamp lights, humans decide —
  same kaizen lineage as kizuki, and exactly kizuki's observe-and-advise
  contract.
- **Motif:** one amber-highlighted line among muted lines — the noticed
  thing surfacing.
- **Mark — primary.** The 気 seal is the logo (dashboard header, favicon,
  future landing page), same hierarchy as ringi's hanko. Revised from the
  original design: the animal was tried as the primary mark and read as
  cute-mascot-first rather than document-first, breaking parity with
  ringi's seal-led identity.
- **Mascot:** ezo momonga (Hokkaido flying squirrel). Giant watchful eyes,
  silent night observer — the noticing animal. **Secondary only** —
  footer, empty states, night diary. Never the primary logo.

## Mascot style rule (hard constraint, both docs)

Same illustrator hand across both: minimal sumi-e line art, flat, exactly
one accent color per animal (amber eye-glint on the momonga, red crown on
the tancho), placed on paper like a stamp or margin annotation. Restrained,
not sticker-pack kawaii. If it drifts toward cute-vector style, the family
coherence and B2B credibility both break.

Both mascots are Hokkaido animals — the family story stays coherent.

## Brand behavior (second layer: how the brand acts, not just looks)

Principle from divergent exploration: **decoration is copyable; only
load-bearing brand survives.** Four behaviors, approved:

### Motion grammar (the siblings differ in physics, not palette)

- **Ringi — discrete, ceremonial.** Stamps land one at a time:
  IntersectionObserver-triggered snap (`scale 1.18 → 1`, thunk easing,
  ink-bleed mask), scroll-snap document-chain sections, single column.
  One document, one decision, one beat at a time.
- **Kizuki — continuous, ambient.** Free-scrolling field; muted lines
  breathe (slow ~6s opacity idle); THE noticed line carries a persistent
  low-frequency amber pulse. No entrance events — ongoing vigilance.
- No shared easing curves or spacing rhythm between products. Empty states
  follow the grammar: ringi = unfilled stamp strip (ritual not yet begun);
  kizuki = calm field with no pulsing line (nothing needs attention).
- Codify as motion tokens: `discrete` vs `continuous` presets in each
  BRAND.md. Reduced-motion fallback required.
- Risk to tune by eye: kizuki's ambient pulse must read "watching," never
  "broken." Prototype both grammars as throwaway single-file HTML side by
  side before touching either repo.

### Diegetic mascots (the animal is information)

- **Momonga renders only when a real misalignment/follow-up exists** —
  gated behind one boolean (`hasSignal()` wrapping the existing followups
  query). "No momonga today" is a query readout, not decoration.
- **Crane walks the ringi stamp strip** as the actual progress indicator.
- Every 404/empty/error state is an in-world event through existing render
  paths: ringi 404 = memo bounced back unstamped for revision (差し戻し);
  kizuki empty = field note, "checked N threads, nothing needs your
  attention" — a rare good outcome, not a placeholder.
- Trust constraint: the momonga gate is a promise. Log every appearance
  (entity, date, what it flagged) to a field-notes file as a self-audit of
  signal quality. Validate `hasSignal()` against real vault data before
  drawing anything.

### Voice registers (mechanically enforced)

- Ringi copy in ringi-sho memo register: routing, seals, dates, revision
  marks. Every string carries a routing/date/seal noun.
- Kizuki copy as understated field notes: no superlatives, no CTAs, never
  a pitch.
- Enforced by a small lint pass over copy strings in each repo.

### Authenticity anchors (unclonable, accountable)

- Commission one real carved hanko per product from the same engraver
  (boxwood, 稟 and 気; ~¥3,000–8,000 each). Stamp on real washi with
  shuniku ink, scan at 600dpi, keep 3–4 impressions with different bleed
  and rotate them in the UI — an object with a history, not a texture pack.
- Etymology page per site (`/about/ringi-sho`, `/notes/kizuki`): sourced,
  footnoted mapping of concept → product mechanic; credited native-speaker
  review before publishing; standing correction invite with a public
  correction changelog. The invite is a live wire — corrections must be
  visibly acted on.
- Mascot art: commissioned or hand-authored original ink illustration,
  credited — same illustrator hand rule as above.

### Kizuki night diary (earned delight)

Dark-mode / late-hours easter egg: the momonga is awake (it is nocturnal)
and offers one diary page about what it noticed that day. Small build,
gated by real time/theme state, never announced in marketing.

Rejected as traps: washi weathering from behavioral data, cross-tab
mascot relationship, stamp cooldown friction.

## Deliverables

1. `ringi/docs/BRAND.md` — family base + ringi layer + brand-behavior
   rules (motion tokens, voice lint, diegetic rules). Codifies what
   `site/index.html` already does; the landing page is the reference
   implementation and adopts the token names.
2. `kizuki/docs/BRAND.md` — family base + kizuki layer + brand-behavior
   rules.
3. Mascot SVGs, hand-authored line art (until commissioned originals
   exist): `tancho.svg` (ringi), `momonga.svg` (kizuki).
4. Motion-grammar prototypes: two single-file HTML pages (stamp-snap vs
   ambient pulse) to validate the contrast by eye — built as permanent
   design-system cards, not throwaways.
5. Physical hanko order + scans; etymology pages — founder tasks tracked
   in the plan, not code deliverables.
6. Living design-system gallery as local HTML: preview cards in
   `kizuki/brand/gallery/` (token sheet, both mascots,
   discrete-vs-continuous motion demos, voice-register samples) plus an
   `index.html` that iframes them grouped — the browsable face of the
   versioned design language. (Originally planned for claude.ai/design
   via DesignSync; Connor's org has no Claude Design access, so the
   gallery is local-first.)

Out of scope for now: restyling the kizuki web dashboard (later task, uses
`BRAND.md` when it happens), any umbrella/parent brand, kizuki public
landing page (system just needs to be ready for it).

## Implementation notes

- The two BRAND.md files are deliberately duplicated, not shared
  infrastructure — same pattern as AGENTS.md mirroring CLAUDE.md. A note in
  each file names the sibling so edits propagate by hand.
- Page work against BRAND.md should use the `frontend-design` skill;
  future dashboard charts derive from the family palette (`dataviz` skill).
- Contrast: seal red and andon amber are accents; body text stays ink on
  paper. Any accent used for text ≤ 18px must pass WCAG AA against
  `--paper` (use the darker amber variant).
