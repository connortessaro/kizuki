# Kizuki Org tier — pitch one-pager (VP/exec validation)

Status: draft, unvalidated — for pressure-test conversations only. Source:
`docs/superpowers/specs/2026-07-16-kizuki-org-tier-design.md`.

Kizuki isn't a dashboard — it's a soul: a living, evidenced model of how the
org actually works, built from the same person/project/team graph the
personal product already builds one relationship at a time, now at
organizational scale.

## What it does

- **Frictionless status reports.** Cross-team project/team status rollup,
  generated on demand instead of waiting for weekly manual updates.
- **Predictive deadline risk.** Flags which major deadlines are falling
  behind, from project/repo-level commit frequency and project/team-level
  communication-pattern signals (thread-stall time, response latency).
  Individual response-pattern data is never surfaced or stored disaggregated.
- **Resource signal — team-level, not individual.** Team-level workload
  distribution and team-level skill-gap coverage: "this team is over
  capacity," "this team lacks senior coverage in X." Supports "where do I add
  headcount" and "where's the skill gap." Does **not** support "reallocate
  this specific person" — no per-person workload number is ever computed or
  exposed.

## The moat

The moat is confidentiality, not features: almost no competitor can tell a
regulated enterprise "your data never leaves a confidential enclave, here is
the attestation receipt" — that, not the UI, is the durable edge. This isn't
"better than Glean/Copilot" — it's the only credible answer for an org whose
data is too sensitive to hand to a horizontal AI assistant at all. It's sold
like enterprise software, not signed up for like SaaS: admin-led deployment,
customized ingestion, a real sales relationship. The market is every
organization large enough that no one person holds the whole picture, and
sensitive enough it can't hand that picture to a horizontal AI vendor — sized
against regulated-industry enterprise software spend.

## What it will never do

It will never produce a score, rating, or ranking of a named individual. That
boundary is enforced at the schema level, not left as a policy convention —
there is no per-person number to soften or walk back later.
