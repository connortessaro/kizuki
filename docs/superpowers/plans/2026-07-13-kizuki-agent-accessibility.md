# Kizuki Agent Accessibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Kizuki usable from any agent — CLI presets, an OpenAI-compatible HTTP agent, cursor/gemini/generic skill exports, and MCP-client docs.

**Architecture:** The `runAgent(prompt) -> Promise<string>` boundary stays. `resolveAgent` grows a discriminated result (`kind: "cmd" | "http"`); a new zero-dep `lib/agentHttp.mjs` implements the HTTP runner behind the same boundary; `runSync` gains capability gating for source-less agents; `lib/skills.mjs` gains three render targets.

**Tech Stack:** Node built-ins only (global `fetch`), `node:test`.

**Spec:** `docs/superpowers/specs/2026-07-13-kizuki-agent-accessibility-design.md`.

## Global Constraints

- Zero runtime dependencies; ESM `.mjs`; TDD failing-test-first; `npm test` green before each commit.
- No comments unless non-obvious; loud errors, no silent fallbacks.
- API keys only via env-var indirection (`apiKeyEnv`); never in config values or logs.
- Payload boundary unchanged: deterministic JS owns all writes regardless of agent kind.
- Tests never hit the network or spawn processes (inject `fetchImpl`).
- Default sync sources stay exactly `["slack", "github", "atlassian", "outlook"]`.

---

### Task 1: Agent presets + `resolveAgent` discriminated result

**Files:**
- Modify: `lib/agent.mjs`
- Test: `lib/agent.test.mjs` (extend)
- Modify: `lib/doctor.mjs`, `kizuki` (call-site adaptation, minimal)

**Interfaces:**
- Produces: `AGENT_PRESETS` (frozen map), `resolveAgent(vaultDir) -> {kind: "cmd", cmd, timeoutMs} | {kind: "http", http: {baseUrl, model, apiKeyEnv}, timeoutMs}`. Task 2 builds the http runner; until then `kind: "http"` call sites throw "http agent not wired yet".

- [ ] **Step 1: Write the failing tests** (append to `lib/agent.test.mjs`; reuse its existing tmp-vault/config helpers if present, otherwise `mkdtemp` + `writeFile` of `kizuki.config.json`)

```js
test("AGENT_PRESETS expose known CLI agents", () => {
  assert.deepEqual(AGENT_PRESETS.codex, ["codex", "exec"]);
  assert.deepEqual(AGENT_PRESETS.claude, ["claude", "-p"]);
  assert.deepEqual(AGENT_PRESETS.gemini, ["gemini", "-p"]);
  assert.deepEqual(AGENT_PRESETS.opencode, ["opencode", "run"]);
});

test("resolveAgent returns kind cmd for agentCmd configs and by default", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-agent-"));
  assert.deepEqual(await resolveAgent(vault), {
    kind: "cmd", cmd: ["codex", "exec"], timeoutMs: 300000,
  });
  await writeFile(join(vault, "kizuki.config.json"),
    JSON.stringify({ agentCmd: ["claude", "-p"], timeoutMs: 1000 }), "utf8");
  assert.deepEqual(await resolveAgent(vault), {
    kind: "cmd", cmd: ["claude", "-p"], timeoutMs: 1000,
  });
});

test("resolveAgent returns kind http and validates agentHttp", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-agent-"));
  const good = { baseUrl: "https://api.deepseek.com/v1/", model: "deepseek-chat", apiKeyEnv: "DEEPSEEK_API_KEY" };
  await writeFile(join(vault, "kizuki.config.json"), JSON.stringify({ agentHttp: good }), "utf8");
  const resolved = await resolveAgent(vault);
  assert.equal(resolved.kind, "http");
  assert.equal(resolved.http.baseUrl, "https://api.deepseek.com/v1");
  assert.equal(resolved.timeoutMs, 300000);

  await writeFile(join(vault, "kizuki.config.json"),
    JSON.stringify({ agentCmd: ["codex", "exec"], agentHttp: good }), "utf8");
  await assert.rejects(resolveAgent(vault), /exactly one of agentCmd or agentHttp/);

  await writeFile(join(vault, "kizuki.config.json"),
    JSON.stringify({ agentHttp: { baseUrl: "x", model: "y" } }), "utf8");
  await assert.rejects(resolveAgent(vault), /agentHttp\.apiKeyEnv/);

  await writeFile(join(vault, "kizuki.config.json"),
    JSON.stringify({ agentHttp: { ...good, extra: 1 } }), "utf8");
  await assert.rejects(resolveAgent(vault), /unknown agentHttp field/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test lib/agent.test.mjs`
Expected: FAIL — `AGENT_PRESETS` not exported / shape mismatch (existing `resolveAgent` tests asserting `{cmd, timeoutMs}` will also fail — update those assertions to the new `{kind: "cmd", ...}` shape in this step).

- [ ] **Step 3: Implement in `lib/agent.mjs`**

```js
export const AGENT_PRESETS = Object.freeze({
  codex: ["codex", "exec"],
  claude: ["claude", "-p"],
  gemini: ["gemini", "-p"],
  opencode: ["opencode", "run"],
});

const HTTP_FIELDS = ["baseUrl", "model", "apiKeyEnv"];

function validateAgentHttp(http) {
  if (!http || typeof http !== "object" || Array.isArray(http)) {
    throw new Error(`${CONFIG_FILE}: agentHttp must be an object`);
  }
  for (const key of Object.keys(http)) {
    if (!HTTP_FIELDS.includes(key)) {
      throw new Error(`${CONFIG_FILE}: unknown agentHttp field ${JSON.stringify(key)}`);
    }
  }
  for (const key of HTTP_FIELDS) {
    if (typeof http[key] !== "string" || http[key].trim() === "") {
      throw new Error(`${CONFIG_FILE}: agentHttp.${key} must be a non-empty string`);
    }
  }
  return {
    baseUrl: http.baseUrl.replace(/\/+$/, ""),
    model: http.model,
    apiKeyEnv: http.apiKeyEnv,
  };
}
```

Rework the body of `resolveAgent` (keep the read/JSON-parse/timeout validation as-is):

```js
  const timeoutMs = data.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`${CONFIG_FILE}: timeoutMs must be a positive integer (milliseconds)`);
  }
  if (data.agentCmd !== undefined && data.agentHttp !== undefined) {
    throw new Error(`${CONFIG_FILE}: set exactly one of agentCmd or agentHttp`);
  }
  if (data.agentHttp !== undefined) {
    return { kind: "http", http: validateAgentHttp(data.agentHttp), timeoutMs };
  }
  const cmd = data.agentCmd;
  if (!Array.isArray(cmd) || cmd.length === 0 || !cmd.every((a) => typeof a === "string")) {
    throw new Error(`${CONFIG_FILE}: agentCmd must be a non-empty array of strings`);
  }
  return { kind: "cmd", cmd, timeoutMs };
```

And the ENOENT default becomes `{ kind: "cmd", cmd: DEFAULT_AGENT_CMD, timeoutMs: DEFAULT_TIMEOUT_MS }`.

- [ ] **Step 4: Adapt call sites to the new shape (keep suite green)**

Read each call site of `resolveAgent` and adapt the destructuring:
- `kizuki` executable (`doSync`, `stop`, `check` branches): `const resolved = await resolveAgent(vaultDir); if (resolved.kind === "http") throw new Error("http agent not wired yet"); const { cmd, timeoutMs } = resolved;` (temporary guard — Task 2 removes it).
- `lib/doctor.mjs` agent-config check: destructure `resolved`; for `kind: "cmd"` behavior unchanged; for `kind: "http"` yield config detail `agentHttp: <baseUrl> (<model>)`, agent-binary check `{status: "pass", detail: "http agent — no binary needed"}`, and smoke `{status: "skip", detail: "skipped: http agent (wired in Task 2)"}` (temporary — Task 2 replaces).
- Update any doctor tests asserting the old shape.

- [ ] **Step 5: Verify + commit**

Run: `node --test lib/agent.test.mjs && npm test`
Expected: all green.

```bash
git add lib/agent.mjs lib/agent.test.mjs lib/doctor.mjs lib/doctor.test.mjs kizuki
git commit -m "feat: add agent presets and discriminated agent config"
```

---

### Task 2: OpenAI-compatible HTTP runner

**Files:**
- Create: `lib/agentHttp.mjs`
- Test: `lib/agentHttp.test.mjs`
- Modify: `lib/agent.mjs` (add `makeConfiguredRunAgent`), `kizuki`, `lib/doctor.mjs`

**Interfaces:**
- Consumes: Task 1's resolved shape.
- Produces: `makeRunAgentHttp({baseUrl, model, apiKeyEnv}, timeoutMs, {fetchImpl}) -> runAgent`, and `makeConfiguredRunAgent(resolved, options?) -> runAgent` in `lib/agent.mjs` used by the executable and doctor for both kinds. Task 3 relies on `resolved.kind`.

- [ ] **Step 1: Write the failing tests** (`lib/agentHttp.test.mjs`)

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRunAgentHttp } from "./agentHttp.mjs";

const HTTP = { baseUrl: "https://api.example.com/v1", model: "test-model", apiKeyEnv: "KIZUKI_TEST_KEY" };

function fakeFetch(handler) {
  return async (url, init) => handler(url, init);
}

test("posts a chat completion and returns the content", async () => {
  process.env.KIZUKI_TEST_KEY = "sk-test";
  let seen;
  const run = makeRunAgentHttp(HTTP, 5000, {
    fetchImpl: fakeFetch(async (url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify({ choices: [{ message: { content: "payload here" } }] }), { status: 200 });
    }),
  });
  assert.equal(await run("do the thing"), "payload here");
  assert.equal(seen.url, "https://api.example.com/v1/chat/completions");
  assert.equal(seen.init.headers.authorization, "Bearer sk-test");
  const body = JSON.parse(seen.init.body);
  assert.equal(body.model, "test-model");
  assert.deepEqual(body.messages, [{ role: "user", content: "do the thing" }]);
});

test("fails loudly on missing key, non-2xx, non-JSON, and empty content", async () => {
  delete process.env.KIZUKI_TEST_KEY;
  await assert.rejects(makeRunAgentHttp(HTTP, 5000, { fetchImpl: fakeFetch(async () => new Response("{}")) })("x"),
    /KIZUKI_TEST_KEY is not set/);

  process.env.KIZUKI_TEST_KEY = "sk-test";
  await assert.rejects(makeRunAgentHttp(HTTP, 5000, { fetchImpl: fakeFetch(async () => new Response("nope", { status: 401 })) })("x"),
    /agentHttp: 401/);
  await assert.rejects(makeRunAgentHttp(HTTP, 5000, { fetchImpl: fakeFetch(async () => new Response("not json", { status: 200 })) })("x"),
    /non-JSON response/);
  await assert.rejects(makeRunAgentHttp(HTTP, 5000, { fetchImpl: fakeFetch(async () => new Response(JSON.stringify({ choices: [] }), { status: 200 })) })("x"),
    /empty completion content/);
});

test("aborts on timeout", async () => {
  process.env.KIZUKI_TEST_KEY = "sk-test";
  const run = makeRunAgentHttp(HTTP, 20, {
    fetchImpl: (url, init) => new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => {
        const e = new Error("aborted"); e.name = "AbortError"; reject(e);
      });
    }),
  });
  await assert.rejects(run("x"), /timed out after 20ms/);
});
```

- [ ] **Step 2: Run to verify failure** — `node --test lib/agentHttp.test.mjs` → `Cannot find module`.

- [ ] **Step 3: Implement `lib/agentHttp.mjs`**

```js
import { DEFAULT_TIMEOUT_MS } from "./agent.mjs";

export function makeRunAgentHttp({ baseUrl, model, apiKeyEnv }, timeoutMs = DEFAULT_TIMEOUT_MS, { fetchImpl = fetch } = {}) {
  return async (prompt) => {
    const apiKey = process.env[apiKeyEnv];
    if (!apiKey) throw new Error(`agentHttp: environment variable ${apiKeyEnv} is not set`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error.name === "AbortError") throw new Error(`agent timed out after ${timeoutMs}ms`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
    const body = await response.text();
    if (!response.ok) throw new Error(`agentHttp: ${response.status} ${body.slice(0, 200)}`);
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      throw new Error(`agentHttp: non-JSON response: ${body.slice(0, 200)}`);
    }
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content === "") throw new Error("agentHttp: empty completion content");
    return content;
  };
}
```

Add to `lib/agent.mjs` (import at top: `import { makeRunAgentHttp } from "./agentHttp.mjs";`):

```js
export function makeConfiguredRunAgent(resolved, options = {}) {
  if (resolved.kind === "http") return makeRunAgentHttp(resolved.http, resolved.timeoutMs, options.http ?? {});
  return makeRunAgent(resolved.cmd, resolved.timeoutMs, options.cmd ?? {});
}
```

- [ ] **Step 4: Wire the executable and doctor**

- `kizuki`: replace the Task 1 guards. `doSync`/`stop`: `const resolved = await resolveAgent(vaultDir); runAgent: makeConfiguredRunAgent(resolved)` (pass `resolved.kind` into `runSync` — parameter lands in Task 3; until then just build the runner). `check` branch: `kind: "cmd"` keeps `makeRunCheckAgent(resolved.cmd, resolved.timeoutMs)`; `kind: "http"` uses `makeConfiguredRunAgent(resolved)` (check's prompt is self-contained).
- `lib/doctor.mjs`: smoke test builds the runner via `makeConfiguredRunAgent(resolved)` for both kinds (replace the Task 1 skip); binary check stays pass-through for http. Update the executable's `runDoctor(vaultDir, { makeRunAgent, ... })` injection accordingly (inject `makeConfiguredRunAgent`).

- [ ] **Step 5: Verify + commit**

Run: `node --test lib/agentHttp.test.mjs && npm test` → green.

```bash
git add lib/agentHttp.mjs lib/agentHttp.test.mjs lib/agent.mjs lib/doctor.mjs lib/doctor.test.mjs kizuki
git commit -m "feat: add OpenAI-compatible http agent"
```

---

### Task 3: Sync capability gating + transcript inlining

**Files:**
- Modify: `lib/args.mjs`, `lib/run.mjs`, `kizuki`
- Test: `lib/args.test.mjs`, `lib/run.test.mjs` (extend)

**Interfaces:**
- Consumes: `resolved.kind` from Task 1; `runAgent` unchanged.
- Produces: `runSync({argv, vaultDir, runAgent, agentKind = "cmd"})`; `VALID_SOURCES` now includes `"transcript"`; `DEFAULT_SOURCES` (new export) stays the four MCP sources.

- [ ] **Step 1: Write the failing tests**

`lib/args.test.mjs` (append):

```js
test("transcript is a valid source but not a default", () => {
  assert.deepEqual(parseArgs(["--source", "transcript"]).sources, ["transcript"]);
  assert.deepEqual(parseArgs([]).sources, ["slack", "github", "atlassian", "outlook"]);
});
```

`lib/run.test.mjs` (append; reuse its existing tmp-vault + fake-runAgent helpers — the suite already runs `runSync` with an injected `runAgent` returning a fenced payload):

```js
test("http agent rejects MCP sources", async () => {
  const vault = await makeVault(); // reuse the file's existing vault fixture helper
  await assert.rejects(
    runSync({ argv: [], vaultDir: vault, runAgent: async () => "", agentKind: "http" }),
    /transcript-only sync/,
  );
});

test("http agent inlines pending transcripts into the prompt", async () => {
  const vault = await makeVault();
  await mkdir(join(vault, "transcripts"), { recursive: true });
  await writeFile(join(vault, "transcripts", "standup.md"), "Maya: creds still blocked", "utf8");
  let prompt;
  await runSync({
    argv: ["--source", "transcript", "--dry-run"],
    vaultDir: vault,
    runAgent: async (p) => { prompt = p; return EMPTY_PAYLOAD; }, // reuse the file's existing empty-payload constant/helper
    agentKind: "http",
  });
  assert.match(prompt, /--- TRANSCRIPT: standup\.md ---/);
  assert.match(prompt, /creds still blocked/);
});

test("http agent transcript inlining enforces the size cap", async () => {
  const vault = await makeVault();
  await mkdir(join(vault, "transcripts"), { recursive: true });
  await writeFile(join(vault, "transcripts", "big.md"), "x".repeat(200_001), "utf8");
  await assert.rejects(
    runSync({ argv: ["--source", "transcript"], vaultDir: vault, runAgent: async () => "", agentKind: "http" }),
    /transcripts exceed/,
  );
});
```

(If `lib/run.test.mjs` has no reusable vault/payload helpers, create them in this step from the file's existing setup pattern — do not invent a new style.)

- [ ] **Step 2: Run to verify failure** — `node --test lib/args.test.mjs lib/run.test.mjs`.

- [ ] **Step 3: Implement**

`lib/args.mjs`:

```js
export const DEFAULT_SOURCES = ["slack", "github", "atlassian", "outlook"];
export const VALID_SOURCES = [...DEFAULT_SOURCES, "transcript"];
```

and the default branch of the return becomes `sources.length ? [...new Set(sources)] : [...DEFAULT_SOURCES]`.

`lib/run.mjs` — extend the signature and gate before calling `runAgent`:

```js
const TRANSCRIPT_INLINE_CAP = 200_000;

async function inlineTranscripts(vaultDir) {
  const dir = join(vaultDir, "transcripts");
  let names;
  try {
    names = (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort();
  } catch (e) {
    if (e.code === "ENOENT") return "";
    throw e;
  }
  let total = 0;
  const parts = [];
  for (const name of names) {
    const text = await readFile(join(dir, name), "utf8");
    total += text.length;
    if (total > TRANSCRIPT_INLINE_CAP) {
      throw new Error(`transcripts exceed ${TRANSCRIPT_INLINE_CAP} chars — archive some or use a CLI agent`);
    }
    parts.push(`--- TRANSCRIPT: ${name} ---\n${text}`);
  }
  return parts.length ? `\n\n${parts.join("\n\n")}` : "";
}

export async function runSync({ argv, vaultDir, runAgent, agentKind = "cmd" }) {
  const { scope, sources, dryRun } = parseArgs(argv);
  if (agentKind === "http") {
    const unavailable = sources.filter((s) => s !== "transcript");
    if (unavailable.length) {
      throw new Error(
        `http agent supports transcript-only sync — run with --source transcript (unavailable: ${unavailable.join(",")})`,
      );
    }
  }
  ...
  let prompt = buildPrompt({ scope, sources, vaultDir, insightContext });
  if (agentKind === "http") prompt += await inlineTranscripts(vaultDir);
  ...
}
```

(Adapt to the file's actual structure — the `...` lines are the existing body, unchanged. Add `readdir` to the fs imports.)

`kizuki` `doSync`: pass `agentKind: resolved.kind` into `runSync`.

- [ ] **Step 4: Verify + commit**

Run: `npm test` → green.

```bash
git add lib/args.mjs lib/args.test.mjs lib/run.mjs lib/run.test.mjs kizuki
git commit -m "feat: gate http-agent sync to inlined transcripts"
```

---

### Task 4: `kizuki init --agent`

**Files:**
- Modify: `lib/init.mjs`, `kizuki`
- Test: `lib/init.test.mjs` (extend)

**Interfaces:**
- Consumes: `AGENT_PRESETS` from Task 1.
- Produces: `configTemplateFor(agent) -> config object`; `runInit(vaultDir, {forceConfig, agent})`.

- [ ] **Step 1: Failing tests** (append to `lib/init.test.mjs`)

```js
test("configTemplateFor maps presets and http", () => {
  assert.deepEqual(configTemplateFor("gemini").agentCmd, ["gemini", "-p"]);
  assert.deepEqual(configTemplateFor().agentCmd, ["codex", "exec"]);
  const http = configTemplateFor("http");
  assert.equal(http.agentCmd, undefined);
  assert.equal(typeof http.agentHttp.baseUrl, "string");
  assert.equal(http.agentHttp.apiKeyEnv, "OPENAI_API_KEY");
  assert.throws(() => configTemplateFor("vim"), /unknown agent preset "vim" \(valid: codex, claude, gemini, opencode, http\)/);
});

test("runInit honors the agent option", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-init-"));
  await runInit(vault, { agent: "claude" });
  const config = JSON.parse(await readFile(join(vault, "kizuki.config.json"), "utf8"));
  assert.deepEqual(config.agentCmd, ["claude", "-p"]);
});
```

- [ ] **Step 2: Run to verify failure** — `node --test lib/init.test.mjs`.

- [ ] **Step 3: Implement** (`lib/init.mjs`; import `AGENT_PRESETS` from `./agent.mjs`)

```js
export function configTemplateFor(agent = "codex") {
  if (agent === "http") {
    return {
      agentHttp: { baseUrl: "https://api.openai.com/v1", model: "gpt-5.4", apiKeyEnv: "OPENAI_API_KEY" },
      timeoutMs: DEFAULT_TIMEOUT_MS,
    };
  }
  const cmd = AGENT_PRESETS[agent];
  if (!cmd) {
    throw new Error(`unknown agent preset ${JSON.stringify(agent)} (valid: ${[...Object.keys(AGENT_PRESETS), "http"].join(", ")})`);
  }
  return { agentCmd: cmd, timeoutMs: DEFAULT_TIMEOUT_MS };
}
```

`runInit` gains `agent` in its options and writes `configTemplateFor(agent)` instead of `CONFIG_TEMPLATE` (keep `CONFIG_TEMPLATE` export as `configTemplateFor()` for compatibility). `kizuki` init branch parses `--agent <value>` from `rest` (value required — loud error otherwise) and passes it through. Add the flag to `USAGE`:

```
  kizuki init [--force-config] [--agent codex|claude|gemini|opencode|http]
```

- [ ] **Step 4: Verify + commit**

Run: `npm test` → green.

```bash
git add lib/init.mjs lib/init.test.mjs kizuki
git commit -m "feat: add init agent presets"
```

---

### Task 5: Skills-export targets — cursor, gemini, generic

**Files:**
- Modify: `lib/skills.mjs`
- Test: `lib/skills.test.mjs` (extend)
- Regenerate: `dist/skills/`

**Interfaces:**
- Consumes: existing `parseRitual`/`TARGETS` shape (`{render, distPath(name), homePath(name, home)}`).
- Produces: `renderCursor`, `renderGemini`, `renderGeneric`; `TARGETS.cursor/gemini/generic`; `generic` has `homePath: null` (dist-only).

- [ ] **Step 1: Verify current formats before coding**

WebFetch the official docs and confirm: Cursor user-level rules path + `.mdc` frontmatter keys (`description`, `alwaysApply`), and Gemini CLI custom-command TOML path + fields (`description`, `prompt`). If either differs from the spec table, follow the docs and record the deviation in the ticket result.

- [ ] **Step 2: Failing tests** (append to `lib/skills.test.mjs`)

```js
test("renderCursor emits mdc frontmatter, renderGemini emits toml, renderGeneric emits headed markdown", () => {
  const ritual = parseRitual(SOURCE);
  assert.equal(
    renderCursor(ritual),
    "---\ndescription: Begin a Kizuki shift\nalwaysApply: false\n---\n\nRun `kizuki start`. Then report.\n",
  );
  const toml = renderGemini(ritual);
  assert.match(toml, /^description = "Begin a Kizuki shift"\n/);
  assert.match(toml, /prompt = """\nRun `kizuki start`\. Then report\.\n"""\n$/);
  assert.equal(
    renderGeneric(ritual),
    "<!-- kizuki ritual: kizuki-start — invoke: kizuki start -->\n\nRun `kizuki start`. Then report.\n",
  );
});

test("new targets map paths; generic is dist-only", () => {
  assert.equal(TARGETS.cursor.homePath("kizuki-start", "/home/u"), join("/home/u", ".cursor", "rules", "kizuki-start.mdc"));
  assert.equal(TARGETS.cursor.distPath("kizuki-start"), join("cursor", "kizuki-start.mdc"));
  assert.equal(TARGETS.gemini.homePath("kizuki-start", "/home/u"), join("/home/u", ".gemini", "commands", "kizuki-start.toml"));
  assert.equal(TARGETS.generic.homePath, null);
  assert.equal(TARGETS.generic.distPath("kizuki-start"), join("generic", "kizuki-start.md"));
});

test("export installs all home targets and errors on generic without --dist/--check", async () => {
  const vault = await seededVault();
  const home = await mkdtemp(join(tmpdir(), "kizuki-skills-home-"));
  await runSkillsCommand(vault, ["export"], { home });
  await readFile(join(home, ".cursor", "rules", "kizuki-start.mdc"), "utf8");
  await readFile(join(home, ".gemini", "commands", "kizuki-start.toml"), "utf8");
  await assert.rejects(runSkillsCommand(vault, ["export", "--agent", "generic"], { home }), /generic renders to dist only/);
  await runSkillsCommand(vault, ["export", "--dist"]);
  await readFile(join(vault, "dist", "skills", "generic", "kizuki-start.md"), "utf8");
});
```

- [ ] **Step 3: Run to verify failure**, **Step 4: Implement**

```js
export function renderCursor(ritual) {
  return ["---", "description: " + ritual.description, "alwaysApply: false", "---", "", ritual.body].join("\n");
}

export function renderGemini(ritual) {
  const description = ritual.description.replaceAll('"', '\\"');
  return `description = "${description}"\nprompt = """\n${ritual.body}"""\n`;
}

export function renderGeneric(ritual) {
  return `<!-- kizuki ritual: ${ritual.name} — invoke: ${ritual.invoke} -->\n\n${ritual.body}`;
}
```

TARGETS additions (`generic.homePath: null`); in `runSkillsCommand`, when a target's `homePath` is null: under `--dist`/`--check` treat normally, otherwise throw `"generic renders to dist only — use --dist or --check"`. `--agent all` home installs skip null-homePath targets. Validate the gemini body for `"""` (throw if present — cannot be TOML-escaped safely).

- [ ] **Step 5: Regenerate dist + verify + commit**

Run: `./kizuki skills export --dist && ./kizuki skills export --check && npm test`
Expected: new `dist/skills/{cursor,gemini,generic}/` files, "skills dist up to date", suite green.

```bash
git add lib/skills.mjs lib/skills.test.mjs dist/skills
git commit -m "feat: add cursor, gemini, and generic skill targets"
```

---

### Task 6: Docs — works-with matrix + MCP-client section

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `AGENTS.md`

- [ ] **Step 1: README**

Add a "Works with" matrix near the top (codex, Claude Code, Gemini CLI, opencode via presets; any OpenAI-compatible API via `agentHttp` — transcript-sync/check/day-summary column notes; any MCP client for vault tools). Add a "Connect any MCP client" section: `mcp/server.mjs`, `KIZUKI_VAULT`, tool list, Claude Code snippet + generic `mcpServers` JSON block. Document `kizuki init --agent ...` and the `agentHttp` config shape (with the env-var note). Extend the skills-export section with the new targets.

- [ ] **Step 2: CLAUDE.md + AGENTS.md (mirrored)**

Commands: `init --agent`, skills export target list. Architecture: `lib/agentHttp.mjs` line + `resolveAgent` discriminated shape note + http sync gating sentence. Keep both files in sync.

- [ ] **Step 3: Verify + commit**

Run: `npm test` → green.

```bash
git add README.md CLAUDE.md AGENTS.md
git commit -m "docs: document agent accessibility"
```
