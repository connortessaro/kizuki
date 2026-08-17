import { test } from "node:test";
import assert from "node:assert/strict";
import { computeGateReport, renderGateReport } from "./gate.mjs";

const NOW = new Date(2026, 6, 15, 12);

const observed = (at) => ({ version: 1, event: "observed", signalId: "sig_0123456789ab", at });
const statusChanged = (at, to, actor = "user") => ({
  version: 1, event: "status_changed", signalId: "sig_0123456789ab", from: "open", to, at, actor,
});
const caughtAt = (at) => ({ version: 1, event: "caught", catchId: "cat_0123456789ab", at });
const capturedAt = (at) => ({ version: 1, event: "captured", insightId: "ins_0123456789ab", at });

test("computeGateReport buckets events into Monday-start weeks, newest first", () => {
  const report = computeGateReport({
    signalEvents: [
      observed("2026-07-14T10:00:00Z"),
      observed("2026-07-08T10:00:00Z"),
      statusChanged("2026-07-08T11:00:00Z", "acted"),
      statusChanged("2026-07-09T11:00:00Z", "dismissed"),
      statusChanged("2026-07-10T11:00:00Z", "resolved", "system"),
    ],
    catchEvents: [caughtAt("2026-07-08T12:00:00Z"), caughtAt("2026-07-14T12:00:00Z")],
    insightEvents: [capturedAt("2026-07-07T12:00:00Z")],
    now: NOW,
    weeks: 2,
  });
  assert.equal(report.weeks.length, 2);
  const [current, previous] = report.weeks;
  assert.equal(current.start, "2026-07-13");
  assert.equal(current.inProgress, true);
  assert.deepEqual(
    { fired: current.fired, catches: current.catches },
    { fired: 1, catches: 1 },
  );
  assert.equal(previous.start, "2026-07-06");
  assert.equal(previous.inProgress, false);
  assert.deepEqual(previous, {
    start: "2026-07-06",
    inProgress: false,
    fired: 1,
    acted: 1,
    dismissed: 1,
    resolved: 0,
    catches: 1,
    insights: 1,
  });
});

test("system status changes never count toward acted/dismissed/resolved", () => {
  const report = computeGateReport({
    signalEvents: [statusChanged("2026-07-08T11:00:00Z", "acted", "system")],
    now: NOW,
  });
  assert.equal(report.weeks[1].acted, 0);
});

test("verdicts count only full weeks", () => {
  const report = computeGateReport({
    signalEvents: [statusChanged("2026-07-14T11:00:00Z", "acted")],
    catchEvents: [caughtAt("2026-07-08T12:00:00Z")],
    now: NOW,
    weeks: 3,
  });
  assert.deepEqual(report.verdicts.v1ToV2, {
    criterion: ">=1 true catch/week",
    met: 1,
    fullWeeks: 2,
  });
  assert.deepEqual(report.verdicts.v2ToV3, {
    criterion: ">=1 acted signal/week",
    met: 0,
    fullWeeks: 2,
  });
});

test("computeGateReport rejects invalid weeks", () => {
  assert.throws(() => computeGateReport({ weeks: 0 }), /between 1 and 12/);
  assert.throws(() => computeGateReport({ weeks: Number("abc") }), /between 1 and 12/);
  assert.throws(() => computeGateReport({ weeks: 13 }), /between 1 and 12/);
});

test("renderGateReport prints weeks, verdicts, and the operator-judgment line", () => {
  const report = computeGateReport({
    catchEvents: [caughtAt("2026-07-08T12:00:00Z")],
    now: NOW,
    weeks: 2,
  });
  const text = renderGateReport(report);
  assert.match(text, /^Kizuki gate report — July 15, 2026/);
  assert.match(text, /Week of July 13, 2026 \(in progress\)/);
  assert.match(text, /Week of July 6, 2026\n/);
  assert.match(text, /true catches: 1 {2}insights captured: 0/);
  assert.match(text, /v1->v2: >=1 true catch\/week — met 1 of 1 full week\b/);
  assert.match(text, /v2->v3: >=1 acted signal\/week — met 0 of 1 full week\b/);
  assert.match(text, /operator judgment — not computed/);
});

test("renderGateReport reports no full weeks yet when weeks is 1", () => {
  const text = renderGateReport(computeGateReport({ now: NOW, weeks: 1 }));
  assert.match(text, /v1->v2: >=1 true catch\/week — no full weeks yet/);
});
