---
synthetic: true
notice: "SYNTHETIC RECORD. This meeting did not happen. It was generated from real commit activity to give the retrieval layer something to retrieve. The commits, files, dates and churn figures below are real; the discussion, decisions and attributed statements are fabricated."
generator: kizuki-corpus@1.0.0
meeting_id: mtg_7e90923f60a2
window_id: win_60f2082bf97f
repo: kizuki
occurred_on: 2026-07-07
kind: design review
grounded_commits:
  - 8e7704fe5a38f4bb5aee412a136827d9613c3e37
  - cf03029a79bda37ff57426e84800594bf0fdee98
  - c319e3817c3aab290fdeb6076a60fac011f7cd90
  - 0653546018ba573a7710375f41dc3481c776057c
  - ca87ec3639f936c3e0615758516a35dd3a3a89cb
  - ff1180caf6f9f78734c80fc719389e6afacb6e31
  - 83267e7122e1bd7fc481bbe18144805d5d04b015
  - ec43f1e2c18500877c05b192ecedb622a65c60c8
grounded_paths:
  - lib/launchd.mjs
  - lib/notify.test.mjs
  - brand/gallery/voice.html
  - lib/prompt.test.mjs
  - web/demo-vault/projects/search-relevance.md
  - web/demo-vault/people/priya-rao.md
---
> SYNTHETIC RECORD. This meeting did not happen. It was generated from real commit activity to give the retrieval layer something to retrieve. The commits, files, dates and churn figures below are real; the discussion, decisions and attributed statements are fabricated.

# kizuki design review — week of 2026-07-06

**Date:** 2026-07-07  
**Repository:** kizuki  
**Attendees:** Avery Brooks

## Activity under discussion

115 commits landed in kizuki during the week of 2026-07-06, touching 6 of the files listed below and moving 18,784 insertions against 1,237 deletions. The work concentrated in the config, tooling, other area.

Files that carried the change:

- `lib/launchd.mjs`
- `lib/notify.test.mjs`
- `brand/gallery/voice.html`
- `lib/prompt.test.mjs`
- `web/demo-vault/projects/search-relevance.md`
- `web/demo-vault/people/priya-rao.md`

Representative commits from the window:

- docs: add brand-behavior layer to branding spec
- docs: spec skills export (multi-agent ritual pack from neutral source)
- feat: ship v3 dashboard, v4 init, and CLI QoL from roadmap
- fix: cap alerts in shift brief
- fix(web): dashboard render bugs found in browser audit

## Discussion

The group walked through why config drew so much of the week's attention. Avery Brooks noted that the churn is concentrated rather than spread, which usually means one problem is being worked rather than many small ones. The team agreed the shape of the change is right and the open question is scope, not direction.

Concern was raised that `lib/launchd.mjs` is becoming a bottleneck for parallel work. No one proposed splitting it this cycle.

## Decisions

### Concentrate work in config

**Decision (proposed):** We will keep the current push focused on the config area of kizuki rather than widening scope until the churn there settles.

**Rationale:** config absorbed the bulk of the 20,021 lines changed this week across 6 files. Splitting attention now would leave it half-migrated.

### Hold the interface in lib/launchd.mjs stable

**Decision (accepted):** lib/launchd.mjs is frozen for the rest of this cycle. Changes that would alter its shape get deferred to the next window.

**Rationale:** It was touched in 115 commits this week and is the file most other work depends on, so further churn there would ripple.

## Grounding

Real commits this record was generated from:

- `8e7704fe5a38`
- `cf03029a79bd`
- `c319e3817c3a`
- `0653546018ba`
- `ca87ec3639f9`
- `ff1180caf6f9`
- `83267e7122e1`
- `ec43f1e2c185`
