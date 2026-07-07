# Payload schema versioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The agent payload contract carries `"version": 1`, and `parsePayload` rejects any other version loudly.

**Architecture:** `PAYLOAD_VERSION` const in `lib/payload.mjs` (parser owns validation); `lib/prompt.mjs` imports it into `PAYLOAD_SHAPE` so contract and parser cannot drift.

**Tech Stack:** Node built-ins only (ESM `.mjs`), `node:test` + `node:assert/strict`.

Spec: `docs/superpowers/specs/2026-07-07-payload-versioning-design.md`

## Global Constraints

- Zero runtime dependencies in `lib/`. ESM `.mjs`. TDD; `npm test` green before commit.
- Missing `version` field = accepted as version 1 (back-compat). Any other present value — including string `"1"` — throws exactly: `payload version <JSON.stringify(value)> not supported (expected 1)`.
- The version check runs before the entity loop; all existing `parsePayload` validation and defaults unchanged.

---

### Task 1: version in contract + parser

**Files:**
- Modify: `lib/payload.mjs` (add `PAYLOAD_VERSION`, version check in `parsePayload`)
- Modify: `lib/prompt.mjs:1` (`PAYLOAD_SHAPE` gains `version` as first key)
- Test: `lib/payload.test.mjs`, `lib/prompt.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `PAYLOAD_VERSION = 1` exported from `lib/payload.mjs`; `PAYLOAD_SHAPE.version === 1`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/payload.test.mjs` (a `wrap` helper for fenced payloads may already exist — reuse the file's existing pattern for building `parsePayload` input; the payloads below are shown bare):

```js
test("parsePayload accepts version 1", () => {
  const data = parsePayload('```json\n{"version": 1, "entities": []}\n```');
  assert.deepEqual(data.entities, []);
});

test("parsePayload accepts a payload without a version field", () => {
  const data = parsePayload('```json\n{"entities": []}\n```');
  assert.deepEqual(data.entities, []);
});

test("parsePayload rejects unsupported versions loudly", () => {
  assert.throws(
    () => parsePayload('```json\n{"version": 2, "entities": []}\n```'),
    /payload version 2 not supported \(expected 1\)/
  );
  assert.throws(
    () => parsePayload('```json\n{"version": "1", "entities": []}\n```'),
    /payload version "1" not supported \(expected 1\)/
  );
});
```

Append to `lib/prompt.test.mjs`:

```js
test("prompt contract declares payload version 1", () => {
  const prompt = buildPrompt({ scope: { kind: "all" }, sources: ["slack"], vaultDir: "/v" });
  assert.match(prompt, /"version": 1/);
});
```

(Adjust the `buildPrompt` arguments to match the file's existing test calls if they differ — reuse the same scope/sources fixtures the neighboring tests use.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test lib/payload.test.mjs lib/prompt.test.mjs`
Expected: FAIL — the two rejection asserts and the prompt match fail (no version handling yet); the two acceptance tests pass already (fine — they pin back-compat).

- [ ] **Step 3: Implement**

`lib/payload.mjs` — add at top:

```js
export const PAYLOAD_VERSION = 1;
```

In `parsePayload`, insert after the `payload missing entities array` check:

```js
  if (data.version !== undefined && data.version !== PAYLOAD_VERSION) {
    throw new Error(`payload version ${JSON.stringify(data.version)} not supported (expected ${PAYLOAD_VERSION})`);
  }
```

`lib/prompt.mjs` — add import and make `version` the first key of `PAYLOAD_SHAPE`:

```js
import { PAYLOAD_VERSION } from "./payload.mjs";

export const PAYLOAD_SHAPE = {
  version: PAYLOAD_VERSION,
  entities: [
```

(rest of the shape unchanged).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test lib/payload.test.mjs lib/prompt.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run full suite and commit**

Run: `npm test`
Expected: all pass.

```bash
git add lib/payload.mjs lib/prompt.mjs lib/payload.test.mjs lib/prompt.test.mjs
git commit -m "feat(payload): schema version 1 in contract and parser"
```
