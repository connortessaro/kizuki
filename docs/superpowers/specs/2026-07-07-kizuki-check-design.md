# Kizuki — `kizuki check` (pre-send draft contradiction check)

**Date:** 2026-07-07
**Status:** shipped 2026-07-07 (`lib/check.mjs`, `buildCheckPrompt`/`parseCheckPayload`, `kizuki check` subcommand; 12 tests)
**Origin:** `docs/2026-07-07-jarvis-presence-ideation.md` — the first buildable
slice of the "pre-send / pre-write intercept," chosen because it doubles as
validation of the core wedge.

## Goal

`kizuki check "<draft>"` takes a draft message/decision you're about to send and
tells you where it **contradicts what the vault already knows** — a decision
another team locked, a field that was cut, a status you're assuming wrong, a thing
the recipient doesn't know yet. Read-only: it prints contradictions and sends
nothing. This is the CLI spike of the pre-send intercept (no Slack/editor hooks)
and a direct test of "does Kizuki catch what I'd miss."

## Why this slice first

- Cheapest real version of the #1 presence idea; no intrusive per-surface hooks.
- Useful solo today; needs no org adoption.
- Exercises the exact wedge the v1→v2 gate measures (a caught misalignment that
  leads to a real action — here, *not* sending the wrong thing).

## Boundary preservation

Reuses the pipeline invariant: the agent returns one fenced JSON block; JS parses
and prints it. No file writes, no sends, no vault mutation. `check` is strictly
read + advise. Distinct from `sync` — it must not call `applyPayload`.

## Data flow

```
kizuki check "<draft>"            # or: kizuki check < draft.md  (stdin)
  → readDraft(argv, stdin)                      # arg wins; else stdin
  → buildCheckPrompt({ draft, scope, vaultDir }) # new, in lib/prompt.mjs
  → runAgent(prompt) → stdout                    # injected, same as runSync
  → parseCheckPayload(stdout)                    # new, in lib/payload.mjs
  → printContradictions(result)                  # human-readable; --json for raw
```

## Components

### `lib/prompt.mjs` — `buildCheckPrompt({ draft, scope, vaultDir })`

New prompt builder. Instructs the agent to:
- Read the vault (source of truth) via the same source list `buildPrompt` names.
- Compare the supplied `draft` against known decisions, statuses, dependencies,
  and "what they don't know yet" in the managed analysis sections.
- Return contradictions only — where the draft asserts or assumes something the
  vault contradicts or that a recipient does not yet know. No general feedback,
  no style notes.
- Cite evidence (the entity + the specific known fact) for each contradiction.
- Return exactly one fenced JSON block matching `CHECK_PAYLOAD_SHAPE`.

`CHECK_PAYLOAD_SHAPE` (new, exported):

```json
{
  "contradictions": [
    {
      "severity": "warn|critical",
      "entity": { "type": "person|project|team", "name": "..." },
      "draftClaim": "what the draft says/assumes",
      "conflict": "what the vault knows that contradicts it",
      "evidence": "the source fact / decision the vault holds"
    }
  ]
}
```

Empty `contradictions: []` is the clean/no-conflict result.

### `lib/payload.mjs` — `parseCheckPayload(stdout)`

- Reuse `extractJsonBlock`.
- Validate `contradictions` is an array; each item has the required keys;
  `severity` in the enum; entity `type` in `TYPES`; entity `name` path-safe
  (reuse the same `assertName` rule as `parsePayload` — even though we never touch
  the filesystem, keep validation loud and consistent).
- Throw loudly on malformed payload (no silent coerce).

### CLI — `kizuki check` subcommand

- Input: `kizuki check "<text>"` (arg) OR piped stdin (`kizuki check < draft.md`).
  Arg wins if both present. Empty input → error, non-zero exit, usage hint.
- Optional `--project <name>` / `--team <name>` scope (reuse `parseArgs` scope
  parsing) to focus the comparison; default = whole vault.
- Optional `--json` → print the raw parsed payload; default = human-readable list
  grouped by severity, each line: `[severity] entity — conflict (evidence)`.
- Exit code: **always 0** when the check ran (advisory, not a gate). Non-zero only
  on operational failure (no input, agent error, malformed payload). A future
  `--strict` (exit non-zero when contradictions exist, for pre-commit/CI hooks) is
  out of scope.
- Resolves the agent via `resolveAgent` + `makeRunAgent`, same as `sync`.

### `lib/run.mjs` (or a new `lib/check.mjs`) — `runCheck({ draft, scope, vaultDir, runAgent })`

Thin orchestrator mirroring `runSync`, with `runAgent` injected so tests never
spawn a process. Returns `{ contradictions }`. **Does not** call `applyPayload`.

## Error handling

- Empty/whitespace draft → throw, name the problem, usage hint, non-zero exit.
- Agent throws/times out → surface the error, non-zero exit (no partial output).
- Malformed payload → throw naming what failed (consistent with `parsePayload`).

## Testing

- `lib/prompt.test.mjs` — `buildCheckPrompt` embeds the draft text, names the
  sources, and requests the `CHECK_PAYLOAD_SHAPE`.
- `lib/payload.test.mjs` — `parseCheckPayload` parses a valid block; rejects a
  missing key, a bad `severity`, a bad entity `type`, an unsafe entity `name`;
  accepts empty `contradictions`.
- `lib/check.test.mjs` (or extend `run.test.mjs`) — `runCheck` returns parsed
  contradictions from a stub `runAgent`; never writes to the vault (assert no
  files created in a tmp vault).
- All tests use a stub `runAgent`; no process, no network.

## Decisions (locked 2026-07-07)

1. **Payload fields** — keep the three (`draftClaim` / `conflict` / `evidence`).
   Structured and testable; revisit only if it proves too rigid in real use.
2. **Scope default** — whole vault; `--project` / `--team` narrow it. Acceptable at
   current personal-vault size; revisit if token cost bites.
3. **Orchestrator home** — new `lib/check.mjs`, a distinct read-only path separate
   from the `sync` writer in `lib/run.mjs`.

## Non-goals

- No Slack/editor/browser hooks (that's the later, hook-based intercept).
- No sending, no file writes, no vault mutation.
- No `--strict` / CI gate mode yet.
- No new runtime dependencies. ESM `.mjs`, Node built-ins, `node:test`.
