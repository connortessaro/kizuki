# Kizuki — LLM-written day summary

**Date:** 2026-07-07
**Status:** design approved, pre-implementation
**Backlog origin:** `docs/ROADMAP.md` unranked appendix — "LLM-written day summary
(deterministic aggregate is v1; prose summary later)."

## Goal

At `./kizuki stop`, prepend a prose **Summary** section to the day file. The prose
synthesizes the day across people/projects, flags what is slipping or at risk, and
names 2-3 priorities for tomorrow. The existing deterministic aggregate
(Activity / Alerts / Open follow-ups) stays verbatim below the prose.

This matches Kizuki's mission — surface what you would otherwise miss — while
keeping the auditable evidence trail and a zero-cost fallback intact.

## Boundary preservation

The central design invariant holds: **the LLM produces text, deterministic JS
writes the file.** The prose call is grounded in the deterministic aggregate
(passed as the prompt's input), so the model cannot invent activity beyond what
is logged. This is a plain-prose call — NOT a JSON payload call — so it does not
touch `parsePayload` / `applyPayload` or the payload version.

## Data flow

```
renderDaySummary(vaultDir, dateStr)          # unchanged — builds facts markdown
  → (if no logged activity) write facts-only, skip agent
  → buildDaySummaryPrompt(factsMarkdown)     # new
  → runAgent(prompt) → prose string          # injected, same pattern as sync
  → "## Summary\n\n{prose}\n\n" + facts      # prepend prose above facts
  → write days/YYYY-MM-DD.md
```

## Components

### `lib/shift.mjs`

- **`buildDaySummaryPrompt(factsMarkdown)`** — new pure function. Returns a prompt
  that instructs the agent to:
  - Read the day's Activity / Alerts / Open follow-ups (embedded below).
  - Write 1-2 short paragraphs: what happened across people/projects, what is at
    risk or slipping.
  - End with a `Tomorrow:` line naming 2-3 priorities.
  - Cite only what appears in the facts; add no outside information.
  - Return plain prose only — no fenced JSON, no markdown headings (the caller
    owns the `## Summary` heading).

- **`writeDaySummary(vaultDir, { now = new Date(), runAgent } = {})`** — signature
  extended with an injected optional `runAgent`.
  - Build facts via `renderDaySummary` (unchanged).
  - If the facts contain no logged activity (the `(no logged activity)` marker),
    skip the agent call and write facts-only.
  - If `runAgent` is omitted/null, write facts-only (current behavior — keeps
    existing tests and callers working unchanged).
  - Otherwise call `runAgent(buildDaySummaryPrompt(facts))`:
    - On success: prepend `## Summary\n\n{prose.trim()}\n\n` above the facts.
    - On throw/reject: write facts-only and `console.error` a loud warning
      (`kizuki day summary: prose generation failed: <message>`). The `stop`
      ritual still completes. (Honors "no silent failures" — the error is
      surfaced, not swallowed — while staying robust to transient LLM hiccups.)
  - Return the written path (unchanged).

### `kizuki` executable

- `stop` currently resolves the agent for its final `doSync`, then calls
  `writeDaySummary(vaultDir)` with no agent. Change: resolve the agent once and
  pass `runAgent: makeRunAgent(cmd, timeoutMs)` into `writeDaySummary`.

## Error handling

- Agent failure → facts-only + stderr warning (never aborts `stop`).
- No logged activity → skip agent, facts-only.
- No `runAgent` injected → facts-only (deterministic; test/programmatic callers).

## Testing (`lib/shift.test.mjs`)

- Prose is prepended above the facts when `runAgent` returns text.
- `runAgent` throw → file is facts-only AND a warning is emitted (assert via a
  captured `console.error` or stderr spy).
- No `runAgent` injected → facts-only, byte-identical to current output.
- Empty day (no logged activity) → agent is NOT called; facts-only.
- `buildDaySummaryPrompt` embeds the facts markdown and requests prose-only.

All `runAgent` usage in tests is a stub — no process spawned, no network, matching
the existing `runSync` test pattern.

## Non-goals

- No change to the sync payload contract or payload version.
- No prose in `renderDaySummary` itself (stays deterministic and pure — the prose
  lives only in the `writeDaySummary` write path).
- No dashboard changes (the `web/` day view renders the file as-is; the new
  `## Summary` heading renders for free).
- No new npm dependencies. ESM `.mjs`, Node built-ins only.
