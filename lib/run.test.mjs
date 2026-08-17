// lib/run.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSync } from "./run.mjs";
import { captureInsight } from "./insightCommands.mjs";

const EMPTY_PAYLOAD = "```json\n" + JSON.stringify({ entities: [], consumedTranscripts: [] }) + "\n```";

const signal = (over = {}) => ({
  severity: "warn",
  kind: "blocker",
  type: "project",
  name: "staff",
  topic: "inbound-schema",
  evidence: "Inbound schema still missing.",
  receipts: [{
    source: "slack",
    locator: "C123:1752084000.000100",
    observedAt: "2026-07-09T18:00:00Z",
    excerpt: "Inbound schema is missing.",
  }],
  ...over,
});

async function makeVault() {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-run-"));
  for (const d of ["people", "projects", "teams", "transcripts"]) await mkdir(join(dir, d), { recursive: true });
  return dir;
}

test("runSync builds prompt, applies payload, returns summary", async () => {
  const v = await makeVault();
  let seenPrompt = "";
  const fakeCodex = async (prompt) => {
    seenPrompt = prompt;
    return "```json\n" + JSON.stringify({
      entities: [{ type: "person", name: "bob", rawEntries: [{ source: "slack", timestamp: "t", text: "hi" }], analysis: { status: "ok" } }],
      consumedTranscripts: [],
    }) + "\n```";
  };

  const result = await runSync({ argv: ["bob", "--source", "slack"], vaultDir: v, runAgent: fakeCodex });

  assert.match(seenPrompt, /bob/);
  assert.match(seenPrompt, /slack/);
  assert.deepEqual(result.sources, ["slack"]);
  assert.equal(result.changes.length, 1);
  const file = await readFile(join(v, "people", "bob.md"), "utf8");
  assert.match(file, /\*\*Status:\*\* ok/);
});

test("runSync notifies for surfaced v2 compatibility alerts", async () => {
  const v = await makeVault();
  const notified = [];
  const fakeCodex = async () => "```json\n" + JSON.stringify({
    version: 2,
    entities: [{ type: "person", name: "bob", rawEntries: [], analysis: {} }],
    consumedTranscripts: [],
    alerts: [
      { severity: "info", kind: "mention", type: "person", name: "bob", evidence: "quiet" },
      { severity: "warn", kind: "blocker", type: "project", name: "staff", evidence: "blocked" },
    ],
  }) + "\n```";

  const result = await runSync({
    argv: [],
    vaultDir: v,
    runAgent: fakeCodex,
    notify: (alerts) => notified.push(...alerts),
  });

  assert.equal(notified.length, 2);
  assert.equal(notified[0].severity, "warn");
  assert.equal(notified[1].severity, "info");
  assert.equal(result.signalChanges.length, 2);
  assert.equal(result.warnings.length, 1);
});

test("runSync returns v3 signal changes and notifies surfaced candidates", async () => {
  const v = await makeVault();
  const notified = [];
  const fakeCodex = async () => "```json\n" + JSON.stringify({
    version: 3,
    entities: [],
    consumedTranscripts: [],
    alerts: [signal()],
  }) + "\n```";
  const result = await runSync({
    argv: [],
    vaultDir: v,
    runAgent: fakeCodex,
    notify: (alerts) => notified.push(...alerts),
  });
  assert.deepEqual(notified, [signal()]);
  assert.equal(result.signalChanges.length, 1);
  assert.deepEqual(result.warnings, []);
});

test("runSync dry-run writes nothing", async () => {
  const v = await makeVault();
  const fakeCodex = async () => "```json\n" + JSON.stringify({ entities: [{ type: "team", name: "plat", rawEntries: [], analysis: {} }], consumedTranscripts: [] }) + "\n```";
  const result = await runSync({ argv: ["--dry-run"], vaultDir: v, runAgent: fakeCodex });
  assert.equal(result.dryRun, true);
  assert.equal(result.changes.length, 1);
  await assert.rejects(readFile(join(v, "teams", "plat.md"), "utf8"));
});

test("runSync dry-run plans signals without notifying or writing runtime state", async () => {
  const v = await makeVault();
  let notifyCalls = 0;
  const fakeCodex = async () => "```json\n" + JSON.stringify({
    version: 3,
    entities: [],
    consumedTranscripts: [],
    alerts: [signal()],
  }) + "\n```";
  const result = await runSync({
    argv: ["--dry-run"],
    vaultDir: v,
    runAgent: fakeCodex,
    notify: () => { notifyCalls++; },
  });
  assert.equal(result.newAlerts.length, 1);
  assert.equal(result.signalChanges.length, 1);
  assert.equal(notifyCalls, 0);
  await assert.rejects(readFile(join(v, "signals", "events.jsonl"), "utf8"));
  await assert.rejects(readFile(join(v, "state", "vault.lock"), "utf8"));
});

test("runSync ignores v2 clear without notifying or persisting it", async () => {
  const v = await makeVault();
  const notified = [];
  const fakeCodex = async () => "```json\n" + JSON.stringify({
    version: 2,
    entities: [],
    consumedTranscripts: [],
    alerts: [{
      severity: "info",
      kind: "clear",
      type: "project",
      name: "kizuki",
      evidence: "No cross-team alignment signals this run.",
    }],
  }) + "\n```";
  const result = await runSync({
    argv: [],
    vaultDir: v,
    runAgent: fakeCodex,
    notify: (alerts) => notified.push(...alerts),
  });
  assert.deepEqual(result.newAlerts, []);
  assert.deepEqual(result.signalChanges, []);
  assert.equal(result.warnings.length, 1);
  assert.deepEqual(notified, []);
  await assert.rejects(readFile(join(v, "signals", "events.jsonl"), "utf8"));
});

test("runSync preserves v2 compatibility when draft is blank", async () => {
  const v = await makeVault();
  const fakeCodex = async () => "```json\n" + JSON.stringify({
    version: 2,
    entities: [],
    consumedTranscripts: [],
    alerts: [{
      severity: "warn",
      kind: "blocker",
      type: "project",
      name: "staff",
      evidence: "Inbound schema is missing.",
      draft: "",
    }],
  }) + "\n```";
  const result = await runSync({ argv: [], vaultDir: v, runAgent: fakeCodex, notify: () => {} });
  assert.equal(result.newAlerts.length, 1);
  assert.equal(result.newAlerts[0].draft, undefined);
  assert.equal(result.signalChanges.length, 1);
});

test("runSync injects only scoped active insights without changing payload version", async () => {
  const v = await makeVault();
  const staff = await captureInsight(v, {
    kind: "hypothesis",
    summary: "Per-FC manifests may be required.",
    entities: [{ type: "project", name: "staff" }],
    origin: { client: "codex" },
  });
  await captureInsight(v, {
    kind: "question",
    summary: "Who owns Zipcar validation?",
    entities: [{ type: "project", name: "zipcar" }],
    origin: { client: "cursor" },
  });
  let seenPrompt = "";
  const fakeCodex = async (prompt) => {
    seenPrompt = prompt;
    return "```json\n" + JSON.stringify({
      version: 3,
      entities: [],
      consumedTranscripts: [],
      alerts: [],
    }) + "\n```";
  };

  await runSync({
    argv: ["--project", "staff", "--dry-run"],
    vaultDir: v,
    runAgent: fakeCodex,
  });

  assert.match(seenPrompt, new RegExp(staff.insightId));
  assert.match(seenPrompt, /Per-FC manifests may be required/);
  assert.doesNotMatch(seenPrompt, /Who owns Zipcar validation/);
  assert.match(seenPrompt, /hypotheses.*unverified/i);
  assert.match(seenPrompt, /source "insight"/i);
  assert.match(seenPrompt, /cannot support.*signal/i);
  assert.match(seenPrompt, /"version": 3/);
});

test("http agent rejects MCP sources", async () => {
  const vault = await makeVault();
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
    runAgent: async (p) => { prompt = p; return EMPTY_PAYLOAD; },
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
