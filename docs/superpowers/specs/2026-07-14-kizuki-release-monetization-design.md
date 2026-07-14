# Kizuki release + monetization design

Date: 2026-07-14. Status: approved by operator (Connor).

## Decision record

This spec overrides the validate-first sequencing in `docs/ROADMAP.md` (v1–v4
evidence gates) and `docs/future-notes.md` §3. Operator decision on 2026-07-14:
full jump — launch publicly and pursue revenue now, without waiting for the
Friday gate report or the one-month-daily-use gate. The gate instrumentation
(`kizuki catch` / `kizuki gate`) stays and keeps collecting evidence; it no
longer blocks release work.

## Positioning

**Kizuki is needs-intelligence: it understands what a business, a team, and a
person need — status, blockers, blind spots, what's about to slip — before
anyone asks.**

- Category contrast: the 2026 "company brain" wave (Gheist, WorkDaemon,
  Cerenovus, Zivroe, Nerra, Opuss, Coworker) sells memory and recall. Glean
  sells search. Kizuki sells understanding of *needs and gaps* — the analysis
  layer, not the archive.
- Buyer psychology (enterprise): leadership omniscience — walk into any meeting
  already knowing what every team is stuck on and what's about to slip.
  External framing is always alignment/clarity ("see the whole board," "nothing
  slips between handoffs"), never monitoring language.
- Privacy is the trust layer, not the headline. Inference-level ZDR is
  commodity; the structural differentiator is that the corpus never has to live
  in our cloud: local-first CLI, self-hosted enterprise deploys, TEE-hosted
  option for managed convenience. Stated as "we don't want your data."

## Business model — open-core, three rungs

| Rung | What | Price | Status |
|------|------|-------|--------|
| Free | OSS CLI, self-run, local vault, BYO agent | $0 | Ships this week |
| Pro hosted | Managed personal tier | TBD | Waitlist only. Not built. No vanilla-cloud version — TEE or self-hosted story required before charging. |
| Enterprise | Shared reasoning layer over team comms (org-graph) | Pilots $500–2,000/mo, per-seat later | Sell first, build with pilot money |

First revenue motion: **enterprise design partners.** 2–3 paid pilots fund the
shared-layer build.

## Workstream 1 — OSS public launch (this week)

1. **Git-history audit (hard blocker).** The working checkout holds real work
   data (`people/`, `transcripts/`, `days/`, `signals/`, …— gitignored). Before
   the repo flips public, audit full history for any leaked work data or
   secrets; scrub or re-cut history if found. Nothing ships until this passes.
2. **LICENSE: Apache-2.0** at repo root; license field in `package.json`.
3. **README / install polish** — quickstart from `npm i -g` (or `npx`) through
   `kizuki init --agent <preset>` to first sync; agent-preset matrix; demo
   link.
4. **npm publish** `kizuki` (bin already wired).
5. **Flip repo public** → **Show HN + X launch post** (drafted via
   `launch-tweet` skill). Landing links the repo.
6. **Landing update (kizuki.dev):** needs-intelligence headline; three rungs —
   Free (install now) / Pro hosted (waitlist, unpaid) / **Enterprise: "shared
   reasoning layer — book a pilot"** CTA. Security section: local-first /
   self-hosted / TEE, "we don't want your data."

## Workstream 2 — Enterprise pilot motion

- **Offer:** paid design partnership, $500–2,000/mo, 2–3 partners, 8–12 week
  pilots. Partners get the shared reasoning layer built against their stack and
  founding-customer pricing.
- **Pitch:** needs-map of the org — what every team needs, where handoffs
  starve, what's slipping. Alignment framing throughout; omniscience is the
  private buyer motivation, never the copy.
- **Materials (agent-draftable):** enterprise one-pager, outreach email
  sequence, pilot terms sketch, synthetic-data demo (extend `web/demo-vault/`).
- **Targets:** founder-supplied network/outbound list. Founder task.
- **Competitive line vs Cerenovus/Gheist/Glean:** needs-analysis not
  memory/search; runs on your infra (they can't offer that without breaking
  their SaaS model); bottom-up credibility from the OSS CLI.

## Enterprise product guardrails (design-level, non-negotiable)

- **Work-state intelligence, not employee surveillance.** In scope: blockers,
  needs, misalignment, slipped handoffs per team/person. Out of scope forever:
  productivity scoring, activity metrics, punitive analytics.
- **Disclosed deployment.** Employees know it runs. No covert mode.
- **RBAC on who sees whose analysis** — load-bearing for internal trust (per
  `docs/future-notes.md` open questions).
- **Observe-and-advise invariant holds.** Kizuki recommends; humans act. Same
  rule as the CLI (`CLAUDE.md`).
- Jurisdiction note: EU works-council / consent-law review before any EU
  deploy.

## Build order

1. Launch week: Workstream 1 only. No new product code beyond launch polish.
2. Platform-foundation T7–T10 (`docs/superpowers/plans/2026-07-14-kizuki-platform-foundation.md`)
   continue — substrate serves both rungs.
3. Shared-graph MVP is spec'd only against a **signed** pilot; pilot's 2–3 real
   sources ship first (likely Slack + meetings + email). Full-surface vision
   (Slack, Confluence, Zoom/Teams, email, GitHub comments, Excel, …) stays
   vision until paid demand pulls each connector.
4. TEE hosting (Phala/RedPill per `docs/future-notes.md`) only when a pilot
   demands managed hosting; self-hosted is the default enterprise deploy.

## Risks (accepted by operator unless noted)

- **Employer IP:** kizuki is dogfooded at the operator's workplace. Check
  employment IP-assignment clause before taking revenue. *Open — founder.*
- **Competition:** Cerenovus (YC S26), Gheist, WorkDaemon et al. are funded and
  selling the same buyer. Counter: positioning + infra story + OSS funnel.
- **No SOC 2 / solo operator:** pilots must be sold as design partnerships to
  buyers comfortable with that; self-hosted deploy sidesteps most of it.
- **Gate evidence abandoned as blocker:** own catch-rate data may never
  validate the wedge. Accepted ("full jump").
- **Surveillance blowback:** mitigated by guardrails above; residual risk
  accepted.

## Success criteria

- Repo public + HN/X launch shipped this week (history audit passed first).
- ≥1 signed paid pilot within 30 days of launch.
- First dollar collected within 45 days.
- Zero work-data leakage at any step.

## Non-goals

- Autonomous action-taking (invariant stands).
- Vanilla-cloud hosted Pro.
- Building connectors or shared-graph features ahead of a signed pilot.
- Charging the Pro waitlist.
