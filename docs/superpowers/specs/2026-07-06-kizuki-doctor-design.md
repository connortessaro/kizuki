# kizuki doctor — design

Date: 2026-07-06
Status: approved

## What

A `kizuki doctor` subcommand that diagnoses whether the local kizuki setup can
run: config validity, agent binary present, agent actually responds (smoke
test), vault directory structure. Output is a per-check checklist; exit 0 when
everything passes, exit 1 when any check fails.

## Decisions made during brainstorming

- **Agent health = smoke-test invocation.** Kizuki is agent-agnostic and cannot
  inspect any one agent's MCP config (e.g. `~/.codex/config.toml`). Running the
  configured agent with a trivial prompt is the honest proxy for "agent + its
  MCP setup is minimally alive."
- **Scope:** `kizuki.config.json` validity, agent binary resolvable, smoke
  test, vault dirs exist (created if missing).
- **Output:** checklist lines + summary, exit code 0/1.
- Design was reviewed by a second pass; its improvements are folded in below
  (factory injection, `skip` status, streaming, timeout cap, stderr capture,
  flags).

## Architecture

- **`lib/doctor.mjs`** — new module, zero-dep, exports
  `runDoctor(vaultDir, options)` as an **async generator** yielding
  `{ name, status, detail }` per check, where
  `status ∈ "pass" | "fail" | "skip"`. Streaming matters because the smoke
  test takes seconds (agent cold start + MCP server boot); the executable
  prints each line as it completes instead of dumping four lines at the end.
- **`kizuki` executable** — new `doctor` branch in the dispatcher. Prints one
  line per yielded check, a summary line, and sets the exit code.
  **It must not call `resolveAgent` up front** (the way `doSync` does):
  resolving config is check #1, and a broken config must produce a clean
  `❌ config: …` line, not the generic `kizuki doctor failed: …` catch-all.
- **`lib/agent.mjs`** — one minimal extension:
  `makeRunAgent(cmd, timeoutMs, { captureStderr } = {})`. Default off keeps
  today's `stdio: ["ignore", "pipe", "inherit"]` behavior for sync. When on,
  stderr is piped and its tail is appended to rejection messages, so a failed
  smoke test reports the agent's actual error instead of spraying it into the
  terminal mid-checklist.

### Dependency injection

`runDoctor(vaultDir, { makeRunAgent, lookupPath, checkOnly = false, runSmoke = true })`

- `makeRunAgent` — the **factory**, not a bound `runAgent`. A bound runner
  cannot be built before config is resolved, and resolving config is itself
  check #1. Doctor calls `resolveAgent` internally, then builds the smoke
  runner from the factory. Tests inject a fake factory.
- `lookupPath(name)` — PATH resolver, injectable for tests. Real
  implementation: if `name` contains a path separator, `fs.access(name, X_OK)`
  directly; otherwise scan `process.env.PATH` split on `path.delimiter` with
  `fs.access(join(dir, name), X_OK)`. Returns the resolved path or `null`.
  Windows `PATHEXT` semantics are out of scope (repo is darwin-targeted; see
  `lib/launchd.mjs`).

## Checks (in order)

1. **`config`** — `resolveAgent(vaultDir)` inside a try. Missing config file
   is a pass (`detail: "using default: codex exec"`, detected via
   `cmd === DEFAULT_AGENT_CMD`); a present, valid config passes with
   `detail: "agentCmd: <cmd joined>"`. Invalid JSON / bad `agentCmd` / bad
   `timeoutMs` → fail with `resolveAgent`'s error message.
2. **`agent-binary`** — depends on check 1. If config failed:
   `skip, "skipped: config invalid"`. Otherwise resolve `cmd[0]` via
   `lookupPath`; pass with the resolved path as detail, or fail with
   `"<name> not found on PATH"`.
3. **`agent-smoke-test`** — depends on check 1. Skipped when `--no-smoke`
   (`detail: "skipped: --no-smoke"`) or when config failed. Otherwise:
   - budget = `Math.min(timeoutMs, DOCTOR_TIMEOUT_CAP_MS)` with
     `DOCTOR_TIMEOUT_CAP_MS = 30000`. Respects a user-lowered `timeoutMs`,
     caps the 5-minute sync default. The effective budget appears in the
     detail so timeouts are diagnostic.
   - runner = `makeRunAgent(cmd, budget, { captureStderr: true })`.
   - prompt: `"Reply with the single word OK and nothing else."`
   - **pass = exit 0 AND non-empty stdout.** Exit 0 with empty output fails
     (`"exit 0 but empty output"`). The output is NOT required to equal "OK" —
     asserting model behavior would flake.
   - rejection (nonzero exit, spawn error, timeout) → fail with the error
     message, which includes the stderr tail via `captureStderr`.
4. **`vault-dirs`** — independent, always runs. Required dirs:
   `people`, `projects`, `teams`, `transcripts`, `transcripts/processed`.
   (`state/` and `days/` are runtime artifacts created by the features that
   own them — out of scope.) Default: `mkdir` recursive for missing dirs,
   pass with `detail` naming created vs already-present. With `--check-only`:
   missing dirs → fail with
   `"missing: <list> (omit --check-only to create)"`, nothing created.
   `EACCES` from mkdir → fail with the path.

Checks 2 and 3 genuinely depend on check 1; `skip` models that honestly
instead of a misleading `fail`. Check 4 always runs regardless of 1–3.

## CLI

```
kizuki doctor [--no-smoke] [--check-only]
```

- `--no-smoke` — skip the agent smoke test. The smoke test is **not free**:
  it boots the real agent, which authenticates and spins up its MCP servers,
  and consumes tokens.
- `--check-only` — read-only mode: report missing vault dirs as failures
  instead of creating them.

Output format (executable):

```
✅ config — agentCmd: codex exec
✅ agent-binary — /opt/homebrew/bin/codex
✅ agent-smoke-test — agent replied (30000ms budget)
✅ vault-dirs — created transcripts/processed; 4 already present

all checks passed
```

Failure lines use `❌ <name> — <detail>`, skips use `⏭️ <name> — <detail>`.
Summary: `all checks passed` or `<n> check(s) failed`. Exit 0 only when zero
fails (skips from `--no-smoke` don't fail; skips caused by a config fail
coexist with that fail, so exit is 1 anyway).

## Error handling

- Expected conditions (invalid config, missing binary, nonzero exit, timeout,
  empty output, missing dirs, `EACCES`) are recorded as `fail` with detail —
  that is the feature, not a silent failure.
- Unexpected exceptions (bugs in doctor itself) are NOT swallowed by blanket
  try/catch; they propagate to the executable's catch-all, per the repo's
  no-silent-failures rule.

## Testing

`lib/doctor.test.mjs`, `node:test`, temp vault dirs per case, fake
`makeRunAgent` and `lookupPath` injected — no real process spawns. Cases:

- config: missing file (pass, default detail), valid config, invalid JSON,
  bad `agentCmd` → fail + checks 2–3 yield `skip`.
- agent-binary: found / not found.
- smoke: resolves non-empty (pass), resolves `""` (fail), rejects exit-1
  (fail, message surfaced), rejects timeout (fail), `runSmoke: false` (skip).
- vault-dirs: all missing → created; all present; mix; `checkOnly: true`
  reports missing without creating (assert nothing created); budget =
  `min(timeoutMs, cap)` verified via fake factory capturing its args.

`makeRunAgent` `captureStderr` gets a test in the existing agent test file:
default behavior unchanged; with flag on, stderr tail appears in rejection.

## Risks / non-goals

- **Smoke test has cost and side effects** — real agent boot, real MCP
  connections, real tokens. Not for tight loops; `--no-smoke` exists for that.
- Doctor never writes vault *files* — only creates empty gitignored dirs.
  The observe-and-advise rule and single-writer rule are untouched (the smoke
  prompt asks for a single word; it does not instruct any tool use).
- **launchd job health check is intentionally out of scope for v1** (e.g.
  detecting "shift active but background sync job not loaded"). Worth a
  future check; deferred deliberately, not forgotten.

## Docs

Add `kizuki doctor [--no-smoke] [--check-only]` to the Commands block in
`README.md`, `CLAUDE.md`, and mirror in `AGENTS.md`.
