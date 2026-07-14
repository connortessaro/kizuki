# Kizuki Platform Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first vertical platform slice: a canonical local event contract, authenticated loopback API, OS-managed daemon, and working CLI, MCP, and web capture clients.

**Architecture:** Keep validation and local persistence in zero-dependency `lib/` modules. Add a zero-dependency HTTP service under `server/`; it injects authenticated local identity context into capability commands and never exposes file CRUD. Existing CLI, MCP, and web behavior stays compatible while new capture behavior uses the shared API.

**Tech Stack:** Node.js ESM, Node built-ins, `node:test`, JSONL, HTTP/JSON, OpenAPI JSON, Next.js 16, React 19, TypeScript

## Global Constraints

- Root and `lib/` use ESM `.mjs`, Node built-ins only, and zero runtime dependencies.
- The model returns one fenced JSON payload; deterministic JavaScript owns durable writes.
- New mutations hold `state/vault.lock` and fail loudly.
- The local API binds to `127.0.0.1` and requires a per-install bearer token.
- Canonical local events live in JSONL. Markdown remains a human-readable view.
- Kizuki observes and advises. It never performs an outward action without human approval.
- TDD order is mandatory: failing test, observed failure, minimal implementation, passing test.
- `npm test` must pass before completion.
- Existing signal, insight, catch, shift, and read-only dashboard behavior must remain compatible.

## Scope boundary

This plan implements the shared foundation as a working product slice. Separate plans will cover PostgreSQL and hosted tenancy, first-party OAuth connectors, full Pack manifests and permissions, shared-workspace UX, billing, and enterprise deployment. Those systems depend on the interfaces created here and should not invent parallel contracts.

## File map

- `lib/platformEvents.mjs`: capture input validation, canonical event validation, idempotent event planning, and capture projection.
- `lib/platformEventStore.mjs`: locked JSONL read/write and capture command execution.
- `lib/daemonConfig.mjs`: local daemon address and secret generation, validation, and secure persistence.
- `server/api.mjs`: authenticated HTTP routes, JSON limits, response envelopes, and event stream.
- `server/cli.mjs`: long-running daemon process and signal handling.
- `server/openapi.json`: public API contract for the shipped routes.
- `lib/daemonService.mjs`: launchd/systemd unit rendering and lifecycle operations.
- `lib/platformApiClient.mjs`: shared authenticated API client for local adapters.
- `lib/captureCommands.mjs`: CLI argument parsing and capture formatting.
- `lib/daemonCommands.mjs`: CLI daemon command routing.
- `mcp/tools.mjs`, `mcp/server.mjs`: `capture_context` MCP adapter.
- `web/lib/api.mjs`: dashboard server-side API adapter.
- `web/app/(dashboard)/capture/*`: writable evidence canvas route and server action.
- `lib/init.mjs`, `lib/doctor.mjs`: event directory, daemon config, and health diagnostics.

---

### Task 1: Canonical capture event contract

**Files:**
- Create: `lib/platformEvents.mjs`
- Create: `lib/platformEvents.test.mjs`

**Interfaces:**
- Produces: `EVENT_VERSION`, `CAPTURE_KINDS`, `LOCAL_CONTEXT`, `validateCaptureInput(input)`, `validatePlatformEvent(event)`, `planCaptureEvent(events, input, context, options)`, and `listCaptureStates(events, options)`.
- Event IDs use `evt_<uuid>`; capture IDs use `cap_<uuid>`.
- Capture input is `{ kind, text, entity?, visibility?, packIds?, receipts? }`.

- [ ] **Step 1: Write failing validation and idempotency tests**

```js
test("planCaptureEvent creates a private local capture", () => {
  const result = planCaptureEvent([], {
    kind: "decision",
    text: "Ship the loopback API first.",
    entity: { type: "project", name: "kizuki" },
  }, LOCAL_CONTEXT, {
    now: new Date("2026-07-14T12:00:00.000Z"),
    randomUUID: sequenceUUID("11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"),
    idempotencyKey: "cli-1",
  });
  assert.equal(result.disposition, "created");
  assert.equal(result.event.type, "capture.recorded");
  assert.equal(result.event.workspaceId, "personal");
  assert.deepEqual(result.event.visibility, {
    scope: "private",
    principalIds: ["local-operator"],
  });
  assert.equal(result.event.payload.entity.name, "kizuki");
});

test("planCaptureEvent returns exact retry and rejects key reuse", () => {
  const first = planCaptureEvent([], INPUT, LOCAL_CONTEXT, FIXED_OPTIONS);
  const retry = planCaptureEvent([first.event], INPUT, LOCAL_CONTEXT, FIXED_OPTIONS);
  assert.equal(retry.disposition, "existing");
  assert.equal(retry.event.eventId, first.event.eventId);
  assert.throws(
    () => planCaptureEvent([first.event], { ...INPUT, text: "different" }, LOCAL_CONTEXT, FIXED_OPTIONS),
    /idempotency key already used/,
  );
});
```

- [ ] **Step 2: Run the tests and observe the missing-module failure**

Run: `node --test lib/platformEvents.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `lib/platformEvents.mjs`.

- [ ] **Step 3: Implement the contract and planner**

Implement these exact public constants and shapes:

```js
export const EVENT_VERSION = 1;
export const CAPTURE_KINDS = Object.freeze([
  "note", "correction", "decision", "hypothesis", "question",
]);
export const LOCAL_CONTEXT = Object.freeze({
  workspaceId: "personal",
  principalId: "local-operator",
  sourceOwnerId: "local-operator",
  allowedVisibility: ["private"],
});

// Canonical event
{
  version: 1,
  eventId: "evt_<uuid>",
  type: "capture.recorded",
  at: "<ISO timestamp>",
  workspaceId: "personal",
  principalId: "local-operator",
  sourceOwnerId: "local-operator",
  visibility: { scope: "private", principalIds: ["local-operator"] },
  packIds: [],
  receipts: [],
  idempotencyKey: "<non-empty string>",
  aggregate: { type: "capture", id: "cap_<uuid>", version: 1 },
  payload: {
    kind: "note",
    text: "<non-empty string>",
    entity: null
  }
}
```

Reject unknown input fields, unsafe entity names, unsupported visibility, query strings or credentials in receipt locators, invalid timestamps, duplicate Pack IDs, oversized text above 50,000 characters, and malformed canonical events. Compare idempotent retries with `isDeepStrictEqual` after removing generated IDs and timestamps.

- [ ] **Step 4: Run focused tests**

Run: `node --test lib/platformEvents.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/platformEvents.mjs lib/platformEvents.test.mjs
git commit -m "feat(events): define capture event contract"
```

### Task 2: Locked local JSONL event store

**Files:**
- Create: `lib/platformEventStore.mjs`
- Create: `lib/platformEventStore.test.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: Task 1 event validators and planner.
- Produces: `platformEventsPath(vaultDir)`, `readPlatformEvents(vaultDir)`, `writePlatformEventsAtomic(vaultDir, events)`, `capturePlatformEvent(vaultDir, input, options)`, and `listPlatformCaptures(vaultDir, options)`.

- [ ] **Step 1: Write failing store tests**

```js
test("capturePlatformEvent writes one event and dedupes retry", async () => {
  const vaultDir = await makeVault();
  const first = await capturePlatformEvent(vaultDir, INPUT, OPTIONS);
  const retry = await capturePlatformEvent(vaultDir, INPUT, OPTIONS);
  assert.equal(first.disposition, "created");
  assert.equal(retry.disposition, "existing");
  assert.equal((await readPlatformEvents(vaultDir)).length, 1);
});

test("capturePlatformEvent serializes through the vault lock", async () => {
  const vaultDir = await makeVault();
  await writeFile(join(vaultDir, "state", "vault.lock"), JSON.stringify({
    pid: 1, tool: "sync", startedAt: "2026-07-14T12:00:00.000Z",
  }));
  await assert.rejects(
    capturePlatformEvent(vaultDir, INPUT, {
      ...OPTIONS,
      lock: { waitMs: 20, pollMs: 5, pidAlive: () => true },
    }),
    /vault locked by sync/,
  );
});
```

- [ ] **Step 2: Run the tests and observe failure**

Run: `node --test lib/platformEventStore.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement atomic JSONL persistence**

Use `events/events.jsonl`. `readPlatformEvents` returns `[]` for `ENOENT`, rejects blank or malformed lines with a line number, and validates every event. `writePlatformEventsAtomic` writes a same-directory temporary file with mode `0o600`, then renames it. `capturePlatformEvent` holds `withVaultLock(vaultDir, ..., { tool: "capture" })`, reads current events, plans the event, and rewrites only when disposition is `created`.

Add `/events/` to `.gitignore`.

- [ ] **Step 4: Run focused and lock tests**

Run: `node --test lib/platformEventStore.test.mjs lib/lock.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .gitignore lib/platformEventStore.mjs lib/platformEventStore.test.mjs
git commit -m "feat(events): persist local platform ledger"
```

### Task 3: Secure daemon configuration

**Files:**
- Create: `lib/daemonConfig.mjs`
- Create: `lib/daemonConfig.test.mjs`

**Interfaces:**
- Produces: `DAEMON_CONFIG_VERSION`, `DEFAULT_DAEMON_HOST`, `DEFAULT_DAEMON_PORT`, `daemonConfigPath(vaultDir)`, `validateDaemonConfig(config)`, `readDaemonConfig(vaultDir)`, and `ensureDaemonConfig(vaultDir, options)`.

- [ ] **Step 1: Write failing config tests**

```js
test("ensureDaemonConfig creates a loopback config with private mode", async () => {
  const vaultDir = await makeVault();
  const config = await ensureDaemonConfig(vaultDir, {
    randomBytes: () => Buffer.alloc(32, 7),
  });
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 4247);
  assert.equal(config.token, Buffer.alloc(32, 7).toString("base64url"));
  assert.equal((await stat(daemonConfigPath(vaultDir))).mode & 0o777, 0o600);
});

test("validateDaemonConfig rejects non-loopback host", () => {
  assert.throws(
    () => validateDaemonConfig({ ...VALID_CONFIG, host: "0.0.0.0" }),
    /host must be 127\.0\.0\.1/,
  );
});
```

- [ ] **Step 2: Run the tests and observe failure**

Run: `node --test lib/daemonConfig.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement config generation and validation**

Persist `state/daemon.json` with this shape:

```json
{
  "version": 1,
  "host": "127.0.0.1",
  "port": 4247,
  "token": "<32 random bytes encoded as base64url>"
}
```

Create `state/` as needed, use an exclusive create where possible, set mode `0o600`, and re-read the winning file if concurrent installers race. Reject unknown fields, ports outside `1024..65535`, tokens shorter than 32 characters, and hosts other than `127.0.0.1`. Never include the token in error strings or formatted CLI output.

- [ ] **Step 4: Run focused tests**

Run: `node --test lib/daemonConfig.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/daemonConfig.mjs lib/daemonConfig.test.mjs
git commit -m "feat(daemon): add secure local config"
```

### Task 4: Authenticated HTTP API and OpenAPI contract

**Files:**
- Create: `server/package.json`
- Create: `server/openapi.json`
- Create: `server/api.mjs`
- Create: `server/api.test.mjs`

**Interfaces:**
- Consumes: `capturePlatformEvent`, `listPlatformCaptures`, and daemon config.
- Produces: `createApiHandler(options)`, `createApiServer(options)`, and `listenApiServer(options)`.
- Routes: authenticated `GET /v1/health`, `GET /v1/captures`, `POST /v1/captures`, `GET /v1/events/stream`, and `GET /openapi.json`.

- [ ] **Step 1: Write failing live-server tests**

```js
test("API rejects missing auth and captures with auth", async (t) => {
  const running = await startTestServer();
  t.after(() => running.close());
  const denied = await fetch(running.url + "/v1/health");
  assert.equal(denied.status, 401);
  const created = await fetch(running.url + "/v1/captures", {
    method: "POST",
    headers: {
      authorization: "Bearer test-token-that-is-at-least-32-chars",
      "content-type": "application/json",
      "idempotency-key": "api-1",
    },
    body: JSON.stringify({ kind: "note", text: "API works." }),
  });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).data.event.type, "capture.recorded");
});

test("API returns stable error envelopes", async () => {
  const response = await authorizedFetch("/v1/captures", {
    method: "POST",
    body: "{",
  });
  assert.deepEqual(await response.json(), {
    error: { code: "invalid_json", message: "request body must be valid JSON" },
  });
});
```

- [ ] **Step 2: Run tests and observe failure**

Run: `node --test server/api.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement API, SSE, and schema**

Use Node `http`, `EventEmitter`, `timingSafeEqual`, and `URL`. Limit JSON bodies to 64 KiB. Require `Content-Type: application/json` for POST and `Idempotency-Key` for mutations. Derive `LOCAL_CONTEXT` server-side; reject any client attempt to set workspace, principal, or source owner.

Return `{ "data": ... }` on success and `{ "error": { "code", "message" } }` on failure. Map validation to `400`, auth to `401`, idempotency conflict to `409`, oversized input to `413`, missing route to `404`, wrong method to `405`, and unexpected failures to `500` without stack traces.

The SSE route sends a `ready` event, broadcasts each created canonical event as `capture.recorded`, sends a comment heartbeat every 25 seconds, and removes closed responses. The test server must use port `0`; the production listener uses configured host and port.

Document the exact routes, request schemas, response schemas, bearer auth, and idempotency header in `server/openapi.json`.

- [ ] **Step 4: Run API tests**

Run: `node --test server/api.test.mjs`

Expected: PASS with no open-handle warning.

- [ ] **Step 5: Commit**

```bash
git add server/package.json server/openapi.json server/api.mjs server/api.test.mjs
git commit -m "feat(api): add authenticated local service"
```

### Task 5: OS-managed daemon lifecycle

**Files:**
- Create: `server/cli.mjs`
- Create: `lib/daemonService.mjs`
- Create: `lib/daemonService.test.mjs`

**Interfaces:**
- Consumes: daemon config and `listenApiServer`.
- Produces: `launchdPlist(options)`, `systemdUnit(options)`, `installDaemon(options)`, `uninstallDaemon(options)`, `restartDaemon(options)`, and `daemonStatus(options)`.

- [ ] **Step 1: Write failing lifecycle tests**

```js
test("launchd plist starts server at login and restarts it", () => {
  const xml = launchdPlist({
    nodePath: "/usr/bin/node",
    serverPath: "/repo/server/cli.mjs",
    vaultDir: "/repo",
  });
  assert.match(xml, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(xml, /<key>KeepAlive<\/key><true\/>/);
  assert.match(xml, /<string>--vault<\/string>\s*<string>\/repo<\/string>/);
  assert.doesNotMatch(xml, /token/);
});

test("systemd unit runs as a user service", () => {
  const unit = systemdUnit({ nodePath: "/usr/bin/node", serverPath: "/repo/server/cli.mjs", vaultDir: "/repo" });
  assert.match(unit, /^\[Unit\]/);
  assert.match(unit, /Restart=on-failure/);
  assert.match(unit, /WantedBy=default\.target/);
});
```

- [ ] **Step 2: Run tests and observe failure**

Run: `node --test lib/daemonService.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement process and service managers**

`server/cli.mjs` accepts only `--vault <absolute path>`, reads `state/daemon.json`, starts the server, writes no secret to stdout, and closes cleanly on `SIGINT` or `SIGTERM`.

On macOS, install `~/Library/LaunchAgents/com.kizuki.daemon.plist` and call `launchctl load`. On Linux, install `~/.config/systemd/user/kizuki.service`, then call `systemctl --user daemon-reload` and `systemctl --user enable --now kizuki.service`. Uninstall and restart use the matching platform commands. Inject platform, home, file operations, and command execution in tests.

`daemonStatus` reads config, calls authenticated `GET /v1/health`, and returns `{ running, url, detail }`. It reports connection refusal as stopped and rethrows config or protocol errors.

- [ ] **Step 4: Run lifecycle and API tests**

Run: `node --test lib/daemonService.test.mjs server/api.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/cli.mjs lib/daemonService.mjs lib/daemonService.test.mjs
git commit -m "feat(daemon): manage local service lifecycle"
```

### Task 6: CLI API client, capture, and daemon commands

**Files:**
- Create: `lib/platformApiClient.mjs`
- Create: `lib/platformApiClient.test.mjs`
- Create: `lib/captureCommands.mjs`
- Create: `lib/captureCommands.test.mjs`
- Create: `lib/daemonCommands.mjs`
- Create: `lib/daemonCommands.test.mjs`
- Modify: `kizuki`

**Interfaces:**
- Produces: `makePlatformApiClient(config, options)`, `parseCaptureArgs(argv)`, `runCaptureCommand(vaultDir, argv, options)`, and `runDaemonCommand(vaultDir, repoDir, argv, options)`.

- [ ] **Step 1: Write failing client and command tests**

```js
test("capture command sends one capability request", async () => {
  const calls = [];
  const output = await runCaptureCommand("/vault", [
    "Ship API", "--kind", "decision", "--project", "kizuki",
  ], {
    randomUUID: () => "11111111-1111-4111-8111-111111111111",
    makeClient: async () => ({
      capture: async (input, options) => {
        calls.push([input, options]);
        return { disposition: "created", event: EVENT };
      },
    }),
  });
  assert.equal(calls[0][0].entity.name, "kizuki");
  assert.equal(calls[0][1].idempotencyKey, "cli-11111111-1111-4111-8111-111111111111");
  assert.equal(output, `Captured ${EVENT.aggregate.id} [decision]`);
});

test("daemon status never prints token", async () => {
  const text = await runDaemonCommand("/vault", "/repo", ["status"], {
    status: async () => ({ running: true, url: "http://127.0.0.1:4247", detail: "ok" }),
  });
  assert.equal(text, "Kizuki daemon running at http://127.0.0.1:4247");
});
```

- [ ] **Step 2: Run tests and observe failure**

Run: `node --test lib/platformApiClient.test.mjs lib/captureCommands.test.mjs lib/daemonCommands.test.mjs`

Expected: FAIL with missing modules.

- [ ] **Step 3: Implement clients and wire CLI**

`makePlatformApiClient` adds bearer auth, parses `{ data }` and `{ error }`, throws errors with API codes, and exposes `health()`, `capture(input, { idempotencyKey })`, and `listCaptures({ limit })`.

Split repository location from vault location in `kizuki`: derive `repoDir` from
`import.meta.url`, and use `resolve(process.env.KIZUKI_VAULT)` when that variable
is present. Keep repository-owned paths, including `server/cli.mjs`, based on
`repoDir`. This seam enables isolated tests without writing to the real vault.

Add these CLI forms:

```text
kizuki daemon install|uninstall|restart|status|run
kizuki capture "<text>" [--kind note|correction|decision|hypothesis|question]
  [--person <name> | --project <name> | --team <name>]
```

`daemon install` calls `ensureDaemonConfig` before installing. `daemon run` runs the server in the foreground for development and does not install an OS service. Reject unknown flags, missing values, conflicting entity scopes, and empty text.

- [ ] **Step 4: Run focused and root tests**

Run: `node --test lib/platformApiClient.test.mjs lib/captureCommands.test.mjs lib/daemonCommands.test.mjs`

Expected: PASS.

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add kizuki lib/platformApiClient.mjs lib/platformApiClient.test.mjs lib/captureCommands.mjs lib/captureCommands.test.mjs lib/daemonCommands.mjs lib/daemonCommands.test.mjs
git commit -m "feat(cli): add daemon and capture commands"
```

### Task 7: MCP capture adapter

**Files:**
- Modify: `mcp/tools.mjs`
- Modify: `mcp/tools.test.mjs`
- Modify: `mcp/server.mjs`
- Modify: `mcp/server.integration.mjs`

**Interfaces:**
- Consumes: `makePlatformApiClient` and daemon config.
- Produces: `captureContextTool(vaultDir, input, options)` and MCP tool `capture_context`.

- [ ] **Step 1: Write failing tool tests**

```js
test("capture_context delegates to authenticated platform API", async () => {
  const calls = [];
  const text = await captureContextTool("/vault", {
    kind: "question",
    text: "Who owns the rollout?",
    entity: { type: "project", name: "kizuki" },
  }, {
    idempotencyKey: "mcp-1",
    makeClient: async () => ({
      capture: async (input, options) => {
        calls.push([input, options]);
        return { disposition: "created", event: EVENT };
      },
    }),
  });
  assert.equal(calls.length, 1);
  assert.equal(text, `Captured ${EVENT.aggregate.id} [question]`);
});
```

- [ ] **Step 2: Run MCP tests and observe failure**

Run: `node --test mcp/tools.test.mjs mcp/server.integration.mjs`

Expected: FAIL because `captureContextTool` and `capture_context` do not exist.

- [ ] **Step 3: Implement MCP adapter**

Register `capture_context` with a strict Zod schema. Accept `kind`, `text`, and optional `{ type, name }` entity. Generate an `mcp-<uuid>` idempotency key. Mark the tool `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true`, and `openWorldHint: false`.

Keep existing MCP tools working. Do not migrate existing insight or analysis tools in this task.

- [ ] **Step 4: Run MCP and root tests**

Run: `node --test mcp/tools.test.mjs mcp/server.integration.mjs`

Expected: PASS.

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp/tools.mjs mcp/tools.test.mjs mcp/server.mjs mcp/server.integration.mjs
git commit -m "feat(mcp): add context capture adapter"
```

### Task 8: Writable web evidence canvas

**Files:**
- Create: `web/lib/api.mjs`
- Create: `web/lib/api.test.mjs`
- Create: `web/app/(dashboard)/capture/page.tsx`
- Create: `web/app/(dashboard)/capture/actions.ts`
- Modify: `web/app/(dashboard)/layout.tsx`
- Modify: `web/app/globals.css`

**Interfaces:**
- Consumes: daemon config and platform API client.
- Produces: `captureFromWeb(vaultDir, input, options)` and `/capture` dashboard route.

- [ ] **Step 1: Write failing web API tests**

```js
test("captureFromWeb uses a web idempotency key", async () => {
  const calls = [];
  const result = await captureFromWeb("/vault", {
    kind: "correction",
    text: "Launch date changed.",
  }, {
    randomUUID: () => "11111111-1111-4111-8111-111111111111",
    makeClient: async () => ({
      capture: async (input, options) => {
        calls.push([input, options]);
        return { disposition: "created", event: EVENT };
      },
    }),
  });
  assert.equal(calls[0][1].idempotencyKey, "web-11111111-1111-4111-8111-111111111111");
  assert.equal(result.event.aggregate.id, EVENT.aggregate.id);
});
```

- [ ] **Step 2: Run test and observe failure**

Run: `node --test web/lib/api.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement API adapter, action, and page**

The server action accepts `FormData`, validates kind, text, and optional entity type/name, calls `captureFromWeb`, and redirects to `/capture?captured=<captureId>`. It must not accept principal, workspace, source owner, Pack grants, or arbitrary visibility fields.

The page renders a textarea, kind select, optional entity type and name fields, submit button, success message, and a short statement that captures stay private in this first slice. Demo mode renders the form disabled. Add a Capture link to dashboard navigation. Add visible focus, error, disabled, and success styles without changing the existing visual system.

- [ ] **Step 4: Run web checks**

Run: `node --test web/lib/api.test.mjs`

Expected: PASS.

Run: `npm run typecheck --prefix web`

Expected: PASS.

Run: `npm run build --prefix web`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/api.mjs web/lib/api.test.mjs web/app/'(dashboard)'/capture/page.tsx web/app/'(dashboard)'/capture/actions.ts web/app/'(dashboard)'/layout.tsx web/app/globals.css
git commit -m "feat(web): add evidence capture canvas"
```

### Task 9: Init, doctor, and usage documentation

**Files:**
- Modify: `lib/doctor.mjs`
- Modify: `lib/doctor.test.mjs`
- Modify: `lib/init.mjs`
- Modify: `lib/init.test.mjs`
- Modify: `README.md`

**Interfaces:**
- Consumes: daemon config and daemon status.
- Produces: initialized `events/` storage, secure daemon config, and doctor checks named `daemon-config` and `daemon-health`.

- [ ] **Step 1: Write failing init and doctor tests**

```js
test("init creates event storage and daemon config", async () => {
  const vaultDir = await makeVault();
  const result = await runInit(vaultDir, {
    ensureDaemonConfig: async () => ({ host: "127.0.0.1", port: 4247, token: "x".repeat(32) }),
  });
  assert.ok(result.created.includes("events"));
  assert.ok(await isDirectory(join(vaultDir, "events")));
});

test("doctor reports stopped daemon without exposing token", async () => {
  const results = [];
  for await (const result of runDoctor(vaultDir, {
    ...DOCTOR_OPTIONS,
    readDaemonConfig: async () => VALID_CONFIG,
    daemonStatus: async () => ({ running: false, url: "http://127.0.0.1:4247", detail: "connection refused" }),
  })) results.push(result);
  assert.deepEqual(results.find((r) => r.name === "daemon-health"), {
    name: "daemon-health", status: "fail", detail: "connection refused",
  });
  assert.doesNotMatch(JSON.stringify(results), new RegExp(VALID_CONFIG.token));
});
```

- [ ] **Step 2: Run tests and observe failure**

Run: `node --test lib/init.test.mjs lib/doctor.test.mjs`

Expected: FAIL because init and doctor do not know the daemon.

- [ ] **Step 3: Extend init, doctor, and README**

Add `events` to required local directories. `runInit` ensures daemon config but does not start or install the service. Update the init report with `kizuki daemon install`, `kizuki daemon status`, and `kizuki capture` steps.

Doctor validates daemon config and probes health. `--check-only` must not create config or start the daemon. `--no-smoke` still controls only the model smoke test.

Document local architecture, daemon commands, API address behavior, CLI capture, MCP `capture_context`, web `/capture`, token secrecy, and uninstall instructions in `README.md`.

- [ ] **Step 4: Run focused and full validation**

Run: `node --test lib/init.test.mjs lib/doctor.test.mjs`

Expected: PASS.

Run: `npm test`

Expected: PASS.

Run: `npm run typecheck --prefix web`

Expected: PASS.

Run: `npm run build --prefix web`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/doctor.mjs lib/doctor.test.mjs lib/init.mjs lib/init.test.mjs README.md
git commit -m "docs: wire daemon setup and diagnostics"
```

### Task 10: End-to-end local proof

**Files:**
- Create: `server/local.integration.test.mjs`
- Modify: `docs/ROADMAP.md`

**Interfaces:**
- Consumes: complete foundation slice.
- Produces: one automated proof that starts an ephemeral server, captures through the API client, reads the canonical JSONL event, and observes the capture through the list endpoint.

- [ ] **Step 1: Write the end-to-end test**

```js
test("local API round-trips one private capture", async (t) => {
  const vaultDir = await makeVault();
  const running = await listenApiServer({
    vaultDir,
    host: "127.0.0.1",
    port: 0,
    token: VALID_CONFIG.token,
  });
  t.after(() => running.close());
  const client = makePlatformApiClient({ ...VALID_CONFIG, port: running.port });
  const created = await client.capture({ kind: "note", text: "Round trip." }, {
    idempotencyKey: "integration-1",
  });
  assert.equal(created.event.visibility.scope, "private");
  assert.equal((await readPlatformEvents(vaultDir)).length, 1);
  assert.equal((await client.listCaptures({ limit: 10 })).length, 1);
});
```

- [ ] **Step 2: Run the test and fix only integration defects**

Run: `node --test server/local.integration.test.mjs`

Expected: PASS. If it fails, change only the smallest module whose contract does not match the focused tests, then rerun that module's tests and this integration test.

- [ ] **Step 3: Update roadmap status without rewriting product history**

Add a new platform-foundation section to `docs/ROADMAP.md`. Record the authenticated local daemon, canonical capture events, API clients, and writable capture page as shipped only after the commands below pass. Keep hosted PostgreSQL, OAuth connectors, Pack manifests, teams, billing, and enterprise deployment listed as subsequent plans.

- [ ] **Step 4: Run final verification**

Run:

```bash
npm test
npm test --prefix mcp
npm run typecheck --prefix web
npm run build --prefix web
git diff --check
```

Expected: every command exits `0`. Verify `git status --short` contains no generated `events/`, `state/daemon.json`, `.next/`, or token-bearing file.

- [ ] **Step 5: Commit**

```bash
git add server/local.integration.test.mjs docs/ROADMAP.md
git commit -m "test: prove local platform capture flow"
```

## Completion gate

Run a fresh local smoke test in a temporary vault rather than the user's real vault:

```bash
tmp="$(mktemp -d)"
KIZUKI_VAULT="$tmp" node ./kizuki init --agent codex
node ./server/cli.mjs --vault "$tmp"
```

In another terminal, use a test-only command invocation pointed at that vault to run `kizuki daemon status` and `kizuki capture "Foundation smoke test" --kind note`. Stop the foreground daemon, confirm `events/events.jsonl` contains one event, and delete the temporary directory. Never print `state/daemon.json`.
