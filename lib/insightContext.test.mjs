import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archiveInsight, captureInsight } from "./insightCommands.mjs";
import {
  activeInsightsForScope,
  formatInsightContext,
  searchActiveInsights,
} from "./insightContext.mjs";

const FIXED = new Date("2026-07-09T20:00:00Z");
const LATER = new Date("2026-07-09T21:00:00Z");

async function makeVault() {
  return mkdtemp(join(tmpdir(), "kizuki-insight-context-"));
}

function insight(overrides = {}) {
  return {
    kind: "hypothesis",
    summary: "Per-FC manifest may be required.",
    context: "Backend lookup resolves one FC.",
    entities: [{ type: "project", name: "staff" }],
    origin: { client: "codex" },
    ...overrides,
  };
}

test("scope selection includes matching active insights and all scope includes unscoped", async () => {
  const vault = await makeVault();
  const staff = await captureInsight(vault, insight(), { now: FIXED });
  await captureInsight(vault, insight({
    kind: "question",
    summary: "Who owns Zipcar validation?",
    context: null,
    entities: [{ type: "project", name: "zipcar" }],
    origin: { client: "cursor" },
  }), { now: LATER });
  await captureInsight(vault, insight({
    kind: "learning",
    summary: "Unscoped operating note.",
    context: null,
    entities: [],
  }), { now: new Date("2026-07-09T22:00:00Z") });

  const scoped = await activeInsightsForScope(vault, { kind: "project", name: "staff" });
  assert.deepEqual(scoped.map((state) => state.insightId), [staff.insightId]);
  const all = await activeInsightsForScope(vault, { kind: "all" });
  assert.equal(all.length, 3);
  assert.equal(all[0].summary, "Unscoped operating note.");
});

test("archived insights are excluded from selection and search", async () => {
  const vault = await makeVault();
  const captured = await captureInsight(vault, insight(), { now: FIXED });
  assert.equal((await searchActiveInsights(vault, "manifest")).length, 1);
  assert.equal((await searchActiveInsights(vault, "backend")).length, 1);
  await archiveInsight(vault, { insightId: captured.insightId }, { now: LATER });
  assert.equal((await activeInsightsForScope(vault, { kind: "all" })).length, 0);
  assert.equal((await searchActiveInsights(vault, "manifest")).length, 0);
});

test("formatInsightContext preserves fields in JSON", async () => {
  const vault = await makeVault();
  const captured = await captureInsight(vault, insight(), { now: FIXED });
  const states = await activeInsightsForScope(vault, { kind: "all" });
  const formatted = formatInsightContext(states);
  assert.match(formatted, /^## Captured insights/);
  assert.match(formatted, /\x60\x60\x60json/);
  assert.match(formatted, new RegExp(captured.insightId));
  assert.match(formatted, /"kind": "hypothesis"/);
  assert.match(formatted, /"context": "Backend lookup resolves one FC\."/);
  assert.equal(formatInsightContext([]), "");
});

test("scope and search validation fail loudly", async () => {
  const vault = await makeVault();
  await assert.rejects(
    activeInsightsForScope(vault, { kind: "robot", name: "staff" }),
    /invalid type/,
  );
  await assert.rejects(
    activeInsightsForScope(vault, { kind: "project", name: "../staff" }),
    /invalid entity name/,
  );
  await assert.rejects(searchActiveInsights(vault, ""), /query is required/);
});

test("malformed ledger blocks selection and search", async () => {
  const vault = await makeVault();
  await mkdir(join(vault, "insights"), { recursive: true });
  await writeFile(join(vault, "insights", "events.jsonl"), "{bad}\n", "utf8");
  await assert.rejects(
    activeInsightsForScope(vault, { kind: "all" }),
    /events\.jsonl:1:/,
  );
  await assert.rejects(searchActiveInsights(vault, "manifest"), /events\.jsonl:1:/);
});
