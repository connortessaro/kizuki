# Kizuki — design (v1, weekend build)

## Problem
Connor (solo SWE) doesn't struggle with coding — he struggles tracking what different people/teams want, what they know and don't know, and what still needs to happen, across many channels. He wants a personal tool that ingests his work communication, organizes it by person/project/team, and tells him his next best move: who to follow up with, what to say, whether to write a Confluence doc or send a Slack message — with a draft ready to use.

Not a team product. A single-operator "chief of staff" tool for himself. Validation-first: if the output actually tells him something he didn't know and changes what he does, there may be a startup underneath. Judge v1 by that alone.

## Non-negotiable scope discipline
The whole system is a **folder convention + prompts run by `codex exec`**. No new app, no database, no custom pipeline service, no second UI. Transcription, MCP connectors, and LLM analysis are all commodity pieces already available; the only thing being built is the folder layout, the prompts, and thin sync scripts around `codex exec`. If a step tries to add a service/DB/app, it's out of scope.

## Components

### 1. Vault (storage)
Plain markdown, git-tracked, opened in Connor's own editor (Obsidian/VSCode). No DB.
```
people/<name>.md      # frontmatter: role, team, manager. body: raw log + analysis section
projects/<name>.md    # frontmatter: status, stakeholders. body: raw log + status/analysis
teams/<name>.md       # frontmatter: members. body: rollup
transcripts/          # raw TalkTrack output lands here (gitignored if desired)
prompts/              # the codex exec prompt templates
```

### 2. Capture (external, not built)
TalkTrack (github.com/ObscureAintSecure/TalkTrack) records Zoom/Teams/Meet locally, Whisper transcription + speaker ID, writes transcript files into `transcripts/`.

### 3. Sync (manual, selective)
A thin shell script that invokes `codex exec` (non-interactive Codex CLI mode; uses the MCP servers already in `~/.codex/config.toml` — Atlassian/Rovo, Slack, GitHub, Outlook — no auth code to write). The prompt instructs Codex to read new transcripts + pull recent activity from the chosen sources, then append raw entries into the correct person/project/team files.

Selective by design:
- `sync` — everything
- `sync <person>` — just that person across sources
- `sync --source slack` (or a subset) — only chosen sources
Connor chooses what gets pulled and what stays out.

### 4. Analysis (auto, same run)
Immediately after sync, the same `codex exec` pass rewrites a managed section in each touched file:
- **people/**: Status · What they need · What they don't know · Follow-ups · **Recommended actions** (each with a copy-paste draft — Slack message, Confluence doc outline, etc.)
- **projects/**: Status · Blockers · Open questions · **Recommended actions**
The managed section is delimited so re-runs replace it cleanly without clobbering raw log or hand notes.

### 5. Interface
None. Open the vault. Git history gives change tracking for free.

## Out of scope for v1 (defer, don't build)
- Any GUI/TUI/web dashboard.
- Background scheduler/cron (manual sync only).
- Auto-executing actions (it recommends + drafts; Connor sends). Advisory only.
- Voice speaker-recognition beyond what TalkTrack gives.
- The "startup" version (org graph as a product, multi-user). Only pursue after v1 proves the output is useful.

## Verification
- Seed a few real people/project files (frontmatter + a couple real log lines).
- Run one real meeting through TalkTrack → transcript in `transcripts/`.
- `sync <that person>` → confirm entries land in the right file, no cross-contamination.
- Confirm the analysis section produces a non-generic follow-up + a usable draft (the whole test: does it say something Connor didn't already know?).
- `sync --source slack` on one person → confirm only Slack was pulled, scoping works.
