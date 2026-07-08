# AGENTS.md

Guidance for AI agents (Codex and others) working in this repository. Claude
Code reads `CLAUDE.md`, which carries the full detail — this file mirrors the
rules that matter for any agent. Keep the two in sync.

## What this is

Kizuki — a personal, single-operator org-intelligence CLI + MCP server. It pulls
work activity (meeting transcripts + Slack/GitHub/Atlassian/Outlook via the
configured agent's MCP servers) into a git-tracked markdown vault sorted by
person/project/team, and rewrites a managed analysis section per file.

It observes and advises only — it never sends messages or takes actions on its
own. Humans approve every outward action. Do not add autonomous action-taking.

Roadmap (v2–v4): `docs/ROADMAP.md`. Ideation: `docs/BACKLOG.md`.

## Hard rules

- **The AI agent returns one fenced JSON payload; deterministic JS writes the
  files.** Never move file-writing into the prompt or let an LLM edit vault
  files directly.
- ESM `.mjs`, Node built-ins only, zero runtime dependencies in root/`lib/`.
  (`mcp/` has its own package.json for the MCP SDK — keep it isolated there.)
- TDD: failing test first, then implementation. `npm test` green before done.
- No silent failures — throw loudly.
- `spliceManagedSection` must never touch content outside the
  `KIZUKI:ANALYSIS` markers; `appendLog` dedup is exact full-line match; entity
  names are validated path-safe before touching the filesystem.

## Web dashboard (`web/`)

`web/` is a Next.js subpackage (own `package.json` — Next/React/react-markdown
stay out of the zero-dep core, same isolation as `mcp/`). Read-only browser UI
for the vault: entity browser, follow-ups, day summaries, search.

- **`web/lib/data.mjs`** — the only module that touches the vault. Plain `.mjs`
  reusing `lib/query.mjs`/`lib/vault.mjs` (guards included); `node:test`-tested,
  picked up by the root suite.
- Pages are thin server components with `dynamic = "force-dynamic"` (fresh read
  per load). No API routes, no client fetching, **no writes** — adding any
  write/action to the dashboard requires revisiting the observe-and-advise rule.
- Entity/date URL params are validated (`assertName`-equivalent guard + date
  regex) before touching the filesystem.

## Commands

```bash
npm test                       # full suite (194 tests)
node --test lib/vault.test.mjs # one file
./kizuki init                  # create vault dirs + default config
./kizuki sync                  # run the sync CLI (spawns configured agent)
./kizuki sync --project <name> # project scope
./kizuki sync --team <name>    # team scope
./kizuki sync --dry-run        # compute changes, write nothing
./kizuki watch                 # auto-sync on new transcripts
./kizuki start                 # begin shift: sync + brief + 30-min background sync
./kizuki stop                   # end shift: final sync + day summary + remove background sync
./kizuki doctor                        # diagnose setup: config, agent binary, smoke test, vault dirs
./kizuki doctor --no-smoke             # skip the agent smoke test (it boots the real agent + MCP, costs tokens)
./kizuki doctor --check-only           # read-only: report missing vault dirs instead of creating them
```

## Parallel work

- One git worktree per task: `git worktree add ../kizuki-wt-<topic> -b <topic>`.
  No install step needed; run `npm test` in the worktree.
- Vault data (`people/`, `projects/`, `teams/`, `transcripts/`, `alerts/`) is gitignored
  and exists only in the main checkout. Never force-add it, never push it.
- Write lock: `applyPayload` serializes writers via `state/vault.lock` (30s
  wait then loud failure; stale locks stolen by PID liveness). Concurrent
  sync and MCP upserts are safe.
