# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

Vigil — a personal, single-operator org-intelligence CLI. It pulls the user's
work activity (TalkTrack meeting transcripts + Slack/GitHub/Atlassian/Outlook via
the configured AI agent's MCP servers) into a git-tracked markdown vault sorted by
person/project/team, and rewrites a managed analysis section per file (status,
needs, what they don't know, follow-ups, recommended actions with drafts).

It observes and advises only — it never sends messages or takes actions. Humans
decide. Do not add autonomous action-taking without revisiting this.

Design + plan: `docs/2026-06-30-vigil-design.md`,
`docs/superpowers/plans/2026-06-30-vigil-v1.md`.

## Commands

```bash
npm test                              # node --test — full suite (46 tests)
node --test lib/vault.test.mjs        # one test file
./sync                                # run the CLI (calls `codex exec`)
./sync <person> --source slack        # scoped run
./sync --dry-run                      # compute changes, write nothing
```

## Architecture

Data flow: `parseArgs → buildPrompt → runAgent → parsePayload → applyPayload → vault helpers`.

The central design decision: **the AI agent returns one fenced JSON payload;
deterministic JS writes the files.** The LLM never edits files directly. This is
what makes re-runs idempotent and guarantees hand-written notes are never
clobbered. Preserve this boundary — do not move file-writing into the prompt.

The agent is pluggable: `runAgent(prompt) -> Promise<string>` is injected into
`runSync`, so tests never spawn a process. The `sync` executable builds the real
`runAgent` from `vigil.config.json` (see `lib/agent.mjs`). The prompt is
agent-agnostic — it names the sources but not any one agent's MCP config path.

- **`lib/args.mjs`** — `parseArgs(argv)` → `{scope, sources, dryRun}`. `VALID_SOURCES`.
- **`lib/prompt.mjs`** — `buildPrompt({scope,sources,vaultDir})` and `PAYLOAD_SHAPE`
  (the JSON contract embedded in the prompt). This contract is the source of truth
  the parser and renderer must agree with. Kept agent-agnostic (no codex-specific
  config path).
- **`lib/agent.mjs`** — `resolveAgent(vaultDir)` reads `vigil.config.json`
  (`agentCmd` array; defaults to `["codex","exec"]`), `buildAgentArgv(cmd,prompt)`
  (substitutes a `{prompt}` token or appends the prompt), `makeRunAgent(cmd)`
  returns the real spawner. Invalid config throws — no silent fallback.
- **`lib/payload.mjs`** — `parsePayload(stdout)` / `extractJsonBlock`. Validates the
  payload; rejects path-unsafe entity names (no `/`, `\`, `..`).
- **`lib/vault.mjs`** — pure string/path helpers. `spliceManagedSection` (only
  touches text between the `VIGIL:ANALYSIS` markers), `appendLog` (exact-line
  dedup so re-runs don't duplicate), `renderAnalysis(entity, now)` (`now` injected
  for deterministic tests).
- **`lib/apply.mjs`** — `applyPayload(vaultDir, payload, {dryRun, now})`. Writes
  entity files, archives consumed transcripts to `transcripts/processed/`.
- **`lib/run.mjs`** — `runSync({argv, vaultDir, runAgent})`. `runAgent` is injected
  so tests never spawn a process or hit the network.
- **`sync`** — executable. Resolves the agent from config and spawns it (plain
  mode, NOT `--json`: plain mode prints only the final agent message, which holds
  the ```json block).

## MCP server (`mcp/`)

`mcp/` is a separate subpackage that exposes the vault to any agent as MCP tools
(`list_entities`, `read_entity`, `list_followups`, `search`, `upsert_analysis`).
It is the conversational/interactive alternative to the `sync` CLI.

- **`mcp/tools.mjs`** — handler logic (pure-ish, `vaultDir`-parameterized, unit
  tested). `upsert_analysis` reuses `lib/apply.mjs` + `lib/vault.mjs`, so the
  managed-section splice / log dedup / path-safety guarantees hold identically to
  the CLI. The LLM never edits files directly here either.
- **`mcp/server.mjs`** — thin `@modelcontextprotocol/sdk` wiring (McpServer +
  StdioServerTransport + zod schemas). Vault dir from `VIGIL_VAULT`, defaults to
  repo root. Read tools are annotated read-only; `upsert_analysis` is idempotent,
  non-destructive.
- **Dependency isolation:** `mcp/` has its own `package.json` (SDK + zod). The
  root/core `lib/` stays zero-dep. Do not pull the SDK into `lib/`.
- Path safety + type validation live in `mcp/tools.mjs` (`assertName`/`assertType`)
  before anything hits the filesystem — same guard as `parsePayload`.

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

## Parallel work (Connor + agents simultaneously)

- One git worktree per task: `git worktree add ../vigil-wt-<topic> -b <topic>`
  (or Claude Code's built-in worktree isolation). Zero-dep core means no install
  step per worktree; `npm test` runs anywhere. Merge to main only with the suite
  green.
- Vault data (`people/`, `projects/`, `teams/`, `transcripts/`) exists only in
  the main checkout — it is gitignored, so worktrees see empty folders. Code
  work in worktrees can never touch real work data.
- **One vault writer at a time.** There is no write lock yet: do not run `./sync`
  and MCP `upsert_analysis` against the main checkout concurrently.
- `AGENTS.md` mirrors this file for non-Claude agents (Codex at work). Keep the
  two in sync when either changes.
