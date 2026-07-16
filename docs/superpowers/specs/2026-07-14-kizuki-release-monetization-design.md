# Kizuki release + monetization design

> **Superseded July 16, 2026:** closed-source pivot — Kizuki is not being open-sourced and the OSS/Show HN launch is cancelled. Kept as a historical record.

Date: 2026-07-14 (rev 2, reconciled with
[`docs/2026-07-14-kizuki-direction-notes.md`](../../2026-07-14-kizuki-direction-notes.md)).
Status: approved by operator (Connor).

## Decision record

Operator decision on 2026-07-14: pursue public release and revenue now. The
v1–v4 evidence gates in `docs/ROADMAP.md` no longer block release work; gate
instrumentation (`kizuki catch` / `kizuki gate`) keeps collecting evidence as
the value metric ("true catches, acted signals, resolved conflicts"), per the
direction notes.

Where this spec and the direction notes conflict, the notes and the approved
platform design (`docs/superpowers/specs/2026-07-14-kizuki-platform-design.md`)
win. Rev 2 superseded the rev 1 choices of enterprise-pilots-first revenue,
a three-rung pricing sketch, a data-normalization "pack," and a single big-bang
launch week.

## Positioning

**Kizuki is an agent-neutral intelligence layer over personal and
organizational data: it understands what a business, a team, and a person
need — what changed, what matters now, what conflicts, what's missing, what
needs a decision — before anyone asks.**

- Category contrast: memory/recall products (Supermemory, Mem0, Cognee,
  Gheist, WorkDaemon, Cerenovus) and enterprise search (Glean, Onyx, Rovo,
  Dust) already exist. Kizuki does not compete on "AI that remembers," MCP
  memory, or connector count. It sells *understanding of needs and gaps* —
  intelligence-first, per the notes' competitive read.
- Buyer psychology (team/enterprise lanes): leadership omniscience — walk into
  any meeting knowing what every team is stuck on. External copy is always
  alignment/clarity framing, never monitoring language.
- Privacy is the trust layer, not the headline. ZDR inference is commodity;
  the structural story is that the corpus never has to live in our cloud:
  local-first OSS, customer-VPC enterprise, TEE-hosted option when managed
  hosting is demanded. Stated as "we don't want your data."

## Business model (from direction notes — canonical)

| Edition | Offer | Price direction |
|---|---|---|
| Free OSS | Complete local product, one operator, BYO agent/model, Packs, portable export | Free |
| Concierge beta | Dedicated instance, onboarding, 3–5 sources, configured Founder or Consultant Pack, weekly review, direct support | $49–99/mo |
| Hosted Pro | Managed sync, reasoning, connectors, backups, remote web + MCP, model allowance, premium Packs | $29/mo or $290/yr |
| Team | Shared workspace, private+shared evidence, roles, team briefs, agent and Pack grants | $25–40/active user/mo, with minimum |
| Enterprise | Dedicated or customer-controlled deployment, governance, SSO/SCIM, audit, residency | Custom annual |

**First paid test: a founder/consultant concierge cohort.** Payment and
retention over waitlist interest. Never charge per memory or per retrieval.
Enterprise design-partner conversations may run opportunistically but do not
gate or lead the revenue plan.

## Launch shape — lanes, not big bang

Each lane ships when its end-to-end path is safe (direction notes supersede a
single launch week). Sequencing:

### Lane 1 — OSS public release (first out)

Gated on platform-foundation completion (T7 MCP capture adapter, T8 web
evidence canvas, T9 init/doctor wiring + docs, T10 end-to-end local proof —
`docs/superpowers/plans/2026-07-14-kizuki-platform-foundation.md`).

1. **Git-history audit (hard blocker), resolved by fresh-cut:** publish a new
   public repo with a clean "initial public release" history. The private repo
   (190 commits, real work data adjacent) stays archived; the public repo
   becomes canonical. Audit the published tree for secrets/work data before
   push.
2. **LICENSE: Apache-2.0**; license field in `package.json`.
3. **One npm package `kizuki`** — core `lib/` stays import-clean (zero-dep as
   a code convention); the package ships the MCP SDK + zod; bin gains
   `kizuki mcp`. CLAUDE.md/AGENTS.md convention line amended.
4. **MCP-first distribution, HTTP-API-first architecture.** Headline install
   is `claude mcp add kizuki -- npx -y kizuki mcp` (plus Cursor/Codex
   snippets); MCP remains a thin adapter over the local service per the
   platform design. Submit to MCP registries/directories.
5. **Show HN + X post** when the lane is live; framed on the intelligence
   layer ("give your agent understanding of your org"), not on memory.
6. **Landing (kizuki.dev):** intelligence-layer headline; five editions with
   Concierge beta as the active paid CTA ("join the founding cohort"); Hosted
   Pro/Team remain waitlist; Enterprise = contact. Security section: local-
   first / your-infra / TEE-optional.

### Lane 2 — Concierge beta (first revenue)

- Offer per notes: dedicated instance, onboarding, 3–5 sources, configured
  Founder or Consultant Pack, weekly review call, direct support, $49–99/mo.
- Target: founders/consultants from operator network + OSS funnel. Outreach
  list is a founder task; materials (one-pager, outreach drafts, onboarding
  checklist, pilot terms) are agent-draftable.
- Cohort size: 3–5. Success = payment + retention + recorded true catches.
- Runs on the platform contracts (daemon, HTTP API, capture) — no separate
  demo architecture.

### Lane 3+ — Hosted Pro, Team, Enterprise

Sequenced by the platform program (hosted storage, permissions, connectors,
scheduled reasoning, provisioning). Not specced here.

## Packs (scope for release)

Packs are portable domain-intelligence packages (entity types, capture and
evidence rules, reasoning questions, signal definitions, permissions, views,
connector mappings) — see direction notes. Not a data-export format.

- Release scope: **Pack contract draft + first-party Work Pack** configured for
  the concierge cohort (Founder/Consultant variants as configuration of Work
  before becoming separate Packs). Personal Pack follows to prove the contract
  is generic.
- Agent-authored Packs, marketplace, and the open specification stay roadmap.

## Connectors (priority from notes)

Gmail, Outlook, Google/Microsoft calendars, GitHub first — delegated,
read-only mailbox access. **Slack follows later**, after connector and
permission contracts prove stable. Meeting transcripts remain native.

## Guardrails (non-negotiable, all lanes)

- Work-state intelligence, not employee surveillance: no productivity scoring,
  no activity metrics, no punitive analytics, no covert deployment.
- RBAC / Pack grants / source-permission intersection per the platform design.
- Observe-and-advise invariant: Kizuki proposes, deterministic code validates,
  humans approve outward actions.
- EU works-council / consent review before any EU team deployment.

## Risks (accepted by operator unless noted)

- **Employer IP:** kizuki is dogfooded at the operator's workplace. Check the
  employment IP-assignment clause before taking revenue. *Open — founder.*
- **Funded competitors** across memory, search, and company-brain categories;
  counter is the intelligence-first combination, agent-neutrality, and the
  your-infra story — not feature count.
- **Solo operator, no SOC 2:** concierge cohort sold as founding-partner
  arrangement; enterprise deferred until governance work exists.
- **Gate evidence no longer blocks release.** Catches remain the value metric
  but not a launch gate. Accepted.

## Success criteria

- Lane 1: public repo + npm + MCP registries + HN/X live, with T10 end-to-end
  proof passed first; ≥1 external user completes install + first value without
  hand-holding.
- Lane 2: 3–5 concierge members paying within 45 days of Lane 1; ≥60%
  retained at day 60; true catches recorded for each member.
- Zero work-data leakage at any step.

## Non-goals

- Autonomous action-taking; general agent runtime; chat ownership.
- Vanilla-cloud hosted tier without the trust story.
- Slack connector before contract stability; connector sprawl ahead of demand.
- Charging per memory/retrieval; charging the Hosted Pro waitlist.
- Big-bang launch coupling all lanes.
