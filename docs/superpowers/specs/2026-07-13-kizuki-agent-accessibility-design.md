# Kizuki — agent accessibility (any LLM, any agent)

**Date:** 2026-07-13
**Status:** design approved, pre-implementation

## Goal

Kizuki today runs best on codex (default `agentCmd`) with claude/codex ritual
exports. Make it usable from any agent: more skills-export targets, config
presets for common CLI agents, a direct OpenAI-compatible HTTP agent so no CLI
is required at all, and documentation that the MCP vault surface already works
from any MCP client.

Fits the v4 "others can discover, install, and run Kizuki" milestone. No new
runtime dependencies; zero-dep core preserved.

## Slice 1 — skills-export targets

Extend `TARGETS` in `lib/skills.mjs`:

| Target | Home path | Render |
|---|---|---|
| `claude` (existing) | `~/.claude/skills/<name>/SKILL.md` | frontmatter + body |
| `codex` (existing) | `~/.codex/prompts/<name>.md` | body |
| `cursor` (new) | `~/.cursor/rules/<name>.mdc` | `.mdc` frontmatter (`description`, `alwaysApply: false`) + body |
| `gemini` (new) | `~/.gemini/commands/<name>.toml` | TOML with `description` and `prompt` (body as multi-line string) |
| `generic` (new) | dist-only (`dist/skills/generic/<name>.md`) | body with a one-line header comment naming the ritual |

- `--agent` accepts the new names; `all` includes cursor + gemini home installs
  (generic is dist-only — no home path; requesting `--agent generic` without
  `--dist`/`--check` errors loudly).
- `--dist`/`--check` cover all five target trees.
- Implementation step verifies the exact Cursor `.mdc` and Gemini CLI custom
  command formats against current official docs (WebFetch) before coding the
  renderers; the committed `dist/` output is the contract the tests lock in.

## Slice 2 — agent presets

- `AGENT_PRESETS` in `lib/agent.mjs`: `codex` → `["codex","exec"]`, `claude` →
  `["claude","-p"]`, `gemini` → `["gemini","-p"]`, `opencode` →
  `["opencode","run"]`. Implementation verifies each CLI's non-interactive
  prompt flag against current docs; presets are data, not new code paths.
- `kizuki init --agent <preset|http>` writes the matching config
  (`agentCmd: PRESETS[name]`, or the `agentHttp` template for `http`).
  Default stays codex; invalid name → loud error listing valid presets.
- README gains a "Works with" matrix (codex, Claude Code, Gemini CLI,
  opencode, any OpenAI-compatible API, any MCP client for the vault tools).
- `kizuki doctor` agent check already spawns whatever is configured — no
  change needed beyond accepting `agentHttp` (slice 3).

## Slice 3 — OpenAI-compatible HTTP agent

The pluggable boundary stays `runAgent(prompt) -> Promise<string>`; this slice
adds a second factory behind it.

### Config

`kizuki.config.json` gains an alternative to `agentCmd`:

```json
{
  "agentHttp": {
    "baseUrl": "https://api.deepseek.com/v1",
    "model": "deepseek-chat",
    "apiKeyEnv": "DEEPSEEK_API_KEY"
  },
  "timeoutMs": 300000
}
```

- Exactly one of `agentCmd` / `agentHttp` may be set — both or a malformed
  `agentHttp` throw loudly in `resolveAgent` (which now returns
  `{kind: "cmd"|"http", ...}`).
- `apiKeyEnv` names the env var; the key itself never enters the config file.
  Missing env var at run time → loud error naming the variable.

### Runner — `lib/agentHttp.mjs` (new, zero-dep, global `fetch`)

`makeRunAgentHttp({baseUrl, model, apiKeyEnv, timeoutMs})` → `runAgent(prompt)`:
POST `<baseUrl>/chat/completions` with
`{model, messages: [{role: "user", content: prompt}]}`, bearer auth from the
env var, `AbortController` timeout. Returns
`choices[0].message.content`; non-2xx or empty content → loud error with
status + body tail. Injectable `fetchImpl` for tests (no network in the
suite).

### Capability gating

HTTP agents have no MCP servers and no filesystem, so:

- **`check` + day-summary prose:** work unchanged — their prompts already
  inline the vault context / day facts.
- **`sync`:** only the `transcript` source is possible, and transcript file
  contents must be inlined into the prompt. `runSync` learns the agent kind;
  with `kind: "http"` it (a) errors loudly if requested sources include
  anything but `transcript`, (b) reads pending transcripts and appends their
  contents to the prompt under a clearly delimited section (per-file header,
  total size cap ~200KB — over the cap → loud error telling the operator to
  sync fewer transcripts or use a CLI agent). The payload contract and
  `applyPayload` are untouched.
- Smoke test in `doctor` works for both kinds (http smoke = trivial prompt
  round-trip).

## Slice 4 — MCP-client docs

- README section: "Connect any MCP client" — `mcp/server.mjs` +
  `KIZUKI_VAULT` env, tool list, one config snippet each for Claude Code and
  a generic `mcpServers` JSON block. States it works today with any
  MCP-capable agent.
- Landing "RUN IT" section gains one sentence naming the wider compatibility
  (agents list matches the README matrix).

## Testing

TDD, `node:test`, no network/process spawns: `lib/skills.test.mjs` extended
for the three new targets + dist/check coverage; `lib/agent.test.mjs` for
preset resolution + `agentHttp` config validation (both-set, malformed,
missing env); new `lib/agentHttp.test.mjs` with injected `fetchImpl` (success,
non-2xx, empty content, timeout); `lib/run.test.mjs` extended for http-kind
source gating + transcript inlining + size cap; init test for `--agent`.

## Safety invariants

- Zero runtime dependencies (global `fetch` is a Node built-in).
- API keys only via env var indirection; never written to config or logs.
- Payload boundary unchanged: deterministic JS still owns all file writes
  regardless of agent kind.

## Non-goals

Windows/Linux shift support, MCP action tools, streaming, retries/model
fallback in the HTTP runner, per-agent prompt tuning.
