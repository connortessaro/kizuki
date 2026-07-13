# Kizuki — gate instrumentation (validation-first v2 wave)

**Date:** 2026-07-13
**Status:** design approved, pre-implementation

## Goal

The roadmap's v2–v4 code shipped; every exit gate is still open because gates
are evidence checkpoints, not features. This wave builds the smallest tooling
that (a) records that evidence durably and (b) keeps it in the operator's face
daily, so the gates close on real numbers instead of vibes.

Four slices, each useful solo today:

1. **Catch ledger** — record a true catch (something Kizuki surfaced that would
   otherwise have been missed) with an optional receipt link.
2. **`kizuki gate`** — compute weekly gate stats from the existing signal and
   insight ledgers plus the new catch ledger, and print verdict lines against
   the roadmap criteria.
3. **Habit wiring** — one gate line in the `start` brief and the `stop` day
   summary facts.
4. **Skills export** — implement the already-approved
   `2026-07-07-kizuki-skills-export-design.md` as written (no scope changes),
   so the start/stop rituals run from any agent and drive daily use.

Non-goals: presence/restraint engine, agent-swarm retrieval, prompt tuning,
dashboard changes, any autonomous action. Observe-and-advise unchanged.

## Slice 1 — catch ledger

### Data

`catches/events.jsonl`, gitignored, append-only, canonical. Mirrors the signal
and insight ledger pattern exactly:

- Strict JSONL read (`readCatchEvents(vaultDir)`): blank line, malformed JSON,
  or invalid event → throw with `path:line`.
- Atomic append-only write (`writeCatchEventsAtomic(vaultDir, events)`): reduce
  first, verify existing prefix unchanged, temp file + rename, `wx` flag.
- Mutations hold `state/vault.lock` via `withVaultLock`.

One event kind:

```json
{"version": 1, "event": "caught", "catchId": "cat_<12-hex>", "at": "<ISO>",
 "note": "<text>", "signalId": null, "insightId": null}
```

- `catchId` = `"cat_" + sha256(`${at}|${note}`).slice(0, 12)` — deterministic
  (matches the `sig_`/`ins_` id convention), collision-checked on append
  (duplicate id → exact-repeat no-op, mismatched content → throw).
- `note` — required non-empty string; the operator's one-line description of
  what was caught and why it would have been missed.
- `signalId` / `insightId` — optional receipt links. When present, the id must
  exist in the respective ledger; unknown id → loud error. Both may be null
  (a catch can come from entity analysis or follow-ups, not only signals).

### Module — `lib/catches.mjs` (new, zero-dep, TDD)

- `validateCatchInput(input)` — note/link validation, throws loudly.
- `planCatchCapture(events, input, { now })` — returns the new event; enforces
  id uniqueness and append-only reduction.
- `reduceCatchEvents(events)` — id-keyed state map; rejects unknown event
  kinds, bad ISO timestamps, duplicate ids.
- `readCatchEvents` / `writeCatchEventsAtomic` as above.

### CLI

- `kizuki catch "<note>" [--signal <id>] [--insight <id>]` — capture under
  lock; prints the new catch id. Cross-ledger link validation reads the signal
  and insight ledgers before writing.
- `kizuki catches [--json]` — read-only list, newest first: id, date, note,
  links.

Command services + formatting live in `lib/catchCommands.mjs` (same shape as
`signalCommands`/`insightCommands`); the `kizuki` executable only dispatches.

## Slice 2 — `kizuki gate`

### Module — `lib/gate.mjs` (new, pure, TDD)

`computeGateReport({ signalEvents, catchEvents, insightEvents, now, weeks })`
→ data structure; `renderGateReport(report)` → text. No filesystem access —
the CLI layer reads the three ledgers and passes events in (same injection
style as `renderAnalysis(entity, now)`).

- **Weeks:** calendar weeks, Monday start, local time, newest first. Default
  `weeks = 2` (current + previous); `--weeks n` overrides. A week row shows
  its date range (month-day-year format per repo convention).
- **Per-week metrics:**
  - `fired` — signal `observed` events in the window
  - `acted` / `dismissed` / `resolved` — `status_changed` events by `to`
  - `catches` — `caught` events
  - `insights` — insight `captured` events
- **Verdict lines** against the roadmap criteria, computed only from complete
  data (the current partial week is shown but marked `(in progress)`):
  - `v1→v2: ≥1 true catch/week — met N of M full weeks`
  - `v2→v3: ≥1 acted signal/week — met N of M full weeks`
  - Notification usefulness (not muted) cannot be computed; the report prints
    a fixed reminder line that this part is operator judgment.

The report states evidence; the operator decides pass/fail, consistent with
the roadmap's "record pass/fail in a local journal" rule.

### CLI

`kizuki gate [--weeks n] [--json]` — read-only; never takes the lock.

## Slice 3 — habit wiring

- `renderBrief` (`lib/shift.mjs`) appends one line from the current week of
  `computeGateReport`: `Gate week so far: 2 catches, 1 acted signal.`
- `stop` day-summary facts (`renderDaySummary` path) get the same single line,
  so the LLM prose synthesis can mention it and the operator sees it at
  shift end. Facts-only fallback includes it too.
- No other surface changes. If the ledgers are empty the line reads
  `Gate week so far: no catches recorded — log with 'kizuki catch'.`

## Slice 4 — skills export

Implement `docs/superpowers/specs/2026-07-07-kizuki-skills-export-design.md`
exactly as approved: `skills/<name>/ritual.md` sources (`kizuki-start`,
`kizuki-stop`), `lib/skills.mjs`, `kizuki skills export
[--agent claude|codex|all] [--check] [--dist]`, committed `dist/skills/`
output. No additions in this wave (a `kizuki-check` ritual is a possible
follow-up, out of scope here).

## Housekeeping

- `.gitignore`: add `catches/`.
- CLAUDE.md + AGENTS.md: add `catches/` to the data-safety and parallel-work
  lists; document the new commands; keep the two files in sync.
- `kizuki init` creates nothing new (ledger dir is created on first write,
  same as `signals/`). `kizuki doctor` vault-dir check remains unchanged.

## Testing

TDD throughout, `node:test` + `node:assert`, no process spawns:

- `lib/catches.test.mjs` — validation, identity, reduction, strict read,
  append-only atomic write, lock integration.
- `lib/catchCommands.test.mjs` — capture with/without links, unknown-link
  errors, list formatting and `--json`.
- `lib/gate.test.mjs` — week bucketing (Monday boundary, empty weeks, partial
  current week), metric counts, verdict lines, injected `now` determinism.
- `lib/shift.test.mjs` — brief and day-facts gate lines (present, empty-ledger
  wording).
- Skills-export tests per its own spec (`lib/skills.test.mjs`, `--check`
  drift behavior).

## Safety invariants (extends the existing list)

- `catches/events.jsonl` is canonical and append-only; mutations hold
  `state/vault.lock`.
- A catch never upgrades an insight or signal — it is operator-recorded
  evidence about Kizuki's usefulness, not new work-state.
- `kizuki gate` and `kizuki catches` are read-only.
