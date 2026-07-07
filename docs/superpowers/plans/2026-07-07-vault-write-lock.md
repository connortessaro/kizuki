# Vault write-lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serialize all vault writers through a PID-aware lock file so concurrent sync/MCP writes can never interleave `applyPayload`'s read-modify-write.

**Architecture:** New zero-dep `lib/lock.mjs` exports `withVaultLock(vaultDir, fn, opts)` — atomic `wx` create of `state/vault.lock` with holder metadata, brief-wait-then-fail contention, PID-liveness stale stealing, release in `finally`. The lock lives inside `applyPayload` (the single choke point both the CLI sync and MCP `upsert_analysis` call); `dryRun` never locks.

**Tech Stack:** Node built-ins only (ESM `.mjs`), `node:test` + `node:assert/strict`.

Spec: `docs/superpowers/specs/2026-07-07-vault-write-lock-design.md`

## Global Constraints

- Zero runtime dependencies in `lib/`. ESM `.mjs`, Node built-ins only.
- TDD: failing test first, then implementation. `npm test` green before every commit claim.
- Lock file path: `state/vault.lock` under the vault dir. Content: JSON `{ "pid": <number>, "tool": "sync"|"mcp", "startedAt": <ISO string> }` + trailing newline.
- Defaults, exactly: `LOCK_WAIT_MS = 30000`, `LOCK_POLL_MS = 500`.
- Contention timeout error message, exactly: `vault locked by <tool> (pid <pid>) since <startedAt>`.
- Stale = holder PID dead, or lock file unreadable/unparsable/missing numeric `pid` → steal by unlink + re-attempt the atomic create (never assume the steal won).
- Release only if the lock file still records our PID; missing file = no-op. `fn` throwing must still release, original error propagates.
- `dryRun` must never create the lock file (nor the `state/` dir).
- No silent failures: only `EEXIST` (create), `ENOENT` (read/unlink races), and JSON-parse-of-lockfile are handled; every other fs error propagates.
- Injectable for tests: `{ tool, waitMs, pollMs, pidAlive, now }`. Default `pidAlive`: `process.kill(pid, 0)` try/catch; `EPERM` counts as alive.
- `CLAUDE.md` and `AGENTS.md` stay in sync (both lose the "no write lock yet" warning).

---

### Task 1: `lib/lock.mjs` — `withVaultLock`

**Files:**
- Create: `lib/lock.mjs`
- Create: `lib/lock.test.mjs`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `withVaultLock(vaultDir, fn, { tool = "sync", waitMs = LOCK_WAIT_MS, pollMs = LOCK_POLL_MS, pidAlive, now = new Date() } = {}) -> Promise<awaited fn()>`, plus exported consts `LOCK_WAIT_MS` (30000) and `LOCK_POLL_MS` (500). Task 2 wraps `applyPayload`'s write path in this.

- [ ] **Step 1: Write the failing tests**

Create `lib/lock.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withVaultLock, LOCK_WAIT_MS, LOCK_POLL_MS } from "./lock.mjs";

const tmp = () => mkdtemp(join(tmpdir(), "kizuki-lock-"));
const lockFile = (dir) => join(dir, "state", "vault.lock");
const exists = (p) => access(p).then(() => true, () => false);
const FIXED = new Date("2026-07-07T09:00:00Z");

const plantLock = async (dir, meta) => {
  await mkdir(join(dir, "state"), { recursive: true });
  await writeFile(lockFile(dir), JSON.stringify(meta));
};

test("exports the default wait and poll intervals", () => {
  assert.equal(LOCK_WAIT_MS, 30000);
  assert.equal(LOCK_POLL_MS, 500);
});

test("holds metadata during fn, returns fn result, removes lock after", async () => {
  const dir = await tmp();
  let during;
  const result = await withVaultLock(dir, async () => {
    during = JSON.parse(await readFile(lockFile(dir), "utf8"));
    return "done";
  }, { tool: "sync", now: FIXED });
  assert.equal(result, "done");
  assert.deepEqual(during, { pid: process.pid, tool: "sync", startedAt: "2026-07-07T09:00:00.000Z" });
  assert.equal(await exists(lockFile(dir)), false);
});

test("second acquire against a live holder waits then throws holder info", async () => {
  const dir = await tmp();
  await plantLock(dir, { pid: 4242, tool: "mcp", startedAt: "2026-07-07T08:00:00.000Z" });
  await assert.rejects(
    withVaultLock(dir, async () => {}, { waitMs: 20, pollMs: 5, pidAlive: () => true }),
    /vault locked by mcp \(pid 4242\) since 2026-07-07T08:00:00\.000Z/
  );
  assert.equal(JSON.parse(await readFile(lockFile(dir), "utf8")).pid, 4242);
});

test("steals a lock whose holder pid is dead", async () => {
  const dir = await tmp();
  await plantLock(dir, { pid: 4242, tool: "sync", startedAt: "x" });
  let ran = false;
  await withVaultLock(dir, async () => { ran = true; }, { pidAlive: () => false });
  assert.equal(ran, true);
  assert.equal(await exists(lockFile(dir)), false);
});

test("treats an unparsable lock file as stale", async () => {
  const dir = await tmp();
  await mkdir(join(dir, "state"), { recursive: true });
  await writeFile(lockFile(dir), "{ not json");
  let ran = false;
  await withVaultLock(dir, async () => { ran = true; }, { pidAlive: () => true });
  assert.equal(ran, true);
});

test("treats a lock file without a numeric pid as stale", async () => {
  const dir = await tmp();
  await plantLock(dir, { pid: "4242", tool: "mcp", startedAt: "x" });
  let ran = false;
  await withVaultLock(dir, async () => { ran = true; }, { pidAlive: () => true });
  assert.equal(ran, true);
});

test("releases the lock when fn throws and propagates the error", async () => {
  const dir = await tmp();
  await assert.rejects(withVaultLock(dir, async () => { throw new Error("boom"); }), /boom/);
  assert.equal(await exists(lockFile(dir)), false);
});

test("release leaves a lock owned by another pid untouched", async () => {
  const dir = await tmp();
  await withVaultLock(dir, async () => {
    await writeFile(lockFile(dir), JSON.stringify({ pid: 999999999, tool: "mcp", startedAt: "x" }));
  });
  assert.equal(JSON.parse(await readFile(lockFile(dir), "utf8")).pid, 999999999);
});

test("waiting acquire succeeds when the holder releases mid-wait", async () => {
  const dir = await tmp();
  await plantLock(dir, { pid: 4242, tool: "sync", startedAt: "x" });
  setTimeout(() => { unlink(lockFile(dir)); }, 15);
  let ran = false;
  await withVaultLock(dir, async () => { ran = true; }, { waitMs: 2000, pollMs: 5, pidAlive: () => true });
  assert.equal(ran, true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test lib/lock.test.mjs`
Expected: FAIL — `Cannot find module './lock.mjs'`.

- [ ] **Step 3: Create `lib/lock.mjs`**

```js
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const LOCK_WAIT_MS = 30000;
export const LOCK_POLL_MS = 500;

const lockPath = (vaultDir) => join(vaultDir, "state", "vault.lock");

const defaultPidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const unlinkIfPresent = async (path) => {
  try {
    await unlink(path);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
};

async function readHolder(path) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
  try {
    const data = JSON.parse(raw);
    if (Number.isInteger(data.pid)) return data;
  } catch {
    // unparsable lock file — fall through to the stale marker
  }
  return { corrupt: true };
}

export async function withVaultLock(vaultDir, fn, {
  tool = "sync",
  waitMs = LOCK_WAIT_MS,
  pollMs = LOCK_POLL_MS,
  pidAlive = defaultPidAlive,
  now = new Date(),
} = {}) {
  const path = lockPath(vaultDir);
  const meta = JSON.stringify({ pid: process.pid, tool, startedAt: now.toISOString() }) + "\n";
  await mkdir(join(vaultDir, "state"), { recursive: true });
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      await writeFile(path, meta, { flag: "wx" });
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    const holder = await readHolder(path);
    if (holder === null) continue;
    if (holder.corrupt || !pidAlive(holder.pid)) {
      await unlinkIfPresent(path);
      continue;
    }
    if (Date.now() >= deadline) {
      throw new Error(`vault locked by ${holder.tool} (pid ${holder.pid}) since ${holder.startedAt}`);
    }
    await sleep(pollMs);
  }
  try {
    return await fn();
  } finally {
    const holder = await readHolder(path);
    if (holder !== null && holder.pid === process.pid) await unlinkIfPresent(path);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test lib/lock.test.mjs`
Expected: PASS (9 tests).

- [ ] **Step 5: Run full suite and commit**

Run: `npm test`
Expected: all pass.

```bash
git add lib/lock.mjs lib/lock.test.mjs
git commit -m "feat(lock): withVaultLock — PID-aware vault write lock"
```

---

### Task 2: lock inside `applyPayload`

**Files:**
- Modify: `lib/apply.mjs`
- Test: `lib/apply.test.mjs`

**Interfaces:**
- Consumes: `withVaultLock(vaultDir, fn, { tool, now, waitMs?, pollMs?, pidAlive? })` from Task 1.
- Produces: `applyPayload(vaultDir, payload, { dryRun = false, now = new Date(), tool = "sync", lock = {} } = {})` — same return value as before. `tool` names the writer in the lock file; `lock` is a test-only pass-through of `{ waitMs, pollMs, pidAlive }` to `withVaultLock`. Task 3's MCP path calls this with `tool: "mcp"`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/apply.test.mjs` (extend the existing fs import with `writeFile` if not present — it is already imported — and note `mkdir`, `join`, `exists`, `makeVault`, `FIXED` already exist in the file):

```js
test("applyPayload throws when the vault lock is held by a live process", async () => {
  const v = await makeVault();
  await mkdir(join(v, "state"), { recursive: true });
  await writeFile(join(v, "state", "vault.lock"), JSON.stringify({ pid: 4242, tool: "mcp", startedAt: "x" }));
  await assert.rejects(
    applyPayload(v, {
      entities: [{ type: "person", name: "bob", rawEntries: [], analysis: {} }],
      consumedTranscripts: [],
    }, { now: FIXED, lock: { waitMs: 20, pollMs: 5, pidAlive: () => true } }),
    /vault locked by mcp \(pid 4242\)/
  );
  assert.equal(await exists(join(v, "people", "bob.md")), false);
});

test("applyPayload removes the lock file after a successful write", async () => {
  const v = await makeVault();
  await applyPayload(v, {
    entities: [{ type: "person", name: "bob", rawEntries: [], analysis: {} }],
    consumedTranscripts: [],
  }, { now: FIXED });
  assert.equal(await exists(join(v, "state", "vault.lock")), false);
  assert.equal(await exists(join(v, "people", "bob.md")), true);
});

test("dry-run never touches the lock or the state dir", async () => {
  const v = await makeVault();
  await applyPayload(v, {
    entities: [{ type: "team", name: "platform", rawEntries: [], analysis: {} }],
    consumedTranscripts: [],
  }, { dryRun: true, now: FIXED });
  assert.equal(await exists(join(v, "state")), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test lib/apply.test.mjs`
Expected: FAIL — first new test writes `bob.md` despite the planted lock (no lock integration yet); the dry-run test may also fail once integration exists, but at this point the two lock-file assertions fail.

- [ ] **Step 3: Wrap the write path**

Replace `lib/apply.mjs` with:

```js
import { readFile, writeFile, mkdir, rename, access } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
import { entityPath, newEntityFile, appendLog, spliceManagedSection, renderAnalysis } from "./vault.mjs";
import { withVaultLock } from "./lock.mjs";

const exists = (p) => access(p).then(() => true, () => false);

async function writePayload(vaultDir, payload, { dryRun, now }) {
  const changes = [];

  for (const entity of payload.entities) {
    const path = entityPath(vaultDir, entity.type, entity.name);
    let content = (await exists(path))
      ? await readFile(path, "utf8")
      : newEntityFile(entity.type, entity.name);

    content = appendLog(content, entity.rawEntries ?? []);
    content = spliceManagedSection(content, renderAnalysis(entity, now));

    changes.push({ path, entity: entity.name });

    if (!dryRun) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, "utf8");
    }
  }

  if (!dryRun) {
    const processedDir = join(vaultDir, "transcripts", "processed");
    for (const t of payload.consumedTranscripts ?? []) {
      const from = join(vaultDir, "transcripts", basename(t));
      if (await exists(from)) {
        await mkdir(processedDir, { recursive: true });
        await rename(from, join(processedDir, basename(t)));
      }
    }
  }

  return changes;
}

export async function applyPayload(vaultDir, payload, { dryRun = false, now = new Date(), tool = "sync", lock = {} } = {}) {
  if (dryRun) return writePayload(vaultDir, payload, { dryRun, now });
  return withVaultLock(vaultDir, () => writePayload(vaultDir, payload, { dryRun, now }), { ...lock, tool, now });
}
```

(The loop/write logic is byte-identical to the previous body — it only moved into `writePayload`. `tool` and `now` come after the `lock` spread so pass-through test options can never override them.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test lib/apply.test.mjs`
Expected: PASS (all, including the pre-existing dry-run and hand-notes tests).

- [ ] **Step 5: Run full suite and commit**

Run: `npm test`
Expected: all pass (run.mjs and mcp callers pass no new options — defaults preserve behavior).

```bash
git add lib/apply.mjs lib/apply.test.mjs
git commit -m "feat(apply): serialize writes through the vault lock"
```

---

### Task 3: MCP writer identity + docs

**Files:**
- Modify: `mcp/tools.mjs:13-19` (`upsertAnalysis`)
- Test: `mcp/tools.test.mjs`
- Modify: `CLAUDE.md` (~line 140), `AGENTS.md` (~line 65), `README.md` if it mentions the single-writer rule

**Interfaces:**
- Consumes: `applyPayload(vaultDir, payload, { tool, lock })` from Task 2.
- Produces: `upsertAnalysis(vaultDir, { type, name, analysis, rawEntries }, applyOpts = {})` — third param is an internal pass-through (tests only; `mcp/server.mjs` keeps calling with two args). `tool: "mcp"` is hardcoded after the spread so callers cannot override it.

- [ ] **Step 1: Write the failing test**

Append to `mcp/tools.test.mjs` (extend the fs import with `writeFile`):

```js
test("upsertAnalysis respects a held vault lock", async () => {
  const v = await makeVault();
  await mkdir(join(v, "state"), { recursive: true });
  await writeFile(join(v, "state", "vault.lock"), JSON.stringify({ pid: 1, tool: "sync", startedAt: "x" }));
  const t0 = Date.now();
  await assert.rejects(
    upsertAnalysis(v, { type: "person", name: "bob", analysis: { status: "x" } },
      { lock: { waitMs: 20, pollMs: 5, pidAlive: () => true } }),
    /vault locked by sync \(pid 1\)/
  );
  assert.ok(Date.now() - t0 < 1000, "lock options were not passed through");
});
```

(PID 1 is always alive — `process.kill(1, 0)` yields `EPERM`, which counts as alive — so if the pass-through is missing, the default 30-second `waitMs` applies and the elapsed-time assertion fails.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test mcp/tools.test.mjs`
Expected: FAIL — `upsertAnalysis` ignores the third argument, so the acquire polls against always-alive PID 1 with the default 30s `waitMs`; after ~30s the rejection fires but the `< 1000` ms elapsed assertion fails. RED is deterministic (just slow, once).

- [ ] **Step 3: Thread the options through**

In `mcp/tools.mjs`, replace `upsertAnalysis`:

```js
export async function upsertAnalysis(vaultDir, { type, name, analysis = {}, rawEntries = [] }, applyOpts = {}) {
  assertType(type);
  assertName(name);
  const payload = { entities: [{ type, name, rawEntries, analysis }], consumedTranscripts: [] };
  const changes = await applyPayload(vaultDir, payload, { ...applyOpts, tool: "mcp" });
  return `Updated ${type}/${name} at ${changes[0].path}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test mcp/tools.test.mjs`
Expected: PASS (all).

- [ ] **Step 5: Update docs**

In `CLAUDE.md`, replace:

```
- **One vault writer at a time.** There is no write lock yet: do not run `./kizuki sync`
  and MCP `upsert_analysis` against the main checkout concurrently.
```

with:

```
- **Write lock.** `applyPayload` serializes writers through `state/vault.lock`
  (waits up to 30s, then fails naming the holder; stale locks stolen by PID
  liveness). Concurrent `./kizuki sync` and MCP `upsert_analysis` are safe.
```

In `AGENTS.md`, replace:

```
- One vault writer at a time — no write lock exists yet.
```

with:

```
- Write lock: `applyPayload` serializes writers via `state/vault.lock` (30s
  wait then loud failure; stale locks stolen by PID liveness). Concurrent
  sync and MCP upserts are safe.
```

Check `README.md` for any "one writer" / "no write lock" phrasing (`grep -n "writer\|lock" README.md`) and update the same way if present.

- [ ] **Step 6: Run full suite and commit**

Run: `npm test`
Expected: all pass.

```bash
git add mcp/tools.mjs mcp/tools.test.mjs CLAUDE.md AGENTS.md README.md
git commit -m "feat(mcp): writer identity + write-lock docs"
```

(If README.md needed no change, drop it from the `git add`.)
