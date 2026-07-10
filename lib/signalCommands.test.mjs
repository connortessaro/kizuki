import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatAlertLine } from "./alerts.mjs";
import {
  planSignalIngestion,
  planSignalTransition,
  readSignalEvents,
  reduceSignalEvents,
  signalIdentity,
  writeSignalEventsAtomic,
} from "./signals.mjs";
import { runSignalCommand, runSignalsCommand } from "./signalCommands.mjs";

const NOW = new Date("2026-07-09T18:00:00Z");
const exists = (path) => access(path).then(() => true, () => false);

const receipt = (over = {}) => ({
  source: "slack",
  locator: "C123:1752084000.000100",
  observedAt: "2026-07-09T17:55:00Z",
  excerpt: "UAT is July 17.",
  ...over,
});

const candidate = (over = {}) => ({
  severity: "warn",
  kind: "contradiction",
  type: "project",
  name: "staff",
  topic: "uat-date",
  evidence: "Two sources report different UAT dates.",
  draft: "Can we confirm the UAT date?",
  receipts: [receipt()],
  ...over,
});

async function vault() {
  return mkdtemp(join(tmpdir(), "kizuki-signal-commands-"));
}

async function seed(vaultDir, specs) {
  let events = [];
  for (const [index, spec] of specs.entries()) {
    const at = new Date(NOW.getTime() + index * 60_000);
    const planned = planSignalIngestion(events, [spec.candidate], { now: at });
    events.push(...planned.events);
    if (spec.status && spec.status !== "open") {
      const transition = planSignalTransition(
        events,
        {
          signalId: signalIdentity(spec.candidate).signalId,
          to: spec.status,
          ...(spec.status === "dismissed" ? { reason: "stale" } : {}),
        },
        { now: new Date(at.getTime() + 30_000) },
      );
      events.push(transition);
    }
  }
  await writeSignalEventsAtomic(vaultDir, events);
  return events;
}

test("signals defaults to active states and sorts open before acted", async () => {
  const v = await vault();
  const openInfo = candidate({ severity: "info", topic: "open-info" });
  const actedCritical = candidate({ severity: "critical", topic: "acted-critical" });
  const openCritical = candidate({ severity: "critical", topic: "open-critical" });
  const resolved = candidate({ topic: "resolved" });
  await seed(v, [
    { candidate: openInfo },
    { candidate: actedCritical, status: "acted" },
    { candidate: openCritical },
    { candidate: resolved, status: "resolved" },
  ]);

  const output = await runSignalsCommand(v, []);
  const ids = output.split("\n").filter(Boolean).map((line) => line.split(" ")[0]);
  assert.deepEqual(ids, [
    signalIdentity(openCritical).signalId,
    signalIdentity(openInfo).signalId,
    signalIdentity(actedCritical).signalId,
  ]);
  assert.doesNotMatch(output, new RegExp(signalIdentity(resolved).signalId));
});

test("signals supports status filters and JSON", async () => {
  const v = await vault();
  const open = candidate({ topic: "open" });
  const dismissed = candidate({ topic: "dismissed" });
  await seed(v, [{ candidate: open }, { candidate: dismissed, status: "dismissed" }]);

  const dismissedJson = JSON.parse(await runSignalsCommand(v, ["--status", "dismissed", "--json"]));
  assert.equal(dismissedJson.length, 1);
  assert.equal(dismissedJson[0].status, "dismissed");
  const allJson = JSON.parse(await runSignalsCommand(v, ["--status", "all", "--json"]));
  assert.equal(allJson.length, 2);
});

test("signal show JSON includes reduced state and event history", async () => {
  const v = await vault();
  const alert = candidate();
  await seed(v, [{ candidate: alert, status: "acted" }]);
  const id = signalIdentity(alert).signalId;
  const shown = JSON.parse(await runSignalCommand(v, ["show", id, "--json"]));
  assert.equal(shown.signalId, id);
  assert.equal(shown.status, "acted");
  assert.equal(shown.history.length, 2);
  assert.equal(shown.history[0].event, "observed");
});

test("signal commands reject invalid syntax and unknown IDs", async () => {
  const v = await vault();
  await assert.rejects(runSignalsCommand(v, ["--status", "wat"]), /status/);
  await assert.rejects(runSignalsCommand(v, ["--wat"]), /unknown option/);
  await assert.rejects(runSignalCommand(v, ["show"]), /requires.*id/i);
  await assert.rejects(runSignalCommand(v, ["show", "bad-id"]), /invalid signal ID/);
  await assert.rejects(runSignalCommand(v, ["show", "sig_000000000000"]), /unknown signal/);
  await assert.rejects(runSignalCommand(v, ["invented", "sig_000000000000"]), /unknown signal command/);
});

test("manual commands enforce lifecycle rules and keep mutation output safe", async () => {
  const v = await vault();
  const alert = candidate();
  await seed(v, [{ candidate: alert }]);
  const id = signalIdentity(alert).signalId;

  const acted = await runSignalCommand(v, ["act", id, "--note", "Sent the alignment question."], { now: NOW });
  assert.match(acted, new RegExp(`${id}.*open.*acted`));
  assert.doesNotMatch(acted, /UAT|C123|receipt/i);
  await assert.rejects(runSignalCommand(v, ["act", id], { now: NOW }), /cannot transition/);
  await assert.rejects(runSignalCommand(v, ["dismiss", id], { now: NOW }), /reason/);
  await assert.rejects(runSignalCommand(v, ["dismiss", id, "--reason", "because"], { now: NOW }), /reason/);

  const dismissed = await runSignalCommand(
    v,
    ["dismiss", id, "--reason", "not-actionable", "--note", "No owner action exists."],
    { now: new Date("2026-07-09T18:01:00Z") },
  );
  assert.match(dismissed, /acted.*dismissed/);
  const state = reduceSignalEvents(await readSignalEvents(v)).get(id);
  assert.equal(state.status, "dismissed");
  const history = await readSignalEvents(v);
  assert.equal(history.at(-1).reason, "not-actionable");
  assert.equal(history.at(-1).note, "No owner action exists.");
  await assert.rejects(
    runSignalCommand(v, ["resolve", id], { now: new Date("2026-07-09T18:02:00Z") }),
    /cannot transition/,
  );
});

test("signal mutations honor the vault lock", async () => {
  const v = await vault();
  const alert = candidate();
  await seed(v, [{ candidate: alert }]);
  await mkdir(join(v, "state"), { recursive: true });
  await writeFile(join(v, "state", "vault.lock"), JSON.stringify({ pid: 4242, tool: "sync", startedAt: "x" }));
  await assert.rejects(
    runSignalCommand(v, ["act", signalIdentity(alert).signalId], {
      now: NOW,
      lock: { waitMs: 20, pollMs: 5, pidAlive: () => true },
    }),
    /vault locked by sync/,
  );
});

function legacyAlert(over = {}) {
  return {
    severity: "warn",
    kind: "blocker",
    type: "project",
    name: "staff",
    evidence: "Inbound schema still missing.",
    ...over,
  };
}

async function writeLegacy(vaultDir, date, lines) {
  await mkdir(join(vaultDir, "alerts"), { recursive: true });
  await writeFile(join(vaultDir, "alerts", `${date}.md`), `${lines.join("\n")}\n`, "utf8");
}

test("migration dry-run reports grouping and clear skips without writes", async () => {
  const v = await vault();
  const line = formatAlertLine(legacyAlert());
  await writeLegacy(v, "2026-07-01", [line, "  ```", "  Ask for the schema.", "  ```", formatAlertLine(legacyAlert({ severity: "info", kind: "clear", name: "kizuki", evidence: "All clear." }))]);
  await writeLegacy(v, "2026-07-02", [line]);

  const report = await runSignalsCommand(v, ["migrate-alerts", "--dry-run"], { now: NOW, returnResult: true });
  assert.deepEqual(report, {
    dryRun: true,
    files: 2,
    candidateAlerts: 2,
    uniqueSignals: 1,
    skippedClear: 1,
    alreadyImportedReceipts: 0,
    newReceipts: 2,
    eventsWritten: 2,
  });
  assert.equal(await exists(join(v, "signals")), false);
  assert.equal(await exists(join(v, "state")), false);
});

test("migration imports grouped signals as resolved history and is idempotent", async () => {
  const v = await vault();
  const line = formatAlertLine(legacyAlert());
  await writeLegacy(v, "2026-07-01", [line]);
  await writeLegacy(v, "2026-07-02", [line]);
  const beforeAlerts = await readFile(join(v, "alerts", "2026-07-01.md"), "utf8");

  const first = await runSignalsCommand(v, ["migrate-alerts"], { now: NOW, returnResult: true });
  assert.equal(first.eventsWritten, 2);
  const events = await readSignalEvents(v);
  const states = [...reduceSignalEvents(events).values()];
  assert.equal(states.length, 1);
  assert.equal(states[0].status, "resolved");
  assert.equal(states[0].receipts.length, 2);
  assert.match(states[0].topic, /^legacy-[0-9a-f]{12}$/);
  assert.equal(states[0].receipts[0].locator, "alerts/2026-07-01.md:1");
  assert.equal(states[0].receipts[0].observedAt, "2026-07-01T00:00:00Z");
  assert.equal(events[1].actor, "system");
  assert.equal(events[1].reason, "legacy-import");
  assert.equal(await readFile(join(v, "alerts", "2026-07-01.md"), "utf8"), beforeAlerts);

  const ledgerBefore = await readFile(join(v, "signals", "events.jsonl"), "utf8");
  const second = await runSignalsCommand(v, ["migrate-alerts"], { now: NOW, returnResult: true });
  assert.equal(second.alreadyImportedReceipts, 2);
  assert.equal(second.newReceipts, 0);
  assert.equal(second.eventsWritten, 0);
  assert.equal(await readFile(join(v, "signals", "events.jsonl"), "utf8"), ledgerBefore);
});

test("migration partial retry appends unseen receipts without reopening", async () => {
  const v = await vault();
  const line = formatAlertLine(legacyAlert());
  await writeLegacy(v, "2026-07-01", [line]);
  await runSignalsCommand(v, ["migrate-alerts"], { now: NOW });
  await writeLegacy(v, "2026-07-02", [line]);
  const result = await runSignalsCommand(v, ["migrate-alerts"], {
    now: new Date("2026-07-09T19:00:00Z"),
    returnResult: true,
  });
  assert.equal(result.alreadyImportedReceipts, 1);
  assert.equal(result.newReceipts, 1);
  assert.equal(result.eventsWritten, 1);
  const events = await readSignalEvents(v);
  const state = [...reduceSignalEvents(events).values()][0];
  assert.equal(state.status, "resolved");
  assert.equal(state.receipts.length, 2);
  assert.equal(events.at(-1).event, "observed");
});

test("migration accepts hyphenated legacy kinds and rejects malformed alert lines loudly", async () => {
  const v = await vault();
  await writeLegacy(v, "2026-07-01", [formatAlertLine(legacyAlert({ kind: "scope-change" }))]);
  const ok = await runSignalsCommand(v, ["migrate-alerts", "--dry-run"], { now: NOW, returnResult: true });
  assert.equal(ok.candidateAlerts, 1);

  await writeLegacy(v, "2026-07-02", ["- **[warn] broken line"]);
  await assert.rejects(
    runSignalsCommand(v, ["migrate-alerts", "--dry-run"], { now: NOW }),
    /alerts\/2026-07-02\.md:1/,
  );
});

test("migration keeps the physical alert line when an empty draft block follows", async () => {
  const v = await vault();
  await writeLegacy(v, "2026-07-01", [formatAlertLine(legacyAlert()), "  ```", "  ```"]);
  await runSignalsCommand(v, ["migrate-alerts"], { now: NOW });
  const state = [...reduceSignalEvents(await readSignalEvents(v)).values()][0];
  assert.equal(state.receipts[0].locator, "alerts/2026-07-01.md:1");
});
