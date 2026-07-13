# Kizuki Gate Instrumentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record gate evidence durably (catch ledger), report it weekly against the roadmap criteria (`kizuki gate`), surface it daily (brief + day summary), and ship the skills-export ritual pack.

**Architecture:** A new append-only `catches/events.jsonl` ledger mirrors the signal/insight ledger pattern exactly (validate → plan → atomic append under `state/vault.lock`). A pure `lib/gate.mjs` counts events into Monday-start local weeks and renders verdict lines; a thin `lib/gateCommands.mjs` reads the three ledgers and injects them. `lib/shift.mjs` gains one gate line in the brief and day-summary facts. `lib/skills.mjs` renders `skills/<name>/ritual.md` sources into Claude/Codex formats per the approved 2026-07-07 skills-export spec.

**Tech Stack:** Node built-ins only, ESM `.mjs`, `node:test` + `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-07-13-kizuki-gate-instrumentation-design.md` (+ `docs/superpowers/specs/2026-07-07-kizuki-skills-export-design.md` for Task 7–8).

## Global Constraints

- Zero runtime dependencies. Node built-ins only. ESM `.mjs`.
- TDD: failing test first, then implementation. `npm test` green before every commit claim.
- No comments unless non-obvious. No silent failures — throw loudly.
- Observe-and-advise: nothing here sends messages or takes outward action.
- Ledgers are append-only and canonical; mutations hold `state/vault.lock` via `withVaultLock(vaultDir, fn, { ...lock, tool, now })`.
- Dates render month-day-year via `formatDate` (`lib/format.mjs`).
- Entity/id validation is loud: ids match `/^cat_[0-9a-f]{12}$/`, `/^sig_[0-9a-f]{12}$/`, `/^ins_[0-9a-f]{12}$/`.
- Tests never spawn processes and never touch the real home dir — `mkdtemp(join(tmpdir(), "kizuki-..."))`.
- `catches/` is gitignored work data — never force-add.

---

### Task 1: Catch ledger core (`lib/catches.mjs` — validate, identity, reduce, plan)

**Files:**
- Create: `lib/catches.mjs`
- Test: `lib/catches.test.mjs`

**Interfaces:**
- Consumes: nothing from this wave (mirrors `lib/insights.mjs` patterns).
- Produces: `validateCatchInput(input) -> {note, signalId, insightId}`, `catchIdentity(input, at) -> {catchId, catch}`, `reduceCatchEvents(events) -> Map<catchId, state>`, `planCatchCapture(events, input, {now}) -> {catchId, disposition: "created"|"exact-repeat", event, state}`. State shape: `{catchId, at, note, signalId, insightId}`.

- [ ] **Step 1: Write the failing tests**

Create `lib/catches.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  catchIdentity,
  planCatchCapture,
  reduceCatchEvents,
  validateCatchInput,
} from "./catches.mjs";

const FIXED = new Date("2026-07-08T10:00:00Z");
const LATER = new Date("2026-07-08T11:00:00Z");

function caught(note = "caught the staff scope cut", now = FIXED, links = {}) {
  return planCatchCapture([], { note, ...links }, { now }).event;
}

test("validateCatchInput trims the note and defaults links to null", () => {
  const normalized = validateCatchInput({ note: "  caught it  " });
  assert.deepEqual(normalized, { note: "caught it", signalId: null, insightId: null });
});

test("validateCatchInput rejects empty, oversized, and unknown fields", () => {
  assert.throws(() => validateCatchInput({ note: "  " }), /non-empty string/);
  assert.throws(() => validateCatchInput({ note: "x".repeat(501) }), /at most 500/);
  assert.throws(() => validateCatchInput({ note: "ok", extra: 1 }), /unknown catch field/);
});

test("validateCatchInput rejects malformed link ids", () => {
  assert.throws(() => validateCatchInput({ note: "ok", signalId: "sig_nope" }), /invalid signal ID/);
  assert.throws(() => validateCatchInput({ note: "ok", insightId: "bad" }), /invalid insight ID/);
});

test("catchIdentity is deterministic over at and note", () => {
  const left = catchIdentity({ note: "same note" }, "2026-07-08T10:00:00.000Z");
  const right = catchIdentity({ note: "  same note  " }, "2026-07-08T10:00:00.000Z");
  assert.equal(left.catchId, right.catchId);
  assert.match(left.catchId, /^cat_[0-9a-f]{12}$/);
  const other = catchIdentity({ note: "same note" }, "2026-07-08T10:00:01.000Z");
  assert.notEqual(left.catchId, other.catchId);
});

test("planCatchCapture creates a version-1 caught event", () => {
  const planned = planCatchCapture([], { note: "caught it" }, { now: FIXED });
  assert.equal(planned.disposition, "created");
  assert.deepEqual(planned.event, {
    version: 1,
    event: "caught",
    catchId: planned.catchId,
    at: "2026-07-08T10:00:00.000Z",
    note: "caught it",
    signalId: null,
    insightId: null,
  });
  assert.deepEqual(planned.state, {
    catchId: planned.catchId,
    at: "2026-07-08T10:00:00.000Z",
    note: "caught it",
    signalId: null,
    insightId: null,
  });
});

test("planCatchCapture is an exact-repeat no-op for the same note at the same time", () => {
  const first = planCatchCapture([], { note: "caught it" }, { now: FIXED });
  const repeat = planCatchCapture([first.event], { note: "caught it" }, { now: FIXED });
  assert.equal(repeat.disposition, "exact-repeat");
  assert.equal(repeat.event, null);
  assert.equal(repeat.catchId, first.catchId);
  const later = planCatchCapture([first.event], { note: "caught it" }, { now: LATER });
  assert.equal(later.disposition, "created");
});

test("reduceCatchEvents rejects tampered and malformed events", () => {
  const event = caught();
  assert.throws(() => reduceCatchEvents([{ ...event, note: "edited" }]), /identity mismatch/);
  assert.throws(() => reduceCatchEvents([{ ...event, version: 2 }]), /invalid catch event version/);
  assert.throws(() => reduceCatchEvents([{ ...event, event: "other" }]), /unknown catch event/);
  assert.throws(() => reduceCatchEvents([{ ...event, at: "yesterday" }]), /ISO timestamp/);
  assert.throws(() => reduceCatchEvents([event, event]), /duplicate catch event/);
  assert.throws(() => reduceCatchEvents([{ ...event, surprise: 1 }]), /unknown catch event field/);
});

test("reduceCatchEvents keeps link ids in state", () => {
  const event = caught("linked catch", FIXED, {
    signalId: "sig_0123456789ab",
    insightId: "ins_0123456789ab",
  });
  const state = reduceCatchEvents([event]).get(event.catchId);
  assert.equal(state.signalId, "sig_0123456789ab");
  assert.equal(state.insightId, "ins_0123456789ab");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test lib/catches.test.mjs`
Expected: FAIL — `Cannot find module` for `./catches.mjs`.

- [ ] **Step 3: Write the implementation**

Create `lib/catches.mjs`:

```js
import { createHash } from "node:crypto";

const CATCH_ID_RE = /^cat_[0-9a-f]{12}$/;
const SIGNAL_ID_RE = /^sig_[0-9a-f]{12}$/;
const INSIGHT_ID_RE = /^ins_[0-9a-f]{12}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const INPUT_FIELDS = new Set(["note", "signalId", "insightId"]);
const EVENT_FIELDS = new Set(["version", "event", "catchId", "at", "note", "signalId", "insightId"]);

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(label + " must be an object");
  }
}

function assertKnownFields(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error("unknown " + label + " field " + JSON.stringify(key));
  }
}

function requiredNote(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("catch note must be a non-empty string");
  }
  const normalized = value.trim();
  if (normalized.length > 500) throw new Error("catch note must be at most 500 characters");
  return normalized;
}

function optionalId(value, re, label) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !re.test(value)) {
    throw new Error("invalid " + label + " " + JSON.stringify(value));
  }
  return value;
}

function assertIso(value, label) {
  if (typeof value !== "string" || !ISO_RE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(label + " must be an ISO timestamp");
  }
}

function toIso(now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error("catch event time must be a valid Date");
  }
  return now.toISOString();
}

export function validateCatchInput(input) {
  assertObject(input, "catch");
  assertKnownFields(input, INPUT_FIELDS, "catch");
  return {
    note: requiredNote(input.note),
    signalId: optionalId(input.signalId, SIGNAL_ID_RE, "signal ID"),
    insightId: optionalId(input.insightId, INSIGHT_ID_RE, "insight ID"),
  };
}

export function catchIdentity(input, at) {
  const normalized = validateCatchInput(input);
  assertIso(at, "catch at");
  const catchId = "cat_" + createHash("sha256").update(at + "|" + normalized.note).digest("hex").slice(0, 12);
  return { catchId, catch: normalized };
}

export function reduceCatchEvents(events) {
  if (!Array.isArray(events)) throw new Error("catch events must be an array");
  const states = new Map();
  for (const event of events) {
    assertObject(event, "catch event");
    if (event.version !== 1) throw new Error("invalid catch event version " + JSON.stringify(event.version));
    if (event.event !== "caught") throw new Error("unknown catch event " + JSON.stringify(event.event));
    assertKnownFields(event, EVENT_FIELDS, "catch event");
    if (typeof event.catchId !== "string" || !CATCH_ID_RE.test(event.catchId)) {
      throw new Error("invalid catch ID " + JSON.stringify(event.catchId));
    }
    assertIso(event.at, "catch event at");
    const identity = catchIdentity(
      { note: event.note, signalId: event.signalId, insightId: event.insightId },
      event.at,
    );
    if (identity.catchId !== event.catchId || identity.catch.note !== event.note) {
      throw new Error("catch identity mismatch for " + event.catchId);
    }
    if (states.has(event.catchId)) throw new Error("duplicate catch event for " + event.catchId);
    states.set(event.catchId, {
      catchId: event.catchId,
      at: event.at,
      note: event.note,
      signalId: identity.catch.signalId,
      insightId: identity.catch.insightId,
    });
  }
  return states;
}

export function planCatchCapture(events, input, { now = new Date() } = {}) {
  const states = reduceCatchEvents(events);
  const at = toIso(now);
  const { catchId, catch: normalized } = catchIdentity(input, at);
  const existing = states.get(catchId);
  if (existing) return { catchId, disposition: "exact-repeat", event: null, state: existing };
  const event = {
    version: 1,
    event: "caught",
    catchId,
    at,
    note: normalized.note,
    signalId: normalized.signalId,
    insightId: normalized.insightId,
  };
  const state = reduceCatchEvents([...events, event]).get(catchId);
  return { catchId, disposition: "created", event, state };
}
```

Note the identity-mismatch guard compares both the recomputed id and the stored note — a tampered note with a stale id must throw, and `reduceCatchEvents` re-derives identity from the raw (already normalized) stored note, so a stored untrimmed note also fails the `identity.catch.note !== event.note` check.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test lib/catches.test.mjs`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/catches.mjs lib/catches.test.mjs
git commit -m "feat: add catch ledger core"
```

---

### Task 2: Catch ledger IO (`readCatchEvents` / `writeCatchEventsAtomic`)

**Files:**
- Modify: `lib/catches.mjs` (append the two functions + imports)
- Test: `lib/catches.test.mjs` (append tests)

**Interfaces:**
- Consumes: Task 1's `reduceCatchEvents`.
- Produces: `readCatchEvents(vaultDir) -> Promise<events[]>` (missing file → `[]`, strict JSONL otherwise), `writeCatchEventsAtomic(vaultDir, events) -> Promise<void>` (append-only, temp+rename). Ledger path: `<vaultDir>/catches/events.jsonl`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/catches.test.mjs` (extend the import from `./catches.mjs` with `readCatchEvents, writeCatchEventsAtomic`, and add fs imports):

```js
import { mkdtemp, readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("readCatchEvents returns [] when the ledger does not exist", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-catches-"));
  assert.deepEqual(await readCatchEvents(vault), []);
});

test("write then read round-trips and leaves no temp files", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-catches-"));
  const event = caught();
  await writeCatchEventsAtomic(vault, [event]);
  assert.deepEqual(await readCatchEvents(vault), [event]);
  const names = await readdir(join(vault, "catches"));
  assert.deepEqual(names, ["events.jsonl"]);
});

test("readCatchEvents names the file and line on malformed content", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-catches-"));
  await mkdir(join(vault, "catches"), { recursive: true });
  const path = join(vault, "catches", "events.jsonl");
  await writeFile(path, "not json\n", "utf8");
  await assert.rejects(readCatchEvents(vault), new RegExp("events\\.jsonl:1: malformed JSON"));
  await writeFile(path, JSON.stringify(caught()) + "\n\n" + JSON.stringify(caught("x", LATER)) + "\n", "utf8");
  await assert.rejects(readCatchEvents(vault), /:2: blank JSONL line/);
});

test("writeCatchEventsAtomic rejects removing or rewriting existing events", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-catches-"));
  const first = caught("first");
  const second = caught("second", LATER);
  await writeCatchEventsAtomic(vault, [first]);
  await assert.rejects(writeCatchEventsAtomic(vault, []), /append-only/);
  await assert.rejects(writeCatchEventsAtomic(vault, [second]), /append-only/);
  await writeCatchEventsAtomic(vault, [first, second]);
  assert.deepEqual(await readCatchEvents(vault), [first, second]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test lib/catches.test.mjs`
Expected: FAIL — `readCatchEvents` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `lib/catches.mjs` (add the imports at the top of the file):

```js
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
```

(Merge with the existing `node:crypto` import: `import { createHash, randomUUID } from "node:crypto";`.)

```js
function eventsPath(vaultDir) {
  return join(vaultDir, "catches", "events.jsonl");
}

export async function readCatchEvents(vaultDir) {
  const path = eventsPath(vaultDir);
  let content;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  if (content === "") return [];
  const lines = content.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const events = [];
  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    if (line.trim() === "") throw new Error(path + ":" + lineNumber + ": blank JSONL line");
    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      throw new Error(path + ":" + lineNumber + ": malformed JSON: " + error.message);
    }
    events.push(event);
    try {
      reduceCatchEvents(events);
    } catch (error) {
      throw new Error(path + ":" + lineNumber + ": " + error.message);
    }
  }
  return events;
}

export async function writeCatchEventsAtomic(vaultDir, events) {
  reduceCatchEvents(events);
  const existing = await readCatchEvents(vaultDir);
  if (
    events.length < existing.length ||
    !existing.every((event, index) => isDeepStrictEqual(event, events[index]))
  ) {
    throw new Error("catch ledger is append-only; existing events cannot be removed or rewritten");
  }

  const dir = join(vaultDir, "catches");
  const path = eventsPath(vaultDir);
  const tempPath = join(dir, ".events.jsonl." + process.pid + "." + randomUUID() + ".tmp");
  const content = events.length === 0
    ? ""
    : events.map((event) => JSON.stringify(event)).join("\n") + "\n";
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(tempPath, content, { encoding: "utf8", flag: "wx" });
    await rename(tempPath, path);
  } catch (error) {
    try {
      await rm(tempPath, { force: true });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "catch ledger write failed and temp cleanup failed",
      );
    }
    throw error;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test lib/catches.test.mjs`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/catches.mjs lib/catches.test.mjs
git commit -m "feat: add catch ledger storage"
```

---

### Task 3: `kizuki catch` / `kizuki catches` commands

**Files:**
- Create: `lib/catchCommands.mjs`
- Test: `lib/catchCommands.test.mjs`
- Modify: `kizuki` (dispatch + USAGE), `.gitignore`

**Interfaces:**
- Consumes: Task 1–2 exports; `withVaultLock` from `lib/lock.mjs`; `readSignalEvents`/`reduceSignalEvents` from `lib/signals.mjs`; `readInsightEvents`/`reduceInsightEvents` from `lib/insights.mjs`.
- Produces: `recordCatch(vaultDir, input, {now, lock}) -> planned` (link-existence validated, locked write), `runCatchCommand(vaultDir, argv, {now, lock}) -> string`, `runCatchesCommand(vaultDir, argv) -> string`.

- [ ] **Step 1: Write the failing tests**

Create `lib/catchCommands.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCatchCommand, runCatchesCommand } from "./catchCommands.mjs";
import { readCatchEvents } from "./catches.mjs";
import { planSignalIngestion, writeSignalEventsAtomic } from "./signals.mjs";
import { planInsightCapture, writeInsightEventsAtomic } from "./insights.mjs";

const FIXED = new Date("2026-07-08T10:00:00Z");
const LATER = new Date("2026-07-08T11:00:00Z");

const CANDIDATE = {
  severity: "warn",
  kind: "contradiction",
  type: "project",
  name: "staff",
  topic: "manifest-scope",
  evidence: "Two teams disagree on the manifest scope.",
  receipts: [{
    source: "slack",
    locator: "C123/p456",
    observedAt: "2026-07-08T09:00:00Z",
    excerpt: "we cut the manifest field",
  }],
};

async function seedSignal(vault) {
  const ingestion = planSignalIngestion([], [CANDIDATE], { now: FIXED });
  await writeSignalEventsAtomic(vault, ingestion.events);
  return ingestion.events[0].signalId;
}

async function seedInsight(vault) {
  const planned = planInsightCapture([], {
    kind: "decision",
    summary: "Manifest scope is per-FC.",
    origin: { client: "codex" },
  }, { now: FIXED });
  await writeInsightEventsAtomic(vault, [planned.event]);
  return planned.insightId;
}

test("catch records a note and catches lists it newest first", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-catchcmd-"));
  const first = await runCatchCommand(vault, ["older catch"], { now: FIXED });
  const second = await runCatchCommand(vault, ["newer catch"], { now: LATER });
  assert.match(first, /^cat_[0-9a-f]{12} recorded$/);
  assert.match(second, /^cat_[0-9a-f]{12} recorded$/);
  const listing = await runCatchesCommand(vault, []);
  const lines = listing.split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /newer catch/);
  assert.match(lines[1], /older catch/);
});

test("catch repeat run at the same time reports already recorded", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-catchcmd-"));
  await runCatchCommand(vault, ["same"], { now: FIXED });
  const repeat = await runCatchCommand(vault, ["same"], { now: FIXED });
  assert.match(repeat, /already recorded$/);
  assert.equal((await readCatchEvents(vault)).length, 1);
});

test("catch validates link ids against the ledgers", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-catchcmd-"));
  await assert.rejects(
    runCatchCommand(vault, ["note", "--signal", "sig_000000000000"], { now: FIXED }),
    /unknown signal sig_000000000000/,
  );
  await assert.rejects(
    runCatchCommand(vault, ["note", "--insight", "ins_000000000000"], { now: FIXED }),
    /unknown insight ins_000000000000/,
  );
  const signalId = await seedSignal(vault);
  const insightId = await seedInsight(vault);
  const out = await runCatchCommand(
    vault,
    ["linked note", "--signal", signalId, "--insight", insightId],
    { now: LATER },
  );
  assert.match(out, /recorded$/);
  const listing = await runCatchesCommand(vault, []);
  assert.match(listing, new RegExp("signal:" + signalId));
  assert.match(listing, new RegExp("insight:" + insightId));
});

test("catch and catches reject bad argv", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-catchcmd-"));
  await assert.rejects(runCatchCommand(vault, [], { now: FIXED }), /requires a note/);
  await assert.rejects(runCatchCommand(vault, ["a", "b"], { now: FIXED }), /one note argument/);
  await assert.rejects(runCatchCommand(vault, ["a", "--signal"], { now: FIXED }), /--signal requires a value/);
  await assert.rejects(runCatchCommand(vault, ["a", "--nope"], { now: FIXED }), /unknown option for catch/);
  await assert.rejects(runCatchesCommand(vault, ["--nope"]), /unknown option for catches/);
});

test("catches --json returns state objects and empty ledger prints No catches.", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-catchcmd-"));
  assert.equal(await runCatchesCommand(vault, []), "No catches.");
  await runCatchCommand(vault, ["a catch"], { now: FIXED });
  const parsed = JSON.parse(await runCatchesCommand(vault, ["--json"]));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].note, "a catch");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test lib/catchCommands.test.mjs`
Expected: FAIL — `Cannot find module` for `./catchCommands.mjs`.

- [ ] **Step 3: Write the implementation**

Create `lib/catchCommands.mjs`:

```js
import { withVaultLock } from "./lock.mjs";
import {
  planCatchCapture,
  readCatchEvents,
  reduceCatchEvents,
  validateCatchInput,
  writeCatchEventsAtomic,
} from "./catches.mjs";
import { readSignalEvents, reduceSignalEvents } from "./signals.mjs";
import { readInsightEvents, reduceInsightEvents } from "./insights.mjs";

function requireValue(argv, index, option) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(option + " requires a value");
  }
  return value;
}

function parseCatchArgs(argv) {
  let note = null;
  let signalId = null;
  let insightId = null;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--signal") {
      signalId = requireValue(argv, index, arg);
      index++;
      continue;
    }
    if (arg === "--insight") {
      insightId = requireValue(argv, index, arg);
      index++;
      continue;
    }
    if (arg.startsWith("--")) throw new Error("unknown option for catch: " + arg);
    if (note !== null) throw new Error("catch takes one note argument");
    note = arg;
  }
  if (note === null) throw new Error('catch requires a note — kizuki catch "<note>"');
  return { note, signalId, insightId };
}

async function assertLinksExist(vaultDir, input) {
  if (input.signalId) {
    const states = reduceSignalEvents(await readSignalEvents(vaultDir));
    if (!states.has(input.signalId)) throw new Error("unknown signal " + input.signalId);
  }
  if (input.insightId) {
    const states = reduceInsightEvents(await readInsightEvents(vaultDir));
    if (!states.has(input.insightId)) throw new Error("unknown insight " + input.insightId);
  }
}

export async function recordCatch(vaultDir, input, { now = new Date(), lock = {} } = {}) {
  const normalized = validateCatchInput(input);
  await assertLinksExist(vaultDir, normalized);
  return withVaultLock(vaultDir, async () => {
    const events = await readCatchEvents(vaultDir);
    const planned = planCatchCapture(events, normalized, { now });
    if (planned.event) await writeCatchEventsAtomic(vaultDir, [...events, planned.event]);
    return planned;
  }, { ...lock, tool: "catch-capture", now });
}

function oneLine(text) {
  return text.replace(/\s+/g, " ").trim();
}

function formatCatchLine(state) {
  const parts = [state.catchId, state.at, oneLine(state.note)];
  if (state.signalId) parts.push("signal:" + state.signalId);
  if (state.insightId) parts.push("insight:" + state.insightId);
  return parts.join(" ");
}

export async function runCatchCommand(vaultDir, argv, { now = new Date(), lock = {} } = {}) {
  const parsed = parseCatchArgs(argv);
  const planned = await recordCatch(vaultDir, parsed, { now, lock });
  return planned.catchId + (planned.disposition === "created" ? " recorded" : " already recorded");
}

export async function runCatchesCommand(vaultDir, argv) {
  let json = false;
  for (const arg of argv) {
    if (arg === "--json") json = true;
    else throw new Error("unknown option for catches: " + arg);
  }
  const states = [...reduceCatchEvents(await readCatchEvents(vaultDir)).values()].sort(
    (left, right) =>
      Date.parse(right.at) - Date.parse(left.at) || left.catchId.localeCompare(right.catchId),
  );
  if (json) return JSON.stringify(states, null, 2);
  if (!states.length) return "No catches.";
  return states.map(formatCatchLine).join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test lib/catchCommands.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire the CLI and gitignore**

In `kizuki`, add to the imports:

```js
import { runCatchCommand, runCatchesCommand } from "./lib/catchCommands.mjs";
```

Add to the dispatch chain after the `insight` branch:

```js
  } else if (command === "catch") {
    console.log(await runCatchCommand(vaultDir, rest));
  } else if (command === "catches") {
    console.log(await runCatchesCommand(vaultDir, rest));
```

Add to `USAGE` after the `insight archive` line:

```
  kizuki catch "<note>" [--signal <id>] [--insight <id>]   record a true catch (gate evidence)
  kizuki catches [--json]                          list recorded catches
```

In `.gitignore`, add `catches/` next to the other vault data dirs (`signals/`, `insights/`).

- [ ] **Step 6: Verify manually and run the full suite**

Run: `./kizuki catch "test catch" && ./kizuki catches && npm test`
Expected: a `cat_… recorded` line, a listing containing "test catch", suite PASS. Then remove the test data: `rm -rf catches/` (it is gitignored work data; this keeps the real vault clean).

- [ ] **Step 7: Commit**

```bash
git add lib/catchCommands.mjs lib/catchCommands.test.mjs kizuki .gitignore
git commit -m "feat: add catch and catches commands"
```

---

### Task 4: Gate report core (`lib/gate.mjs`)

**Files:**
- Create: `lib/gate.mjs`
- Test: `lib/gate.test.mjs`

**Interfaces:**
- Consumes: `formatDate` from `lib/format.mjs`. Raw ledger events (no reduction): signal `observed`/`status_changed` events, catch `caught` events, insight `captured` events — all carry an ISO `at`.
- Produces: `computeGateReport({signalEvents, catchEvents, insightEvents, now, weeks}) -> {generatedAt, weeks: [{start, inProgress, fired, acted, dismissed, resolved, catches, insights}], verdicts: {v1ToV2, v2ToV3}}` where each verdict is `{criterion, met, fullWeeks}`; `renderGateReport(report) -> string`. Weeks are Monday-start local calendar weeks, newest first; `weeks[0]` is the in-progress current week; only `actor === "user"` status changes count.

- [ ] **Step 1: Write the failing tests**

Create `lib/gate.test.mjs`. July 15, 2026 is a Wednesday; the current week starts Monday July 13, the previous full week is July 6–12. Local-time `Date` constructors keep the tests timezone-stable (events at mid-day UTC land on the same local date in any offset within ±11 h).

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeGateReport, renderGateReport } from "./gate.mjs";

const NOW = new Date(2026, 6, 15, 12);

const observed = (at) => ({ version: 1, event: "observed", signalId: "sig_0123456789ab", at });
const statusChanged = (at, to, actor = "user") => ({
  version: 1, event: "status_changed", signalId: "sig_0123456789ab", from: "open", to, at, actor,
});
const caughtAt = (at) => ({ version: 1, event: "caught", catchId: "cat_0123456789ab", at });
const capturedAt = (at) => ({ version: 1, event: "captured", insightId: "ins_0123456789ab", at });

test("computeGateReport buckets events into Monday-start weeks, newest first", () => {
  const report = computeGateReport({
    signalEvents: [
      observed("2026-07-14T10:00:00Z"),
      observed("2026-07-08T10:00:00Z"),
      statusChanged("2026-07-08T11:00:00Z", "acted"),
      statusChanged("2026-07-09T11:00:00Z", "dismissed"),
      statusChanged("2026-07-10T11:00:00Z", "resolved", "system"),
    ],
    catchEvents: [caughtAt("2026-07-08T12:00:00Z"), caughtAt("2026-07-14T12:00:00Z")],
    insightEvents: [capturedAt("2026-07-07T12:00:00Z")],
    now: NOW,
    weeks: 2,
  });
  assert.equal(report.weeks.length, 2);
  const [current, previous] = report.weeks;
  assert.equal(current.start, "2026-07-13");
  assert.equal(current.inProgress, true);
  assert.deepEqual(
    { fired: current.fired, catches: current.catches },
    { fired: 1, catches: 1 },
  );
  assert.equal(previous.start, "2026-07-06");
  assert.equal(previous.inProgress, false);
  assert.deepEqual(previous, {
    start: "2026-07-06",
    inProgress: false,
    fired: 1,
    acted: 1,
    dismissed: 1,
    resolved: 0,
    catches: 1,
    insights: 1,
  });
});

test("system status changes never count toward acted/dismissed/resolved", () => {
  const report = computeGateReport({
    signalEvents: [statusChanged("2026-07-08T11:00:00Z", "acted", "system")],
    now: NOW,
  });
  assert.equal(report.weeks[1].acted, 0);
});

test("verdicts count only full weeks", () => {
  const report = computeGateReport({
    signalEvents: [statusChanged("2026-07-14T11:00:00Z", "acted")],
    catchEvents: [caughtAt("2026-07-08T12:00:00Z")],
    now: NOW,
    weeks: 3,
  });
  assert.deepEqual(report.verdicts.v1ToV2, {
    criterion: ">=1 true catch/week",
    met: 1,
    fullWeeks: 2,
  });
  assert.deepEqual(report.verdicts.v2ToV3, {
    criterion: ">=1 acted signal/week",
    met: 0,
    fullWeeks: 2,
  });
});

test("computeGateReport rejects invalid weeks", () => {
  assert.throws(() => computeGateReport({ weeks: 0 }), /between 1 and 12/);
  assert.throws(() => computeGateReport({ weeks: Number("abc") }), /between 1 and 12/);
  assert.throws(() => computeGateReport({ weeks: 13 }), /between 1 and 12/);
});

test("renderGateReport prints weeks, verdicts, and the operator-judgment line", () => {
  const report = computeGateReport({
    catchEvents: [caughtAt("2026-07-08T12:00:00Z")],
    now: NOW,
    weeks: 2,
  });
  const text = renderGateReport(report);
  assert.match(text, /^Kizuki gate report — July 15, 2026/);
  assert.match(text, /Week of July 13, 2026 \(in progress\)/);
  assert.match(text, /Week of July 6, 2026\n/);
  assert.match(text, /true catches: 1 {2}insights captured: 0/);
  assert.match(text, /v1->v2: >=1 true catch\/week — met 1 of 1 full week\b/);
  assert.match(text, /v2->v3: >=1 acted signal\/week — met 0 of 1 full week\b/);
  assert.match(text, /operator judgment — not computed/);
});

test("renderGateReport reports no full weeks yet when weeks is 1", () => {
  const text = renderGateReport(computeGateReport({ now: NOW, weeks: 1 }));
  assert.match(text, /v1->v2: >=1 true catch\/week — no full weeks yet/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test lib/gate.test.mjs`
Expected: FAIL — `Cannot find module` for `./gate.mjs`.

- [ ] **Step 3: Write the implementation**

Create `lib/gate.mjs`:

```js
import { formatDate } from "./format.mjs";

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function weekStart(date) {
  const day = startOfDay(date);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function localIso(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return date.getFullYear() + "-" + month + "-" + day;
}

function inWindow(at, start, end) {
  const time = Date.parse(at);
  return time >= start.getTime() && time < end.getTime();
}

export function computeGateReport({
  signalEvents = [],
  catchEvents = [],
  insightEvents = [],
  now = new Date(),
  weeks = 2,
} = {}) {
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 12) {
    throw new Error("weeks must be an integer between 1 and 12");
  }
  const rows = [];
  for (let index = 0; index < weeks; index++) {
    const start = addDays(weekStart(now), -7 * index);
    const end = addDays(start, 7);
    const userChanges = signalEvents.filter(
      (event) =>
        event.event === "status_changed" && event.actor === "user" && inWindow(event.at, start, end),
    );
    rows.push({
      start: localIso(start),
      inProgress: index === 0,
      fired: signalEvents.filter(
        (event) => event.event === "observed" && inWindow(event.at, start, end),
      ).length,
      acted: userChanges.filter((event) => event.to === "acted").length,
      dismissed: userChanges.filter((event) => event.to === "dismissed").length,
      resolved: userChanges.filter((event) => event.to === "resolved").length,
      catches: catchEvents.filter(
        (event) => event.event === "caught" && inWindow(event.at, start, end),
      ).length,
      insights: insightEvents.filter(
        (event) => event.event === "captured" && inWindow(event.at, start, end),
      ).length,
    });
  }
  const fullWeeks = rows.filter((row) => !row.inProgress);
  const verdict = (criterion, metric) => ({
    criterion,
    met: fullWeeks.filter((row) => row[metric] >= 1).length,
    fullWeeks: fullWeeks.length,
  });
  return {
    generatedAt: localIso(startOfDay(now)),
    weeks: rows,
    verdicts: {
      v1ToV2: verdict(">=1 true catch/week", "catches"),
      v2ToV3: verdict(">=1 acted signal/week", "acted"),
    },
  };
}

function verdictLine(label, verdict) {
  if (!verdict.fullWeeks) return label + ": " + verdict.criterion + " — no full weeks yet";
  const unit = verdict.fullWeeks === 1 ? "full week" : "full weeks";
  return label + ": " + verdict.criterion + " — met " + verdict.met + " of " + verdict.fullWeeks + " " + unit;
}

export function renderGateReport(report) {
  const out = ["Kizuki gate report — " + formatDate(report.generatedAt), ""];
  for (const week of report.weeks) {
    out.push("Week of " + formatDate(week.start) + (week.inProgress ? " (in progress)" : ""));
    out.push(
      "  signals fired: " + week.fired + "  acted: " + week.acted +
        "  dismissed: " + week.dismissed + "  resolved: " + week.resolved,
    );
    out.push("  true catches: " + week.catches + "  insights captured: " + week.insights);
    out.push("");
  }
  out.push(verdictLine("v1->v2", report.verdicts.v1ToV2));
  out.push(verdictLine("v2->v3", report.verdicts.v2ToV3));
  out.push("Notification usefulness (not muted) is operator judgment — not computed.");
  return out.join("\n") + "\n";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test lib/gate.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/gate.mjs lib/gate.test.mjs
git commit -m "feat: add gate report core"
```

---

### Task 5: `kizuki gate` command (`lib/gateCommands.mjs`)

**Files:**
- Create: `lib/gateCommands.mjs`
- Test: `lib/gateCommands.test.mjs`
- Modify: `kizuki` (dispatch + USAGE)

**Interfaces:**
- Consumes: `computeGateReport`/`renderGateReport` (Task 4), `readSignalEvents` (`lib/signals.mjs`), `readInsightEvents` (`lib/insights.mjs`), `readCatchEvents` (Task 2).
- Produces: `runGateCommand(vaultDir, argv, {now}) -> Promise<string>` and `gateWeekLine(vaultDir, now) -> Promise<string>` (used by Task 6).

- [ ] **Step 1: Write the failing tests**

Create `lib/gateCommands.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gateWeekLine, runGateCommand } from "./gateCommands.mjs";
import { runCatchCommand } from "./catchCommands.mjs";

const NOW = new Date(2026, 6, 15, 12);
const IN_WEEK = new Date(2026, 6, 14, 9);

test("gate reads the ledgers and renders the report", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-gatecmd-"));
  await runCatchCommand(vault, ["caught something"], { now: IN_WEEK });
  const text = await runGateCommand(vault, [], { now: NOW });
  assert.match(text, /Kizuki gate report/);
  assert.match(text, /true catches: 1/);
  const parsed = JSON.parse(await runGateCommand(vault, ["--json"], { now: NOW }));
  assert.equal(parsed.weeks.length, 2);
  assert.equal(parsed.weeks[0].catches, 1);
});

test("gate honors --weeks and rejects bad argv", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-gatecmd-"));
  const parsed = JSON.parse(await runGateCommand(vault, ["--weeks", "4", "--json"], { now: NOW }));
  assert.equal(parsed.weeks.length, 4);
  await assert.rejects(runGateCommand(vault, ["--weeks"], { now: NOW }), /--weeks requires a value/);
  await assert.rejects(runGateCommand(vault, ["--weeks", "abc"], { now: NOW }), /between 1 and 12/);
  await assert.rejects(runGateCommand(vault, ["--nope"], { now: NOW }), /unknown option for gate/);
});

test("gateWeekLine summarizes the current week and prompts when empty", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-gatecmd-"));
  assert.equal(
    await gateWeekLine(vault, NOW),
    "Gate week so far: no catches recorded — log with 'kizuki catch'.",
  );
  await runCatchCommand(vault, ["one"], { now: IN_WEEK });
  assert.equal(await gateWeekLine(vault, NOW), "Gate week so far: 1 catch, 0 acted signals.");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test lib/gateCommands.test.mjs`
Expected: FAIL — `Cannot find module` for `./gateCommands.mjs`.

- [ ] **Step 3: Write the implementation**

Create `lib/gateCommands.mjs`:

```js
import { computeGateReport, renderGateReport } from "./gate.mjs";
import { readCatchEvents } from "./catches.mjs";
import { readInsightEvents } from "./insights.mjs";
import { readSignalEvents } from "./signals.mjs";

function parseGateArgs(argv) {
  let weeks = 2;
  let json = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--weeks") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error("--weeks requires a value");
      weeks = Number(value);
      index++;
      continue;
    }
    throw new Error("unknown option for gate: " + arg);
  }
  return { weeks, json };
}

async function readGateReport(vaultDir, { now, weeks }) {
  return computeGateReport({
    signalEvents: await readSignalEvents(vaultDir),
    catchEvents: await readCatchEvents(vaultDir),
    insightEvents: await readInsightEvents(vaultDir),
    now,
    weeks,
  });
}

export async function runGateCommand(vaultDir, argv, { now = new Date() } = {}) {
  const { weeks, json } = parseGateArgs(argv);
  const report = await readGateReport(vaultDir, { now, weeks });
  return json ? JSON.stringify(report, null, 2) : renderGateReport(report);
}

export async function gateWeekLine(vaultDir, now = new Date()) {
  const week = (await readGateReport(vaultDir, { now, weeks: 1 })).weeks[0];
  if (week.catches === 0 && week.acted === 0) {
    return "Gate week so far: no catches recorded — log with 'kizuki catch'.";
  }
  const catches = week.catches + (week.catches === 1 ? " catch" : " catches");
  const acted = week.acted + " acted " + (week.acted === 1 ? "signal" : "signals");
  return "Gate week so far: " + catches + ", " + acted + ".";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test lib/gateCommands.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire the CLI**

In `kizuki`, add to the imports:

```js
import { runGateCommand } from "./lib/gateCommands.mjs";
```

Add to the dispatch chain after the `catches` branch:

```js
  } else if (command === "gate") {
    console.log(await runGateCommand(vaultDir, rest));
```

Add to `USAGE` after the `catches` line:

```
  kizuki gate [--weeks n] [--json]                 weekly gate-evidence report
```

- [ ] **Step 6: Verify manually and run the full suite**

Run: `./kizuki gate && npm test`
Expected: a report with two week blocks and the two verdict lines; suite PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/gateCommands.mjs lib/gateCommands.test.mjs kizuki
git commit -m "feat: add gate command"
```

---

### Task 6: Gate line in brief and day summary (`lib/shift.mjs`)

**Files:**
- Modify: `lib/shift.mjs`
- Test: `lib/shift.test.mjs` (append tests; existing tests may need the new line added to any exact-output assertions)

**Interfaces:**
- Consumes: `gateWeekLine(vaultDir, now)` from Task 5.
- Produces: `renderBrief` output ends with the gate line; `renderDaySummary` output ends with a `## Gate` section containing the same line.

- [ ] **Step 1: Write the failing tests**

Append to `lib/shift.test.mjs` (reuse its existing tmp-vault setup helpers if present; otherwise use `mkdtemp` as below):

```js
import { runCatchCommand } from "./catchCommands.mjs";

test("brief ends with the gate week line", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-shift-gate-"));
  const empty = await renderBrief(vault, new Date(2026, 6, 15, 12));
  assert.match(empty, /Gate week so far: no catches recorded — log with 'kizuki catch'\.\n$/);
  await runCatchCommand(vault, ["caught one"], { now: new Date(2026, 6, 14, 9) });
  const brief = await renderBrief(vault, new Date(2026, 6, 15, 12));
  assert.match(brief, /Gate week so far: 1 catch, 0 acted signals\.\n$/);
});

test("day summary includes a Gate section", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-shift-gate-"));
  await runCatchCommand(vault, ["caught one"], { now: new Date(2026, 6, 14, 9) });
  const facts = await renderDaySummary(vault, "2026-07-14");
  assert.match(facts, /## Gate\nGate week so far: 1 catch, 0 acted signals\./);
});
```

(If `lib/shift.test.mjs` does not already import `mkdtemp`, `tmpdir`, `join`, `renderBrief`, or `renderDaySummary`, add them to its imports.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test lib/shift.test.mjs`
Expected: the two new tests FAIL (no gate line in output).

- [ ] **Step 3: Write the implementation**

In `lib/shift.mjs`, add the import:

```js
import { gateWeekLine } from "./gateCommands.mjs";
```

In `renderBrief`, immediately before the final `return out.join("\n").trimEnd() + "\n";`, add:

```js
  out.push("", await gateWeekLine(vaultDir, now));
```

In `renderDaySummary`, immediately before its final `return out.join("\n").trimEnd() + "\n";`, add:

```js
  out.push("", "## Gate", await gateWeekLine(vaultDir, new Date(dateStr + "T12:00:00")));
```

(`renderDaySummary` builds facts for a specific date; local noon of that date picks the week containing it without DST edge risk.)

- [ ] **Step 4: Run the full suite and fix exact-output assertions**

Run: `npm test`
Expected: the two new tests PASS. Any pre-existing `renderBrief`/`renderDaySummary` tests that assert full output will now be missing the gate line — update those assertions to include it (the empty-ledger wording is `Gate week so far: no catches recorded — log with 'kizuki catch'.`). Everything green before moving on. Note: `writeDaySummary` gates its LLM-prose call on `facts.includes("(no logged activity)")`, which is unaffected by the appended section.

- [ ] **Step 5: Commit**

```bash
git add lib/shift.mjs lib/shift.test.mjs
git commit -m "feat: surface gate week line in brief and day summary"
```

---

### Task 7: Ritual sources + skills renderer (`skills/`, `lib/skills.mjs`)

**Files:**
- Create: `skills/kizuki-start/ritual.md`, `skills/kizuki-stop/ritual.md`, `lib/skills.mjs`
- Test: `lib/skills.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `parseRitual(source) -> {name, description, invoke, body}`, `readRituals(skillsDir) -> Promise<ritual[]>`, `renderClaude(ritual) -> string`, `renderCodex(ritual) -> string`, `TARGETS = {claude: {render, distPath(name), homePath(name, home)}, codex: {...}}`. Task 8 builds the export command on these.

- [ ] **Step 1: Create the ritual sources**

Create `skills/kizuki-start/ritual.md` (body ported from `codex/prompts/kizuki-start.md`, `./kizuki` → global `kizuki`):

```markdown
---
name: kizuki-start
description: Begin a Kizuki shift — sync, read the brief, plan the first move
invoke: kizuki start
---

Run `kizuki start`. Read the brief it prints, then:

1. Give me the morning rundown in your own words — lead with anything that
   looks like cross-team misalignment or a blocker aging badly.
2. For each open follow-up, tell me whether it's still mine, waiting on
   someone else, or stale.
3. Suggest the one thing to do first and draft it if it's a message.

Rules: the vault is the source of truth — read entities via the kizuki MCP
tools if you need detail. You never send anything anywhere; every outward
action is a draft I approve and send myself.
```

Create `skills/kizuki-stop/ritual.md`:

```markdown
---
name: kizuki-stop
description: End a Kizuki shift — final sync, day summary, tomorrow's first move
invoke: kizuki stop
---

Run `kizuki stop`. Read the day summary file it prints the path to, then:

1. Recap the day in three sentences max.
2. List what's still open, who each item is waiting on, and what will bite
   first tomorrow.
3. Write tomorrow's first move as a one-line note.

Rules: observe and advise only. Drafts, not sends.
```

- [ ] **Step 2: Write the failing tests**

Create `lib/skills.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TARGETS, parseRitual, readRituals, renderClaude, renderCodex } from "./skills.mjs";

const SOURCE = `---
name: kizuki-start
description: Begin a Kizuki shift
invoke: kizuki start
---

Run \`kizuki start\`. Then report.
`;

test("parseRitual extracts frontmatter keys and body", () => {
  const ritual = parseRitual(SOURCE);
  assert.deepEqual(ritual, {
    name: "kizuki-start",
    description: "Begin a Kizuki shift",
    invoke: "kizuki start",
    body: "Run `kizuki start`. Then report.\n",
  });
});

test("parseRitual throws on missing frontmatter or missing keys", () => {
  assert.throws(() => parseRitual("no frontmatter"), /missing frontmatter/);
  assert.throws(
    () => parseRitual("---\nname: x\ndescription: y\n---\n\nbody\n"),
    /missing invoke/,
  );
});

test("parseRitual rejects an unsafe name", () => {
  const unsafe = SOURCE.replace("name: kizuki-start", "name: ../evil");
  assert.throws(() => parseRitual(unsafe), /not path-safe/);
});

test("renderClaude emits SKILL.md frontmatter plus body; renderCodex emits body only", () => {
  const ritual = parseRitual(SOURCE);
  assert.equal(
    renderClaude(ritual),
    "---\nname: kizuki-start\ndescription: Begin a Kizuki shift\n---\n\nRun `kizuki start`. Then report.\n",
  );
  assert.equal(renderCodex(ritual), "Run `kizuki start`. Then report.\n");
});

test("TARGETS map dist and home paths", () => {
  assert.equal(TARGETS.claude.distPath("kizuki-start"), join("claude", "kizuki-start", "SKILL.md"));
  assert.equal(
    TARGETS.claude.homePath("kizuki-start", "/home/u"),
    join("/home/u", ".claude", "skills", "kizuki-start", "SKILL.md"),
  );
  assert.equal(TARGETS.codex.distPath("kizuki-start"), join("codex", "kizuki-start.md"));
  assert.equal(
    TARGETS.codex.homePath("kizuki-start", "/home/u"),
    join("/home/u", ".codex", "prompts", "kizuki-start.md"),
  );
});

test("readRituals reads skills/*/ritual.md sorted and validates names match dirs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-skills-"));
  await mkdir(join(dir, "kizuki-start"), { recursive: true });
  await writeFile(join(dir, "kizuki-start", "ritual.md"), SOURCE, "utf8");
  const rituals = await readRituals(dir);
  assert.equal(rituals.length, 1);
  assert.equal(rituals[0].name, "kizuki-start");

  await mkdir(join(dir, "renamed"), { recursive: true });
  await writeFile(join(dir, "renamed", "ritual.md"), SOURCE, "utf8");
  await assert.rejects(readRituals(dir), /frontmatter name must match directory name/);
});

test("readRituals throws on a missing or empty skills dir", async () => {
  await assert.rejects(readRituals("/nonexistent/skills"), /no skills directory/);
  const empty = await mkdtemp(join(tmpdir(), "kizuki-skills-empty-"));
  await assert.rejects(readRituals(empty), /no rituals found/);
});

test("repo ritual sources parse and invoke the global kizuki binary", async () => {
  const rituals = await readRituals(join(import.meta.dirname, "..", "skills"));
  assert.deepEqual(rituals.map((ritual) => ritual.name), ["kizuki-start", "kizuki-stop"]);
  for (const ritual of rituals) {
    assert.doesNotMatch(ritual.body, /\.\/kizuki/);
    assert.match(ritual.body, /`kizuki (start|stop)`/);
  }
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test lib/skills.test.mjs`
Expected: FAIL — `Cannot find module` for `./skills.mjs`.

- [ ] **Step 4: Write the implementation**

Create `lib/skills.mjs`:

```js
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const FRONTMATTER_KEYS = ["name", "description", "invoke"];

function assertSafeName(name) {
  if (name.includes("..") || name.includes("/") || name.includes("\\") || name.includes("\0")) {
    throw new Error("ritual name is not path-safe: " + JSON.stringify(name));
  }
}

export function parseRitual(source) {
  const match = /^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/.exec(source);
  if (!match) throw new Error("ritual is missing frontmatter");
  const fields = {};
  for (const line of match[1].split("\n")) {
    const keyValue = /^([a-z]+):\s*(\S.*)$/.exec(line);
    if (!keyValue) throw new Error("invalid ritual frontmatter line: " + JSON.stringify(line));
    fields[keyValue[1]] = keyValue[2].trim();
  }
  for (const key of FRONTMATTER_KEYS) {
    if (!fields[key]) throw new Error("ritual frontmatter is missing " + key);
  }
  assertSafeName(fields.name);
  const body = match[2].trim();
  if (!body) throw new Error("ritual body is empty");
  return {
    name: fields.name,
    description: fields.description,
    invoke: fields.invoke,
    body: body + "\n",
  };
}

export async function readRituals(skillsDir) {
  let names;
  try {
    names = await readdir(skillsDir);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("no skills directory at " + skillsDir);
    throw error;
  }
  const rituals = [];
  for (const name of names.sort()) {
    const path = join(skillsDir, name, "ritual.md");
    let source;
    try {
      source = await readFile(path, "utf8");
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") continue;
      throw error;
    }
    let ritual;
    try {
      ritual = parseRitual(source);
    } catch (error) {
      throw new Error(path + ": " + error.message);
    }
    if (ritual.name !== name) throw new Error(path + ": frontmatter name must match directory name");
    rituals.push(ritual);
  }
  if (!rituals.length) throw new Error("no rituals found in " + skillsDir);
  return rituals;
}

export function renderClaude(ritual) {
  return ["---", "name: " + ritual.name, "description: " + ritual.description, "---", "", ritual.body].join("\n");
}

export function renderCodex(ritual) {
  return ritual.body;
}

export const TARGETS = Object.freeze({
  claude: {
    render: renderClaude,
    distPath: (name) => join("claude", name, "SKILL.md"),
    homePath: (name, home) => join(home, ".claude", "skills", name, "SKILL.md"),
  },
  codex: {
    render: renderCodex,
    distPath: (name) => join("codex", name + ".md"),
    homePath: (name, home) => join(home, ".codex", "prompts", name + ".md"),
  },
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test lib/skills.test.mjs`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add skills/ lib/skills.mjs lib/skills.test.mjs
git commit -m "feat: add ritual sources and skills renderer"
```

---

### Task 8: `kizuki skills export` + committed dist + script removal

**Files:**
- Modify: `lib/skills.mjs` (add `runSkillsCommand`), `lib/skills.test.mjs`, `kizuki` (dispatch + USAGE), `README.md`
- Create: `dist/skills/` (generated output, committed)
- Delete: `scripts/install-codex-prompts.mjs`, `codex/prompts/` (superseded sources — `skills/*/ritual.md` is now the single source; grep for references and update them)

**Interfaces:**
- Consumes: Task 7's `readRituals` + `TARGETS`.
- Produces: `runSkillsCommand(vaultDir, argv, {home}) -> Promise<string>`; CLI `kizuki skills export [--agent claude|codex|all] [--check] [--dist]`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/skills.test.mjs` (add `runSkillsCommand` and `readFile` to the imports):

```js
async function seededVault() {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-skills-vault-"));
  await mkdir(join(vault, "skills", "kizuki-start"), { recursive: true });
  await writeFile(join(vault, "skills", "kizuki-start", "ritual.md"), SOURCE, "utf8");
  return vault;
}

test("skills export installs rendered rituals into the home dirs", async () => {
  const vault = await seededVault();
  const home = await mkdtemp(join(tmpdir(), "kizuki-skills-home-"));
  const out = await runSkillsCommand(vault, ["export"], { home });
  const claudePath = join(home, ".claude", "skills", "kizuki-start", "SKILL.md");
  const codexPath = join(home, ".codex", "prompts", "kizuki-start.md");
  assert.match(out, new RegExp("wrote .*SKILL\\.md"));
  assert.equal(await readFile(claudePath, "utf8"), renderClaude(parseRitual(SOURCE)));
  assert.equal(await readFile(codexPath, "utf8"), renderCodex(parseRitual(SOURCE)));
});

test("skills export --agent codex writes only the codex target", async () => {
  const vault = await seededVault();
  const home = await mkdtemp(join(tmpdir(), "kizuki-skills-home-"));
  await runSkillsCommand(vault, ["export", "--agent", "codex"], { home });
  await assert.rejects(readFile(join(home, ".claude", "skills", "kizuki-start", "SKILL.md"), "utf8"));
  await readFile(join(home, ".codex", "prompts", "kizuki-start.md"), "utf8");
});

test("skills export --dist writes the committed tree and --check verifies it", async () => {
  const vault = await seededVault();
  await runSkillsCommand(vault, ["export", "--dist"]);
  assert.equal(
    await readFile(join(vault, "dist", "skills", "claude", "kizuki-start", "SKILL.md"), "utf8"),
    renderClaude(parseRitual(SOURCE)),
  );
  assert.equal(await runSkillsCommand(vault, ["export", "--check"]), "skills dist up to date");
  await writeFile(
    join(vault, "skills", "kizuki-start", "ritual.md"),
    SOURCE.replace("Then report.", "Then drifted."),
    "utf8",
  );
  await assert.rejects(runSkillsCommand(vault, ["export", "--check"]), /skills dist drift: .*kizuki-start/);
});

test("skills export rejects bad argv", async () => {
  const vault = await seededVault();
  await assert.rejects(runSkillsCommand(vault, ["install"]), /unknown skills command/);
  await assert.rejects(runSkillsCommand(vault, ["export", "--agent", "vim"]), /invalid agent/);
  await assert.rejects(runSkillsCommand(vault, ["export", "--check", "--dist"]), /mutually exclusive/);
  await assert.rejects(runSkillsCommand(vault, ["export", "--nope"]), /unknown option for skills export/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test lib/skills.test.mjs`
Expected: FAIL — `runSkillsCommand` is not exported.

- [ ] **Step 3: Write the implementation**

In `lib/skills.mjs`, extend the imports:

```js
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
```

Append:

```js
function parseExportArgs(argv) {
  let agent = "all";
  let check = false;
  let dist = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--check") {
      check = true;
      continue;
    }
    if (arg === "--dist") {
      dist = true;
      continue;
    }
    if (arg === "--agent") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error("--agent requires a value");
      agent = value;
      index++;
      continue;
    }
    throw new Error("unknown option for skills export: " + arg);
  }
  if (!["claude", "codex", "all"].includes(agent)) throw new Error("invalid agent " + JSON.stringify(agent));
  if (check && dist) throw new Error("--check and --dist are mutually exclusive");
  return { agent, check, dist };
}

export async function runSkillsCommand(vaultDir, argv, { home = homedir() } = {}) {
  const [action, ...rest] = argv;
  if (action !== "export") throw new Error("unknown skills command " + JSON.stringify(action));
  const { agent, check, dist } = parseExportArgs(rest);
  const rituals = await readRituals(join(vaultDir, "skills"));
  const targets = agent === "all" ? Object.keys(TARGETS) : [agent];
  const distRoot = join(vaultDir, "dist", "skills");
  const written = [];

  for (const targetName of targets) {
    const target = TARGETS[targetName];
    for (const ritual of rituals) {
      const rendered = target.render(ritual);
      const distFile = join(distRoot, target.distPath(ritual.name));
      if (check) {
        let existing = null;
        try {
          existing = await readFile(distFile, "utf8");
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        if (existing !== rendered) {
          throw new Error("skills dist drift: " + distFile + " — run kizuki skills export --dist");
        }
        continue;
      }
      const path = dist ? distFile : target.homePath(ritual.name, home);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, rendered, "utf8");
      written.push(path);
    }
  }
  return check ? "skills dist up to date" : written.map((path) => "wrote " + path).join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test lib/skills.test.mjs`
Expected: PASS (12 tests).

- [ ] **Step 5: Wire the CLI, generate dist, remove the superseded script**

In `kizuki`, add to the imports:

```js
import { runSkillsCommand } from "./lib/skills.mjs";
```

Add to the dispatch chain after the `gate` branch:

```js
  } else if (command === "skills") {
    console.log(await runSkillsCommand(vaultDir, rest));
```

Add to `USAGE` after the `gate` line:

```
  kizuki skills export [--agent claude|codex|all] [--check] [--dist]   install ritual skills
```

Generate and commit the dist tree:

Run: `./kizuki skills export --dist && ./kizuki skills export --check`
Expected: four `wrote dist/skills/...` lines, then `skills dist up to date`.

Delete the superseded sources and check references:

```bash
git rm scripts/install-codex-prompts.mjs
git rm -r codex/prompts
grep -rn "install-codex-prompts\|codex/prompts" README.md CLAUDE.md AGENTS.md docs/ package.json || true
```

Update every hit to reference `kizuki skills export` / `dist/skills/` instead (docs under `docs/superpowers/` are historical records — leave those; update README, CLAUDE.md, AGENTS.md, package.json scripts if present). If `scripts/` is then empty, remove it.

- [ ] **Step 6: README install section**

In `README.md`, add under the install/setup material:

```markdown
## Install the rituals as agent skills

    kizuki skills export            # installs for Claude Code and Codex
    kizuki skills export --agent codex

Claude Code skills land in `~/.claude/skills/<name>/SKILL.md`; Codex prompts in
`~/.codex/prompts/<name>.md`. Pure-markdown users can copy the committed files
under `dist/skills/` directly. The rituals invoke the `kizuki` binary, so it
must be on your PATH.
```

- [ ] **Step 7: Verify manually and run the full suite**

Run: `npm test && ./kizuki skills export --check`
Expected: suite PASS; `skills dist up to date`.

- [ ] **Step 8: Commit**

```bash
git add lib/skills.mjs lib/skills.test.mjs kizuki dist/skills README.md
git commit -m "feat: add skills export command"
```

(The `git rm` deletions from Step 5 are already staged; include them in this commit.)

---

### Task 9: Docs sync (CLAUDE.md, AGENTS.md, ROADMAP, BACKLOG)

**Files:**
- Modify: `CLAUDE.md`, `AGENTS.md`, `docs/ROADMAP.md`, `docs/BACKLOG.md`

**Interfaces:**
- Consumes: everything shipped in Tasks 1–8.
- Produces: docs that match the code. CLAUDE.md and AGENTS.md must stay mirrored.

- [ ] **Step 1: Update CLAUDE.md**

- Commands block: add
  ```
  ./kizuki catch "<note>" [--signal <id>] [--insight <id>]   record a true catch (gate evidence)
  ./kizuki catches [--json]               list recorded catches
  ./kizuki gate [--weeks n] [--json]      weekly gate-evidence report
  ./kizuki skills export [--agent claude|codex|all] [--check] [--dist]   install ritual skills
  ```
- Architecture list: add
  - `lib/catches.mjs` — stable catch identity, event validation/reduction, capture planning, atomic append-only writes to `catches/events.jsonl`.
  - `lib/catchCommands.mjs` — catch capture (cross-ledger link validation, locked) and read-only listing.
  - `lib/gate.mjs` — pure weekly gate-report compute + render (Monday-start local weeks, injected `now`).
  - `lib/gateCommands.mjs` — reads the three ledgers for `kizuki gate` and the brief/day-summary gate line.
  - `lib/skills.mjs` — ritual parsing (`skills/*/ritual.md`) and per-agent rendering/export (`dist/skills/`, home installs).
- Safety invariants: add "`catches/events.jsonl` is the canonical catch record — append-only, mutations hold `state/vault.lock`; a catch is operator-recorded evidence about Kizuki's usefulness and never upgrades a signal or insight."
- Data safety + parallel-work vault-data lists: add `catches/`.

- [ ] **Step 2: Mirror into AGENTS.md**

Apply the same edits to `AGENTS.md` (it mirrors CLAUDE.md for non-Claude agents). If it still references `scripts/install-codex-prompts.mjs` or `codex/prompts/`, point those at `kizuki skills export`.

- [ ] **Step 3: Update ROADMAP.md and BACKLOG.md**

- `docs/ROADMAP.md`: in "Open v1 validation" and the gate table intro, note the tooling: "Track gate evidence with `kizuki catch` / `kizuki gate` (spec: `docs/superpowers/specs/2026-07-13-kizuki-gate-instrumentation-design.md`)."
- `docs/BACKLOG.md`: mark the skills-pack line shipped: "Distribute rituals as an open Agent Skills pack — **shipped** (`kizuki skills export`, committed `dist/skills/`)."

- [ ] **Step 4: Run the full suite one last time**

Run: `npm test`
Expected: PASS, all files.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md AGENTS.md docs/ROADMAP.md docs/BACKLOG.md
git commit -m "docs: sync gate instrumentation and skills export"
```
