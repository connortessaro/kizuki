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

## Commands

```bash
npm test                       # full suite
node --test lib/vault.test.mjs # one file
./kizuki sync                   # run the sync CLI (spawns configured agent)
./kizuki sync --dry-run         # compute changes, write nothing
./kizuki start                  # begin shift: sync + brief + 30-min background sync
./kizuki stop                   # end shift: final sync + day summary + remove background sync
```

## Parallel work

- One git worktree per task: `git worktree add ../kizuki-wt-<topic> -b <topic>`.
  No install step needed; run `npm test` in the worktree.
- Vault data (`people/`, `projects/`, `teams/`, `transcripts/`) is gitignored
  and exists only in the main checkout. Never force-add it, never push it.
- One vault writer at a time — no write lock exists yet.
