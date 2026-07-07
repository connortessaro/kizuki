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
- **Mascot:** ezo momonga (Hokkaido flying squirrel). Giant watchful eyes,
  silent night observer — the noticing animal.
- **Mascot placement — primary.** Kizuki has no existing mark and its
  audience is the operator. Momonga is THE logo: dashboard header, favicon,
  future landing page.

## Mascot style rule (hard constraint, both docs)

Same illustrator hand across both: minimal sumi-e line art, flat, exactly
one accent color per animal (amber eye-glint on the momonga, red crown on
the tancho), placed on paper like a stamp or margin annotation. Restrained,
not sticker-pack kawaii. If it drifts toward cute-vector style, the family
coherence and B2B credibility both break.

Both mascots are Hokkaido animals — the family story stays coherent.

## Deliverables

1. `ringi/docs/BRAND.md` — family base + ringi layer. Codifies what
   `site/index.html` already does; the landing page is the reference
   implementation and adopts the token names.
2. `kizuki/docs/BRAND.md` — family base + kizuki layer.
3. Mascot SVGs, hand-authored line art (no image-gen tooling available):
   `tancho.svg` (ringi), `momonga.svg` (kizuki).

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
