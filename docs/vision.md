# Kizuki — Product Vision

> Status: vision, not validated. The wedge (cross-team alignment) is gated on one
> real test at Connor's eng org. This doc is the north star, not a build order.

Related docs:

- [Product model](PRODUCT.md) for the concise builder operating model.
- [Manifesto](MANIFESTO.md) for the product belief.
- [Roadmap](ROADMAP.md) for build order.

## One line

**Keep every team acting on the same picture — and catch the misalignment that
isn't, before it costs a deadline.**

## The problem

Software gets built wrong not because people can't code, but because people are
misaligned and don't know it. Two teams assume different things about a shared
decision. A field gets quietly cut in one meeting and the team building against
it never hears. A dependency slips and the people downstream find out at the
deadline. The information to prevent all of this already exists — scattered across
Slack, Jira, Confluence, GitHub, email, and meetings — but no human holds all the
threads at once, so the conflicts stay invisible until they're expensive.

Standups and status meetings are the current fix. They're lossy, periodic, and
only surface what someone happens to raise. The misalignment that matters is the
one nobody knew to bring up.

## Who it's for

The people who sit *between* teams and carry the alignment burden: tech leads,
engineering managers, PMs, and program managers at scaling orgs — where enough
teams and dependencies exist that no one can hold the whole picture in their head,
but the org isn't big enough to have solved it with process.

## What we're building

A living model of how work actually connects: people, projects, teams, and the
decisions and dependencies between them — continuously assembled from the tools
where work already happens. On top of that model, an intelligence layer that does
the one thing status meetings can't: **detect contested decisions and cross-team
dependency conflicts, and say what to do about them** — with a draft ready to
send (the Slack message, the Confluence decision doc, the meeting to call).

It observes and advises. Humans decide and act. It never sends anything for you.

## The future state

You stop being the single point of failure for alignment. Instead of holding
forty threads in your head and hoping you catch the conflict in time, the picture
holds itself, and the conflicts surface to you early — with a concrete next move,
not just a summary. The wrong thing gets caught before it's built, not after.

## The long arc — a personal alignment Jarvis (the A-path)

> Added 2026-07-07 after a vision ideation pass. This is the north-star *shape*
> of the product, not a build order. It is contingent on the same wedge
> validation as everything else — do not scaffold ahead of it.

There are two futures for Kizuki in the AI-agent age. **A:** it stays *your*
assistant — it reads everything, tells you what's misaligned, hands you drafts,
and you decide and act. **B:** it becomes infrastructure that agents consult
autonomously (a belief protocol, attestation an agent attaches before acting,
killing downstream agent tasks when a decision is retracted) — the human recedes.
B bends the two hardest principles (observe-and-advise, never-score). **We are
building A.**

Maxed out, A is a **personal work Jarvis**: an always-on chief-of-staff that
holds your entire work picture, that you can talk to, that interrupts you at the
right moment (not a feed you remember to check), drafts the next move on command,
and — critically for the agent age — **guards you against your own agent swarm**.
You never stop being the decider; it never acts alone.

Kizuki already has three of the four Jarvis organs:

- **Memory** — the git-tracked vault (people/projects/teams + managed analysis).
- **Senses** — MCP connectors across Slack/Jira/Confluence/GitHub/Outlook +
  meeting transcripts.
- **Judgment** — the analysis/alerts layer that says what's misaligned and what
  to do about it.

The missing organ is **presence**: today Kizuki is a batch CLI (`sync`/`start`/
`stop`/`watch`) plus a read-only dashboard — three fragmented surfaces you go to.
Jarvis is one presence that comes to you: conversational (talk to it), ambient
(continuous, not per-shift), and proactive (interrupts at the right moment with
the right thing). Closing the presence gap — without breaking observe-and-advise
or turning into a surveillance/scoring tool — is the long arc of the A-path.

### The agent-age twist: epistemic armor

The misalignment that will bite *individuals* first is not team-vs-team — it is
**you vs the agents acting in your name**. As you delegate to a swarm of proxies,
they will commit you to things, drift from your intent, and contradict each other.
A personal Jarvis that models your standing positions and flags when your own
agents drift is the cleanest evolution of today's single-operator product: same
local vault, same observe-and-advise, no org-wide adoption required to be
valuable. This is where A goes that the incumbents cannot follow.

## Why this, not the obvious version

The obvious version — "AI that knows everything about your org" — is a graveyard.
Glean, Microsoft Copilot, Dust, and the in-suite assistants already own
horizontal org search, and a solo founder loses that fight. Kizuki wins by being
narrow where they're broad: they *summarize and retrieve*; they do not do the
relational, cross-team *alignment* work — detecting that two teams believe
different things about the same decision and pushing it to a resolution. That gap
is real and unclaimed.

## Why us / why now

- **Now:** the ingestion problem is finally cheap. Agents with MCP connectors can
  read across Slack/Jira/Confluence/GitHub without a year of integration work, and
  models are good enough to synthesize misalignment from messy, multi-source text.
- **Us:** the defensible moat isn't the app — it's confidentiality. This data is
  the most sensitive an org has, and the accounts that need alignment intelligence
  most (legal, healthcare, finance, exec/deal teams, anyone regulated) are exactly
  the ones *banned* from sending it to Glean or Copilot. A confidential,
  attested-compute (TEE) deployment serves the customers the incumbents
  structurally cannot. That reuses the founder's real edge (Phantom / TEE +
  attestation) and turns the privacy objection into the reason to buy.

## The shape (open-core)

- **Open-source core** — the vault + agent + MCP. Distribution and trust; anyone
  can run it locally, private by default.
- **Team** — shared, hosted alignment intelligence across teams. Per-seat.
- **Enterprise / Confidential** — TEE-hosted with attestation receipts, SSO, RBAC,
  audit. The version legal/security actually approves; the version the incumbents
  can't offer.

## What it is not

- Not another horizontal "chat with your company docs" search.
- Not a task tracker or a wiki — it reads those, it doesn't replace them.
- Not an autonomous actor — it drafts and recommends; people send and decide.
- Not a surveillance or people-rating tool — it aligns work, it does not score
  humans. (This boundary is a product principle, not a footnote.)

## The path (staged, each gate real)

1. **Validate the wedge.** At a real eng org, does ingest-based analysis catch a
   genuine cross-team misalignment or dependency conflict that standups/Jira
   missed or caught late? One real hit = signal. This is the only thing that
   matters right now; everything below is contingent on it.
2. **Sharpen for one team.** Make that one detection reliable and the drafts
   worth sending, for the teams the founder sits between.
3. **Team product.** Shared org-graph, RBAC, the multi-team version.
4. **Confidential enterprise.** TEE hosting + attestation for the accounts
   incumbents can't serve.

Do not skip to 3 or 4. The Concord lesson: scaffolding a platform before a
validating user exists is how good ideas die with clean architecture.

## North-star metric

Not usage, not summaries generated. **Caught misalignments that led to a real
action** — a decision resolved, a dependency re-planned, a doc written — that
would otherwise have surfaced late or not at all. If that number is real and
growing, the vision is working.
