---
synthetic: true
notice: "SYNTHETIC RECORD. This meeting did not happen. It was generated from real commit activity to give the retrieval layer something to retrieve. The commits, files, dates and churn figures below are real; the discussion, decisions and attributed statements are fabricated."
generator: kizuki-corpus@1.0.0
meeting_id: mtg_752dfd0e18cb
window_id: win_10d262860da9
repo: 4x-war
occurred_on: 2026-08-18
kind: design review
grounded_commits:
  - 0b94bcd57da4f603189eb54740c7dd1c8d9604c9
  - ebcc2a5b5498163e7fed69e6aef6597e7a2e2398
  - 1e931f98e9bd37397c9920635601c86b086efbc8
  - d34d3a86f572387d8ab3daad8329be8fee8bf166
  - f8515f362b2295a48648fbc2dedb373e0852c2d9
  - c91fc3f384f53afa89c87f142d342b95e986028c
  - b55de5b6900bf9d7f2131e1b1fd33f7ba9800b51
  - 805bc6d571aa8b08e154ff641a48b38df8299bf6
grounded_paths:
  - src/data/scenarios.ts
  - src/env.d.ts
  - src/sim/simClock.test.ts
  - src/map/layerSlabs.ts
  - .github/workflows/ci.yml
  - map-style/README.md
---
> SYNTHETIC RECORD. This meeting did not happen. It was generated from real commit activity to give the retrieval layer something to retrieve. The commits, files, dates and churn figures below are real; the discussion, decisions and attributed statements are fabricated.

# 4x-war design review — week of 2026-08-17

**Date:** 2026-08-18  
**Repository:** 4x-war  
**Attendees:** Avery Brooks, Sasha Lindqvist

## Activity under discussion

51 commits landed in 4x-war during the week of 2026-08-17, touching 6 of the files listed below and moving 7,969 insertions against 18,974 deletions. The work concentrated in the ci, docs, test area.

Files that carried the change:

- `src/data/scenarios.ts`
- `src/env.d.ts`
- `src/sim/simClock.test.ts`
- `src/map/layerSlabs.ts`
- `.github/workflows/ci.yml`
- `map-style/README.md`

Representative commits from the window:

- chore(map): rename a leftover 'domain' in a comment to 'layer'
- ci: take deploys off git, gate prod behind a tagged release
- fix(map): close the slab stack into a volume the operator can read
- feat(map): draw the domain stack on the live map
- feat(map): scroll-driven camera rig on a theater-sized table

## Discussion

The group walked through why ci drew so much of the week's attention. Avery Brooks noted that the churn is concentrated rather than spread, which usually means one problem is being worked rather than many small ones. The team agreed the shape of the change is right and the open question is scope, not direction.

Concern was raised that `src/data/scenarios.ts` is becoming a bottleneck for parallel work. No one proposed splitting it this cycle.

## Decisions

### Defer ci cleanup

**Decision (proposed):** Cleanup in ci is deferred; we will revisit once the current work lands.

**Rationale:** Only 51 commits reached it this week, and pulling it forward would compete with the higher-churn work already in flight.

### Concentrate work in ci

**Decision (accepted):** We will keep the current push focused on the ci area of 4x-war rather than widening scope until the churn there settles.

**Rationale:** ci absorbed the bulk of the 26,943 lines changed this week across 6 files. Splitting attention now would leave it half-migrated.

## Grounding

Real commits this record was generated from:

- `0b94bcd57da4`
- `ebcc2a5b5498`
- `1e931f98e9bd`
- `d34d3a86f572`
- `f8515f362b22`
- `c91fc3f384f5`
- `b55de5b6900b`
- `805bc6d571aa`
