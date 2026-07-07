# Vault write-lock — design

Date: 2026-07-07
Status: approved

## What

A machine-local write lock so two vault writers cannot interleave the
read-modify-write in `applyPayload` and silently lose updates. Today the
"one vault writer at a time" rule is convention only; the 30-minute launchd
background sync racing a manual `kizuki sync` or an MCP `upsert_analysis`
is a real lost-update hazard.

## Decisions made during brainstorming

- **Contention: wait briefly, then fail.** Retry up to 30 seconds, then throw
  loudly naming the holder. No silent skip.
- **Stale locks: PID liveness check.** Lock file records the holder's PID; a
  dead PID means the lock is stolen automatically. Single-machine vault makes
  PID checks reliable.
- **Scope: write phase only.** Lock wraps `applyPayload`'s writes (seconds),
  not the agent's minutes-long gather phase. Accepted window: the agent may
  read the vault, an MCP write lands, then sync overwrites with analysis based
  on slightly stale reads — acceptable because the managed section is
  regenerated on every sync anyway, and hand-written content outside the
  markers is never touched by either writer.
- **Mechanism: lock file with atomic create.** `writeFile(..., { flag: "wx" })`
  is O_EXCL-atomic on a local filesystem and lets holder metadata live inside
  the file. `mkdir`-as-lock needs a second file for metadata; an npm lockfile
  package breaks the zero-dep rule.

## Architecture

- **`lib/lock.mjs`** — new zero-dep module. Exports:
  - `withVaultLock(vaultDir, fn, opts = {}) -> Promise<result of fn>` —
    acquire → `await fn()` → release in `finally`.
  - `LOCK_WAIT_MS = 30000`, `LOCK_POLL_MS = 500` (defaults, overridable via
    `opts` for tests).
- **Choke point: inside `applyPayload`.** Both writers — CLI sync
  (`lib/run.mjs`) and MCP `upsert_analysis` (`mcp/tools.mjs`) — call
  `applyPayload`, so locking there covers every write path and no future
  caller can forget it. The entire non-dryRun body (entity writes + transcript
  archival) runs inside one `withVaultLock`. `dryRun` runs compute the same
  changes without ever touching the lock.
- `applyPayload` gains a `tool` option (default `"sync"`; MCP passes
  `"mcp"`) recorded in the lock file so contention errors name the holder.

## Lock file

- Path: `state/vault.lock` under the vault dir (`state/` is gitignored and
  machine-local; created with `mkdir` recursive if missing).
- Content: JSON `{ "pid": <number>, "tool": "sync"|"mcp", "startedAt": <ISO string> }`.

## Acquire protocol

1. `mkdir(state, { recursive: true })`, then attempt
   `writeFile(lockPath, meta, { flag: "wx" })`.
2. Success → lock held.
3. `EEXIST` → read the lock file:
   - Unreadable or unparsable JSON, or missing/non-numeric `pid` → treat as
     stale: unlink and retry the atomic create immediately.
   - `pidAlive(pid)` false → stale: unlink, retry immediately.
   - Holder alive → wait `pollMs` (default 500ms) and re-run the full
     acquire from step 1 (so a holder that finishes or dies mid-wait is
     picked up); once `waitMs` (default 30000ms) has elapsed, throw:
     `vault locked by <tool> (pid <pid>) since <startedAt>`.
4. Any error other than `EEXIST` from the create (e.g. `EACCES`) propagates —
   no silent failure.

The steal path re-enters the atomic create rather than assuming success —
two stealers racing resolve correctly because only one `wx` create wins.

## Release protocol

- In `finally`, re-read the lock file; unlink only if it records our PID.
  (Guards the edge where our lock was judged stale and stolen — never delete
  another writer's lock.) If the file is already gone, release is a no-op.
- `fn` throwing still releases; the original error propagates.

## Injectable options (tests)

`withVaultLock(vaultDir, fn, { tool, waitMs, pollMs, pidAlive, now })`

- `pidAlive(pid)` — default: `process.kill(pid, 0)` in a try/catch returning
  boolean (an `EPERM` counts as alive). Tests inject fakes.
- `waitMs` / `pollMs` — tests use single-digit-millisecond values; no real
  sleeps.
- `now` — injected for deterministic `startedAt`, matching the repo's
  `renderAnalysis(entity, now)` convention.

## Error handling

- Contention timeout throws with holder metadata — caller (`kizuki`
  executable / MCP server) surfaces it through existing error paths. The
  background `sync --loop` already logs failures to `state/sync.log` and
  exits 1; a lock timeout lands there like any other sync failure.
- Acquire/release fs errors other than the expected `EEXIST`/`ENOENT` cases
  propagate.
- No blanket try/catch around `fn`.

## Testing

- `lib/lock.test.mjs` (`node:test`, temp dirs): acquire writes metadata;
  release removes file; concurrent second acquire waits then throws holder
  message after `waitMs`; dead-PID lock stolen; corrupt lock file stolen;
  `fn` throw still releases and propagates; release skips unlink when file
  holds a different PID.
- `lib/apply.test.mjs` additions: `applyPayload` creates and removes
  `state/vault.lock` around a real write; `dryRun` never creates it; a held
  lock (live PID, tiny `waitMs` injected) makes `applyPayload` throw.
- MCP path: `upsertAnalysis` gains an internal pass-through options param so
  one test can prove the upsert path respects a held lock (injected tiny
  `waitMs`); `tool: "mcp"` is hardcoded after the spread so callers cannot
  override it, and is verified in review (runtime capture would need hooks
  the design doesn't want).

## Non-goals

- No cross-machine locking (vault is single-machine by design).
- No read locks — readers (dashboard, MCP read tools) stay lock-free;
  worst case they read a mid-write file, next refresh corrects.
- No locking of `state/shift.json` / `days/` writes — different files,
  single-writer by construction (shift commands are interactive).

## Invariants preserved

- Deterministic-JS-writes boundary unchanged; the LLM still never touches
  files.
- `spliceManagedSection` / `appendLog` guarantees unchanged — the lock only
  serializes who runs them.
- Zero-dep core holds.

## Docs

- CLAUDE.md + AGENTS.md: replace the "One vault writer at a time — no write
  lock yet" warning in Parallel work with a note that `applyPayload` holds
  `state/vault.lock` (30s wait, PID-stale-steal); keep the two files in sync.
