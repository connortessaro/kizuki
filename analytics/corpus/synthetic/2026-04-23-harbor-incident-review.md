---
synthetic: true
notice: "SYNTHETIC RECORD. This meeting did not happen. It was generated from real commit activity to give the retrieval layer something to retrieve. The commits, files, dates and churn figures below are real; the discussion, decisions and attributed statements are fabricated."
generator: kizuki-corpus@1.0.0
meeting_id: mtg_e9873c7a7901
window_id: win_f65fb0ef4afc
repo: harbor
occurred_on: 2026-04-23
kind: incident review
grounded_commits:
  - e43c5eb17f21c2633ee2f1d28acf32fd238248c1
  - d16e09e4f257f8d49779009ade3e05742a3f0bee
  - 1fd4f2e69e8f1a3e69458ed6d1cc69baf3dbb216
  - 18f0e2e1c55a40b9c49ea5099765b7c9b3f1a1b4
  - a4790062359274df4c8bbda9263be22216efcab4
  - fa3ec8e10a99ec9e7b9f34127076ef58c982bc53
  - b3b8677c2c7b560a5417916f750fac57a7c24b94
  - 99ca5b8361074bee55f0505d822915c7c5c6af5a
grounded_paths:
  - navbar-logo.png
  - .claude/hooks/skill-activation.sh
  - src/lib/components/ui/Container.svelte
  - src/lib/analytics/landing.ts
  - src/lib/loan-application/submission-contract.test.ts
  - src/lib/application/lead-result-navigation.ts
---
> SYNTHETIC RECORD. This meeting did not happen. It was generated from real commit activity to give the retrieval layer something to retrieve. The commits, files, dates and churn figures below are real; the discussion, decisions and attributed statements are fabricated.

# harbor incident review — week of 2026-04-20

**Date:** 2026-04-23  
**Repository:** harbor  
**Attendees:** Avery Brooks

## Activity under discussion

123 commits landed in harbor during the week of 2026-04-20, touching 6 of the files listed below and moving 25,157 insertions against 29,372 deletions. The work concentrated in the ci, test, docs area.

Files that carried the change:

- `navbar-logo.png`
- `.claude/hooks/skill-activation.sh`
- `src/lib/components/ui/Container.svelte`
- `src/lib/analytics/landing.ts`
- `src/lib/loan-application/submission-contract.test.ts`
- `src/lib/application/lead-result-navigation.ts`

Representative commits from the window:

- content: add 8th FAQ for even grid
- feat: sticky CTA, amber errors, Instrument Serif + Geist Mono fonts
- style: apply font-mono-nums to all tabular numeric displays site-wide
- feat: sticky mobile CTA bar + trust signals on apply funnel
- feat: sticky mobile CTA + social proof sidebar on /apply

## Discussion

The group walked through why ci drew so much of the week's attention. Avery Brooks noted that the churn is concentrated rather than spread, which usually means one problem is being worked rather than many small ones. The team agreed the shape of the change is right and the open question is scope, not direction.

Concern was raised that `navbar-logo.png` is becoming a bottleneck for parallel work. No one proposed splitting it this cycle.

## Decisions

### Hold the interface in navbar-logo.png stable

**Decision (accepted):** navbar-logo.png is frozen for the rest of this cycle. Changes that would alter its shape get deferred to the next window.

**Rationale:** It was touched in 123 commits this week and is the file most other work depends on, so further churn there would ripple.

### Concentrate work in ci

**Decision (accepted):** We will keep the current push focused on the ci area of harbor rather than widening scope until the churn there settles.

**Rationale:** ci absorbed the bulk of the 54,529 lines changed this week across 6 files. Splitting attention now would leave it half-migrated.

## Grounding

Real commits this record was generated from:

- `e43c5eb17f21`
- `d16e09e4f257`
- `1fd4f2e69e8f`
- `18f0e2e1c55a`
- `a47900623592`
- `fa3ec8e10a99`
- `b3b8677c2c7b`
- `99ca5b836107`
