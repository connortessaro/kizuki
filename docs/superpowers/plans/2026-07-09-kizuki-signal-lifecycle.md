# Kizuki signal lifecycle implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` or `superpowers:executing-plans`.
> Follow each task with TDD and a review gate.

**Goal:** Make an append-only signal ledger canonical while preserving daily
markdown alerts as a compatibility view.

**Architecture:** `lib/signals.mjs` owns identity, validation, reduction,
ingestion, transitions, and atomic ledger writes. Existing payload, apply, run,
and CLI modules call that boundary. Root remains dependency-free ESM.

**Tech stack:** Node built-ins, ESM `.mjs`, `node:test`.

Spec:
`docs/superpowers/specs/2026-07-09-kizuki-signal-lifecycle-design.md`

## Global constraints

- Root and `lib/` use ESM `.mjs`, Node built-ins only, and zero runtime
  dependencies.
- The agent returns one fenced JSON payload. Deterministic JavaScript performs
  all writes.
- Every production behavior starts with a focused failing test.
- All signal mutations hold `state/vault.lock` across read, reduce, plan, and
  atomic write. The lock is non-reentrant.
- `signals/events.jsonl` is canonical. `alerts/YYYY-MM-DD.md` remains a derived
  compatibility view.
- Dry-run writes no signal, alert, entity, transcript, notification, lock, or
  state file.
- Do not run legacy migration during implementation.
- Preserve the main checkout's deleted `transcripts/.gitkeep` state.
- No dashboard controls, aliases, retrieval changes, timezone repair,
  transcript-archiving fix, connector sandboxing, or ledger compaction.

---

## Task 1: Signal ledger core

**Files:**

- Create: `lib/signals.mjs`
- Create: `lib/signals.test.mjs`
- Include in first commit:
  `docs/superpowers/specs/2026-07-09-kizuki-signal-lifecycle-design.md`
  and this plan

**Produces:**

```js
readSignalEvents(vaultDir)
reduceSignalEvents(events)
planSignalIngestion(events, candidates, { now })
planSignalTransition(events, transition, { now })
writeSignalEventsAtomic(vaultDir, events)
signalIdentity(candidate)
```

`reduceSignalEvents` returns a `Map` keyed by `signalId`. Each state contains
the latest candidate, status, first and last observation times, receipts, and
event-derived metadata needed by listing and ingestion.

- [ ] Write focused tests for stable identity across evidence/draft wording;
  different topic/entity/kind identities; receipt identity by `source` plus
  `locator`; exact repeat; severity increase/decrease; active and terminal
  status behavior; automatic reopen; dismissal reason; optional notes; bad
  enums; unknown IDs; bad ordering; mismatched `from`; hash collisions;
  malformed JSONL line reporting; and atomic-write failure preservation.
- [ ] Run `node --test lib/signals.test.mjs`. Confirm failures come from the
  missing module or missing behavior.
- [ ] Implement candidate validation, SHA-256 identity, strict event reduction,
  ingestion planning, transition planning, JSONL reading, and sibling-temp
  atomic replacement. Output JSONL ends with one newline when nonempty.
- [ ] Run `node --test lib/signals.test.mjs`, then `npm test`.
- [ ] Commit task files after both commands pass.

## Task 2: Payload v3 and sync integration

**Files:**

- Modify: `lib/payload.mjs`, `lib/payload.test.mjs`
- Modify: `lib/prompt.mjs`, `lib/prompt.test.mjs`
- Modify: `lib/apply.mjs`, `lib/apply.test.mjs`
- Modify: `lib/run.mjs`, `lib/run.test.mjs`
- Modify only if compatibility parsing needs it: `lib/alerts.mjs`,
  `lib/alerts.test.mjs`

**Consumes:** Task 1 signal functions.

**Produces:** Parsed v3 candidates and `applyPayload` results containing
`newAlerts`, `signalChanges`, and `warnings`.

- [ ] Write failing parser/prompt tests for v3 `topic` and receipt validation,
  forbidden locator query/fragment/credential forms, v1/v2 parsing, one v2
  warning per sync, ignored v2 `clear`, and no synthetic all-clear.
- [ ] Run `node --test lib/payload.test.mjs lib/prompt.test.mjs` and confirm the
  expected failures.
- [ ] Implement `PAYLOAD_VERSION = 3`, v3 contract validation, v1/v2
  normalization, compatibility warnings, and removal of synthesized `clear`
  alerts.
- [ ] Write failing apply/run tests proving signal planning precedes writes,
  surfaced candidates alone reach compatibility markdown and notifications,
  a new receipt can surface even when the exact markdown line already exists,
  ledger commit follows compatibility output, and dry-run writes nothing.
- [ ] Run `node --test lib/apply.test.mjs lib/run.test.mjs` and confirm the
  expected failures.
- [ ] Integrate one non-reentrant lock boundary around entity writes,
  compatibility alert output, transcript moves, and final atomic ledger write.
  Return planner `surfaced` candidates as `newAlerts`, independent of markdown
  exact-line dedupe.
- [ ] Run focused task tests, then `npm test`, and commit.

## Task 3: Lifecycle CLI and legacy migration

**Files:**

- Create: `lib/signalCommands.mjs`
- Create: `lib/signalCommands.test.mjs`
- Modify: `kizuki`
- Modify as needed for legacy parsing: `lib/alerts.mjs`, `lib/alerts.test.mjs`

**Consumes:** Task 1 signal functions and the existing alert line parser.

**Produces:**

```text
kizuki signals [--status active|open|acted|dismissed|resolved|all] [--json]
kizuki signal show <id> [--json]
kizuki signal act <id> [--note <text>]
kizuki signal dismiss <id> --reason <reason> [--note <text>]
kizuki signal resolve <id> [--note <text>]
kizuki signals migrate-alerts [--dry-run]
```

- [ ] Write failing tests for command syntax, default active filtering, explicit
  filters, JSON list/show output, show history, unknown IDs, sort order,
  allowed transitions, rejected repeated/terminal transitions, required
  dismissal reasons, optional notes, and mutation output that omits evidence
  and receipts.
- [ ] Run `node --test lib/signalCommands.test.mjs` and confirm expected
  failures.
- [ ] Implement argument parsing, read-only listing/show, and lock-owning manual
  transitions.
- [ ] Write failing migration tests for dry-run counts, resolved imports,
  grouping, clear skipping, partial retry, unseen receipt append, idempotence,
  and never reopening an imported signal.
- [ ] Implement alert-file scanning and deterministic legacy identity. Use
  `legacy-alert` only for migration receipts, actor `system`, and reason
  `legacy-import`.
- [ ] Wire dispatch in `kizuki` without changing existing commands.
- [ ] Run focused tests, then `npm test`, and commit.

## Task 4: Setup and operator documentation

**Files:**

- Modify: `.gitignore`
- Modify: `lib/doctor.mjs`, `lib/doctor.test.mjs`
- Modify: `lib/init.test.mjs`
- Modify: `README.md`, `docs/ROADMAP.md`
- Modify together: `AGENTS.md`, `CLAUDE.md`

**Consumes:** Task 3 command names and lifecycle semantics.

- [ ] Write failing init/doctor tests proving `signals/` is created, verified,
  and reported missing in check-only mode.
- [ ] Run `node --test lib/init.test.mjs lib/doctor.test.mjs` and confirm the
  expected failures.
- [ ] Add `signals` to the shared required-directory list and `/signals/` to
  `.gitignore`.
- [ ] Document payload v3, canonical ledger, status meanings, commands,
  compatibility alerts, manual migration, and private runtime data. Keep
  `AGENTS.md` and `CLAUDE.md` aligned and remove fixed test-count claims.
- [ ] Run focused setup tests, `npm test`, `cd web && npm run typecheck`, and
  `git diff --check`, then commit.

## Final verification

```bash
node --test lib/signals.test.mjs
node --test lib/payload.test.mjs lib/prompt.test.mjs lib/apply.test.mjs lib/run.test.mjs
node --test lib/signalCommands.test.mjs lib/init.test.mjs lib/doctor.test.mjs
npm test
cd web && npm run typecheck
git diff --check
```
