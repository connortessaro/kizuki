# Payload schema versioning — design

Date: 2026-07-07
Status: approved

## What

The agent payload contract gains an explicit schema version so future contract
changes fail loudly instead of half-parsing. `PAYLOAD_SHAPE` (the contract
embedded in the prompt) declares `"version": 1`; `parsePayload` validates it.

## Decisions

- **Missing version = version 1.** Existing agent behavior (and any cached
  prompts) omit the field; treating absence as 1 keeps re-runs working. Any
  present value other than the integer `1` — including the string `"1"` —
  rejects loudly: `payload version <value> not supported (expected 1)`.
- **`PAYLOAD_VERSION` lives in `lib/payload.mjs`** (the parser owns
  validation); `lib/prompt.mjs` imports it so the shape and the parser can
  never drift. No circular import (`payload.mjs` imports nothing).

## Changes

- `lib/payload.mjs`: export `PAYLOAD_VERSION = 1`; `parsePayload` checks
  `data.version` (when present) equals `PAYLOAD_VERSION` before the entity
  loop.
- `lib/prompt.mjs`: `PAYLOAD_SHAPE` gains `version: PAYLOAD_VERSION` as its
  first key, so every generated prompt shows `"version": 1` in the JSON
  contract.

## Testing

- `lib/payload.test.mjs`: accepts `version: 1`; accepts missing version;
  rejects `version: 2` and `version: "1"` with the exact message.
- `lib/prompt.test.mjs`: `buildPrompt` output contains `"version": 1`.

## Non-goals

- No migration machinery, no multi-version parsing — one supported version;
  the check exists so a future v2 is a deliberate, visible change.
