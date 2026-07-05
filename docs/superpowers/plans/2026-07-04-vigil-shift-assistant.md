# Vigil Shift Assistant (v0 remainder + v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the sync pipeline (agent timeout, evidence-guard prompt rules) and add shift rituals: `vigil start` / `vigil stop` with a launchd background sync loop, morning brief, and day summary.

**Architecture:** All logic lives in pure, `vaultDir`-parameterized functions under `lib/` (tested with node:test + temp dirs); the `vigil` executable is thin dispatch. Shared vault-reading helpers move from `mcp/tools.mjs` into `lib/query.mjs` so `lib/` never imports from `mcp/`. The LLM-returns-JSON / deterministic-JS-writes boundary is untouched.

**Tech Stack:** Node built-ins only in core (ESM `.mjs`), `node:test` + `node:assert/strict`. No new npm packages.

## Global Constraints

- Zero runtime dependencies in root/`lib/` — Node built-ins only. `mcp/` keeps its own package.json; never import MCP SDK into `lib/`.
- TDD: every task writes the failing test first; `npm test` green before every commit.
- No silent failures — throw/reject loudly; the only allowed expected-failure handling is `ENOENT → null/default` reads.
- Entity/vault safety invariants (managed-section splice, exact-line dedup, path-safe names) must not change.
- Vault data dirs are gitignored; new dirs `state/` and `days/` hold work data → gitignore them too.
- Executable is repo-local `./vigil` (renamed from `./sync`), shebang `#!/usr/bin/env node`.

---

### Task 1: Agent timeout (`lib/agent.mjs`)

**Files:**
- Modify: `lib/agent.mjs`
- Test: `lib/agent.test.mjs`

**Interfaces:**
- Consumes: existing `buildAgentArgv(cmd, prompt)`, `resolveAgent(vaultDir)`, `makeRunAgent(cmd)`.
- Produces: `resolveAgent(vaultDir) -> Promise<{cmd: string[], timeoutMs: number}>` (new `timeoutMs`, default `DEFAULT_TIMEOUT_MS = 300000`, from optional `timeoutMs` key in `vigil.config.json`; invalid values throw). `makeRunAgent(cmd, timeoutMs?) -> (prompt) => Promise<string>` which kills the child and rejects with `agent timed out after <ms>ms` on expiry. Task 8's executable calls `makeRunAgent(cmd, timeoutMs)`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/agent.test.mjs` (match the file's existing imports/style; it already imports `test`, `assert`, `mkdtemp`-style temp dirs for `resolveAgent` tests):

```js
test("resolveAgent returns default timeoutMs when config has none", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vigil-"));
  await writeFile(join(dir, "vigil.config.json"), JSON.stringify({ agentCmd: ["echo"] }));
  const { timeoutMs } = await resolveAgent(dir);
  assert.equal(timeoutMs, 300000);
});

test("resolveAgent reads timeoutMs from config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vigil-"));
  await writeFile(join(dir, "vigil.config.json"), JSON.stringify({ agentCmd: ["echo"], timeoutMs: 1234 }));
  const { timeoutMs } = await resolveAgent(dir);
  assert.equal(timeoutMs, 1234);
});

test("resolveAgent rejects non-positive or non-integer timeoutMs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vigil-"));
  await writeFile(join(dir, "vigil.config.json"), JSON.stringify({ agentCmd: ["echo"], timeoutMs: "5s" }));
  await assert.rejects(() => resolveAgent(dir), /timeoutMs must be a positive integer/);
});

test("resolveAgent with no config file returns defaults", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vigil-"));
  const { cmd, timeoutMs } = await resolveAgent(dir);
  assert.deepEqual(cmd, ["codex", "exec"]);
  assert.equal(timeoutMs, 300000);
});

test("makeRunAgent rejects when the agent exceeds timeoutMs", async () => {
  const run = makeRunAgent(["sleep", "5"], 100);
  await assert.rejects(() => run("ignored"), /agent timed out after 100ms/);
});

test("makeRunAgent resolves normally under the timeout", async () => {
  const run = makeRunAgent(["echo", "hi"], 5000);
  const out = await run("ignored");
  assert.match(out, /hi/);
});
```

Note: `makeRunAgent(["sleep","5"], ...)` appends the prompt as a final arg (`sleep 5 ignored`) — sleep ignores extra args on macOS? It does NOT (errors on extra operand on some systems). Use the `{prompt}` token to control argv exactly: `makeRunAgent(["sleep", "5", "{prompt}"], 100)` replaces the token — still passes "ignored" to sleep. Safest stub: `["sh", "-c", "sleep 5", "{prompt}"]`? `sh -c 'sleep 5' ignored` sets $0=ignored — valid and sleeps. Use for the timeout test:

```js
const run = makeRunAgent(["sh", "-c", "sleep 5", "{prompt}"], 100);
```

and for the success test:

```js
const run = makeRunAgent(["sh", "-c", "echo hi", "{prompt}"], 5000);
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test lib/agent.test.mjs`
Expected: FAIL — `timeoutMs` is `undefined` (resolveAgent tests) and timeout test times out the promise resolution path / rejects with wrong message.

- [ ] **Step 3: Implement**

In `lib/agent.mjs`:

```js
export const DEFAULT_TIMEOUT_MS = 300000;
```

In `resolveAgent`, ENOENT branch becomes:

```js
if (e.code === "ENOENT") return { cmd: DEFAULT_AGENT_CMD, timeoutMs: DEFAULT_TIMEOUT_MS };
```

and after the `agentCmd` validation:

```js
const timeoutMs = data.timeoutMs ?? DEFAULT_TIMEOUT_MS;
if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
  throw new Error(`${CONFIG_FILE}: timeoutMs must be a positive integer (milliseconds)`);
}
return { cmd, timeoutMs };
```

Replace `makeRunAgent`:

```js
export function makeRunAgent(cmd, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return (prompt) =>
    new Promise((resolve, reject) => {
      const { file, args } = buildAgentArgv(cmd, prompt);
      const child = spawn(file, args, { stdio: ["ignore", "pipe", "inherit"] });
      let out = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`agent timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      child.stdout.on("data", (d) => (out += d));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(out);
        else reject(new Error(`${file} exited with ${code}`));
      });
    });
}
```

(Double-settle after kill is harmless — the promise is already rejected when `close` fires.)

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: all pass (existing `sync`-executable destructuring `const { cmd } = await resolveAgent(...)` still works; Task 8 starts passing `timeoutMs`).

- [ ] **Step 5: Commit**

```bash
git add lib/agent.mjs lib/agent.test.mjs
git commit -m "feat: agent timeout (timeoutMs config, default 300s)"
```

---

### Task 2: Evidence-guard + source-attribution prompt rules

**Files:**
- Modify: `lib/prompt.mjs`
- Test: `lib/prompt.test.mjs`

**Interfaces:**
- Consumes: existing `buildPrompt({scope, sources, vaultDir})`.
- Produces: same signature; the returned prompt's `Rules:` block contains the two new literal rule lines below (Task 8 doesn't depend on them; the sync agent does).

- [ ] **Step 1: Write the failing test**

Append to `lib/prompt.test.mjs`:

```js
test("prompt forbids inventing entities and relabeling sources", () => {
  const p = buildPrompt({ scope: { kind: "all" }, sources: ["slack"], vaultDir: "/v" });
  assert.match(p, /Only report entities directly evidenced/);
  assert.match(p, /always use source "transcript"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/prompt.test.mjs`
Expected: FAIL — no match.

- [ ] **Step 3: Implement**

In `lib/prompt.mjs`, add to the `Rules:` list (after the "Be faithful" line):

```js
`- Only report entities directly evidenced in the transcript files or the listed sources. Never derive entities from the vault directory itself, its code, or its docs.`,
`- Each rawEntry "source" must be the channel the item actually came from. Items read from transcript files always use source "transcript" — never relabel them.`,
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/prompt.mjs lib/prompt.test.mjs
git commit -m "feat: evidence-guard and source-attribution prompt rules"
```

---

### Task 3: Extract `lib/query.mjs` from `mcp/tools.mjs`

**Files:**
- Create: `lib/query.mjs`
- Create: `lib/query.test.mjs`
- Modify: `mcp/tools.mjs`

**Interfaces:**
- Consumes: `entityDir`, `ANALYSIS_START`, `ANALYSIS_END` from `lib/vault.mjs`.
- Produces (used by Task 5/6 and by `mcp/tools.mjs`):
  - `TYPES: string[]` — `["person","project","team"]`
  - `managedSection(content: string) -> string`
  - `bulletsUnder(section: string, heading: string) -> string[]`
  - `eachEntity(vaultDir: string, filterType?: string) -> Promise<{type,name,content,path}[]>` — **now includes `path`** (absolute file path).
  - `followupsByEntity(vaultDir: string) -> Promise<{type,name,followUps: string[], actions: string[]}[]>` (only entities having at least one of either).

- [ ] **Step 1: Write the failing test**

Create `lib/query.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eachEntity, followupsByEntity, managedSection, bulletsUnder, TYPES } from "./query.mjs";

async function vaultWith(files) {
  const dir = await mkdtemp(join(tmpdir(), "vigil-q-"));
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(join(dir, rel, ".."), { recursive: true });
    await writeFile(join(dir, rel), content, "utf8");
  }
  return dir;
}

const ENTITY = `---
type: person
name: maya
---

# maya

## Log

<!-- VIGIL:ANALYSIS:START -->
**Status:** busy
**Follow-ups:**
- chase creds
**Recommended actions:**
- escalate ticket
<!-- VIGIL:ANALYSIS:END -->
`;

test("TYPES lists the three entity types", () => {
  assert.deepEqual(TYPES, ["person", "project", "team"]);
});

test("eachEntity returns type, name, content, and path", async () => {
  const dir = await vaultWith({ "people/maya.md": ENTITY });
  const all = await eachEntity(dir);
  assert.equal(all.length, 1);
  assert.equal(all[0].type, "person");
  assert.equal(all[0].name, "maya");
  assert.equal(all[0].path, join(dir, "people", "maya.md"));
  assert.match(all[0].content, /# maya/);
});

test("eachEntity skips missing type dirs and honors filterType", async () => {
  const dir = await vaultWith({ "people/maya.md": ENTITY });
  assert.equal((await eachEntity(dir, "project")).length, 0);
  assert.equal((await eachEntity(dir, "person")).length, 1);
});

test("followupsByEntity extracts follow-ups and actions", async () => {
  const dir = await vaultWith({ "people/maya.md": ENTITY });
  const groups = await followupsByEntity(dir);
  assert.deepEqual(groups, [
    { type: "person", name: "maya", followUps: ["chase creds"], actions: ["escalate ticket"] },
  ]);
});

test("managedSection and bulletsUnder work on raw strings", () => {
  const section = managedSection(ENTITY);
  assert.match(section, /\*\*Status:\*\* busy/);
  assert.deepEqual(bulletsUnder(section, "**Follow-ups:"), ["chase creds"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/query.test.mjs`
Expected: FAIL — `Cannot find module './query.mjs'`.

- [ ] **Step 3: Create `lib/query.mjs`**

Move the implementations verbatim from `mcp/tools.mjs` (`TYPES`, `managedSection`, `eachEntity`, `bulletsUnder`), with one change — `eachEntity` records the path:

```js
import { readFile, readdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { entityDir, ANALYSIS_START, ANALYSIS_END } from "./vault.mjs";

export const TYPES = ["person", "project", "team"];

export function managedSection(content) {
  const s = content.indexOf(ANALYSIS_START);
  const e = content.indexOf(ANALYSIS_END);
  if (s === -1 || e === -1 || e < s) return "";
  return content.slice(s + ANALYSIS_START.length, e);
}

export async function eachEntity(vaultDir, filterType) {
  const out = [];
  for (const type of filterType ? [filterType] : TYPES) {
    const dir = join(vaultDir, entityDir(type));
    let files;
    try {
      files = await readdir(dir);
    } catch (e) {
      if (e.code === "ENOENT") continue;
      throw e;
    }
    for (const f of files.filter((f) => f.endsWith(".md"))) {
      const path = join(dir, f);
      const content = await readFile(path, "utf8");
      out.push({ type, name: basename(f, ".md"), content, path });
    }
  }
  return out;
}

export function bulletsUnder(section, heading) {
  const lines = section.split("\n");
  const out = [];
  let active = false;
  for (const line of lines) {
    if (/^\*\*.+:\*\*/.test(line)) active = line.startsWith(heading);
    else if (active && line.trimStart().startsWith("- ")) out.push(line.trim().slice(2).trim());
  }
  return out;
}

export async function followupsByEntity(vaultDir) {
  const groups = [];
  for (const e of await eachEntity(vaultDir)) {
    const section = managedSection(e.content);
    const followUps = bulletsUnder(section, "**Follow-ups:");
    const actions = bulletsUnder(section, "**Recommended actions:");
    if (followUps.length || actions.length) groups.push({ type: e.type, name: e.name, followUps, actions });
  }
  return groups;
}
```

- [ ] **Step 4: Rewire `mcp/tools.mjs`**

Delete the moved definitions from `mcp/tools.mjs` and import instead:

```js
import { TYPES, managedSection, eachEntity, bulletsUnder, followupsByEntity } from "../lib/query.mjs";
export { TYPES };
```

Rewrite `listFollowups` to use the shared aggregation:

```js
export async function listFollowups(vaultDir) {
  const groups = await followupsByEntity(vaultDir);
  const blocks = groups.map((g) =>
    [
      `${g.type}/${g.name}`,
      ...g.followUps.map((f) => `  - [follow-up] ${f}`),
      ...g.actions.map((a) => `  - [action] ${a}`),
    ].join("\n"),
  );
  if (!blocks.length) return "No open follow-ups or actions.";
  return truncate(blocks.join("\n\n"));
}
```

(`assertType`, `assertName`, `truncate`, `readIfExists`, `statusOf`, and the tool functions stay in `mcp/tools.mjs`; `statusOf` now uses the imported `managedSection`.)

- [ ] **Step 5: Run the full suite (including mcp tests)**

Run: `npm test && node --test mcp/tools.test.mjs`
Expected: all pass — `mcp/tools.test.mjs` output identical to before the refactor.

- [ ] **Step 6: Commit**

```bash
git add lib/query.mjs lib/query.test.mjs mcp/tools.mjs
git commit -m "refactor: extract vault query helpers to lib/query.mjs"
```

---

### Task 4: Shift state (`lib/shift.mjs` — flags only)

**Files:**
- Create: `lib/shift.mjs`
- Create: `lib/shift.test.mjs`

**Interfaces:**
- Consumes: nothing beyond node builtins.
- Produces (used by Tasks 5, 6, 8):
  - `readShift(vaultDir) -> Promise<{started: string} | null>`
  - `startShift(vaultDir, now?: Date) -> Promise<void>` — writes `state/shift.json`
  - `endShift(vaultDir) -> Promise<void>` — removes the flag (idempotent)
  - `readLastStop(vaultDir) -> Promise<{stopped: string} | null>`
  - `recordStop(vaultDir, now?: Date) -> Promise<void>` — writes `state/last-stop.json`

- [ ] **Step 1: Write the failing test**

Create `lib/shift.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readShift, startShift, endShift, readLastStop, recordStop } from "./shift.mjs";

test("shift flag lifecycle", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vigil-s-"));
  assert.equal(await readShift(dir), null);
  await startShift(dir, new Date("2026-07-06T09:00:00Z"));
  assert.deepEqual(await readShift(dir), { started: "2026-07-06T09:00:00.000Z" });
  await endShift(dir);
  assert.equal(await readShift(dir), null);
  await endShift(dir); // idempotent — no throw
});

test("last-stop record lifecycle", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vigil-s-"));
  assert.equal(await readLastStop(dir), null);
  await recordStop(dir, new Date("2026-07-06T17:00:00Z"));
  assert.deepEqual(await readLastStop(dir), { stopped: "2026-07-06T17:00:00.000Z" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/shift.test.mjs`
Expected: FAIL — `Cannot find module './shift.mjs'`.

- [ ] **Step 3: Implement `lib/shift.mjs`**

```js
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const stateDir = (vaultDir) => join(vaultDir, "state");
const shiftPath = (vaultDir) => join(stateDir(vaultDir), "shift.json");
const lastStopPath = (vaultDir) => join(stateDir(vaultDir), "last-stop.json");

async function readJsonOrNull(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

async function writeJson(path, data) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(data) + "\n", "utf8");
}

export const readShift = (vaultDir) => readJsonOrNull(shiftPath(vaultDir));
export const startShift = (vaultDir, now = new Date()) =>
  writeJson(shiftPath(vaultDir), { started: now.toISOString() });
export const endShift = (vaultDir) => rm(shiftPath(vaultDir), { force: true });
export const readLastStop = (vaultDir) => readJsonOrNull(lastStopPath(vaultDir));
export const recordStop = (vaultDir, now = new Date()) =>
  writeJson(lastStopPath(vaultDir), { stopped: now.toISOString() });
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/shift.mjs lib/shift.test.mjs
git commit -m "feat: shift state flags (shift.json, last-stop.json)"
```

---

### Task 5: Morning brief renderer (`lib/shift.mjs`)

**Files:**
- Modify: `lib/shift.mjs`
- Test: `lib/shift.test.mjs`

**Interfaces:**
- Consumes: `eachEntity`, `followupsByEntity` from `lib/query.mjs` (Task 3); `readLastStop` (Task 4).
- Produces: `renderBrief(vaultDir, now?: Date) -> Promise<string>` — markdown with `## Changed since last shift` (entity files whose mtime is after `last-stop.json`; all entities listed when no baseline) and `## Open follow-ups`. Used by Task 8's `vigil start`.

- [ ] **Step 1: Write the failing test**

Append to `lib/shift.test.mjs` (add imports: `mkdir`, `writeFile`, `utimes` from `node:fs/promises`, `renderBrief` from `./shift.mjs`):

```js
const ENTITY = `---
type: person
name: maya
---

# maya

## Log

<!-- VIGIL:ANALYSIS:START -->
**Status:** busy
**Follow-ups:**
- chase creds
<!-- VIGIL:ANALYSIS:END -->
`;

async function seedEntity(dir, rel, content, mtime) {
  await mkdir(join(dir, rel, ".."), { recursive: true });
  await writeFile(join(dir, rel), content, "utf8");
  if (mtime) await utimes(join(dir, rel), mtime, mtime);
}

test("renderBrief without baseline lists all entities and follow-ups", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vigil-b-"));
  await seedEntity(dir, "people/maya.md", ENTITY);
  const brief = await renderBrief(dir, new Date("2026-07-06T09:00:00Z"));
  assert.match(brief, /# Vigil brief — 2026-07-06/);
  assert.match(brief, /## Changed since last shift/);
  assert.match(brief, /- person\/maya/);
  assert.match(brief, /## Open follow-ups/);
  assert.match(brief, /- person\/maya: \[follow-up\] chase creds/);
});

test("renderBrief with baseline only lists entities modified after last stop", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vigil-b-"));
  await seedEntity(dir, "people/old.md", ENTITY.replaceAll("maya", "old"), new Date("2026-07-01T00:00:00Z"));
  await seedEntity(dir, "people/fresh.md", ENTITY.replaceAll("maya", "fresh"), new Date("2026-07-06T08:00:00Z"));
  await recordStop(dir, new Date("2026-07-05T17:00:00Z"));
  const brief = await renderBrief(dir, new Date("2026-07-06T09:00:00Z"));
  assert.doesNotMatch(brief, /Changed since last shift[\s\S]*- person\/old/);
  assert.match(brief, /- person\/fresh/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/shift.test.mjs`
Expected: FAIL — `renderBrief` not exported.

- [ ] **Step 3: Implement**

Add to `lib/shift.mjs`:

```js
import { stat } from "node:fs/promises";
import { eachEntity, followupsByEntity } from "./query.mjs";

export async function renderBrief(vaultDir, now = new Date()) {
  const out = [`# Vigil brief — ${now.toISOString().slice(0, 10)}`, "", "## Changed since last shift"];
  const last = await readLastStop(vaultDir);
  const entities = await eachEntity(vaultDir);
  let changed;
  if (last) {
    const cutoff = Date.parse(last.stopped);
    changed = [];
    for (const e of entities) {
      if ((await stat(e.path)).mtimeMs > cutoff) changed.push(e);
    }
  } else {
    changed = entities;
  }
  out.push(...(changed.length ? changed.map((e) => `- ${e.type}/${e.name}`) : ["(none)"]), "");
  out.push("## Open follow-ups");
  const groups = await followupsByEntity(vaultDir);
  if (!groups.length) out.push("(none)");
  for (const g of groups) {
    out.push(...g.followUps.map((f) => `- ${g.type}/${g.name}: [follow-up] ${f}`));
    out.push(...g.actions.map((a) => `- ${g.type}/${g.name}: [action] ${a}`));
  }
  return out.join("\n").trimEnd() + "\n";
}
```

(Consolidate imports at the top of the file — one `node:fs/promises` import line.)

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/shift.mjs lib/shift.test.mjs
git commit -m "feat: morning brief renderer (changed entities + open follow-ups)"
```

---

### Task 6: Day summary (`lib/shift.mjs`)

**Files:**
- Modify: `lib/shift.mjs`
- Test: `lib/shift.test.mjs`

**Interfaces:**
- Consumes: `eachEntity`, `followupsByEntity` (Task 3).
- Produces: `renderDaySummary(vaultDir, dateStr: "YYYY-MM-DD") -> Promise<string>`; `writeDaySummary(vaultDir, now?: Date) -> Promise<string>` — writes `days/YYYY-MM-DD.md`, returns the path. Used by Task 8's `vigil stop`.

- [ ] **Step 1: Write the failing test**

Append to `lib/shift.test.mjs` (import `readFile`, `renderDaySummary`, `writeDaySummary`):

```js
const LOGGED = `---
type: project
name: checkout
---

# checkout

## Log

- **transcript** 2026-07-06T09:32:00: scope cut announced
- **transcript** 2026-07-01T09:00:00: old entry

<!-- VIGIL:ANALYSIS:START -->
**Status:** at risk
**Follow-ups:**
- tell mobile
<!-- VIGIL:ANALYSIS:END -->
`;

test("renderDaySummary includes only that day's log lines plus open follow-ups", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vigil-d-"));
  await seedEntity(dir, "projects/checkout.md", LOGGED);
  const md = await renderDaySummary(dir, "2026-07-06");
  assert.match(md, /# 2026-07-06 — day summary/);
  assert.match(md, /### project\/checkout/);
  assert.match(md, /scope cut announced/);
  assert.doesNotMatch(md, /old entry/);
  assert.match(md, /## Open follow-ups/);
  assert.match(md, /- project\/checkout: tell mobile/);
});

test("writeDaySummary writes days/YYYY-MM-DD.md and returns the path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vigil-d-"));
  await seedEntity(dir, "projects/checkout.md", LOGGED);
  const path = await writeDaySummary(dir, new Date("2026-07-06T17:00:00Z"));
  assert.equal(path, join(dir, "days", "2026-07-06.md"));
  assert.match(await readFile(path, "utf8"), /day summary/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/shift.test.mjs`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement**

Add to `lib/shift.mjs`:

```js
export async function renderDaySummary(vaultDir, dateStr) {
  const out = [`# ${dateStr} — day summary`, "", "## Activity"];
  let any = false;
  for (const e of await eachEntity(vaultDir)) {
    const lines = e.content
      .split("\n")
      .filter((l) => l.startsWith("- **") && l.includes(dateStr));
    if (!lines.length) continue;
    any = true;
    out.push(`### ${e.type}/${e.name}`, ...lines, "");
  }
  if (!any) out.push("(no logged activity)", "");
  out.push("## Open follow-ups");
  const groups = await followupsByEntity(vaultDir);
  if (!groups.length) out.push("(none)");
  for (const g of groups) {
    out.push(...g.followUps.map((f) => `- ${g.type}/${g.name}: ${f}`));
    out.push(...g.actions.map((a) => `- ${g.type}/${g.name}: [action] ${a}`));
  }
  return out.join("\n").trimEnd() + "\n";
}

export async function writeDaySummary(vaultDir, now = new Date()) {
  const dateStr = now.toISOString().slice(0, 10);
  const dir = join(vaultDir, "days");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${dateStr}.md`);
  await writeFile(path, await renderDaySummary(vaultDir, dateStr), "utf8");
  return path;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/shift.mjs lib/shift.test.mjs
git commit -m "feat: deterministic day summary written to days/YYYY-MM-DD.md"
```

---

### Task 7: launchd plumbing (`lib/launchd.mjs`)

**Files:**
- Create: `lib/launchd.mjs`
- Create: `lib/launchd.test.mjs`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (used by Task 8):
  - `LABEL = "com.tessaro.vigil.sync"`
  - `plistPath(label?) -> string` — `~/Library/LaunchAgents/<label>.plist`
  - `plistContent({vigilPath, vaultDir, label?, intervalSec?}) -> string`
  - `installJob({vigilPath, vaultDir, label?, intervalSec?, exec?, path?}) -> Promise<string>` — writes plist, `launchctl load <path>`; throws on non-darwin
  - `removeJob({label?, exec?, path?}) -> Promise<void>` — `launchctl unload <path>`, deletes plist; throws on non-darwin
  - `exec` is injected as `(file, args) => Promise` so tests never touch real launchctl.

- [ ] **Step 1: Write the failing test**

Create `lib/launchd.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LABEL, plistContent, plistPath, installJob, removeJob } from "./launchd.mjs";

test("plistContent wires vigil sync --loop on a 30-min interval", () => {
  const xml = plistContent({ vigilPath: "/repo/vigil", vaultDir: "/repo" });
  assert.match(xml, /<string>com\.tessaro\.vigil\.sync<\/string>/);
  assert.match(xml, /<string>\/repo\/vigil<\/string>/);
  assert.match(xml, /<string>sync<\/string>\s*<string>--loop<\/string>/);
  assert.match(xml, /<integer>1800<\/integer>/);
  assert.match(xml, /<string>\/repo\/state\/sync\.log<\/string>/);
});

test("plistPath points into ~/Library/LaunchAgents", () => {
  assert.match(plistPath(), /Library\/LaunchAgents\/com\.tessaro\.vigil\.sync\.plist$/);
});

test("installJob writes the plist and loads it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vigil-l-"));
  const calls = [];
  const fakeExec = async (file, args) => calls.push([file, ...args]);
  const path = join(dir, `${LABEL}.plist`);
  await installJob({ vigilPath: "/repo/vigil", vaultDir: dir, exec: fakeExec, path });
  assert.match(await readFile(path, "utf8"), /--loop/);
  assert.deepEqual(calls, [["launchctl", "load", path]]);
});

test("removeJob unloads and deletes the plist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vigil-l-"));
  const calls = [];
  const fakeExec = async (file, args) => calls.push([file, ...args]);
  const path = join(dir, `${LABEL}.plist`);
  await installJob({ vigilPath: "/repo/vigil", vaultDir: dir, exec: fakeExec, path });
  await removeJob({ exec: fakeExec, path });
  assert.deepEqual(calls[1], ["launchctl", "unload", path]);
  await assert.rejects(() => access(path));
});

test("removeJob surfaces launchctl failure", async () => {
  const failExec = async () => {
    throw new Error("Could not find specified service");
  };
  await assert.rejects(
    () => removeJob({ exec: failExec, path: "/nonexistent.plist" }),
    /Could not find specified service/,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/launchd.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/launchd.mjs`**

```js
import { writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const LABEL = "com.tessaro.vigil.sync";
const execFileAsync = promisify(execFile);

export function plistPath(label = LABEL) {
  return join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
}

export function plistContent({ vigilPath, vaultDir, label = LABEL, intervalSec = 1800 }) {
  const log = join(vaultDir, "state", "sync.log");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${vigilPath}</string>
    <string>sync</string>
    <string>--loop</string>
  </array>
  <key>WorkingDirectory</key><string>${vaultDir}</string>
  <key>StartInterval</key><integer>${intervalSec}</integer>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>${log}</string>
  <key>StandardErrorPath</key><string>${log}</string>
</dict>
</plist>
`;
}

function assertDarwin(what) {
  if (process.platform !== "darwin") {
    throw new Error(`${what}: background sync requires macOS launchd`);
  }
}

export async function installJob({
  vigilPath,
  vaultDir,
  label = LABEL,
  intervalSec = 1800,
  exec = execFileAsync,
  path = plistPath(label),
}) {
  assertDarwin("vigil start");
  await mkdir(join(vaultDir, "state"), { recursive: true });
  await writeFile(path, plistContent({ vigilPath, vaultDir, label, intervalSec }), "utf8");
  await exec("launchctl", ["load", path]);
  return path;
}

export async function removeJob({ label = LABEL, exec = execFileAsync, path = plistPath(label) }) {
  assertDarwin("vigil stop");
  await exec("launchctl", ["unload", path]);
  await rm(path, { force: true });
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/launchd.mjs lib/launchd.test.mjs
git commit -m "feat: launchd plumbing for 30-min background sync (injected exec)"
```

---

### Task 8: `vigil` executable — subcommand dispatch

**Files:**
- Rename: `sync` → `vigil` (`git mv sync vigil`)
- Modify: `vigil` (full rewrite below)
- Modify: `.gitignore`, `README.md`, `CLAUDE.md`, `AGENTS.md` (command references)

**Interfaces:**
- Consumes: `runSync` (`lib/run.mjs`), `resolveAgent`/`makeRunAgent` (Task 1), shift state + brief + summary (Tasks 4–6), `installJob`/`removeJob` (Task 7).
- Produces: `./vigil sync|start|stop` CLI. No new library surface. All logic already unit-tested; the executable stays thin wiring, verified by the manual smoke steps below.

- [ ] **Step 1: Rename and rewrite**

```bash
git mv sync vigil
```

Replace the contents of `vigil` with:

```js
#!/usr/bin/env node
// vigil
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { appendFile, mkdir } from "node:fs/promises";
import { runSync } from "./lib/run.mjs";
import { resolveAgent, makeRunAgent } from "./lib/agent.mjs";
import { readShift, startShift, endShift, recordStop, renderBrief, writeDaySummary } from "./lib/shift.mjs";
import { installJob, removeJob } from "./lib/launchd.mjs";

const vaultDir = dirname(fileURLToPath(import.meta.url));
const vigilPath = join(vaultDir, "vigil");
const [command, ...rest] = process.argv.slice(2);

const USAGE = `usage: vigil <command>
  vigil sync [person] [--source a,b] [--dry-run]  pull activity into the vault
  vigil sync --loop                               background mode (no-op unless a shift is on)
  vigil start                                     begin shift: sync + brief + 30-min background sync
  vigil stop                                      end shift: final sync + day summary + remove background sync`;

async function doSync(argv) {
  const { cmd, timeoutMs } = await resolveAgent(vaultDir);
  const r = await runSync({ argv, vaultDir, runAgent: makeRunAgent(cmd, timeoutMs) });
  const who = r.scope.kind === "person" ? r.scope.name : "all";
  console.log(`Vigil sync — scope: ${who}, sources: ${r.sources.join(",")}${r.dryRun ? " (dry-run)" : ""}`);
  if (!r.changes.length) console.log("  no changes");
  for (const c of r.changes) console.log(`  updated ${c.path}`);
}

try {
  if (command === "sync" && rest.includes("--loop")) {
    if (!(await readShift(vaultDir))) process.exit(0);
    try {
      await doSync(rest.filter((a) => a !== "--loop"));
    } catch (e) {
      await mkdir(join(vaultDir, "state"), { recursive: true });
      await appendFile(join(vaultDir, "state", "sync.log"), `${new Date().toISOString()} sync failed: ${e.message}\n`);
      process.exit(1);
    }
  } else if (command === "sync") {
    await doSync(rest);
  } else if (command === "start") {
    if (await readShift(vaultDir)) throw new Error("shift already started — run `vigil stop` first");
    await startShift(vaultDir);
    await doSync([]);
    await installJob({ vigilPath, vaultDir });
    console.log("\n" + (await renderBrief(vaultDir)));
  } else if (command === "stop") {
    if (!(await readShift(vaultDir))) throw new Error("no shift in progress");
    await doSync([]);
    const summaryPath = await writeDaySummary(vaultDir);
    try {
      await removeJob({});
    } catch (e) {
      console.error(`warning: could not remove launchd job: ${e.message}`);
    }
    await endShift(vaultDir);
    await recordStop(vaultDir);
    console.log(`shift ended — day summary: ${summaryPath}`);
  } else {
    console.error(USAGE);
    process.exit(1);
  }
} catch (e) {
  console.error(`vigil ${command ?? ""} failed: ${e.message}`);
  process.exit(1);
}
```

- [ ] **Step 2: Update `.gitignore`**

Add after the vault-data block:

```
# Shift state + day summaries — machine-local work data
state/
days/
```

- [ ] **Step 3: Update docs**

In `README.md`, `CLAUDE.md` (Commands section), `AGENTS.md` (Commands section): replace `./sync` invocations with `./vigil sync`, and add one line each for `./vigil start` / `./vigil stop`. In CLAUDE.md architecture list, change the `**\`sync\`**` bullet to `**\`vigil\`**` and mention subcommand dispatch.

- [ ] **Step 4: Manual smoke test (no agent call)**

```bash
./vigil                      # expect usage on stderr, exit 1
echo $?                      # expect 1
./vigil stop                 # expect "vigil stop failed: no shift in progress", exit 1
./vigil sync --loop; echo $? # expect silent exit 0 (no shift flag)
npm test                     # expect all pass
```

- [ ] **Step 5: Manual end-to-end (agent call, laptop config)**

```bash
cp transcripts/processed/standup-2026-07-04.txt transcripts/ 2>/dev/null || true
./vigil start        # sync runs, launchd job installs, brief prints
launchctl list | grep vigil   # expect com.tessaro.vigil.sync
./vigil stop         # final sync, day summary path printed, job removed
launchctl list | grep vigil   # expect no output
cat days/$(date +%F).md
```

- [ ] **Step 6: Commit**

```bash
git add vigil .gitignore README.md CLAUDE.md AGENTS.md
git commit -m "feat: vigil executable with start/stop/sync subcommands"
```

---

### Task 9: Codex ritual prompts

**Files:**
- Create: `codex/prompts/vigil-start.md`
- Create: `codex/prompts/vigil-stop.md`
- Modify: `README.md` (setup section)

**Interfaces:**
- Consumes: the `./vigil start` / `./vigil stop` CLI from Task 8.
- Produces: prompt files the user copies to `~/.codex/prompts/` on the work machine (become `/vigil-start`, `/vigil-stop` slash commands in Codex).

- [ ] **Step 1: Create `codex/prompts/vigil-start.md`**

```markdown
Run `./vigil start` in the vigil repo. Read the brief it prints, then:

1. Give me the morning rundown in your own words — lead with anything that
   looks like cross-team misalignment or a blocker aging badly.
2. For each open follow-up, tell me whether it's still mine, waiting on
   someone else, or stale.
3. Suggest the one thing to do first and draft it if it's a message.

Rules: the vault is the source of truth — read entities via the vigil MCP
tools if you need detail. You never send anything anywhere; every outward
action is a draft I approve and send myself.
```

- [ ] **Step 2: Create `codex/prompts/vigil-stop.md`**

```markdown
Run `./vigil stop` in the vigil repo. Read the day summary file it prints the
path to, then:

1. Recap the day in three sentences max.
2. List what's still open, who each item is waiting on, and what will bite
   first tomorrow.
3. Write tomorrow's first move as a one-line note.

Rules: observe and advise only. Drafts, not sends.
```

- [ ] **Step 3: README setup section**

Add to `README.md` under setup: copy instructions —

```bash
cp codex/prompts/vigil-start.md codex/prompts/vigil-stop.md ~/.codex/prompts/
```

plus one sentence: plain-chat triggers ("start vigil", "vigil ima stop") can be added to the work machine's global AGENTS.md pointing at the same two prompts.

- [ ] **Step 4: Verify + commit**

Run: `npm test`
Expected: all pass (docs-only task; suite still green).

```bash
git add codex/prompts/ README.md
git commit -m "feat: codex shift ritual prompts (/vigil-start, /vigil-stop)"
```

---

## Self-review notes

- Spec coverage: timeout → Task 1; evidence/source rules → Task 2; `lib/shift.mjs` brief + summary → Tasks 4–6 (query extraction Task 3 is the dependency the spec's "reuses listFollowups logic" implies); launchd + `--loop` → Tasks 7–8; codex prompts → Task 9; gitignore for `state/`/`days/` → Task 8. `vigil serve` is reserved-only per spec — intentionally no task.
- `--loop` is handled in the executable (filtered before `parseArgs`), so no `lib/args.mjs` change — YAGNI.
- Type consistency: `eachEntity` gains `path` in Task 3; Task 5 depends on it; `followupsByEntity` shape `{type,name,followUps,actions}` used identically in Tasks 5, 6, and mcp rewiring.
