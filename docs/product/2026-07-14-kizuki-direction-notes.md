# Kizuki direction notes, July 14, 2026

Status: discussion record

This file records the product decisions and new ideas discussed on July 14. It
supplements the approved [platform design](superpowers/specs/2026-07-14-kizuki-platform-design.md),
the [foundation plan](superpowers/plans/2026-07-14-kizuki-platform-foundation.md),
and the [backlog](BACKLOG.md). The approved platform design wins if these notes
conflict with it.

## Product identity

Kizuki is an agent-neutral intelligence layer over personal and organizational
data. It builds a living understanding of what is happening, notices what needs
attention, and prepares people and their chosen AI agents to respond.

Intelligence is the product. Shared memory and reasoning make it work. Evidence,
deterministic validation, permissions, and human authority keep it trustworthy.

```text
inboxes, calendars, projects, files, conversations, human input
                              |
                              v
                           Kizuki
       remembers, connects, interprets, notices, and advises
                              |
                              v
              people and authorized AI agents
```

Kizuki should answer questions that document search or generic memory cannot:

- What changed?
- What matters now?
- What conflicts with prior understanding?
- What information is missing?
- Who is affected?
- What needs a decision?
- What should an authorized agent know before helping?

Kizuki is not a full agent runtime. OpenClaw, Hermes, Claude, Codex, and other
agents can gather information, reason, and perform approved work. Kizuki gives
them shared context and records the durable result. Kizuki can run scheduled
reasoning, but it does not need to own chat, model routing, or general tool
orchestration.

The operating boundary remains:

```text
models and connected agents propose structured changes
Kizuki validates, scopes, and records them
people approve outward actions and commitments
```

Kizuki observes, interprets, and advises. It does not send a message, change a
source system, or make a commitment without a person approving that action.

## Shared memory

Different AI agents should use the same Kizuki state. A fact learned through one
agent can help another agent later without copying entire conversations between
them.

Kizuki stores distilled understanding rather than every chat or tool result. A
useful record contains the claim, source receipt, certainty, scope, time, and any
claim it supersedes or contradicts.

Capture follows risk:

- An explicit "remember this" command can write through a validated capability.
- A Pack may allow routine source-backed facts to enter automatically.
- Inferences, sensitive claims, structural changes, and visibility changes need
  preview or confirmation.
- Full chats and raw tool output stay out of memory by default.

New evidence supersedes or archives stale claims instead of erasing history.
Users can permanently delete private data and derived indexes when privacy
requires it. Conflicting evidence remains contested until deterministic policy
or an authorized person resolves it.

Named agent profiles receive scoped credentials and explicit Pack grants. New
Packs default to no agent access. Kizuki records the principal, client, Pack,
time, and action for each read or write.

## Packs

A Kizuki Pack is a portable domain-intelligence package. It teaches Kizuki what
a domain contains, what evidence matters, and what actions are safe.

```text
skill = how an AI agent behaves
MCP   = what an AI agent can do
Pack  = what Kizuki and connected agents understand about a domain
```

A Pack can define:

- Entity types and fields.
- Relationships and identity facets.
- Capture and evidence rules.
- Reasoning questions and signal definitions.
- Permissions and retention rules.
- Views, briefs, schedules, and evaluation fixtures.
- Connector mappings and safe actions.

The initial first-party Packs should cover Work and Personal. Later first-party
Packs can cover Founder, Consultant, and Team Operations use cases. Building at
least two distinct domains will test whether the Pack contract is truly generic.

One person can have Work and Personal facets under one stable identity. Pack
scope and permissions keep the evidence separate when needed.

Agents may author or edit declarative Packs. Kizuki validates the manifest,
previews the change, and requires human approval before activation. Code plugins
need an explicit manifest, isolated execution, reviewed capabilities, declared
inputs and outputs, and tests. Agents cannot silently rewrite the deterministic
kernel.

The Pack concept starts as a Kizuki feature. After two or three real Packs prove
the contract, it may become an open specification that other agent and memory
systems can use.

## Canonical storage and indexes

Local Kizuki keeps canonical events in append-only JSONL and renders
human-readable Markdown. Hosted Kizuki can use append-only PostgreSQL while
preserving lossless JSONL and Markdown export.

SQLite, embeddings, vector databases, graphs, summaries, and Markdown analysis
are rebuildable projections. They improve retrieval but never become the source
of truth.

Graphiti was identified as a possible optional sidecar for temporal graph and
entity-candidate discovery. Qdrant could provide semantic candidate search. Both
remain optional. They may propose links or aliases, but deterministic Kizuki
evidence decides whether a durable change can apply.

## Identity and auto-repositioning

Auto-repositioning helps Kizuki reorganize understanding as new evidence
arrives. It can link evidence to a better entity, change a classification, add a
hierarchy link, or merge duplicate identities.

The decisions were:

- Use balanced authority. Kizuki may apply aliases and directly evidenced
  hierarchy changes. Splits, archives, and visibility changes require
  confirmation.
- Require deterministic evidence for automatic changes. Model similarity can
  propose a candidate but cannot authorize a merge.
- Keep the operator-pinned canonical name. Without a pin, keep the oldest
  source-backed entity as canonical.
- Use a physical merge with a redirect stub, preserved history, content hashes,
  and an append-only undo event.
- Block an automatic physical merge when files do not parse cleanly or manual
  fields conflict.
- Let the calling agent reason about candidates. Kizuki validates and writes the
  result.
- Put ambiguous proposals in a dedicated, non-blocking orientation inbox.
- Use compensating events to undo a merge or repositioning.

Reasoning runs at two speeds. Capture-time work handles extraction, exact
identity evidence, linking, deduplication, and relevance. Scheduled or manual
deep work compares sources and Packs to find conflicts, risks, missing context,
and better organization.

## Web experience

The web product should become an active evidence canvas instead of a read-only
report.

A person can type a note, correction, decision, hypothesis, question, or request
in natural language. A configured one-shot reasoner converts the text into a
structured proposal. Kizuki validates the proposal and shows the exact entities,
relationships, receipts, visibility, and file or event changes before Kizuki
writes an event.

Every web write requires preview and confirmation. The web app does not become a
general agent chat or a direct editor for generated analysis and canonical
storage.

The same surface should support:

- Evidence and receipt review.
- Signal lifecycle changes.
- Orientation approvals.
- Contested-claim resolution.
- Pack and agent permission management.
- Draft preparation for an external action, with human approval before handoff.

## Runtime and deployment

One hostable service should power every edition. A versioned HTTP/JSON API and
OpenAPI definition form the durable contract. CLI, MCP, web, and SDKs call the
same API.

- Local OSS runs an always-on user service on loopback with a per-install token.
- Hosted Pro adds persistent service, managed connectors, scheduling,
  PostgreSQL, backups, and managed reasoning.
- Team adds workspaces, membership, private and shared evidence, roles, and
  multiple users and agents.
- Enterprise supports a dedicated environment, customer VPC or cloud, SSO,
  SCIM, retention, audit export, residency, and customer-managed keys.

A thin stdio MCP adapter can serve clients that need a subprocess. Hosted HTTP
MCP uses scoped authorization.

Effective access must honor every boundary:

```text
source permission
intersect workspace permission
intersect Pack grant
intersect requesting agent profile
```

Personal inbox and calendar data starts private. Kizuki can narrow source
permissions but cannot widen them. Sharing private context requires an explicit,
audited action.

Local credentials stay local. Hosted credentials use narrow OAuth grants in
encrypted storage. Enterprise customers can keep source access behind a
customer-side gateway. Early mailbox work should use delegated, read-only access
instead of organization-wide grants.

The first managed connector contracts should cover Gmail, Outlook, Google and
Microsoft calendars, and GitHub. Slack follows after the connector and
permission contracts prove stable. The current Slack alert mirror remains
dropped until work IT permits an app.

## Business model

The editions share one engine and differ through hosting, operations,
permissions, and governance.

| Edition | Offer | Working price direction |
| --- | --- | --- |
| Free OSS | Complete local product, one operator, bring your own agent and model, manual or community connectors, Packs, portable export | Free |
| Concierge beta | Dedicated instance, onboarding, three to five sources, configured Founder or Consultant Pack, weekly review, direct support | $49 to $99 per month |
| Hosted Pro | Managed sync, reasoning, connectors, backups, remote web and MCP, model allowance, premium Packs | $29 per month or $290 per year |
| Team | Shared workspace, private and shared evidence, roles, team briefs, agent and Pack grants, central billing | $25 to $40 per active user per month with a minimum |
| Enterprise | Dedicated or customer-controlled deployment, governance, security, custom connectors, support | Custom annual contract |

Later revenue may include premium Packs, paid connector Packs, marketplace
revenue share, an embedded intelligence API, OEM licensing, onboarding,
migrations, and managed self-hosting.

Do not charge per memory or ordinary retrieval. That would discourage use and
make bills hard to predict.

Development starts each commercial lane now, but shared event, API, permission,
connector, and Pack contracts land before dependent features. Each lane launches
when its end-to-end path is safe. Released features use the production contracts
instead of a separate demo architecture.

The first paid test should be a founder or consultant concierge cohort. Payment
and retention matter more than waitlist interest. Product value should be
measured through true catches, acted signals, resolved conflicts, and prevented
mistakes. Memory count, retrieval count, and token use do not prove value.

## Competitive read

The market already contains most individual pieces:

- Supermemory, Mem0, Cognee, Hindsight, Basic Memory, and Graphiti cover memory,
  retrieval, graphs, or agent context.
- Glean, Onyx, Rovo, and Dust cover enterprise search, permissions, company
  knowledge, or collaborative agents.
- Pieces and Granola cover personal activity or meeting intelligence.

Kizuki should not compete on "AI that remembers," MCP memory, connector count,
generic enterprise search, or a new agent runtime. Those categories already have
strong products.

Kizuki's opening is an intelligence-first combination:

- One portable understanding shared by different AI agents.
- Reasoning across work and everyday life.
- Selective capture instead of recording everything.
- Evidence and explicit uncertainty behind conclusions.
- Agent-authored Packs with a stable deterministic core.
- Personal context that can become team context through explicit permission.
- Quiet notices about changes and needs instead of another activity feed.

## Choices superseded during the discussion

Several ideas were useful but did not survive the approved platform design:

- Evidence or trust as the primary identity. Evidence is a guardrail;
  intelligence and sensemaking are the product.
- Kizuki as a full autonomous agent runtime. It remains agent-neutral and can
  use configured reasoners.
- A fully schema-less, self-modifying system. Declarative Packs provide
  flexibility while the kernel enforces evidence, permission, history, and
  migration rules.
- A required vector or graph database. Derived indexes stay optional and
  rebuildable.
- Hosted-only SaaS. Local, managed, team, and dedicated deployments share one
  service contract.
- A big-bang launch. Workstreams move in parallel and release safe end-to-end
  paths continuously.
- A permanently read-only dashboard. The approved web direction supports
  audited, previewed input.
- MCP-only v2 and a clean v2 vault with no migration path. The approved design
  uses one HTTP API with CLI, MCP, and web clients, then migrates through current
  seams and compatible event adapters.

## Work completed today

The following work reached `main`:

- Approved platform design: `88fac82`.
- Platform foundation plan: `83261b7`.
- Canonical capture-event contract: `89ba69c`.
- Locked append-only local event store: `52f7302`.
- Secure loopback daemon configuration and secret handling: `0ccd8d7`.
- Authenticated local HTTP API and OpenAPI contract: `8cd8ebb`.
- Local daemon lifecycle: `60632a0`.
- CLI API client plus daemon and capture commands: `3a77c5b`.
- Backlog update recording open foundation work: `825c47e`.

The CLI slice reported 444 passing tests on `main`.

Remaining foundation work:

1. Add the MCP capture adapter.
2. Build the writable web evidence canvas.
3. Wire init and doctor behavior, then update usage docs.
4. Run the end-to-end local proof and completion gate.

The broader product still needs Pack contracts, hosted storage, permissions,
connectors, scheduled reasoning, commercial provisioning, and enterprise
deployment work. Those belong to the parallel platform program, not the current
foundation completion gate.
