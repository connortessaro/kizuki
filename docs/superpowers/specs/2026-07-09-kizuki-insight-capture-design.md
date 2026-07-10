# Kizuki insight capture

Date: 2026-07-09
Status: approved design, written review pending

## Goal

Let a person preserve useful context from an active Codex or Cursor conversation
by saying "Kizuki this." The calling agent distills the relevant thought and
passes structured data to Kizuki through MCP. Kizuki validates and stores the
capture without reading or retaining the full conversation.

Captured insights become searchable context immediately. They do not rewrite
entity files during capture. Kizuki keeps decisions and learnings distinct from
unverified hypotheses and open questions so later syncs and checks do not turn
brainstorming into fact.

Kizuki remains observe-and-advise only. The agent proposes a structured capture;
deterministic JavaScript validates identity, takes the vault lock, and writes
state.

## Approaches considered

### Dedicated insight inbox

Add a gitignored append-only insight ledger, a focused MCP capture tool, read
tools, and matching local CLI controls. Sync, check, and search can consume
active insights while preserving their kind.

This is the selected approach. It gives captured thoughts provenance and a
lifecycle without mixing them into entity truth at write time.

### Reuse `upsert_analysis`

The calling agent could summarize the conversation and write directly to an
entity log. This is smaller, but it asks the chat agent to decide what counts as
durable project truth. It also lacks insight identity, provenance, uncertainty,
and archival controls.

### Read chat sessions automatically

Kizuki could scan Codex or Cursor session logs. This adds passive surveillance,
partial-session parsing, client-specific formats, tool noise, and a risk that a
Kizuki sync ingests itself. Automatic session access is outside this design.

## Capture contract

The MCP tool is named `capture_insight`. Its description tells compatible
agents to call it when the user says "Kizuki this" or directly asks to save the
current thought in Kizuki.

Input:

```json
{
  "kind": "hypothesis",
  "summary": "STAFF may need per-FC manifests instead of one global pointer.",
  "context": "This came from reasoning about the backend bundle contract.",
  "entities": [
    { "type": "project", "name": "staff" }
  ],
  "origin": {
    "client": "codex",
    "locator": "optional stable thread or turn identifier"
  }
}
```

`kind` is one of:

- `decision`: a record of the user's stated intent or choice.
- `learning`: context the user wants available later.
- `hypothesis`: an explanation or claim that still needs evidence.
- `question`: an unresolved point worth revisiting.

`summary` is required, trimmed, and limited to 500 characters. It should stand
on its own. `context` is optional and limited to 4,000 characters. The caller
must distill the conversation instead of copying a full transcript.

`entities` is optional and contains at most five unique references. Entity types
remain `person`, `project`, and `team`; names use the existing path-safe
validation. Duplicate references fail validation. An empty list creates an
unscoped inbox item.

`origin.client` is `codex`, `cursor`, or `other`. `origin.locator` is optional.
When present, it identifies the originating thread or turn and follows the same
credential and signed-parameter safety rules as signal receipt locators. Kizuki
does not infer the client or gain access to the caller's conversation through
MCP.

The tool returns the insight ID, kind, and current status. Mutation output does
not repeat the summary or context.

## Stable identity

Kizuki normalizes trimmed text and sorts entity references before computing:

```text
dedupeKey = JSON.stringify([
  kind,
  summary,
  context || "",
  sortedEntities,
  origin.client,
  origin.locator || null
])

insightId = "ins_" + first 12 hex chars of SHA-256(dedupeKey)
```

An exact retry returns the existing active or archived insight without adding
an event. A changed kind, wording, entity set, client, or locator creates a new
insight. The reducer rejects a hash collision when one ID maps to another
dedupe key.

## Event ledger

Kizuki stores sensitive insight events in gitignored
`insights/events.jsonl`.

Capture event:

```json
{
  "version": 1,
  "event": "captured",
  "insightId": "ins_ab12cd34ef56",
  "dedupeKey": "[...]",
  "at": "2026-07-09T20:00:00Z",
  "insight": {
    "kind": "hypothesis",
    "summary": "STAFF may need per-FC manifests instead of one global pointer.",
    "context": "This came from reasoning about the backend bundle contract.",
    "entities": [{ "type": "project", "name": "staff" }],
    "origin": { "client": "codex", "locator": null }
  }
}
```

Archive event:

```json
{
  "version": 1,
  "event": "insight_archived",
  "insightId": "ins_ab12cd34ef56",
  "from": "active",
  "to": "archived",
  "at": "2026-07-09T21:00:00Z",
  "actor": "user",
  "note": null
}
```

Statuses are `active` and `archived`. Archiving is terminal in this slice.
Repeated archive attempts and transitions from an unknown ID fail. Exact
recapture of an archived item remains archived; the user must capture changed
content to create a new insight.

`lib/insights.mjs` owns these boundaries:

- `readInsightEvents(vaultDir)` reads and validates every JSONL line, reporting
  malformed data with its file and line number.
- `reduceInsightEvents(events)` returns current states and rejects unknown IDs,
  invalid ordering, mismatched transitions, invalid enums, and collisions.
- `planInsightCapture(events, input, { now })` validates and returns either one
  capture event or an exact-retry disposition.
- `planInsightArchive(events, transition, { now })` validates and returns one
  archive event.
- `writeInsightEventsAtomic(vaultDir, events)` writes the complete immutable
  sequence through a sibling temporary file and atomic rename.

All insight mutations run under `state/vault.lock`. Read-only commands rely on
atomic rename for a consistent snapshot. The writer rejects removal or rewrite
of existing events.

## MCP interface

The existing Kizuki MCP server keeps its current tools and adds:

```text
capture_insight
list_insights
read_insight
archive_insight
```

`capture_insight` accepts the capture contract above. `list_insights` defaults
to active items and supports `active`, `archived`, or `all`. It returns newest
first. `read_insight` returns the reduced state plus event history.
`archive_insight` accepts an ID and optional note.
Archive notes are limited to 500 characters.

The MCP schemas reject unknown fields. Mutation responses name the ID and
transition without dumping captured text. Read tools return captured content
because the caller explicitly requested it.

## CLI interface

```text
kizuki insights
kizuki insights --status active|archived|all
kizuki insights --json
kizuki insight show <id> [--json]
kizuki insight archive <id> [--note <text>]
```

The default list shows active insights newest first. Human output includes ID,
kind, summary, entity references, origin client, and capture time. JSON output
returns the reduced states. `show --json` also includes event history.

Invalid syntax, unknown IDs, repeated archive attempts, and invalid statuses
fail loudly.

## Search, sync, and check

Kizuki's local and MCP search includes active insight summaries and context.
Archived insights stay available through `show` and explicit archived or all
listing, but ordinary search excludes them.

Before spawning the configured agent, sync reads a consistent snapshot of
active insights:

- An all-scope sync includes every active insight.
- A person, project, or team sync includes insights with a matching entity
  reference.
- Unscoped insights appear in all-scope syncs and direct insight queries.

The prompt labels the context as user-captured. Decisions record the user's
intent. Learnings provide context. Hypotheses and questions remain unverified
and must not be stated as established facts.

Captured insights can inform entity analysis and raw log entries. They cannot
support a new signal receipt by themselves, and this design does not add an
`insight` signal receipt source. A signal still needs evidence from Slack,
GitHub, Atlassian, Outlook, or a transcript.

Payload version 3 remains unchanged. When sync records an insight in an entity
log, the raw entry uses source `insight`, the capture timestamp, and text that
names the insight ID and kind. Hypotheses and questions stay labeled in that
text. Sync does not mark or archive an insight after using it.

`kizuki check` includes active insights that match its explicit scope. An
all-scope check includes all active insights. The check prompt follows the same
kind rules and identifies conflicts with a hypothesis as an evidence gap rather
than a factual contradiction.

Capture itself does not run sync, rewrite entity files, notify, or create a
signal.

## Setup and documentation

- Add `/insights/` to `.gitignore`.
- `kizuki init` creates `insights/`.
- Doctor verifies `insights/`.
- Document the phrase, capture contract, MCP tools, CLI commands, status
  meanings, scope behavior, and privacy boundary.
- Keep `AGENTS.md` and `CLAUDE.md` synchronized where shared invariants change.
- Do not add fixed total-test counts.

The repo does not install or modify global Codex or Cursor instructions in this
slice. Tool descriptions carry the "Kizuki this" behavior for clients that
already load the Kizuki MCP server.

## Error handling

- Malformed insight JSONL throws with the file and line number.
- Invalid capture inputs fail before the lock or filesystem mutation.
- Lock acquisition uses the existing timeout and stale-lock behavior.
- Atomic write failure leaves the previous ledger intact.
- Search, sync, and check fail rather than silently dropping a malformed
  insight ledger.
- Missing `insights/events.jsonl` means an empty inbox.

## Test plan

Tests cover:

- Stable ID and exact retry behavior.
- Different kinds, wording, entities, clients, and locators produce different
  IDs.
- Text limits, path-safe entities, duplicate references, and locator safety.
- Reducer rejection of malformed JSONL, bad ordering, bad enums, unknown IDs,
  transition mismatch, and collisions.
- Atomic writer prefix protection and prior-ledger preservation on failure.
- Lock use for capture and archive.
- Active and archived CLI listing, sort order, JSON, show history, invalid
  syntax, and unknown IDs.
- MCP validation, capture, listing, reading, archive, exact retry, and safe
  mutation output.
- Search includes active insights and excludes archived insights.
- Sync scope selection and epistemic prompt rules.
- Check context and evidence-gap handling for hypotheses.
- Capture performs no entity, signal, alert, transcript, or notification write.
- Init and doctor include `insights/`.
- Existing sync, signal, entity, and MCP behavior remains green.

## Constraints and non-goals

- Root and `lib/` remain ESM `.mjs`, Node built-ins only, with zero runtime
  dependencies.
- The MCP package keeps its existing isolated dependencies.
- Use failing tests before implementation and keep `npm test` green.
- Preserve the main checkout's existing `transcripts/.gitkeep` deletion.
- Do not read Codex or Cursor session files automatically.
- Do not store full conversations or raw tool output.
- Do not add passive capture, session-end hooks, notifications, dashboard
  controls, insight restoration, semantic clustering, or automatic archival.
- Do not change signal lifecycle or add insight-only signals.

## Verification

```bash
node --test lib/insights.test.mjs
node --test lib/insightCommands.test.mjs lib/query.test.mjs lib/check.test.mjs
node --test lib/prompt.test.mjs lib/run.test.mjs lib/init.test.mjs lib/doctor.test.mjs
cd mcp && npm test
npm test
cd web && npm run typecheck
git diff --check
```
