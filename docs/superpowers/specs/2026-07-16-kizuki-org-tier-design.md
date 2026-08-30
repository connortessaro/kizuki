# Kizuki Org tier — design (speculative)

Status: **not validated. Do not build any of this before the validation step in
"Sequencing" below returns a yes.** This is a spec to think against, produced
by brainstorming, not a build order. It sits alongside
`docs/vision.md` and `docs/future-notes.md` and refines both: it splits what
those docs called "Team" into two genuinely different products with different
consent models, and concretizes the VP-facing half.

Related docs: `docs/vision.md` (north star), `docs/future-notes.md`
(monetization/TEE thesis), `docs/ROADMAP.md` (build order, Platform foundation
section).

## Why three tiers, not two

`docs/future-notes.md` currently describes Free (solo) → Team (shared,
TEE-hosted) → Enterprise (Team + SSO/RBAC/audit/attestation). That conflates
two different products under "Team": a group that opts itself in to share its
own graph, and an org-wide deployment an admin turns on for VP visibility.
Those have different consent models and different buyers, so they should be
named and designed separately:

| Tier | Who adopts it | Consent model | Who reads it |
|------|---------------|----------------|--------------|
| **Personal** (shipped) | An individual | N/A — local, solo | The individual |
| **Team** | A team, together | Opt-in — the team chooses to share its graph | The team (tech leads, PMs) |
| **Org** | An org admin | Disclosed, not opt-in — admin connects org-wide sources, employees are told it exists | VPs / execs |

Team grows bottom-up from Personal adoption (future-notes.md's existing
motion). Org is sold top-down and does not require anyone to have adopted
Personal or Team first — that's the entire commercial appeal to a VP buyer.
This document specs **Org** only; Team is unchanged from future-notes.md.

## Positioning: the moat and the narrative

Framed for fundraising, not just design intent. The reference point worth
borrowing is Palantir's *aura*, not its product line — the mystique of being
infrastructure the most powerful people in an org depend on — without the
individual-surveillance business line that made Palantir controversial.
Translated to Kizuki:

- **Not a dashboard. A soul.** Kizuki already treats people, projects, and
  teams as first-class, connected objects with a live, evidenced graph
  between them (`lib/vault.mjs` entities + signals/insights ledgers). Kizuki
  doesn't give the org reports — it gives it a soul: a living model of how
  the org actually works, not how it's reported to work in a status meeting.
  This is a defensible claim, not just a slogan: the personal product already
  builds this graph one relationship at a time; Org tier is the same graph
  at scale.
- **The moat is confidentiality, not features.** Any competitor can build a
  Slack summarizer. Almost none can credibly tell a regulated enterprise
  (legal, healthcare, finance, defense-adjacent) "your data never leaves a
  confidential enclave, here is the attestation receipt" — `docs/vision.md`'s
  existing thesis, stated as a moat rather than a feature. This is the real
  Palantir parallel: its durable edge was never the UI, it was being trusted
  with data competitors structurally could not touch. Kizuki's version of
  that trust is confidentiality for regulated commercial orgs.
- **Monopoly framing, not competition framing** (Thiel's own *Zero to One*
  thesis): don't pitch "better than Glean/Copilot." Pitch a category those
  companies cannot enter — the only credible answer for an org whose data is
  too sensitive to hand to a horizontal AI assistant at all. A market defined
  by exclusion is the shape of market this kind of investor looks for.
- **Forward-deployed motion, not self-serve SaaS.** Org tier's actual GTM
  (per RBAC/disclosure below) is closer to Palantir's high-touch enterprise
  motion than a signup form: org-admin-led deployment, customized ingestion,
  a real sales relationship with the buyer. That's not a growth-hacking
  weakness to apologize for — it's what lets it price like enterprise
  software instead of per-seat SaaS.
- **TAM, stated ambitiously.** Not "teams that want a Slack bot" — every
  organization large enough that no single human holds the whole picture,
  and sensitive enough it cannot hand that picture to a horizontal AI vendor.
  Sized against regulated-industry enterprise software spend.

None of this changes what the product does — only how it's described. The
guardrails below (disclosed, work-level-only, schema-enforced no-person-score)
stay exactly as designed. Palantir's mystique came from being trusted with
the most sensitive data in the world and never leaking it; Kizuki's version of
that trust is being the vendor that structurally cannot leak an individual's
data even to itself, and cannot be used to score a person even if a customer
asked for it. Stated with the same confidence as the rest of this section,
that restraint is the aura — not a caveat on it.

## Non-negotiable boundary: work-level only, never a person-score

Org tier surfaces facts about *work* — decisions, dependencies, deadlines,
team-level capacity — never a score, rating, or ranking of a named individual.
This is `docs/vision.md`'s existing principle ("not a surveillance or
people-rating tool... a product principle, not a footnote"), carried forward
deliberately, not by default. It is enforced at the schema level (see
"Analysis & rollup" below), not left as a policy convention, so violating it
later requires a deliberate schema change, not a slow drift.

Two market data points from research done during this brainstorm, which is why
this boundary is treated as a commercial requirement and not only an ethical
one:

- Individual-level workplace surveillance has a documented backlash pattern
  serious enough that Meta scaled back its own internal mouse/keystroke
  tracking tool in June 2026 after employee revolt — despite being disclosed.
- Team/workflow-framed tools (e.g. TD Bank's productivity-tracking rollout,
  framed as "manage workflows, team capacity") did not generate the same
  backlash. Staying at team/project granularity is the lane that survives
  scrutiny, not just the more defensible one ethically.

Individual-level workload/performance data (e.g. "reallocate this named
person") was considered and explicitly cut from this spec: it cannot be
computed without a per-person capacity number, which breaks the schema
guarantee above, and it likely triggers **EU AI Act Annex III high-risk
classification** (AI systems used in employment monitoring/evaluation/
reallocation decisions require conformity assessments and human-oversight
documentation) — a real compliance program, not a PR risk. If a buyer
specifically demands named-person reallocation, that is a separate,
explicitly-gated feature to scope later, not a default extension of Org tier.

## Feature set

Validated against three feature ideas surfaced from public discussion of what
VP buyers want from AI-driven org tools, scoped to fit the work-level-only
boundary:

1. **Frictionless status reports.** Cross-team project/team status rollup,
   generated on demand instead of waiting for weekly manual updates. Direct
   extension of the personal product's existing signal categories
   (contested decisions, blockers), computed at org scale.
2. **Predictive deadline risk.** Flags which major deadlines are falling
   behind, from project/repo-level commit frequency and project/team-level
   communication-pattern signals (thread-stall time, response latency —
   aggregated at project/team granularity). Individual response-pattern data
   is never surfaced or stored disaggregated; only the team/project rollup
   number exists downstream of ingestion.
3. **Resource signal (scoped).** Team-level workload distribution and
   team-level skill-gap coverage — "this team is over capacity relative to
   its project load," "this team lacks senior coverage in X" — supports
   "where do I add headcount" and "where's the skill gap," which are normally
   team/role decisions anyway. Does **not** support "reallocate this specific
   person" (see boundary above) — no per-person workload number is ever
   computed or exposed.

## Architecture

Builds on platform-foundation pieces already shipped or drafted, rather than
new infrastructure:

- **Event schema.** `lib/platformEvents.mjs` already has `workspaceId` /
  `principalId` / `sourceOwnerId` / `visibility` as first-class fields, today
  pinned to `LOCAL_CONTEXT` (`"personal"`, `"local-operator"`,
  `["private"]`). Org tier generalizes these to real org/team identifiers and
  widens `visibility` to include rollup-eligible levels (e.g.
  `"team-rollup"`, `"org-rollup"`) so an event declares what aggregation
  level it may surface at, at ingestion time.
- **Storage.** Hosted multi-tenant Postgres event store (backlog `DRAFT-5`)
  replaces the local append-only JSONL store for this tier; same
  append-only, version-checked, idempotent event model as
  `lib/platformEventStore.mjs`, not a new one.
- **Ingestion.** Org-wide OAuth connectors (backlog `DRAFT-6`), admin-
  authorized, not per-employee — Slack workspace, Jira/Confluence org,
  GitHub org, Outlook tenant. Tagged to the existing person/project/team
  entity model.
- **Confidential compute.** TEE-hosted (Phala + RedPill), covering both
  hosting and inference — `docs/future-notes.md` already flags that if the
  enclave calls a normal LLM API, org data leaves the boundary and
  attestation is theater. Non-negotiable for this tier's disclosure claim to
  be true ("analyzed, never leaves the enclave, not even to us").
- **Rollup / analysis.** A separate aggregation pass consumes raw events and
  computes team/project-level signals only. The rollup output type has no
  person-keyed field capable of holding a score or rank — people appear only
  as cited participants inside an evidenced work-level event (same
  evidence-citation pattern the personal product already uses). VPs read only
  the rollup layer; raw events are audit trail, never the product surface.
- **RBAC.** `org-admin` (connects sources, owns disclosure), `vp` (rollup
  dashboard, team/project granularity only), `employee` (sees the disclosure
  notice; no dashboard access in v1).
- **Disclosure.** Mandatory, generated at connection time: what's connected,
  what's computed, and an explicit statement of what's *not* computed (no
  per-person score) — doubles as the legal defense that the boundary was
  actually communicated.
- **Audit.** Every VP dashboard read is logged, per the audit-log control
  already sketched for the Enterprise tier in `docs/future-notes.md`.

Out of scope for this spec (separate future items, already drafted in the
backlog, not designed here): pack manifests (`DRAFT-7`), billing (`DRAFT-9`).

## Sequencing (validation gate)

There is currently **zero external signal** that a VP buyer wants this —
brainstormed from conviction plus public market research, not a coworker or
customer ask. Per the locked direction from 2026-07-14 (validate before
building) and the Concord lesson (scaffolding before a validating user exists
is how good ideas die with clean architecture), the plan produced from this
spec must open with a cheap validation step, not infrastructure work:

1. **Pressure-test the pitch.** Take the disclosed, work-level-only framing
   (status reports + deadline risk + scoped resource signal) to 1-2 real
   VP/exec-type contacts. Does that framing still sell, or do they actually
   want the individual-level version this spec explicitly cut? That answer
   determines whether a real buyer exists for *this* product, before any
   Postgres/OAuth/TEE work starts.
2. Only if (1) returns real interest: sequence the architecture pieces above,
   each as its own implementation plan (event schema generalization → hosted
   store → OAuth connectors → TEE hosting → rollup/RBAC/disclosure).

Do not invert this order.
