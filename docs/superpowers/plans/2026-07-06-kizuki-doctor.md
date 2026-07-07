# kizuki doctor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `kizuki doctor` subcommand that diagnoses config validity, agent binary presence, agent responsiveness (smoke test), and vault directory structure, printing a streaming ✅/❌/⏭️ checklist with exit 0/1.

**Architecture:** New zero-dep `lib/doctor.mjs` exposes `runDoctor(vaultDir, options)` as an async generator yielding `{name, status, detail}` per check; the `kizuki` executable prints each result as it arrives and sets the exit code. The agent spawner **factory** (`makeRunAgent`) is injected — not a bound runner — because resolving config is itself check #1. `lib/agent.mjs` gains an optional `captureStderr` flag so smoke-test failures carry the agent's stderr tail.

**Tech Stack:** Node built-ins only (ESM `.mjs`), `node:test` + `node:assert/strict`.

Spec: `docs/superpowers/specs/2026-07-06-kizuki-doctor-design.md`

## Global Constraints

- Zero runtime dependencies in `lib/`. ESM `.mjs`, Node built-ins only.
- TDD: failing test first, then implementation. `npm test` green before every commit claim.
- No silent failures: expected diagnosable conditions become `status:"fail"` with detail; unexpected exceptions propagate uncaught.
- Check name slugs, exactly: `"config"`, `"agent-binary"`, `"agent-smoke-test"`, `"vault-dirs"`.
- `status ∈ "pass" | "fail" | "skip"`.
- `DOCTOR_TIMEOUT_CAP_MS = 30000`. Smoke budget = `Math.min(timeoutMs, DOCTOR_TIMEOUT_CAP_MS)`.
- `REQUIRED_DIRS = ["people", "projects", "teams", "transcripts", "transcripts/processed"]`. `state/` and `days/` are out of scope.
- Smoke prompt, exactly: `"Reply with the single word OK and nothing else."`
- Smoke pass = exit 0 AND non-empty (trimmed) stdout. Output content is never asserted against "OK".
- Executable marks: pass `✅`, fail `❌`, skip `⏭️`. Line format: `<mark> <name> — <detail>`. Summary: `all checks passed` / `<n> check(s) failed`. Exit 0 only when zero fails.
- The `doctor` branch in the executable must NOT call `resolveAgent` before `runDoctor` — config errors must surface as the `config` check line, not the catch-all.
- Doctor never writes vault files; it only creates empty gitignored directories (and not in `--check-only` mode).
- `CLAUDE.md` and `AGENTS.md` command blocks stay in sync.

---

### Task 1: `makeRunAgent` captureStderr option

**Files:**
- Modify: `lib/agent.mjs:43-64` (`makeRunAgent`)
- Test: `lib/agent.test.mjs`

**Interfaces:**
- Consumes: existing `makeRunAgent(cmd, timeoutMs)`, `buildAgentArgv`.
- Produces: `makeRunAgent(cmd, timeoutMs = DEFAULT_TIMEOUT_MS, { captureStderr = false } = {})`. Default behavior byte-identical to today (stderr inherited, rejection messages unchanged). With `captureStderr: true`, stderr is piped and its last 3 non-empty-trimmed lines are appended to rejection messages as `: <tail>`. Task 3 relies on this exact signature.

- [ ] **Step 1: Write the failing tests**

Append to `lib/agent.test.mjs`:

```js
test("makeRunAgent captureStderr appends stderr tail to rejection", async () => {
  const run = makeRunAgent(
    ["node", "-e", "console.error('boom detail'); process.exit(2)"],
    5000,
    { captureStderr: true }
  );
  await assert.rejects(run("x"), /exited with 2: boom detail/);
});

test("makeRunAgent captureStderr with empty stderr leaves message bare", async () => {
  const run = makeRunAgent(["node", "-e", "process.exit(2)"], 5000, { captureStderr: true });
  await assert.rejects(run("x"), (e) => e.message === "node exited with 2");
});

test("makeRunAgent default rejection message is unchanged (no opts)", async () => {
  const run = makeRunAgent(["node", "-e", "process.exit(3)"]);
  await assert.rejects(run("x"), (e) => e.message === "node exited with 3");
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test lib/agent.test.mjs`
Expected: FAIL — first new test's rejection message is `node exited with 2` (no stderr tail), so the `/exited with 2: boom detail/` match fails. The other two new tests pass already (that is fine — they pin existing behavior).

- [ ] **Step 3: Implement captureStderr**

Replace `makeRunAgent` in `lib/agent.mjs` with:

```js
export function makeRunAgent(cmd, timeoutMs = DEFAULT_TIMEOUT_MS, { captureStderr = false } = {}) {
  return (prompt) =>
    new Promise((resolve, reject) => {
      const { file, args } = buildAgentArgv(cmd, prompt);
      const child = spawn(file, args, {
        stdio: ["ignore", "pipe", captureStderr ? "pipe" : "inherit"],
      });
      let out = "";
      let err = "";
      const fail = (msg) => {
        const tail = err.trim().split("\n").slice(-3).join("\n").trim();
        reject(new Error(tail ? `${msg}: ${tail}` : msg));
      };
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        fail(`agent timed out after ${timeoutMs}ms`);
      }, timeoutMs);
      child.stdout.on("data", (d) => (out += d));
      if (captureStderr) child.stderr.on("data", (d) => (err += d));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(out);
        else fail(`${file} exited with ${code}`);
      });
    });
}
```

Note: when `captureStderr` is false, `err` stays `""` so `fail` produces the same messages as today.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test lib/agent.test.mjs`
Expected: PASS (all, including the pre-existing timeout/exit tests whose messages must be unchanged).

- [ ] **Step 5: Run full suite and commit**

Run: `npm test`
Expected: all pass.

```bash
git add lib/agent.mjs lib/agent.test.mjs
git commit -m "feat(agent): optional captureStderr on makeRunAgent"
```

---

### Task 2: `lookupPath` in `lib/doctor.mjs`

**Files:**
- Create: `lib/doctor.mjs`
- Create: `lib/doctor.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `lookupPath(name, envPath = process.env.PATH ?? "") -> Promise<string | null>`. Slash-containing names are checked directly with `fs.access(X_OK)`; bare names are scanned across `envPath` split on `path.delimiter`. Also exports `DOCTOR_TIMEOUT_CAP_MS` (30000) and `REQUIRED_DIRS`. Task 3/4 build `runDoctor` in this same file.

- [ ] **Step 1: Write the failing tests**

Create `lib/doctor.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lookupPath } from "./doctor.mjs";

const tmp = () => mkdtemp(join(tmpdir(), "kizuki-doctor-"));

const stubExe = async (dir, name) => {
  const p = join(dir, name);
  await writeFile(p, "#!/bin/sh\n");
  await chmod(p, 0o755);
  return p;
};

test("lookupPath finds an executable on the provided PATH", async () => {
  const dir = await tmp();
  const bin = await stubExe(dir, "fakeagent");
  assert.equal(await lookupPath("fakeagent", dir), bin);
});

test("lookupPath returns null when not found", async () => {
  const dir = await tmp();
  assert.equal(await lookupPath("no-such-bin", dir), null);
});

test("lookupPath ignores non-executable files", async () => {
  const dir = await tmp();
  await writeFile(join(dir, "plainfile"), "data");
  await chmod(join(dir, "plainfile"), 0o644);
  assert.equal(await lookupPath("plainfile", dir), null);
});

test("lookupPath checks slash-containing names directly, not via PATH", async () => {
  const dir = await tmp();
  const bin = await stubExe(dir, "direct");
  assert.equal(await lookupPath(bin, ""), bin);
  assert.equal(await lookupPath(join(dir, "absent"), ""), null);
});

test("lookupPath scans later PATH entries and skips empty segments", async () => {
  const a = await tmp();
  const b = await tmp();
  const bin = await stubExe(b, "second");
  assert.equal(await lookupPath("second", `${a}::${b}`), bin);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test lib/doctor.test.mjs`
Expected: FAIL — `Cannot find module './doctor.mjs'`.

- [ ] **Step 3: Create `lib/doctor.mjs`**

```js
import { access, constants } from "node:fs/promises";
import { delimiter, join } from "node:path";

export const DOCTOR_TIMEOUT_CAP_MS = 30000;
export const REQUIRED_DIRS = ["people", "projects", "teams", "transcripts", "transcripts/processed"];

const executable = async (p) => {
  try {
    await access(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

export async function lookupPath(name, envPath = process.env.PATH ?? "") {
  if (name.includes("/")) return (await executable(name)) ? name : null;
  for (const dir of envPath.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (await executable(candidate)) return candidate;
  }
  return null;
}
```

(The `catch { return false }` is the check's semantic — "not executable" — not a swallowed error. Windows `PATHEXT` is out of scope; the repo is darwin-targeted, see `lib/launchd.mjs`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test lib/doctor.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Run full suite and commit**

Run: `npm test`
Expected: all pass.

```bash
git add lib/doctor.mjs lib/doctor.test.mjs
git commit -m "feat(doctor): lookupPath + doctor constants"
```

---

### Task 3: `runDoctor` — config, agent-binary, agent-smoke-test checks

**Files:**
- Modify: `lib/doctor.mjs`
- Test: `lib/doctor.test.mjs`

**Interfaces:**
- Consumes: `resolveAgent`, `DEFAULT_AGENT_CMD` from `lib/agent.mjs` (Task 1's `makeRunAgent(cmd, timeoutMs, { captureStderr })` signature); `lookupPath`, `DOCTOR_TIMEOUT_CAP_MS` from Task 2.
- Produces: `runDoctor(vaultDir, { makeRunAgent, lookupPath?, checkOnly?, runSmoke? })` — async generator yielding `{ name, status, detail }` with `status ∈ "pass"|"fail"|"skip"`. After this task it yields exactly the three agent-side checks in order: `config`, `agent-binary`, `agent-smoke-test`. Task 4 appends `vault-dirs`; Task 5's executable consumes the generator. `checkOnly` is accepted (default `false`) but unused until Task 4.

- [ ] **Step 1: Write the failing tests**

Append to `lib/doctor.test.mjs` (add `runDoctor` to the existing import from `./doctor.mjs`, and add a `writeFile`-based config helper):

```js
import { runDoctor } from "./doctor.mjs";

const collect = async (iter) => {
  const out = [];
  for await (const r of iter) out.push(r);
  return out;
};
const byName = (results) => Object.fromEntries(results.map((r) => [r.name, r]));

const fakeFactory = (result) => {
  const factory = (cmd, timeoutMs, opts) => {
    factory.calls.push({ cmd, timeoutMs, opts });
    return async () => {
      if (result instanceof Error) throw result;
      return result;
    };
  };
  factory.calls = [];
  return factory;
};
const foundLookup = async (name) => `/fake/bin/${name}`;
const missingLookup = async () => null;

test("runDoctor passes all agent checks with default config and responsive agent", async () => {
  const dir = await tmp();
  const factory = fakeFactory("OK\n");
  const r = byName(await collect(runDoctor(dir, { makeRunAgent: factory, lookupPath: foundLookup })));
  assert.deepEqual(r["config"], { name: "config", status: "pass", detail: "using default: codex exec" });
  assert.deepEqual(r["agent-binary"], { name: "agent-binary", status: "pass", detail: "/fake/bin/codex" });
  assert.equal(r["agent-smoke-test"].status, "pass");
  assert.match(r["agent-smoke-test"].detail, /30000ms budget/);
  assert.deepEqual(factory.calls, [
    { cmd: ["codex", "exec"], timeoutMs: 30000, opts: { captureStderr: true } },
  ]);
});

test("runDoctor reports explicit agentCmd and caps budget at min(timeoutMs, cap)", async () => {
  const dir = await tmp();
  await writeFile(join(dir, "kizuki.config.json"), JSON.stringify({ agentCmd: ["claude", "-p"], timeoutMs: 5000 }));
  const factory = fakeFactory("OK\n");
  const r = byName(await collect(runDoctor(dir, { makeRunAgent: factory, lookupPath: foundLookup })));
  assert.deepEqual(r["config"], { name: "config", status: "pass", detail: "agentCmd: claude -p" });
  assert.equal(factory.calls[0].timeoutMs, 5000);
});

test("runDoctor config failure skips agent-binary and smoke test", async () => {
  const dir = await tmp();
  await writeFile(join(dir, "kizuki.config.json"), "{ not json");
  const factory = fakeFactory("OK\n");
  const r = byName(await collect(runDoctor(dir, { makeRunAgent: factory, lookupPath: foundLookup })));
  assert.equal(r["config"].status, "fail");
  assert.match(r["config"].detail, /not valid JSON/);
  assert.deepEqual(r["agent-binary"], { name: "agent-binary", status: "skip", detail: "skipped: config invalid" });
  assert.deepEqual(r["agent-smoke-test"], { name: "agent-smoke-test", status: "skip", detail: "skipped: config invalid" });
  assert.equal(factory.calls.length, 0);
});

test("runDoctor fails agent-binary when not on PATH", async () => {
  const dir = await tmp();
  const r = byName(await collect(runDoctor(dir, { makeRunAgent: fakeFactory("OK\n"), lookupPath: missingLookup })));
  assert.deepEqual(r["agent-binary"], { name: "agent-binary", status: "fail", detail: "codex not found on PATH" });
});

test("runDoctor fails smoke test on exit 0 with empty output", async () => {
  const dir = await tmp();
  const r = byName(await collect(runDoctor(dir, { makeRunAgent: fakeFactory("  \n"), lookupPath: foundLookup })));
  assert.deepEqual(r["agent-smoke-test"], { name: "agent-smoke-test", status: "fail", detail: "exit 0 but empty output" });
});

test("runDoctor surfaces smoke-test rejection message as the failure detail", async () => {
  const dir = await tmp();
  const boom = new Error("codex exited with 1: auth expired");
  const r = byName(await collect(runDoctor(dir, { makeRunAgent: fakeFactory(boom), lookupPath: foundLookup })));
  assert.deepEqual(r["agent-smoke-test"], { name: "agent-smoke-test", status: "fail", detail: "codex exited with 1: auth expired" });
});

test("runDoctor skips smoke test when runSmoke is false", async () => {
  const dir = await tmp();
  const factory = fakeFactory("OK\n");
  const r = byName(await collect(runDoctor(dir, { makeRunAgent: factory, lookupPath: foundLookup, runSmoke: false })));
  assert.deepEqual(r["agent-smoke-test"], { name: "agent-smoke-test", status: "skip", detail: "skipped: --no-smoke" });
  assert.equal(factory.calls.length, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test lib/doctor.test.mjs`
Expected: FAIL — `runDoctor` is not exported.

- [ ] **Step 3: Implement `runDoctor` (agent-side checks)**

Add to `lib/doctor.mjs` (new imports at top: `import { DEFAULT_AGENT_CMD, resolveAgent } from "./agent.mjs";`):

```js
export async function* runDoctor(vaultDir, {
  makeRunAgent,
  lookupPath: lookup = lookupPath,
  checkOnly = false,
  runSmoke = true,
}) {
  let cmd;
  let timeoutMs;
  let configOk = false;
  try {
    ({ cmd, timeoutMs } = await resolveAgent(vaultDir));
    configOk = true;
    const detail = cmd === DEFAULT_AGENT_CMD ? "using default: codex exec" : `agentCmd: ${cmd.join(" ")}`;
    yield { name: "config", status: "pass", detail };
  } catch (e) {
    yield { name: "config", status: "fail", detail: e.message };
  }

  if (!configOk) {
    yield { name: "agent-binary", status: "skip", detail: "skipped: config invalid" };
  } else {
    const found = await lookup(cmd[0]);
    yield found
      ? { name: "agent-binary", status: "pass", detail: found }
      : { name: "agent-binary", status: "fail", detail: `${cmd[0]} not found on PATH` };
  }

  if (!runSmoke) {
    yield { name: "agent-smoke-test", status: "skip", detail: "skipped: --no-smoke" };
  } else if (!configOk) {
    yield { name: "agent-smoke-test", status: "skip", detail: "skipped: config invalid" };
  } else {
    const budget = Math.min(timeoutMs, DOCTOR_TIMEOUT_CAP_MS);
    const runAgent = makeRunAgent(cmd, budget, { captureStderr: true });
    try {
      const out = await runAgent("Reply with the single word OK and nothing else.");
      yield out.trim()
        ? { name: "agent-smoke-test", status: "pass", detail: `agent replied (${budget}ms budget)` }
        : { name: "agent-smoke-test", status: "fail", detail: "exit 0 but empty output" };
    } catch (e) {
      yield { name: "agent-smoke-test", status: "fail", detail: e.message };
    }
  }
}
```

(`checkOnly` is threaded through now so the signature is final; Task 4 uses it. The `catch` blocks wrap only `resolveAgent` and the smoke run — both throw only diagnosable conditions. Bugs elsewhere in the generator propagate, per the no-silent-failures rule.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test lib/doctor.test.mjs`
Expected: PASS (12 tests).

- [ ] **Step 5: Run full suite and commit**

Run: `npm test`
Expected: all pass.

```bash
git add lib/doctor.mjs lib/doctor.test.mjs
git commit -m "feat(doctor): runDoctor config/binary/smoke checks"
```

---

### Task 4: `vault-dirs` check + `checkOnly`

**Files:**
- Modify: `lib/doctor.mjs` (append to `runDoctor`)
- Test: `lib/doctor.test.mjs`

**Interfaces:**
- Consumes: `runDoctor` from Task 3, `REQUIRED_DIRS` from Task 2.
- Produces: `runDoctor` now yields a fourth, final result `{ name: "vault-dirs", ... }`. It always runs regardless of earlier checks. Default mode creates missing dirs (`mkdir` recursive); `checkOnly: true` reports them as `fail` and creates nothing. Order of `REQUIRED_DIRS` guarantees `transcripts` is created before `transcripts/processed`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/doctor.test.mjs` (extend the fs import with `mkdir, stat`):

```js
const noSmoke = (dir) =>
  runDoctor(dir, { makeRunAgent: fakeFactory("OK\n"), lookupPath: foundLookup, runSmoke: false });

test("runDoctor yields checks in order, ending with vault-dirs", async () => {
  const dir = await tmp();
  const names = (await collect(noSmoke(dir))).map((r) => r.name);
  assert.deepEqual(names, ["config", "agent-binary", "agent-smoke-test", "vault-dirs"]);
});

test("runDoctor creates missing vault dirs and reports them", async () => {
  const dir = await tmp();
  const r = byName(await collect(noSmoke(dir)));
  assert.equal(r["vault-dirs"].status, "pass");
  assert.match(r["vault-dirs"].detail, /created people, projects, teams, transcripts, transcripts\/processed/);
  assert.ok((await stat(join(dir, "transcripts", "processed"))).isDirectory());
});

test("runDoctor reports all-present vault dirs without creating", async () => {
  const dir = await tmp();
  for (const d of ["people", "projects", "teams", "transcripts", "transcripts/processed"]) {
    await mkdir(join(dir, d), { recursive: true });
  }
  const r = byName(await collect(noSmoke(dir)));
  assert.deepEqual(r["vault-dirs"], { name: "vault-dirs", status: "pass", detail: "5 already present" });
});

test("runDoctor checkOnly reports missing dirs as failure and creates nothing", async () => {
  const dir = await tmp();
  await mkdir(join(dir, "people"));
  const r = byName(
    await collect(runDoctor(dir, { makeRunAgent: fakeFactory("OK\n"), lookupPath: foundLookup, runSmoke: false, checkOnly: true }))
  );
  assert.equal(r["vault-dirs"].status, "fail");
  assert.equal(r["vault-dirs"].detail, "missing: projects, teams, transcripts, transcripts/processed (omit --check-only to create)");
  await assert.rejects(stat(join(dir, "projects")));
});

test("runDoctor fails vault-dirs when a required path is a file", async () => {
  const dir = await tmp();
  await writeFile(join(dir, "people"), "not a dir");
  const r = byName(await collect(noSmoke(dir)));
  assert.equal(r["vault-dirs"].status, "fail");
  assert.match(r["vault-dirs"].detail, /people/);
});

test("runDoctor runs vault-dirs even when config is invalid", async () => {
  const dir = await tmp();
  await writeFile(join(dir, "kizuki.config.json"), "{ not json");
  const r = byName(await collect(noSmoke(dir)));
  assert.equal(r["config"].status, "fail");
  assert.equal(r["vault-dirs"].status, "pass");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test lib/doctor.test.mjs`
Expected: FAIL — the six new tests find no `vault-dirs` result (generator ends after three yields).

- [ ] **Step 3: Implement the vault-dirs check**

In `lib/doctor.mjs`, extend the fs import to `import { access, constants, mkdir, stat } from "node:fs/promises";` and append at the end of `runDoctor` (after the smoke-test block):

```js
  const created = [];
  const existed = [];
  const missing = [];
  let dirError = null;
  for (const d of REQUIRED_DIRS) {
    const p = join(vaultDir, d);
    let isDir = false;
    try {
      isDir = (await stat(p)).isDirectory();
    } catch (e) {
      if (e.code !== "ENOENT") {
        dirError = `${d}: ${e.message}`;
        break;
      }
    }
    if (isDir) {
      existed.push(d);
    } else if (checkOnly) {
      missing.push(d);
    } else {
      try {
        await mkdir(p, { recursive: true });
        created.push(d);
      } catch (e) {
        dirError = `${d}: ${e.message}`;
        break;
      }
    }
  }
  if (dirError) {
    yield { name: "vault-dirs", status: "fail", detail: dirError };
  } else if (missing.length) {
    yield { name: "vault-dirs", status: "fail", detail: `missing: ${missing.join(", ")} (omit --check-only to create)` };
  } else {
    const prefix = created.length ? `created ${created.join(", ")}; ` : "";
    yield { name: "vault-dirs", status: "pass", detail: `${prefix}${existed.length} already present` };
  }
```

(A required path existing as a *file* passes `stat` with `isDirectory() === false`, falls into the create branch, and `mkdir` throws `EEXIST` → surfaced as `dirError`. `EACCES` on stat or mkdir surfaces the same way.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test lib/doctor.test.mjs`
Expected: PASS (18 tests).

- [ ] **Step 5: Run full suite and commit**

Run: `npm test`
Expected: all pass.

```bash
git add lib/doctor.mjs lib/doctor.test.mjs
git commit -m "feat(doctor): vault-dirs check with --check-only support"
```

---

### Task 5: executable wiring + docs

**Files:**
- Modify: `kizuki` (dispatcher + USAGE)
- Modify: `README.md`, `CLAUDE.md`, `AGENTS.md` (Commands blocks)

**Interfaces:**
- Consumes: `runDoctor` from `lib/doctor.mjs` (Tasks 3–4), `makeRunAgent` from `lib/agent.mjs` (already imported in `kizuki`).
- Produces: `kizuki doctor [--no-smoke] [--check-only]` CLI. No later task consumes this.

- [ ] **Step 1: Add the doctor branch to `kizuki`**

Add the import (extend the existing `lib/agent.mjs` import line's neighborhood):

```js
import { runDoctor } from "./lib/doctor.mjs";
```

Add this branch in the dispatcher chain, before the final `else` that prints USAGE:

```js
  } else if (command === "doctor") {
    const checkOnly = rest.includes("--check-only");
    const runSmoke = !rest.includes("--no-smoke");
    const MARKS = { pass: "✅", fail: "❌", skip: "⏭️" };
    let fails = 0;
    for await (const r of runDoctor(vaultDir, { makeRunAgent, checkOnly, runSmoke })) {
      console.log(`${MARKS[r.status]} ${r.name} — ${r.detail}`);
      if (r.status === "fail") fails++;
    }
    console.log(fails ? `\n${fails} check(s) failed` : "\nall checks passed");
    process.exit(fails ? 1 : 0);
  }
```

Do NOT call `resolveAgent` in this branch — `runDoctor` resolves config itself so a broken config prints as `❌ config — …`, not the generic catch-all.

Update `USAGE` by adding this line after the `kizuki stop` line:

```
  kizuki doctor [--no-smoke] [--check-only]        diagnose config, agent, vault structure
```

- [ ] **Step 2: Verify manually**

Run: `./kizuki doctor --no-smoke; echo "exit: $?"`
Expected: four lines — `✅ config — …`, `✅ agent-binary — /…/codex` (or ❌ if codex missing on this machine), `⏭️ agent-smoke-test — skipped: --no-smoke`, `✅ vault-dirs — 5 already present` (`transcripts/processed` may report as created on first run) — then blank line, `all checks passed`, `exit: 0` (or `1 check(s) failed` + `exit: 1` if agent-binary failed; both prove the wiring).

Run: `./kizuki doctor --no-smoke --check-only; echo "exit: $?"`
Expected: same, but vault-dirs reports without creating.

Run: `./kizuki bogus; echo "exit: $?"`
Expected: USAGE (now including the doctor line), `exit: 1`.

- [ ] **Step 3: Update docs**

In `README.md` and `CLAUDE.md`, add to the Commands code block after the `./kizuki stop` line:

```bash
./kizuki doctor                        # diagnose setup: config, agent binary, smoke test, vault dirs
./kizuki doctor --no-smoke             # skip the agent smoke test (it boots the real agent + MCP, costs tokens)
./kizuki doctor --check-only           # read-only: report missing vault dirs instead of creating them
```

Copy the identical lines into `AGENTS.md`'s corresponding Commands block (CLAUDE.md and AGENTS.md must stay in sync — after editing, verify with `diff <(grep -A20 '```bash' CLAUDE.md | head -25) <(grep -A20 '```bash' AGENTS.md | head -25)` or by reading both blocks).

- [ ] **Step 4: Run full suite and commit**

Run: `npm test`
Expected: all pass.

```bash
git add kizuki README.md CLAUDE.md AGENTS.md
git commit -m "feat: kizuki doctor subcommand"
```
