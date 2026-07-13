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
