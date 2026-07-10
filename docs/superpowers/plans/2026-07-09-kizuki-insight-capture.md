# Kizuki Insight Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit "Kizuki this" capture from Codex/Cursor into durable, searchable, epistemically labeled insight history.

**Architecture:** New root insight ledger owns validation, identity, reduction, lifecycle, and atomic storage. Focused CLI and MCP adapters call that deterministic core under existing vault lock. Sync, check, and search read active insight snapshots; capture never rewrites entity or signal state.

**Tech Stack:** ESM `.mjs`, Node built-ins in root/`lib/`, `node:test`, existing MCP SDK + Zod inside `mcp/`.

## Global Constraints

- Root and `lib/` stay ESM `.mjs`, Node built-ins only, zero runtime dependencies.
- MCP dependencies stay isolated under `mcp/`.
- Agent proposes structured data; deterministic JavaScript validates and writes.
- All insight mutations use `state/vault.lock`.
- `insights/events.jsonl` stays gitignored and append-only.
- Capture requires explicit user intent. Never read Codex/Cursor sessions automatically.
- Never store full chats or raw tool output.
- Hypotheses/questions remain unverified. Insight alone cannot create signal receipt.
- Preserve main checkout `transcripts/.gitkeep` deletion.
- Write failing tests first. Keep `npm test` green.

---

### Task 1: Insight ledger core

**Files:**
- Create: `lib/insights.mjs`
- Create: `lib/insights.test.mjs`

**Interfaces:**
- Consumes: `assertName(name)` and `TYPES` from `lib/query.mjs`.
- Produces: `INSIGHT_KINDS`, `INSIGHT_STATUSES`, `ORIGIN_CLIENTS`, `validateInsightInput(input)`, `insightIdentity(input)`, `readInsightEvents(vaultDir)`, `reduceInsightEvents(events)`, `planInsightCapture(events, input, { now })`, `planInsightArchive(events, transition, { now })`, `writeInsightEventsAtomic(vaultDir, events, deps)`.
- Reduced state shape: `{ insightId, dedupeKey, status, kind, summary, context, entities, origin, capturedAt, lastEventAt }`.
- Capture planner result: `{ insightId, disposition: "created"|"exact-repeat", event, state }`; `event` null only for exact repeat.

- [ ] **Step 1: Write failing identity, validation, reducer, planner, and writer tests**

Create fixtures and core tests:

~~~js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  insightIdentity,
  planInsightArchive,
  planInsightCapture,
  readInsightEvents,
  reduceInsightEvents,
  validateInsightInput,
  writeInsightEventsAtomic,
} from "./insights.mjs";

const FIXED = new Date("2026-07-09T20:00:00Z");
const BASE = {
  kind: "hypothesis",
  summary: "STAFF may need per-FC manifests.",
  context: "Reasoning from the bundle contract.",
  entities: [{ type: "project", name: "staff" }],
  origin: { client: "codex", locator: "thread-1/turn-2" },
};

test("identity normalizes text and entity order", () => {
  const left = insightIdentity({
    ...BASE,
    summary: "  STAFF may need per-FC manifests.  ",
    entities: [
      { type: "team", name: "ors" },
      { type: "project", name: "staff" },
    ],
  });
  const right = insightIdentity({
    ...BASE,
    entities: [
      { type: "project", name: "staff" },
      { type: "team", name: "ors" },
    ],
  });
  assert.equal(left.insightId, right.insightId);
  assert.equal(left.dedupeKey, right.dedupeKey);
});

test("exact retry adds no event", () => {
  const first = planInsightCapture([], BASE, { now: FIXED });
  const repeat = planInsightCapture([first.event], BASE, { now: FIXED });
  assert.equal(first.disposition, "created");
  assert.equal(repeat.disposition, "exact-repeat");
  assert.equal(repeat.event, null);
});

test("archive is terminal", () => {
  const capture = planInsightCapture([], BASE, { now: FIXED });
  const archived = planInsightArchive([capture.event], {
    insightId: capture.insightId,
    note: "No longer useful",
  }, { now: new Date("2026-07-09T21:00:00Z") });
  const events = [capture.event, archived];
  assert.equal(reduceInsightEvents(events).get(capture.insightId).status, "archived");
  assert.throws(
    () => planInsightArchive(events, { insightId: capture.insightId }, { now: FIXED }),
    /already archived/,
  );
});

test("atomic writer preserves prior ledger on rename failure", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-insights-"));
  await mkdir(join(vault, "insights"), { recursive: true });
  const first = planInsightCapture([], BASE, { now: FIXED }).event;
  await writeInsightEventsAtomic(vault, [first]);
  const before = await readFile(join(vault, "insights", "events.jsonl"), "utf8");
  await assert.rejects(
    writeInsightEventsAtomic(vault, [first], {
      rename: async () => { throw new Error("rename failed"); },
    }),
    /rename failed/,
  );
  assert.equal(await readFile(join(vault, "insights", "events.jsonl"), "utf8"), before);
});
~~~

Add named tests for:

- Different kind, wording, entity, client, locator produce different IDs.
- Missing/extra fields, invalid kind/client, blank summary, summary over 500, context over 4,000 fail.
- More than five entities, duplicate refs, bad type/name fail.
- Locator query, fragment, credentials, NUL, signed params fail.
- Missing ledger returns `[]`.
- Malformed JSONL and invalid event report file + line.
- Reducer rejects unknown archive ID, bad order/status/actor, mismatched `from`, identity mismatch, collision.
- Exact recapture after archive remains archived and adds no event.
- Writer emits one JSON object per line, terminal newline, immutable-prefix enforcement, temp cleanup failure reporting.

- [ ] **Step 2: Run core tests and confirm failure**

Run:

~~~bash
node --test lib/insights.test.mjs
~~~

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `lib/insights.mjs`.

- [ ] **Step 3: Implement minimal core**

Use these constants and public signatures:

~~~js
export const INSIGHT_KINDS = Object.freeze([
  "decision",
  "learning",
  "hypothesis",
  "question",
]);
export const INSIGHT_STATUSES = Object.freeze(["active", "archived"]);
export const ORIGIN_CLIENTS = Object.freeze(["codex", "cursor", "other"]);

export function validateInsightInput(input) {}
export function insightIdentity(input) {}
export function reduceInsightEvents(events) {}
export async function readInsightEvents(vaultDir) {}
export function planInsightCapture(events, input, { now = new Date() } = {}) {}
export function planInsightArchive(events, transition, { now = new Date() } = {}) {}
export async function writeInsightEventsAtomic(vaultDir, events, deps = {}) {}
~~~

Implementation rules:

- Reject unknown object fields at top level, entity refs, and origin.
- Normalize by trimming summary/context/locator; default context to `null`, entities to `[]`, locator to `null`.
- Sort cloned entity refs by `type/name`; never mutate caller input.
- Build ID from SHA-256 of exact design dedupe tuple, first 12 hex chars, prefix `ins_`.
- Validate ISO UTC timestamps and `ins_[0-9a-f]{12}` IDs.
- Capture event: `{ version:1,event:"captured",insightId,dedupeKey,at,insight }`.
- Archive event: `{ version:1,event:"insight_archived",insightId,from:"active",to:"archived",at,actor:"user",note }`.
- Note optional, trimmed, max 500, blank rejected when supplied.
- Reducer accepts capture then optional archive only; tracks `capturedAt` and `lastEventAt`.
- Reader parses nonblank JSONL lines, validates full sequence, wraps any error as `<path>:<line>: <message>`.
- Writer mirrors signal writer safety: validate next sequence, verify existing file is exact prefix, create `insights/`, write sibling UUID temp, rename atomically, remove temp on failure, aggregate write + cleanup failures.
- Dependency injection supports `mkdir`, `readFile`, `writeFile`, `rename`, `rm`, `randomUUID`.

- [ ] **Step 4: Run core tests**

Run:

~~~bash
node --test lib/insights.test.mjs
~~~

Expected: all insight core tests PASS.

- [ ] **Step 5: Commit core**

~~~bash
git add lib/insights.mjs lib/insights.test.mjs
git commit -m "feat: add insight ledger core"
~~~

---

### Task 2: Insight lifecycle CLI

**Files:**
- Create: `lib/insightCommands.mjs`
- Create: `lib/insightCommands.test.mjs`
- Modify: `kizuki`

**Interfaces:**
- Consumes Task 1 planners/readers/writer.
- Produces `captureInsight(vaultDir, input, options)`, `listInsightStates(vaultDir, options)`, `readInsight(vaultDir, insightId)`, `archiveInsight(vaultDir, transition, options)`, `runInsightsCommand(vaultDir, argv, options)`, `runInsightCommand(vaultDir, argv, options)`.
- MCP task imports first four functions. CLI imports last two.

- [ ] **Step 1: Write failing service and CLI tests**

~~~js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  archiveInsight,
  captureInsight,
  readInsight,
  runInsightCommand,
  runInsightsCommand,
} from "./insightCommands.mjs";

const input = {
  kind: "learning",
  summary: "Per-FC manifests drive backend lookup.",
  entities: [{ type: "project", name: "staff" }],
  origin: { client: "cursor" },
};

test("capture, list, show, archive, and exact retry", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-insight-cli-"));
  const first = await captureInsight(vault, input, {
    now: new Date("2026-07-09T20:00:00Z"),
  });
  const retry = await captureInsight(vault, input, {
    now: new Date("2026-07-09T20:01:00Z"),
  });
  assert.equal(first.insightId, retry.insightId);
  assert.equal(retry.disposition, "exact-repeat");
  assert.match(await runInsightsCommand(vault, []), new RegExp(first.insightId));
  assert.match(await runInsightCommand(vault, ["show", first.insightId]), /Per-FC manifests/);
  assert.equal((await readInsight(vault, first.insightId)).history.length, 1);
  await archiveInsight(vault, { insightId: first.insightId, note: "absorbed" });
  assert.equal(await runInsightsCommand(vault, []), "No insights.");
  assert.match(await runInsightsCommand(vault, ["--status", "archived"]), /archived/);
});
~~~

Add named tests for:

- Default list active newest first.
- `--status active|archived|all`, `--json`, show JSON history.
- Human row fields match spec.
- Invalid ID/status/options/action, missing ID/note value, unknown ID fail.
- Repeated archive fails.
- Capture/archive honor held vault lock and safe mutation output omits summary/context.

- [ ] **Step 2: Run tests and confirm failure**

~~~bash
node --test lib/insightCommands.test.mjs
~~~

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement service + CLI routing**

Public service behavior:

~~~js
export async function captureInsight(
  vaultDir,
  input,
  { now = new Date(), lock = {} } = {},
) {}

export async function listInsightStates(
  vaultDir,
  { status = "active" } = {},
) {}

export async function readInsight(vaultDir, insightId) {}

export async function archiveInsight(
  vaultDir,
  { insightId, note = null },
  { now = new Date(), lock = {} } = {},
) {}

export async function runInsightsCommand(vaultDir, argv, options = {}) {}
export async function runInsightCommand(vaultDir, argv, options = {}) {}
~~~

Rules:

- Validate capture before acquiring lock; read/replan/write inside lock to prevent race.
- Lock tools: `insight-capture`, `insight-archive`.
- Exact retry performs no write.
- List sort: `capturedAt` descending, then `insightId`.
- Human list: `<id> <status> [<kind>] <entities-or-unscoped> <origin.client> <capturedAt> <summary>`.
- Show human details include context, refs, origin locator, history count.
- Archive mutation response: `<id> active -> archived`; capture response formatter names ID/kind/status only.
- CLI usage gains approved insight commands and routes before `check`.

Add imports/routing to `kizuki`:

~~~js
import { runInsightCommand, runInsightsCommand } from "./lib/insightCommands.mjs";

// command routing
} else if (command === "insights") {
  console.log(await runInsightsCommand(vaultDir, rest));
} else if (command === "insight") {
  console.log(await runInsightCommand(vaultDir, rest));
~~~

- [ ] **Step 4: Run lifecycle tests**

~~~bash
node --test lib/insights.test.mjs lib/insightCommands.test.mjs
~~~

Expected: PASS.

- [ ] **Step 5: Commit CLI**

~~~bash
git add lib/insightCommands.mjs lib/insightCommands.test.mjs kizuki
git commit -m "feat: add insight lifecycle commands"
~~~

---

### Task 3: Search, sync, and check context

**Files:**
- Create: `lib/insightContext.mjs`
- Create: `lib/insightContext.test.mjs`
- Modify: `lib/run.mjs`
- Modify: `lib/run.test.mjs`
- Modify: `lib/prompt.mjs`
- Modify: `lib/prompt.test.mjs`
- Modify: `lib/check.mjs`
- Modify: `lib/check.test.mjs`

**Interfaces:**
- Consumes Task 1 reader/reducer.
- Produces `activeInsightsForScope(vaultDir, scope)`, `formatInsightContext(states)`, `searchActiveInsights(vaultDir, query)`.
- `buildPrompt` gains optional `insightContext = ""`.
- `checkVaultContext` appends formatted insight context.

- [ ] **Step 1: Write failing context selection/search tests**

~~~js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureInsight, archiveInsight } from "./insightCommands.mjs";
import {
  activeInsightsForScope,
  formatInsightContext,
  searchActiveInsights,
} from "./insightContext.mjs";

test("scope selection and search use active insights only", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-insight-context-"));
  const staff = await captureInsight(vault, {
    kind: "hypothesis",
    summary: "Per-FC manifest may be required.",
    entities: [{ type: "project", name: "staff" }],
    origin: { client: "codex" },
  });
  await captureInsight(vault, {
    kind: "question",
    summary: "Who owns Zipcar validation?",
    entities: [{ type: "project", name: "zipcar" }],
    origin: { client: "cursor" },
  });
  assert.equal((await activeInsightsForScope(vault, { kind: "project", name: "staff" })).length, 1);
  assert.equal((await activeInsightsForScope(vault, { kind: "all" })).length, 2);
  assert.equal((await searchActiveInsights(vault, "manifest")).length, 1);
  await archiveInsight(vault, { insightId: staff.insightId });
  assert.equal((await searchActiveInsights(vault, "manifest")).length, 0);
});
~~~

Add tests proving:

- Unscoped included only for all scope.
- Malformed ledger fails search/scope selection.
- Formatter includes ID, kind, capture time, refs, summary, context, origin.
- Formatter returns empty string for no states.

- [ ] **Step 2: Write failing sync/check prompt tests**

Add exact assertions:

~~~js
test("runSync injects scoped insights without changing payload version", async () => {
  const result = await captureInsight(v, insight(), { now: FIXED });
  await runSync({ argv: ["--project", "staff"], vaultDir: v, runAgent: fakeAgent });
  assert.match(seenPrompt, new RegExp(result.insightId));
  assert.match(seenPrompt, /hypothesis.*unverified/i);
  assert.match(seenPrompt, /source "insight"/i);
  assert.match(seenPrompt, /requires Slack, GitHub, Atlassian, Outlook, or transcript/i);
  assert.equal(PAYLOAD_VERSION, 3);
});

test("check context treats hypothesis conflict as evidence gap", async () => {
  await captureInsight(v, insight(), { now: FIXED });
  const context = await checkVaultContext(v, { kind: "project", name: "staff" }, "");
  assert.match(context, /Captured insights/);
  const prompt = buildCheckPrompt({
    draft: "One global pointer is correct.",
    scope: { kind: "project", name: "staff" },
    vaultDir: v,
    vaultContext: context,
  });
  assert.match(prompt, /evidence gap/i);
  assert.match(prompt, /must not treat hypotheses.*fact/i);
});
~~~

- [ ] **Step 3: Run focused tests and confirm failure**

~~~bash
node --test lib/insightContext.test.mjs lib/run.test.mjs lib/prompt.test.mjs lib/check.test.mjs
~~~

Expected: new tests FAIL because context helpers/arguments do not exist.

- [ ] **Step 4: Implement deterministic context helpers**

~~~js
export async function activeInsightsForScope(vaultDir, scope) {}
export function formatInsightContext(states) {}
export async function searchActiveInsights(vaultDir, query) {}
~~~

Rules:

- Reduce one atomic ledger snapshot.
- Keep active only; newest first.
- All scope gets all active. Entity scope gets exact `type/name` ref. Unscoped gets all scope only.
- Search case-insensitive across summary/context; return state objects, newest first.
- Formatter emits JSON inside a titled Markdown block to preserve fields without prose parsing.

- [ ] **Step 5: Wire sync and check**

Change sync flow:

~~~js
const { scope, sources, dryRun } = parseArgs(argv);
const insightContext = formatInsightContext(
  await activeInsightsForScope(vaultDir, scope),
);
const prompt = buildPrompt({ scope, sources, vaultDir, insightContext });
~~~

Change `buildPrompt({ scope, sources, vaultDir, insightContext = "" })`:

- Insert active insight block before task list when nonempty.
- State decisions record user intent; learnings are context; hypotheses/questions unverified.
- Permit insight-derived entity raw entries only as source `insight`, capture timestamp, text naming ID + kind.
- Forbid insight-only alerts and preserve existing receipt-source list.

Change `checkVaultContext`:

- Keep existing entity selection.
- Append matching active insight block even when no matching entity file exists.
- Return `(no matching entity files or active insights found)` only when both empty.
- Build-check rules forbid treating hypothesis/question as fact; draft dependence on them becomes `evidence gap`.

- [ ] **Step 6: Run focused tests**

~~~bash
node --test lib/insightContext.test.mjs lib/run.test.mjs lib/prompt.test.mjs lib/check.test.mjs
~~~

Expected: PASS.

- [ ] **Step 7: Commit context integration**

~~~bash
git add lib/insightContext.mjs lib/insightContext.test.mjs lib/run.mjs lib/run.test.mjs lib/prompt.mjs lib/prompt.test.mjs lib/check.mjs lib/check.test.mjs
git commit -m "feat: use captured insights as context"
~~~

---

### Task 4: MCP insight tools and search

**Files:**
- Modify: `mcp/tools.mjs`
- Modify: `mcp/tools.test.mjs`
- Modify: `mcp/server.mjs`

**Interfaces:**
- Consumes Task 2 service functions and Task 3 search.
- Produces MCP adapters `captureInsightTool`, `listInsightsTool`, `readInsightTool`, `archiveInsightTool`.
- Existing `search` includes active insight matches after entity matches.

- [ ] **Step 1: Write failing MCP adapter tests**

~~~js
import {
  archiveInsightTool,
  captureInsightTool,
  listInsightsTool,
  readInsightTool,
  search,
} from "./tools.mjs";

const mcpInput = {
  kind: "learning",
  summary: "Per-FC manifests drive lookup.",
  entities: [{ type: "project", name: "staff" }],
  origin: { client: "codex" },
};

test("MCP insight tools capture, read, list, archive, and dedupe", async () => {
  const first = await captureInsightTool(v, mcpInput, { now: FIXED });
  const retry = await captureInsightTool(v, mcpInput, { now: LATER });
  assert.match(first, /^Captured ins_[0-9a-f]{12} \[learning\] active$/);
  assert.doesNotMatch(first, /Per-FC/);
  assert.match(retry, /exact-repeat/);
  const id = first.match(/ins_[0-9a-f]{12}/)[0];
  assert.match(await listInsightsTool(v, {}), new RegExp(id));
  assert.match(await readInsightTool(v, { insightId: id }), /Per-FC manifests/);
  assert.match(await archiveInsightTool(v, { insightId: id, note: "absorbed" }), /active -> archived/);
});

test("MCP search includes active insights and excludes archived", async () => {
  const captured = await captureInsightTool(v, mcpInput, { now: FIXED });
  assert.match(await search(v, "manifests"), /insight\/ins_/);
  const id = captured.match(/ins_[0-9a-f]{12}/)[0];
  await archiveInsightTool(v, { insightId: id });
  assert.doesNotMatch(await search(v, "manifests"), /insight\/ins_/);
});
~~~

Test setup creates `v`, `FIXED`, and `LATER` before these cases.

- [ ] **Step 2: Run MCP tests and confirm failure**

~~~bash
cd mcp && npm test
~~~

Expected: FAIL because insight adapters are not exported.

- [ ] **Step 3: Implement MCP adapters**

In `mcp/tools.mjs`:

~~~js
export async function captureInsightTool(vaultDir, input, options = {}) {}
export async function listInsightsTool(vaultDir, { status = "active" } = {}) {}
export async function readInsightTool(vaultDir, { insightId }) {}
export async function archiveInsightTool(vaultDir, { insightId, note = null }, options = {}) {}
~~~

Formatting:

- Capture created: `Captured <id> [<kind>] active`.
- Exact retry: `Existing <id> [<kind>] <status> (exact-repeat)`.
- List/read may return captured text; use `CHARACTER_LIMIT`.
- Archive returns Task 2 safe transition output.
- Search output insight match: `insight/<id>: [<kind>] <summary>`.

- [ ] **Step 4: Register strict MCP schemas**

Add Zod enums/objects:

~~~js
const insightKindEnum = z.enum(["decision", "learning", "hypothesis", "question"]);
const insightStatusEnum = z.enum(["active", "archived", "all"]);
const insightOriginSchema = z.object({
  client: z.enum(["codex", "cursor", "other"]),
  locator: z.string().optional(),
}).strict();
const insightEntitySchema = z.object({
  type: typeEnum,
  name: z.string(),
}).strict();
~~~

Register four tools:

- `capture_insight`: description explicitly maps "Kizuki this" to distilled capture, warns against full transcript; idempotent non-destructive mutation.
- `list_insights`: read-only; optional status.
- `read_insight`: read-only; ID.
- `archive_insight`: terminal mutation; ID + optional note.

Core validation still rejects unknown fields and enforces length/locator rules.

- [ ] **Step 5: Run MCP and root tests**

~~~bash
cd mcp && npm test
cd .. && node --test mcp/tools.test.mjs
~~~

Expected: PASS.

- [ ] **Step 6: Commit MCP surface**

~~~bash
git add mcp/tools.mjs mcp/tools.test.mjs mcp/server.mjs
git commit -m "feat: add insight capture MCP tools"
~~~

---

### Task 5: Setup, docs, and final verification

**Files:**
- Modify: `.gitignore`
- Modify: `lib/doctor.mjs`
- Modify: `lib/doctor.test.mjs`
- Modify: `lib/init.test.mjs`
- Modify: `README.md`
- Modify: `docs/ROADMAP.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Extends shared `REQUIRED_DIRS` with `insights`; `runInit` inherits it.
- Documents stable operator and agent contracts.

- [ ] **Step 1: Write failing init/doctor tests**

Update expected directory lists:

~~~js
assert.equal(await exists(join(dir, "insights")), true);
assert.match(vaultDirs.detail, /insights/);
~~~

Add check-only assertion proving missing `insights` reports failure without creating it.

- [ ] **Step 2: Run setup tests and confirm failure**

~~~bash
node --test lib/init.test.mjs lib/doctor.test.mjs
~~~

Expected: FAIL because `insights` is absent from `REQUIRED_DIRS`.

- [ ] **Step 3: Add setup behavior**

~~~js
export const REQUIRED_DIRS = [
  "people",
  "projects",
  "teams",
  "transcripts",
  "transcripts/processed",
  "signals",
  "insights",
];
~~~

Add `/insights/` beside `/signals/` in `.gitignore`.

- [ ] **Step 4: Update docs**

README:

- Add approved CLI commands.
- Add "Kizuki this" flow and exact capture example.
- Add MCP tools and explicit privacy boundary.
- Explain kinds, active/archive lifecycle, exact retry, search/scope rules.
- Add `insights/events.jsonl` to vault layout/data safety.

ROADMAP:

- Record explicit insight capture as shipped only after implementation passes.
- Keep passive Codex/Cursor session reading out of current scope.

AGENTS/CLAUDE:

- Sync shared invariant: explicit capture only; deterministic JS writes insight ledger; no full-chat/session scraping.
- Add commands without fixed test total.

Run stop-slop, then humanizer on changed team prose. Preserve technical terms.

- [ ] **Step 5: Run focused verification**

~~~bash
node --test lib/insights.test.mjs
node --test lib/insightCommands.test.mjs lib/insightContext.test.mjs lib/query.test.mjs lib/check.test.mjs
node --test lib/prompt.test.mjs lib/run.test.mjs lib/init.test.mjs lib/doctor.test.mjs
cd mcp && npm test
~~~

Expected: PASS.

- [ ] **Step 6: Run full verification**

~~~bash
npm test
cd web && npm run typecheck
cd .. && git diff --check
~~~

Expected: all commands exit 0. No root runtime dependency change.

- [ ] **Step 7: Commit setup/docs**

~~~bash
git add .gitignore lib/doctor.mjs lib/doctor.test.mjs lib/init.test.mjs README.md docs/ROADMAP.md AGENTS.md CLAUDE.md
git commit -m "docs: add insight capture setup and guidance"
~~~

---

## Final review checklist

- Compare branch diff against approved spec.
- Confirm no passive session reads, full-chat storage, dashboard controls, insight-only signals, or global client instruction edits.
- Confirm every mutation uses vault lock + atomic append-only writer.
- Confirm exact retry writes nothing.
- Confirm malformed ledger blocks search/sync/check loudly.
- Confirm main checkout `transcripts/.gitkeep` deletion unchanged.
- Run `git status --short`, `git diff --check`, focused tests, `npm test`, MCP tests, web typecheck.
