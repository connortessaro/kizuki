# Kizuki platform design

Date: 2026-07-14
Status: approved direction, pending written-spec review

## Purpose

Kizuki will give people and their AI agents one durable place to remember,
interpret, and retrieve personal or organizational context. It will connect the
sources where life and work happen, reason across them, and surface what needs
attention with the evidence that supports each conclusion.

Kizuki remains an observe-and-advise product. It may prepare a draft or suggest
an action, but a person decides whether to act. Kizuki will not send messages,
change source systems, or make commitments on a person's behalf.

This design covers one platform that supports the local open source product,
hosted personal accounts, shared workspaces, and enterprise deployments. Each
edition uses the same contracts and deterministic kernel.

## Product identity

Kizuki is an intelligence layer over personal and organizational data. It is
not an agent runtime, a generic vector-memory API, a meeting notetaker, or a
replacement for a source system.

Connected agents use Kizuki as shared memory. Kizuki gives them the same
evidence, identity history, certainty state, permissions, and prior conclusions.
Kizuki also schedules reasoning jobs that compare new activity with what the
system already knows. Users can get value from the web and CLI without adopting
a specific agent.

The product has five distinguishing properties:

- Evidence receipts support every established claim and signal.
- Reasoning connects context across sources instead of returning search results
  alone.
- Packs adapt the system to different kinds of work and everyday life.
- Local and hosted editions share one portable data contract.
- Permissions follow source ownership and remain visible in derived results.

## Responsibility boundary

```text
connectors and people capture source material
models interpret it and propose structured changes
Kizuki validates, stores, and retrieves durable state
people approve every outward action
```

An AI model returns one fenced JSON proposal. Deterministic Kizuki code validates
the proposal before it changes durable state. Models never write canonical files
or database rows directly.

External clients use explicit capability commands. They can ingest evidence,
capture an insight, propose a claim or signal, update permitted Kizuki state, or
configure a granted Pack. Kizuki does not expose generic file or database CRUD.

## System architecture

```text
source APIs, imports, web input, MCP input
                    |
                    v
       connector receipts and capture events
                    |
                    v
   identity, workspace, visibility, and Pack resolution
                    |
                    v
       scheduled or requested reasoning jobs
                    |
                    v
             fenced JSON proposals
                    |
                    v
          deterministic validation kernel
                    |
                    v
              append-only event store
                    |
                    v
     Markdown, search, vector, graph, and UI views
                    |
                    v
             people and connected agents
```

The deterministic kernel remains in the zero-dependency root and `lib/`
packages. A separate service package owns HTTP, scheduling, hosted storage,
authentication, and other runtime dependencies. The existing `mcp/` and `web/`
packages stay isolated from the kernel.

## One engine across deployments

The service contract stays the same in every edition.

### Local

Kizuki runs as an always-on user service. `kizuki daemon install` configures
`launchd` on macOS and `systemd --user` on Linux. The CLI also provides status,
restart, logs, upgrade, and uninstall commands. Windows service support can use
the same lifecycle interface when the project adds a Windows implementation.

The local service binds to `127.0.0.1` and requires a per-install token. It does
not bind to the LAN. A user who needs remote access can choose hosted Kizuki or
configure a secure tunnel outside the default install.

### Hosted Pro and Team

Hosted editions run the same service as a persistent deployment. They add a
multi-tenant control plane, PostgreSQL, managed connector workers, encrypted
credential storage, backups, billing, and managed model allowances.

### Enterprise

Enterprise customers can use a dedicated Kizuki environment, deploy Kizuki in
their cloud, or keep source access behind a customer-side gateway. Enterprise
features include SSO and SCIM, retention policies, audit exports, data residency,
customer-managed keys, service commitments, and custom connectors.

## API contract

A versioned HTTP/JSON API is the canonical integration contract. OpenAPI
describes request bodies, responses, errors, capabilities, and version support.
The CLI, web app, SDKs, and MCP servers call this API instead of implementing
their own storage behavior.

The first API version supports:

- Evidence and insight capture.
- Entity, claim, signal, and receipt retrieval.
- Search and scoped context assembly.
- Explicit signal and insight lifecycle commands.
- Human corrections and conflict resolution.
- Pack installation, configuration, and grants.
- Connector state and health.
- Reasoning-job requests and status.
- Server-sent events for local or web updates.
- Webhooks for permitted hosted integrations.

Local clients authenticate with the install token. Hosted users authenticate
through user sessions, scoped personal tokens, or scoped service identities.
Workspace and Pack grants constrain each command after authentication.

## Canonical events and storage

One versioned event contract supports both storage adapters. Every event records
the workspace, principal, source owner, visibility, Pack scope, source receipts,
timestamp, schema version, and idempotency key.

Local Kizuki stores canonical events in JSONL. It renders the familiar Markdown
vault for people, version control, and portable inspection. Content outside
managed analysis markers remains operator-owned. When a person edits that
content, the local service captures the edit as a human-authored event before it
updates managed projections. Kizuki never rewrites text outside the managed
markers.

Hosted Kizuki stores canonical events in append-only PostgreSQL tables. It can
export lossless JSONL plus Markdown views. A user can move between local and
hosted editions without losing identity history, receipts, visibility, Pack
state, or lifecycle events.

Search indexes, embeddings, graph edges, summaries, and Markdown analysis are
derived views. Kizuki can rebuild them from canonical events. A vector database
may improve semantic retrieval, but it will not become a source of truth.

Commands include an expected version where concurrent updates can conflict.
Kizuki rejects stale commands with a structured conflict response. Clients then
read current state and retry deliberately. Kizuki does not use silent
last-write-wins behavior.

## Identity and auto-repositioning

Kizuki maintains stable IDs for people, projects, teams, sources, and other Pack
entities. Source-specific IDs, aliases, and prior names attach to those stable
IDs.

Auto-repositioning improves organization without moving or deleting receipts.
It changes the entity links and projections that place evidence in context.
Kizuki may:

- Link evidence to a better person, project, team, or Pack facet.
- Reclassify an item when later context changes its meaning.
- Merge duplicate identities and leave redirects from old IDs.
- Undo a merge or repositioning through compensating events.

Kizuki applies an automatic merge only when deterministic evidence establishes
identity, such as an authoritative source ID or an exact verified alias. Model
suggestions and weaker matches go to an ambiguity inbox. Visibility changes and
destructive-looking moves require confirmation.

## Reasoning

Kizuki runs two classes of reasoning work:

- Capture-time work extracts candidate entities, topics, links, and receipts.
- Deep work compares evidence across time, sources, and Packs to produce claims,
  contradictions, signals, questions, briefs, and suggested next moves.

The always-on service schedules deep work and also accepts manual requests. Local
users bring a supported CLI model or OpenAI-compatible endpoint. Hosted Pro
includes a managed allowance and can support customer-provided credentials. Team
admins select approved providers and budgets. Enterprise deployments can use a
managed provider, a customer cloud endpoint, or a customer-hosted model.

Reasoning jobs produce proposals. The deterministic kernel checks schema,
permissions, provenance, lifecycle transitions, and Pack rules before appending
events. Failed checks return structured errors and leave canonical state
unchanged.

## Human input and disagreements

The web app gives each entity, project, team, and day an evidence canvas. A user
can type a note, correction, decision, hypothesis, or question. The user can add
receipts, choose permitted visibility, and link the entry to an entity or Pack.
Submitting the entry creates a provenance-tagged event, so later reasoning uses
it.

Generated analysis and source receipts remain protected from direct edits. A
human correction supersedes a generated conclusion, while the old conclusion
and its receipts remain in history. New external evidence can reopen the topic.

When authorized people disagree, Kizuki stores each position and marks the topic
contested. It explains the conflict without selecting a winner. Personal claims
use the source owner as resolver. Shared Packs or projects assign scoped resolver
roles. Workspace admins assign those roles but do not gain truth authority by
default. Every resolution records the resolver, note, and supporting receipts.

## Visibility and credential custody

Personal inbox and calendar data starts private. Workspace sources retain the
source system's access rules. Kizuki may narrow access but cannot widen it.
Derived claims inherit the strictest visibility among their supporting receipts.
Users promote private context to a workspace through an explicit, audited
command.

Local connector credentials remain on the local machine. Hosted Kizuki stores
narrow OAuth grants in encrypted credential storage and separates credential
access from application queries. Enterprise customers can keep credentials and
source access in their network through the gateway.

Workspace administrators manage connector configuration, membership, policies,
and resolver assignments. They do not receive automatic access to private source
content. Enterprise compliance access requires an explicit role and audit trail
that also respects source policy.

## Packs

A Pack is a portable domain-intelligence package. It adapts Kizuki without
creating another Kizuki runtime or agent.

A declarative Pack can define entity fields, capture rules, connector mappings,
reasoning questions, signal definitions, permissions, views, briefs, retention
requirements, schedules, and evaluation fixtures. Starter Packs cover Work,
Personal, Founder, Consultant, and Team Operations use cases.

One identity can have facets from several Packs. The Work and Personal Packs,
for example, can describe the same person while keeping evidence and visibility
separate.

Declarative Packs are the default extension format. A Pack that needs code uses
an explicit plugin manifest, declared inputs and outputs, isolated execution,
and reviewed capabilities. Community Packs work with local Kizuki. Hosted plans
can offer managed and premium Packs. A later marketplace can pay third-party
authors without changing the core event contract.

## Web experience

The web app becomes an API client and stops reading the vault or hosted database
directly. It includes:

- Evidence canvas and scoped Kizuki query.
- Entity, project, team, and Pack views.
- Receipt-backed claims and timelines.
- Signal, ambiguity, and contested-topic inboxes.
- Connector and reasoning-job health.
- Draft preview and human approval controls.
- Workspace, agent, Pack, and visibility administration when permitted.

The web app may prepare text for an external action. It can copy or hand the
draft to the user's chosen tool after confirmation, but Kizuki does not send it.

## Connector contract

Each connector implements incremental checkpoints, source receipts, identity
mapping, deletion handling, permission mapping, health reporting, and bounded
retry behavior. First-party hosted connectors will target Gmail, Outlook, Google
Calendar, Microsoft Calendar, and GitHub. Slack follows after those contracts
prove stable.

Kizuki also accepts MCP capture, HTTP imports, webhooks, file imports, and
Pack-defined connector mappings. The connector contract prevents each source
from inventing different provenance or deletion semantics.

## Product editions and revenue

### Free local

The open source edition is a complete single-operator product. It includes the
local vault, daemon, CLI, MCP, web app, bring-your-own reasoning, manual sync,
community Packs, and portable export.

### Concierge beta

The first paid service offers a dedicated Kizuki deployment, personal onboarding,
three to five connected sources, a configured Founder or Consultant Pack, weekly
reasoning review, and direct support. The expected beta price is $49 to $99 per
month. This service tests whether Kizuki produces useful catches and supports
the connector work required for self-service hosting.

### Hosted Pro

Hosted Pro adds managed sync, connectors, scheduling, model allowance, backups,
remote web and MCP access, and premium Packs. The target self-service price is
$29 per month or $290 per year.

### Team

Team plans add shared workspaces, private and shared context, several connected
inboxes, role-based access, team briefs, agent and Pack permissions, audit
history, and central billing. The target range is $25 to $40 per active user per
month with a minimum workspace charge.

### Enterprise

Enterprise contracts sell deployment, security, governance, integration, and
support. Pricing is annual and custom.

Later revenue can come from premium Packs, connector Packs, marketplace revenue
share, an embedded intelligence API, OEM licensing, onboarding, migrations, and
managed self-hosting support. These products reuse the same contracts instead of
forking the platform.

## Parallel delivery model

The project will develop each commercial path at the same time without treating
them as separate products. A small foundation stream defines the shared event,
API, permission, connector, and Pack contracts. Other streams build against
contract fixtures as soon as those interfaces stabilize:

1. Deterministic kernel and storage adapters.
2. Local daemon, CLI, MCP, and migration compatibility.
3. Hosted control plane, PostgreSQL, authentication, billing, and backups.
4. Connector workers, OAuth custody, and enterprise gateway.
5. Web evidence canvas, Packs, team permissions, and admin flows.
6. Concierge operations, Pro packaging, and enterprise deployment assets.

Each stream releases usable slices continuously. The project will not wait for a
single large launch, and it will not maintain a demo-only implementation that
uses different contracts from the product.

Product validation still governs investment. Kizuki will measure true catches,
acted signals, resolved conflicts, and prevented mistakes. Memory count, search
volume, and token use do not establish product value.

## Failure handling

- Connector sync records its checkpoint only after canonical events commit.
- Repeated delivery uses idempotency keys and cannot duplicate canonical events.
- Permission or visibility uncertainty rejects a write instead of broadening
  access.
- Model timeouts, invalid JSON, and failed validation leave state unchanged and
  produce visible job errors.
- Projection failures preserve canonical events and retry the projection.
- Local daemon crashes preserve the event log and use the OS service manager for
  restart.
- Imports validate the full batch before commit and report the failing event.
- Lock or concurrency timeouts fail loudly.

## Testing

Implementation follows TDD. Contract tests run against the JSONL and PostgreSQL
adapters. The suite covers:

- Event versioning, validation, idempotency, and replay.
- Visibility inheritance and tenant isolation.
- Capability grants and denied commands.
- Connector checkpoints, deletion, and retry fixtures.
- Identity merge, redirect, ambiguity, repositioning, and undo.
- Human correction, contested claims, and resolution.
- JSONL and Markdown export/import parity.
- Projection rebuilds and failure recovery.
- Daemon install, health, restart, and uninstall seams.
- API and MCP compatibility.
- Web behavior on desktop and mobile, including console errors and permission
  boundaries.

`npm test` remains the repository-wide completion check. Subpackages can add
their own focused checks without moving dependencies into the zero-dependency
kernel.

## Relationship to current docs and code

This design preserves the existing payload boundary, append-only signal,
insight, and catch ledgers, write lock, path guards, managed Markdown sections,
and observe-and-advise rule.

It supersedes these earlier assumptions where they conflict:

- The dashboard remains read-only and talks directly to the vault.
- Kizuki should not add a service runtime.
- Source credentials always belong to the calling agent.
- Team, hosted, and enterprise work waits until after the local roadmap.
- The product uses one implicit single-operator workspace internally.

Migration should use existing seams instead of rewriting shipped behavior at
once. The service can wrap current `lib/` commands first. The local JSONL adapter
can incorporate existing ledgers, and the web app can move one read surface at a
time from `web/lib/data.mjs` to the API.

## Acceptance criteria

The platform direction is implemented when:

- One versioned event contract runs against local JSONL and hosted PostgreSQL.
- The local OS service exposes an authenticated loopback API.
- CLI, MCP, and web use the same API for migrated capabilities.
- Packs and principals receive explicit capability and visibility grants.
- Human web input changes durable state through audited commands.
- Local and hosted exports round-trip without losing receipts or permissions.
- A hosted user can connect sources and receive scheduled reasoning without a
  laptop running.
- A team can combine private and shared evidence without widening source access.
- An enterprise customer can choose a dedicated or customer-controlled
  deployment.
- No Kizuki path sends an outward action without human approval.

## Non-goals

- Building a general-purpose agent runtime.
- Replacing email, chat, calendars, project trackers, or source repositories.
- Passively storing full agent conversations.
- Scoring employee performance or enabling hidden surveillance.
- Letting models write canonical storage directly.
- Making a vector database or generated summary authoritative.
- Charging per memory or ordinary retrieval operation.
