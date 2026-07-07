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
- Mark: the 気 seal — primary mark (header, favicon, future landing page).
  Same hierarchy as ringi's hanko: the stamped kanji is the logo, not an
  animal. Interim asset is an AI photo-textured stamp with a real
  Shippori Mincho glyph overlay (`brand/seal-ki.svg`); replace with the
  real carved-hanko scan per founder tasks.
- Mascot: ezo momonga — secondary only (footer, empty states, night
  diary; never the primary logo). Sumi-e line art, flat, single amber
  eye-glint. Never kawaii-vector.

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
