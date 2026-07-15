import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  archiveInsightTool,
  captureContextTool,
  captureInsightTool,
  listInsightsTool,
  readInsightTool,
  upsertAnalysis,
  readEntity,
  listEntities,
  listFollowups,
  search,
} from "./tools.mjs";

async function makeVault() {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-mcp-"));
  for (const d of ["people", "projects", "teams", "transcripts"]) await mkdir(join(dir, d), { recursive: true });
  return dir;
}

const FIXED = new Date("2026-07-09T20:00:00Z");
const LATER = new Date("2026-07-09T21:00:00Z");
const INSIGHT = {
  kind: "learning",
  summary: "Per-FC manifests drive lookup.",
  context: "Backend resolves each FC separately.",
  entities: [{ type: "project", name: "staff" }],
  origin: { client: "codex" },
};
const EVENT = {
  version: 1,
  eventId: "evt_11111111-1111-4111-8111-111111111111",
  type: "capture.recorded",
  at: "2026-07-14T12:00:00.000Z",
  workspaceId: "personal",
  principalId: "local-operator",
  sourceOwnerId: "local-operator",
  visibility: { scope: "private", principalIds: ["local-operator"] },
  packIds: [],
  receipts: [],
  idempotencyKey: "mcp-1",
  aggregate: { type: "capture", id: "cap_22222222-2222-4222-8222-222222222222", version: 1 },
  payload: { kind: "question", text: "Who owns the rollout?", entity: { type: "project", name: "kizuki" } },
};

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

test("capture_context defaults to an mcp-<uuid> idempotency key and passes vaultDir", async () => {
  const seen = [];
  const calls = [];
  const text = await captureContextTool("/vault", { kind: "note", text: "A thought" }, {
    randomUUID: () => "11111111-1111-4111-8111-111111111111",
    makeClient: async (vaultDir) => {
      seen.push(vaultDir);
      return {
        capture: async (input, options) => {
          calls.push([input, options]);
          return {
            disposition: "created",
            event: { ...EVENT, payload: { ...EVENT.payload, kind: "note" } },
          };
        },
      };
    },
  });
  assert.deepEqual(seen, ["/vault"]);
  assert.equal(calls[0][1].idempotencyKey, "mcp-11111111-1111-4111-8111-111111111111");
  assert.equal(calls[0][0].kind, "note");
  assert.equal(calls[0][0].entity, null);
  assert.equal(text, `Captured ${EVENT.aggregate.id} [note]`);
});

test("upsertAnalysis creates a person file and splices the managed section", async () => {
  const v = await makeVault();
  const res = await upsertAnalysis(v, {
    type: "person", name: "priya-shah",
    rawEntries: [{ source: "slack", timestamp: "t1", text: "blocked on schema" }],
    analysis: { status: "blocked", needs: "schema" },
  });
  const file = await readFile(join(v, "people", "priya-shah.md"), "utf8");
  assert.match(file, /type: person/);
  assert.match(file, /\*\*Status:\*\* blocked/);
  assert.match(file, /blocked on schema/);
  assert.match(res, /priya-shah/);
});

test("upsertAnalysis is idempotent — no duplicate log lines on re-run", async () => {
  const v = await makeVault();
  const entity = { type: "person", name: "bob", rawEntries: [{ source: "slack", timestamp: "t", text: "hi" }], analysis: { status: "ok" } };
  await upsertAnalysis(v, entity);
  await upsertAnalysis(v, entity);
  const file = await readFile(join(v, "people", "bob.md"), "utf8");
  assert.equal((file.match(/hi/g) || []).length, 1);
});

test("upsertAnalysis preserves hand-notes outside the markers", async () => {
  const v = await makeVault();
  await upsertAnalysis(v, { type: "person", name: "bob", analysis: { status: "one" } });
  const path = join(v, "people", "bob.md");
  let c = await readFile(path, "utf8");
  await writeFile(path, c.replace("<!-- KIZUKI:ANALYSIS:START -->", "> HANDNOTE keep me\n<!-- KIZUKI:ANALYSIS:START -->"));
  await upsertAnalysis(v, { type: "person", name: "bob", analysis: { status: "two" } });
  const after = await readFile(path, "utf8");
  assert.match(after, /HANDNOTE keep me/);
  assert.match(after, /\*\*Status:\*\* two/);
});

test("upsertAnalysis rejects path-unsafe names", async () => {
  const v = await makeVault();
  await assert.rejects(upsertAnalysis(v, { type: "person", name: "../../etc/passwd", analysis: {} }), /invalid.*name/i);
});

test("upsertAnalysis rejects invalid type", async () => {
  const v = await makeVault();
  await assert.rejects(upsertAnalysis(v, { type: "robot", name: "x", analysis: {} }), /type/i);
});

test("readEntity returns file content and rejects bad names", async () => {
  const v = await makeVault();
  await upsertAnalysis(v, { type: "project", name: "billing", analysis: { status: "in progress" } });
  const c = await readEntity(v, "project", "billing");
  assert.match(c, /in progress/);
  await assert.rejects(readEntity(v, "project", "../x"), /invalid.*name/i);
  await assert.rejects(readEntity(v, "project", "missing"), /not found/i);
});

test("listEntities lists entities with one-line status", async () => {
  const v = await makeVault();
  await upsertAnalysis(v, { type: "person", name: "priya", analysis: { status: "blocked" } });
  await upsertAnalysis(v, { type: "project", name: "billing", analysis: { status: "in progress" } });
  const all = await listEntities(v);
  assert.match(all, /person\/priya/);
  assert.match(all, /blocked/);
  assert.match(all, /project\/billing/);
  const onlyPeople = await listEntities(v, "person");
  assert.match(onlyPeople, /priya/);
  assert.doesNotMatch(onlyPeople, /billing/);
});

test("listFollowups aggregates follow-ups across entities", async () => {
  const v = await makeVault();
  await upsertAnalysis(v, { type: "person", name: "priya", analysis: { status: "x", followUps: ["confirm refunds scope"] } });
  await upsertAnalysis(v, { type: "project", name: "billing", analysis: { status: "x", followUps: ["name a schema owner"] } });
  const f = await listFollowups(v);
  assert.match(f, /confirm refunds scope/);
  assert.match(f, /name a schema owner/);
  assert.match(f, /priya/);
});

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

test("search finds a term across the vault", async () => {
  const v = await makeVault();
  await upsertAnalysis(v, { type: "person", name: "priya", analysis: { status: "blocked on refunds field" } });
  const r = await search(v, "refunds");
  assert.match(r, /priya/);
  assert.match(r, /refunds/);
  const none = await search(v, "zzzznotthere");
  assert.match(none, /no matches/i);
});

test("MCP insight tools capture, dedupe, list, read, and archive", async () => {
  const v = await makeVault();
  const first = await captureInsightTool(v, INSIGHT, { now: FIXED });
  const retry = await captureInsightTool(v, INSIGHT, { now: LATER });
  assert.match(first, /^Captured ins_[0-9a-f]{12} \[learning\] active$/);
  assert.doesNotMatch(first, /Per-FC|Backend/);
  assert.match(retry, /^Existing ins_[0-9a-f]{12} \[learning\] active \(exact-repeat\)$/);
  const insightId = first.match(/ins_[0-9a-f]{12}/)[0];

  assert.match(await listInsightsTool(v, {}), new RegExp(insightId));
  assert.match(await readInsightTool(v, { insightId }), /Per-FC manifests/);
  const archived = await archiveInsightTool(v, {
    insightId,
    note: "absorbed",
  }, { now: LATER });
  assert.equal(archived, insightId + " active -> archived");
  assert.doesNotMatch(archived, /absorbed|Per-FC/);
  assert.equal(await listInsightsTool(v, {}), "No insights.");
  assert.match(await listInsightsTool(v, { status: "archived" }), /archived/);
});

test("MCP insight tools reject unknown fields through core validation", async () => {
  const v = await makeVault();
  await assert.rejects(
    captureInsightTool(v, { ...INSIGHT, fullChat: "secret" }, { now: FIXED }),
    /unknown insight field/,
  );
});

test("search includes active insight summary and context but excludes archived", async () => {
  const v = await makeVault();
  const first = await captureInsightTool(v, INSIGHT, { now: FIXED });
  const insightId = first.match(/ins_[0-9a-f]{12}/)[0];
  assert.match(await search(v, "manifests"), new RegExp("insight/" + insightId));
  assert.match(await search(v, "separately"), new RegExp("insight/" + insightId));
  await archiveInsightTool(v, { insightId }, { now: LATER });
  assert.doesNotMatch(await search(v, "manifests"), /insight\/ins_/);
});
