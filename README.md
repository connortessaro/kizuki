# OrgMind

Personal org-intelligence tool. Pulls work activity (TalkTrack transcripts + MCP
servers via `codex exec`) into a markdown vault sorted by person/project/team,
and rewrites a managed analysis section per file with status, follow-ups, and
copy-paste-ready recommended actions.

## Usage

    ./sync                     # all people/projects/teams, all sources
    ./sync bob-smith           # only this person, all sources
    ./sync --source slack      # all entities, only Slack
    ./sync bob-smith --source slack,github
    ./sync --dry-run           # show what would change, write nothing

## Requirements

- Node >= 20
- OpenAI Codex CLI (`codex`) with MCP servers configured in `~/.codex/config.toml`
  (slack, github, atlassian/rovo, outlook)
- TalkTrack writing transcript files into `transcripts/`

## WARNING

This repo contains internal work data and meeting transcripts. It is for local
use only. Do NOT add a remote or push it anywhere.
