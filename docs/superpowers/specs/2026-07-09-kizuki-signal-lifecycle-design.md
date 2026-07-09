# Kizuki signal model and lifecycle

Date: 2026-07-09
Status: approved

## Goal

Replace daily free-text alerts as Kizuki's source of truth with a durable,
append-only signal ledger. Keep `alerts/YYYY-MM-DD.md` as a compatibility view
for the dashboard and current notifications.

Kizuki remains observe-and-advise only. The agent proposes candidates in one
fenced JSON payload. Deterministic JavaScript validates and writes vault state.

## Payload version 3

Top-level `alerts` remains the per-sync proposal list:

```json
{
  "version": 3,
  "entities": [],
  "consumedTranscripts": [],
  "alerts": [
    {
      "severity": "warn",
      "kind": "contradiction",
      "type": "project",
      "name": "staff",
      "topic": "uat-date",
      "evidence": "Two sources report different UAT dates.",
      "draft": "Optional ready-to-send message.",
      "receipts": [
        {
          "source": "slack",
          "locator": "stable source-native ID or canonical URL",
          "observedAt": "2026-07-09T18:00:00Z",
          "excerpt": "Short supporting excerpt."
        }
      ]
    }
  ]
}
```

`topic` uses lowercase kebab-case and identifies the semantic subject. New v3
candidates require at least one receipt. Agent-facing receipt sources are
`slack`, `github`, `atlassian`, `outlook`, and `transcript`.

Receipt identity is `source + locator`. A locator identifies one message,
comment, change, or transcript. It must not contain query strings, fragments,
credentials, or signed parameters.

Versions 1 and 2 remain parseable. Version 2 alerts use an exact-evidence legacy
identity and produce one compatibility warning per sync. Version 2 `clear`
alerts are ignored with a warning. A sync with no candidates reports that fact
through CLI output and does not persist an all-clear alert.

## Stable identity

```text
dedupeKey = JSON.stringify([kind, type, name, topic])
signalId  = "sig_" + first 12 hex chars of SHA-256(dedupeKey)
```

The reducer rejects a hash collision when one signal ID maps to another dedupe
key.

## Event ledger

Kizuki stores sensitive local events in gitignored `signals/events.jsonl`.

Observation event:

```json
{
  "version": 1,
  "event": "observed",
  "signalId": "sig_ab12cd34ef56",
  "dedupeKey": "[\"contradiction\",\"project\",\"staff\",\"uat-date\"]",
  "at": "2026-07-09T18:00:00Z",
  "candidate": {},
  "surfaceReason": "created"
}
```

Status event:

```json
{
  "version": 1,
  "event": "status_changed",
  "signalId": "sig_ab12cd34ef56",
  "from": "open",
  "to": "acted",
  "at": "2026-07-09T18:10:00Z",
  "actor": "user",
  "reason": null,
  "note": null
}
```

Statuses are `open`, `acted`, `dismissed`, and `resolved`. Dismiss reasons are
`false-positive`, `stale`, `duplicate`, `not-actionable`, and `low-value`.

`lib/signals.mjs` owns these boundaries:

- `readSignalEvents(vaultDir)` validates every JSONL line and reports malformed
  data with the file path and line number.
- `reduceSignalEvents(events)` returns current states and rejects unknown IDs,
  invalid ordering, mismatched `from`, invalid enums, and collisions.
- `planSignalIngestion(events, candidates, { now })` returns events to append and
  candidates to surface.
- `planSignalTransition(events, transition, { now })` validates one manual or
  system transition and returns one status event.
- `writeSignalEventsAtomic(vaultDir, events)` writes the complete immutable
  sequence through a sibling temporary file and atomic rename.

All mutations use `state/vault.lock`. Read-only listing relies on atomic rename
for a consistent snapshot.

## Ingestion rules

- First observation creates an `open` signal and surfaces it.
- An exact repeat adds no event.
- Evidence or draft wording changes without a new receipt or severity change add
  no event.
- A new receipt appends an observation and surfaces it.
- A severity increase appends and surfaces; a decrease appends quietly.
- `acted` remains active and quiet until new proof or a higher severity surfaces
  it.
- New proof or a higher severity reopens `dismissed` or `resolved` to `open`.
- Terminal exact repeats remain terminal.

## Sync integration

`applyPayload` validates and plans signal changes before any mutation. Under the
existing vault lock it writes entity updates, renders surfaced candidates into
the daily compatibility alert file, then commits the ledger after compatibility
output succeeds. It returns surfaced candidates as `newAlerts` so notification
wiring keeps working, plus `signalChanges` and compatibility warnings for CLI
reporting.

Dry-run computes dispositions but writes no signal, alert, entity, transcript,
notification, lock, or state file.

The dashboard stays unchanged in this slice.

## Lifecycle CLI

```text
kizuki signals
kizuki signals --status active|open|acted|dismissed|resolved|all
kizuki signals --json
kizuki signal show <id> [--json]
kizuki signal act <id> [--note <text>]
kizuki signal dismiss <id> --reason <reason> [--note <text>]
kizuki signal resolve <id> [--note <text>]
kizuki signals migrate-alerts [--dry-run]
```

The default list includes `open` and `acted`. Sort `open` before `acted`, then
`critical`, `warn`, and `info`, then newest `lastSeenAt`.

`show --json` returns reduced state plus event history. Allowed manual
transitions are `open` to `acted`, `dismissed`, or `resolved`, and `acted` to
`dismissed` or `resolved`. Repeated and terminal manual transitions fail.
Dismiss requires one valid reason. Notes remain optional. Mutation output names
the signal ID and transition without printing evidence or receipts.

## Legacy migration

`kizuki signals migrate-alerts` scans `alerts/YYYY-MM-DD.md` without changing
those files. It skips `clear` alerts.

For each imported alert:

- Topic is `legacy-` plus the first 12 SHA-256 hex characters of the exact
  formatted alert line.
- Receipt source is `legacy-alert`.
- Locator is the relative alert path plus line number.
- `observedAt` is the source file date with day-level precision.
- Excerpt is the existing evidence.

Migration groups matching legacy identities, appends unseen receipts, then
transitions the signal to `resolved` with actor `system` and reason
`legacy-import`. Dry-run reports scanned files, candidate alerts, unique
signals, skipped clear entries, and already imported receipts. Re-running after
migration writes nothing. Import never reopens a migrated signal.

## Setup and docs

- Add `/signals/` to `.gitignore`.
- `kizuki init` creates `signals/`.
- Doctor verifies `signals/`.
- Document lifecycle meanings, commands, payload v3, compatibility behavior,
  and migration steps.
- Keep `AGENTS.md` and `CLAUDE.md` synchronized.
- Remove fixed test-count claims.

## Constraints

- Root and `lib/` stay ESM `.mjs`, Node built-ins only, with zero runtime
  dependencies.
- Use failing tests before implementation and keep `npm test` green.
- Preserve current `transcripts/.gitkeep` deletion state in the main checkout.
- Do not run migration automatically or against the feature worktree.
- Do not add dashboard lifecycle controls, aliases, retrieval changes, timezone
  changes, transcript-archiving fixes, connector sandboxing, or ledger
  compaction in this slice.

After review and merge, the operator runs migration in the main checkout:

```bash
./kizuki signals migrate-alerts --dry-run
./kizuki signals migrate-alerts
./kizuki signals --status resolved
```

## Verification

```bash
node --test lib/signals.test.mjs
node --test lib/payload.test.mjs lib/prompt.test.mjs lib/apply.test.mjs lib/run.test.mjs
node --test lib/signalCommands.test.mjs lib/init.test.mjs lib/doctor.test.mjs
npm test
cd web && npm run typecheck
git diff --check
```
