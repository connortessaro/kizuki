# Kizuki — pricing section + waitlist (marketing slice)

**Date:** 2026-07-13
**Status:** design approved, pre-implementation

## Goal

Add a pricing section to the kizuki.dev landing that names the freemium shape
and captures hosted-product demand — without building billing, accounts, or
hosting. This is the smallest willingness-to-pay test consistent with
`docs/future-notes.md`'s validation gate.

Strategy note (July 13, 2026): Connor dropped the TEE/confidential-deployment
thesis — no moat there for Kizuki. `docs/vision.md` ("why us") and
`docs/future-notes.md` (monetization thesis) still assume it; both get a
revision pass as a docs follow-up, out of scope here.

## Page change

One new section on `web/app/(landing)/landing/page.tsx`, between WHAT IT
REFUSES and RUN IT. Eyebrow: `PRICING`. Two tiers, side by side on desktop,
stacked on mobile:

- **Free** — "Everything you saw above. The CLI, the vault, the dashboard,
  the MCP server. Runs on your machine. Open source, no account."
  CTA: `GitHub` (repo link).
- **Pro — hosted** — "Kizuki that runs without your laptop: hosted sync,
  ambient watch, same rules — it still sends nothing without you. In
  development." CTA: `Join the waitlist`.

Copy above is the approved draft (stop-slop conventions; em dash only in
brand strings — the Pro line's dash is a hyphenated label, keep it a plain
hyphen in implementation: "Pro hosted" rendered as label + sublabel).

## Waitlist mechanics

- CTA links to a hosted form (Tally form Connor creates; URL is a
  `WAITLIST_URL` constant at the top of the page file so it's one-line
  swappable). Form asks: email + "what would you pay for?" free-text.
- No API route, no storage, no client component — dashboard's no-writes rule
  and the landing's static-only rule both hold.
- Until Connor supplies the real form URL, the constant points to
  `mailto:tessaro.c@northeastern.edu?subject=Kizuki%20Pro%20waitlist` so the
  CTA works from day one.

## Styling

`.landing .tiers` grid (two columns ≥ 640px, one below), tier cards with
hairline `--rule` borders, tier name in display face, Pro card carries a thin
amber top rule (`--kizuki`) as the single accent. Reuses existing tokens; no
new colors.

## Verification

- Typecheck + `curl -s localhost:3000/landing | grep -c "PRICING"` ≥ 1.
- Playwright screenshots desktop + 390px (cards stack).
- Root `npm test` green; deploy only on Connor's go.

## Non-goals

Billing, accounts, license keys, hosted runtime, TEE anything, pricing
numbers (tiers are unpriced until real demand data exists).
