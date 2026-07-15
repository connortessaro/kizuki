# Lane 1 — OSS Public Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship kizuki publicly — single npm package with `kizuki mcp`, Apache-2.0, fresh-cut public repo, MCP-registry + HN/X launch, landing updated to the five-edition model — plus Lane 2 concierge materials.

**Architecture:** The existing engine ships as-is; this plan packages and publishes it. One npm package (`kizuki`) absorbs the MCP server deps (SDK + zod) at the root while `lib/` stays import-clean. The public repo is a fresh cut (clean history); the private repo stays canonical for vault data and pre-release history until cutover.

**Tech Stack:** Node built-ins, `@modelcontextprotocol/sdk` + `zod` (only runtime deps), `node:test`, Next.js (web/ only), gh CLI, npm.

**Spec:** `docs/superpowers/specs/2026-07-14-kizuki-release-monetization-design.md` (rev 2). Direction record: `docs/2026-07-14-kizuki-direction-notes.md`.

## Global Constraints

- `lib/` imports Node built-ins only — no npm packages inside `lib/` (zero-dep kernel convention; the *package* may depend on `@modelcontextprotocol/sdk` and `zod`).
- License: **Apache-2.0** exactly.
- Package name: `kizuki` (verified unclaimed on npm 2026-07-14).
- Headline install: `claude mcp add kizuki -- npx -y kizuki mcp`.
- Positioning copy: intelligence layer / needs-and-gaps language; never "memory," never monitoring language. Alignment framing only.
- Editions and prices verbatim from spec: Free OSS / Concierge beta $49–99/mo / Hosted Pro $29/mo or $290/yr / Team $25–40 per active user/mo / Enterprise custom.
- **Nothing ships publicly before the Phase 0 gate and the Task 5 data audit pass.**
- Vault dirs (`people/`, `projects/`, `teams/`, `transcripts/`, `alerts/`, `signals/`, `insights/`, `catches/`, `days/`, `state/`) and `docs/concierge/` never enter the public repo or the npm tarball.
- Full suite green (`npm test`) before every commit claim.

---

## Phase 0 — Foundation completion (prerequisite gate)

Execute Tasks 7–10 of `docs/superpowers/plans/2026-07-14-kizuki-platform-foundation.md` exactly as written there (T7 MCP capture adapter, T8 writable web evidence canvas, T9 init/doctor wiring + usage docs, T10 end-to-end local proof). That plan is complete and self-contained — do not duplicate it here. **Lane 1 Tasks 5–8 below must not start until T10's completion gate passes.** Tasks 1–4 and 9 may run in parallel with Phase 0.

---

### Task 1: LICENSE + package metadata

**Files:**
- Create: `LICENSE`
- Modify: `package.json`

**Interfaces:**
- Produces: root `package.json` with `"license": "Apache-2.0"`, `"private": false` deferred to Task 4 (stays `true` here so nothing publishes early).

- [ ] **Step 1: Add the Apache-2.0 license text**

Run: `curl -fsSL https://www.apache.org/licenses/LICENSE-2.0.txt -o LICENSE`

Verify: `head -2 LICENSE` prints "Apache License" / "Version 2.0, January 2004". Then edit nothing — Apache-2.0 does not require inserting a copyright line into LICENSE itself.

- [ ] **Step 2: Update package.json metadata**

Modify `package.json` (keep `"private": true` for now):

```json
{
  "name": "kizuki",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "description": "Agent-neutral intelligence layer over your work: understands what a business, a team, and a person need — what changed, what matters, what's missing.",
  "license": "Apache-2.0",
  "repository": { "type": "git", "url": "git+https://github.com/connortessaro/kizuki.git" },
  "keywords": ["mcp", "mcp-server", "intelligence", "agent", "org-intelligence", "claude", "codex"],
  "bin": {
    "kizuki": "./kizuki"
  },
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 3: Run suite, commit**

Run: `npm test` — expected: all pass, 0 fail.

```bash
git add LICENSE package.json
git commit -m "chore: add Apache-2.0 license and package metadata"
```

---

### Task 2: `kizuki mcp` subcommand (single-package MCP entry)

**Files:**
- Modify: `package.json` (add dependencies)
- Modify: `kizuki` (dispatch `mcp`)
- Modify: `mcp/package.json` (drop duplicate deps, keep test script)
- Test: `mcp/server.integration.mjs` pattern; new test `lib/mcpCommand.test.mjs`

**Interfaces:**
- Consumes: `mcp/server.mjs` (existing stdio server; reads `KIZUKI_VAULT` env, defaults to repo root).
- Produces: `./kizuki mcp` boots the same server; `npx -y kizuki mcp` works post-publish.

- [ ] **Step 1: Hoist MCP deps to root**

In root `package.json` add:

```json
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "zod": "^3.25.0"
  }
```

In `mcp/package.json` delete the `dependencies` block and delete `mcp/node_modules` + `mcp/package-lock.json`. Run `npm install` at root. ESM resolution walks up from `mcp/server.mjs` to root `node_modules`, so imports keep working.

- [ ] **Step 2: Write the failing test**

Create `lib/mcpCommand.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

test("kizuki mcp answers an MCP initialize over stdio", async () => {
  const child = spawn(process.execPath, [join(repo, "kizuki"), "mcp"], {
    env: { ...process.env, KIZUKI_VAULT: repo },
  });
  const init = {
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } },
  };
  child.stdin.write(JSON.stringify(init) + "\n");
  const line = await new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("timeout: " + buf)), 15000);
    child.stdout.on("data", (d) => {
      buf += d;
      const nl = buf.indexOf("\n");
      if (nl !== -1) { clearTimeout(timer); resolve(buf.slice(0, nl)); }
    });
  }).finally(() => child.kill());
  const msg = JSON.parse(line);
  assert.equal(msg.id, 1);
  assert.ok(msg.result.serverInfo.name.length > 0);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test lib/mcpCommand.test.mjs`
Expected: FAIL (usage text printed, no JSON-RPC reply → timeout or parse error).

- [ ] **Step 4: Add the dispatch case**

In `kizuki`, in the command dispatch (same level as `doctor`, `watch`, etc.), add:

```js
if (command === "mcp") {
  await import("./mcp/server.mjs");
} else
```

(Exact placement: follow the existing `if/else if` or `switch` chain style in the file — read the dispatch block first and match it.) Add one usage line: `  kizuki mcp                                       start the MCP server (stdio)`.

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test lib/mcpCommand.test.mjs` — expected: PASS.
Run: `npm test` — expected: full suite green (root runner now also picks up `mcp/` tests via root deps; if `mcp/server.integration.mjs` was excluded from root runs before, leave that arrangement as-is).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json kizuki mcp/package.json lib/mcpCommand.test.mjs
git commit -m "feat(cli): add kizuki mcp subcommand, single-package deps"
```

---

### Task 3: README rewrite (MCP-first)

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 2's `kizuki mcp`.
- Produces: the public repo's front page; Task 5 copies it verbatim.

- [ ] **Step 1: Rewrite README with this structure**

Sections, in order (write full prose, intelligence-layer voice, no "memory" framing):

1. **One-liner + hero:** "Kizuki is an agent-neutral intelligence layer over your work. It understands what a business, a team, and a person need — what changed, what matters now, what conflicts, what's missing — and prepares you and your AI agents to respond."
2. **Install (MCP-first):**
   ````markdown
   ## Give your agent understanding
   ```bash
   claude mcp add kizuki -- npx -y kizuki mcp        # Claude Code
   ```
   Cursor (`.cursor/mcp.json`) and Codex (`~/.codex/config.toml`) snippets follow the same `npx -y kizuki mcp` command.
   ````
3. **CLI quickstart:** `npx kizuki init --agent claude` → `kizuki sync` → `kizuki start`/`stop`; link `kizuki doctor`.
4. **What it answers:** the seven questions from the direction notes (what changed / what matters now / what conflicts / what's missing / who's affected / what needs a decision / what should an agent know).
5. **How it stays trustworthy:** deterministic writes, evidence receipts, observe-and-advise (never sends/acts), local-first vault, append-only ledgers.
6. **Editions:** table verbatim from Global Constraints; Free OSS is this repo; Concierge beta link to landing.
7. **Demo:** link the public synthetic-data dashboard.
8. License footer: Apache-2.0.

- [ ] **Step 2: Verify commands in README actually run**

Run each quickstart command in a temp dir (`KIZUKI_VAULT=$(mktemp -d) ./kizuki init` etc.). Expected: no errors, doctor reports vault structure.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: MCP-first README for public release"
```

---

### Task 4: npm publish preparation

**Files:**
- Modify: `package.json` (`private: false`, `files` whitelist)

**Interfaces:**
- Produces: publishable tarball containing only engine code.

- [ ] **Step 1: Add files whitelist and flip private**

In `package.json` set `"private": false` and add:

```json
  "files": ["kizuki", "lib/**/*.mjs", "mcp/*.mjs", "mcp/package.json", "skills/", "dist/skills/", "README.md", "LICENSE"]
```

Then remove test files from the tarball by adding to the whitelist exclusions — npm `files` cannot exclude, so verify in Step 2 and, if `lib/*.test.mjs` lands in the tarball, change the glob to enumerate: `"lib/!(*.test).mjs"` is unsupported by npm — instead accept test files in the tarball (harmless, keeps globs simple) **or** list directories and add `.npmignore` entries `*.test.mjs` / `server.integration.mjs`. Prefer the `.npmignore` route.

- [ ] **Step 2: Verify tarball contents**

Run: `npm pack --dry-run 2>&1 | tee /tmp/pack.txt` and check:

```bash
grep -E "people/|transcripts/|days/|signals/|insights/|catches/|state/|web/|docs/|kizuki.config.json|concierge" /tmp/pack.txt && echo "LEAK — fix files whitelist" || echo "clean"
```

Expected: `clean`.

- [ ] **Step 3: Smoke-test the packed package**

```bash
npm pack && mkdir -p /tmp/kizuki-smoke && cd /tmp/kizuki-smoke && npm init -y >/dev/null && npm i /Users/tessaro/kizuki/kizuki-0.1.0.tgz && KIZUKI_VAULT=$(mktemp -d) npx kizuki doctor --check-only
```

Expected: doctor runs from the installed package without error.

- [ ] **Step 4: Commit** (do NOT `npm publish` yet — publish happens in Task 6 after the fresh-cut audit)

```bash
git add package.json .npmignore
git commit -m "chore: publishable package config with files whitelist"
```

---

### Task 5: Fresh-cut public repo + data audit (HARD GATE)

**Files:** none in-repo; produces `~/src/kizuki-public` and `github.com/connortessaro/kizuki` (public).

**Interfaces:**
- Consumes: Tasks 1–4 complete, Phase 0 gate passed.
- Produces: public canonical repo; all later work lands there and syncs back here until cutover.

- [ ] **Step 1: Export a clean tree**

```bash
git -C /Users/tessaro/kizuki archive HEAD | (mkdir -p ~/src/kizuki-public && tar -x -C ~/src/kizuki-public)
```

`git archive` honors tracked files only — gitignored vault data cannot enter. Then delete private-only paths from the export: `rm -rf ~/src/kizuki-public/docs/concierge` (if present) and review `docs/` for anything work-referencing.

- [ ] **Step 2: Audit the tree (blocker)**

```bash
cd ~/src/kizuki-public
grep -rniE "chewy|tessaro\.c@|northeastern" . && echo "SCRUB REQUIRED" || echo "names clean"
npx -y gitleaks dir . 2>&1 | tail -5   # expected: no leaks found
ls people projects teams transcripts days signals insights catches state 2>/dev/null && echo "VAULT DATA PRESENT — STOP" || echo "vault clean"
```

All three must pass. Additionally, read every file under `docs/` once — human judgment pass for colleague names, meeting content, or employer specifics; delete or redact anything found. **Operator (Connor) signs off on this step explicitly before Step 3.**

- [ ] **Step 3: Init and push public repo**

```bash
cd ~/src/kizuki-public
git init -b main && git add -A && git commit -m "Kizuki — initial public release"
gh auth switch --user connortessaro
gh repo create connortessaro/kizuki --public --source . --push --description "Agent-neutral intelligence layer over your work"
```

(If `connortessaro/kizuki` name is taken by the private repo, rename the private one first: `gh repo rename kizuki-private --repo connortessaro/kizuki`, keeping it private.)

- [ ] **Step 4: Record cutover rule**

Append to the private repo's `CLAUDE.md` Parallel-work section: public repo is now canonical for engine code; private repo holds vault data + pre-release history; changes land publicly and are pulled here. Commit that note in the private repo.

---

### Task 6: npm publish + MCP registry submissions

**Interfaces:**
- Consumes: Task 5 public repo live.
- Produces: `npm i -g kizuki` works globally; registry listings.

- [ ] **Step 1: Publish**

From `~/src/kizuki-public`: `npm publish` (operator must be logged into npm as the owning account; `npm whoami` first). Verify: `npx -y kizuki@latest doctor --check-only` in a temp dir runs.

- [ ] **Step 2: MCP registry submissions**

- Official MCP registry: create `server.json` per current schema at registry docs (`io.github.connortessaro/kizuki`, stdio, `npx -y kizuki mcp`), publish with `mcp-publisher` CLI following https://github.com/modelcontextprotocol/registry docs.
- mcp.so + Smithery: submit via their web forms (manual, operator).
- Verify each listing renders the install command correctly.

- [ ] **Step 3: Commit `server.json` to the public repo**

```bash
git add server.json && git commit -m "chore: MCP registry manifest" && git push
```

---

### Task 7: Landing update — five editions + concierge CTA

**Files:**
- Modify: `web/app/(landing)/landing/page.tsx` (and its pricing section/components in the same directory)

**Interfaces:**
- Consumes: edition table from Global Constraints.
- Produces: kizuki.dev shows intelligence-layer headline, five editions, concierge as the active paid CTA.

- [ ] **Step 1: Read the current landing page and pricing markup** — match existing component and styling patterns exactly (brand per `docs/BRAND.md`).

- [ ] **Step 2: Apply copy + structure changes**

- Headline: "Kizuki understands what your business, your teams, and your people need." Subhead: the what-changed/what-matters/what's-missing triplet. Remove any memory-adjacent phrasing.
- Pricing grid → five cards with the verbatim edition table. Free card CTA: "Install" → GitHub repo + `claude mcp add` snippet. **Concierge card is the highlighted CTA: "Join the founding cohort — $49–99/mo"** → existing waitlist mechanism with a `tier=concierge` distinction (reuse the current waitlist form/param pattern; do not build new backend).
- Hosted Pro + Team cards: keep waitlist state, show prices. Enterprise: "Talk to us."
- Security strip: "Local-first. Your infra. We don't want your data." linking a short security section.

- [ ] **Step 3: Verify + test**

Run: `cd web && npm test` (root suite picks up `web/lib` tests) and `npm run build` — expected: build succeeds. View `/landing` locally, screenshot, eyeball the five cards.

- [ ] **Step 4: Commit + deploy**

```bash
git add "web/app/(landing)/landing/page.tsx"
git commit -m "feat(web): five-edition pricing with concierge founding-cohort CTA"
```

Deploy per existing Vercel flow. Verify live URL renders.

---

### Task 8: Launch posts

**Files:**
- Create: `docs/launch/2026-07-show-hn.md`, `docs/launch/2026-07-x-thread.md` (private repo only — add `docs/launch/` to the Task 5 private-only deletion list)

- [ ] **Step 1: Draft Show HN** — title: `Show HN: Kizuki – an intelligence layer your AI agent plugs into (local-first, Apache-2.0)`. Body: personal story (built to keep up with org chaos at work), what it answers (the seven questions), the `claude mcp add` one-liner, observe-and-advise trust rules, link repo + demo. No pricing push in the post; concierge mentioned once at the end.
- [ ] **Step 2: Draft X thread** via the `launch-tweet` skill at execution time.
- [ ] **Step 3: Operator review of both drafts** (Connor edits voice), then commit to private repo.
- [ ] **Step 4: Post on launch morning** (~9am ET, Tue–Thu), operator action; monitor HN comments for the first 4 hours and reply.

---

### Task 9: Lane 2 concierge materials (parallel-safe, private)

**Files:**
- Create: `docs/concierge/one-pager.md`, `docs/concierge/outreach.md`, `docs/concierge/onboarding-checklist.md`, `docs/concierge/terms.md` (private repo only; excluded in Task 5)

- [ ] **Step 1: One-pager** — offer verbatim from spec (dedicated instance, onboarding, 3–5 sources, configured Founder/Consultant Pack, weekly review, direct support, $49–99/mo founding price); the seven questions as the value section; "what we never do" trust block.
- [ ] **Step 2: Outreach drafts** — one warm-intro email (network) + one cold variant for founders/consultants; ≤150 words each; single CTA: 20-minute call.
- [ ] **Step 3: Onboarding checklist** — call agenda, source selection (3–5 from: mailbox, calendar, GitHub, transcripts), install/hosting choice, first-week cadence, catch-recording ritual (`kizuki catch`).
- [ ] **Step 4: Terms sketch** — month-to-month, cancel anytime, data handling (their infra or dedicated instance; deletion on exit), founding-price lock. Mark "not reviewed by a lawyer."
- [ ] **Step 5: Commit to private repo** — `git add docs/concierge && git commit -m "docs: concierge founding-cohort materials"`.

---

## Execution order

```
Phase 0 (T7–T10, foundation plan) ─┐
Tasks 1–4 (package, parallel OK)  ─┼→ Task 5 (fresh-cut + audit, HARD GATE, operator sign-off)
Task 9 (concierge, anytime)        │        → Task 6 (npm + registries)
                                   │        → Task 7 (landing) → Task 8 (launch posts → post)
```

Operator-only steps: Task 5 Step 2 sign-off, npm login, registry web forms, launch-post voice edit + posting, concierge outreach sending.
