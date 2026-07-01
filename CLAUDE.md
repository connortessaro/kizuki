# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

OrgMind — a personal, single-operator org-intelligence CLI. It pulls the user's
work activity (TalkTrack meeting transcripts + Slack/GitHub/Atlassian/Outlook via
`codex exec` MCP servers) into a git-tracked markdown vault sorted by
person/project/team, and rewrites a managed analysis section per file (status,
needs, what they don't know, follow-ups, recommended actions with drafts).

It observes and advises only — it never sends messages or takes actions. Humans
decide. Do not add autonomous action-taking without revisiting this.

Design + plan: `docs/2026-06-30-orgmind-design.md`,
`docs/superpowers/plans/2026-06-30-orgmind-v1.md`.

## Commands

```bash
npm test                              # node --test — full suite (46 tests)
node --test lib/vault.test.mjs        # one test file
./sync                                # run the CLI (calls `codex exec`)
./sync <person> --source slack        # scoped run
./sync --dry-run                      # compute changes, write nothing
```

## Architecture

Data flow: `parseArgs → buildPrompt → runCodex → parsePayload → applyPayload → vault helpers`.

The central design decision: **`codex exec` returns one fenced JSON payload;
deterministic JS writes the files.** The LLM never edits files directly. This is
what makes re-runs idempotent and guarantees hand-written notes are never
clobbered. Preserve this boundary — do not move file-writing into the prompt.

- **`lib/args.mjs`** — `parseArgs(argv)` → `{scope, sources, dryRun}`. `VALID_SOURCES`.
- **`lib/prompt.mjs`** — `buildPrompt({scope,sources,vaultDir})` and `PAYLOAD_SHAPE`
  (the JSON contract embedded in the prompt). This contract is the source of truth
  the parser and renderer must agree with.
- **`lib/payload.mjs`** — `parsePayload(stdout)` / `extractJsonBlock`. Validates the
  payload; rejects path-unsafe entity names (no `/`, `\`, `..`).
- **`lib/vault.mjs`** — pure string/path helpers. `spliceManagedSection` (only
  touches text between the `ORGMIND:ANALYSIS` markers), `appendLog` (exact-line
  dedup so re-runs don't duplicate), `renderAnalysis(entity, now)` (`now` injected
  for deterministic tests).
- **`lib/apply.mjs`** — `applyPayload(vaultDir, payload, {dryRun, now})`. Writes
  entity files, archives consumed transcripts to `transcripts/processed/`.
- **`lib/run.mjs`** — `runSync({argv, vaultDir, runCodex})`. `runCodex` is injected
  so tests never spawn `codex` or hit the network.
- **`sync`** — executable. Real `runCodex` spawns `codex exec <prompt>` (plain
  mode, NOT `--json`: plain mode prints only the final agent message, which holds
  the ```json block).

## Conventions (match these)

- **ESM `.mjs`, Node built-ins only. Zero runtime dependencies.** Do not add npm
  packages. Tests use `node:test` + `node:assert`.
- **TDD.** Every change: failing test first, then implementation. Keep the suite
  green (`npm test`) before claiming done.
- No comments unless non-obvious. Pure functions where possible.
- **No silent failures.** Parser/pipeline throw loudly; the only intentional
  "coerce missing to ""/[]" is the faithful-render contract in vault/render.

## Safety invariants (do not break)

- `spliceManagedSection` must never modify content outside the analysis markers.
- `appendLog` dedup uses **exact full-line** match (not substring) — a new entry
  that is a prefix of an existing line must still be appended.
- Entity names are validated path-safe in `parsePayload` before ever hitting the
  filesystem in `entityPath`/`applyPayload`.

## Data safety

`people/`, `projects/`, `teams/`, and `transcripts/` are gitignored — they hold
internal work data. Only code + empty folder structure is tracked. Never
force-add files under those folders; never push work data to a remote.
