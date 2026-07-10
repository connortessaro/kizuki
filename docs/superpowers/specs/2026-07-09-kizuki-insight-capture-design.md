# Kizuki insight capture

Date: 2026-07-09
Status: approved design

## Goal

Save useful Codex/Cursor chat context via "Kizuki this." Caller distills thought,
calls MCP. Kizuki validates structured capture. No full-chat read or retention.

Insights become searchable immediately. Capture never rewrites entity files.
Kinds preserve epistemic state: decisions/learnings separate from unverified
hypotheses/questions.

Kizuki stays observe-and-advise. Agent proposes capture. Deterministic JavaScript
validates identity, locks vault, writes state.

## Approaches considered

### Dedicated insight inbox

Gitignored append-only ledger + focused MCP/CLI tools. Sync, check, search consume
active insights while preserving kind.

Selected. Adds provenance + lifecycle without writing entity truth during
capture.

### Reuse `upsert_analysis`

Caller summarizes chat, writes entity log. Smaller, but chat agent decides
durable truth. No insight identity, provenance, uncertainty, archival controls.

### Read chat sessions automatically

Kizuki scans Codex/Cursor logs. Adds passive surveillance, partial-session
parsing, client-specific formats, tool noise, self-ingestion risk. Out of scope.

## Capture contract

MCP tool: `capture_insight`. Description directs agents to call it for "Kizuki
this" or explicit save requests.

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

Kinds:

- `decision`: user's stated intent/choice.
- `learning`: context wanted later.
- `hypothesis`: explanation/claim needing evidence.
- `question`: unresolved point.

`summary`: required, trimmed, max 500 chars, standalone. `context`: optional,
max 4,000 chars. Caller distills chat; never copies full transcript.

`entities`: optional, max five unique refs. Types: `person`, `project`,
`team`. Names use existing path-safe validation. Duplicate refs fail. Empty
list = unscoped inbox item.

`origin.client`: `codex`, `cursor`, or `other`. `origin.locator`:
optional stable thread/turn ID. Same credential/signed-parameter safety rules as
signal receipt locators. Kizuki cannot infer client or access caller chat through
MCP.

Tool returns insight ID, kind, status. Mutation output omits summary/context.

## Stable identity

Trim text. Sort entity refs. Compute:

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

Exact retry returns existing active/archived insight; adds no event. Changed
kind, wording, entity set, client, or locator = new insight. Reducer rejects hash
collision mapping one ID to different dedupe key.

## Event ledger

Sensitive events live in gitignored `insights/events.jsonl`.

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

Statuses: `active`, `archived`. Archive terminal for this slice. Repeated
archive + unknown-ID transition fail. Exact recapture of archived item stays
archived; changed content creates new insight.

`lib/insights.mjs` boundaries:

- `readInsightEvents(vaultDir)`: validate every JSONL line; malformed data
  reports file + line.
- `reduceInsightEvents(events)`: current states; reject unknown IDs, bad order,
  transition mismatch, bad enums, collisions.
- `planInsightCapture(events, input, { now })`: validate; return capture event
  or exact-retry disposition.
- `planInsightArchive(events, transition, { now })`: validate; return archive
  event.
- `writeInsightEventsAtomic(vaultDir, events)`: write full immutable sequence
  via sibling temp file + atomic rename.

All mutations use `state/vault.lock`. Reads rely on atomic rename. Writer
rejects existing-event removal/rewrite.

## MCP interface

Keep current tools. Add:

```text
capture_insight
list_insights
read_insight
archive_insight
```

`capture_insight`: capture contract above. `list_insights`: defaults active;
supports `active`, `archived`, `all`; newest first. `read_insight`:
reduced state + history. `archive_insight`: ID + optional note, max 500 chars.

Schemas reject unknown fields. Mutation output names ID/transition, omits text.
Read tools return text only after explicit request.

## CLI interface

```text
kizuki insights
kizuki insights --status active|archived|all
kizuki insights --json
kizuki insight show <id> [--json]
kizuki insight archive <id> [--note <text>]
```

Default: active, newest first. Human rows: ID, kind, summary, entity refs, origin
client, capture time. JSON: reduced states. `show --json`: state + history.

Bad syntax/status, unknown IDs, repeated archive fail loudly.

## Search, sync, and check

Local/MCP search includes active insight summary/context. Ordinary search excludes
archived; `show` and archived/all listing retain access.

Sync reads consistent active-insight snapshot before agent spawn:

- All scope: every active insight.
- Entity scope: matching entity refs.
- Unscoped: all-scope sync + direct insight queries only.

Prompt labels user-captured context. Decisions = user intent. Learnings = context.
Hypotheses/questions = unverified; never established facts.

Insights may inform entity analysis/raw log. Cannot support new signal receipt
alone. No `insight` signal receipt source. Signals still require Slack, GitHub,
Atlassian, Outlook, or transcript evidence.

Payload version 3 unchanged. Insight-derived raw entry uses source `insight`,
capture timestamp, text naming insight ID + kind. Hypotheses/questions stay
labeled. Sync never marks/archives used insight.

`kizuki check`: explicit scope gets matching active insights; all scope gets
all. Hypothesis conflict = evidence gap, not factual contradiction.

Capture never runs sync, rewrites entities, notifies, or creates signal.

## Setup and documentation

- Add `/insights/` to `.gitignore`.
- `kizuki init` creates `insights/`.
- Doctor verifies `insights/`.
- Document phrase, contract, MCP/CLI, statuses, scope, privacy.
- Sync `AGENTS.md` + `CLAUDE.md` shared invariants.
- No fixed total-test counts.

No global Codex/Cursor instruction edits. Tool description carries "Kizuki this"
behavior for clients loading Kizuki MCP.

## Error handling

- Malformed ledger: throw file + line.
- Invalid input: fail before lock/filesystem mutation.
- Lock: existing timeout + stale-lock rules.
- Atomic write failure: previous ledger intact.
- Search/sync/check: fail on malformed ledger; never drop silently.
- Missing ledger: empty inbox.

## Test plan

- Stable ID + exact retry.
- Identity changes for kind, wording, entities, client, locator.
- Text limits, safe entity names, duplicate refs, safe locator.
- Reducer rejects malformed JSONL, bad order/enums, unknown IDs, transition
  mismatch, collision.
- Atomic prefix protection + failure preservation.
- Lock capture/archive.
- CLI active/archived sort, JSON, history, bad syntax/IDs.
- MCP validation, capture/list/read/archive, retry, safe mutation output.
- Search includes active, excludes archived.
- Sync scope + epistemic prompt rules.
- Check context + hypothesis evidence-gap handling.
- Capture writes no entity/signal/alert/transcript/notification.
- Init/doctor include `insights/`.
- Existing sync/signal/entity/MCP behavior green.

## Constraints and non-goals

- Root/`lib/`: ESM `.mjs`, Node built-ins only, zero runtime deps.
- MCP deps stay isolated.
- Failing tests first. `npm test` green.
- Preserve main checkout `transcripts/.gitkeep` deletion.
- No automatic Codex/Cursor session reads.
- No full chats/raw tool output.
- No passive capture, session-end hooks, notifications, dashboard controls,
  restore, semantic clustering, auto-archive.
- No signal lifecycle change or insight-only signals.

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
