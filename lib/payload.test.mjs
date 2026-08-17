// lib/payload.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePayload, extractJsonBlock, trimAlerts, finalizePayload, parseCheckPayload } from "./payload.mjs";

const wrap = (obj) => "here you go:\n```json\n" + JSON.stringify(obj) + "\n```\ndone";

const alertV3 = (over = {}) => ({
  severity: "warn",
  kind: "contradiction",
  type: "project",
  name: "staff",
  topic: "uat-date",
  evidence: "Two sources report different UAT dates.",
  draft: "Can we confirm the UAT date?",
  receipts: [{
    source: "slack",
    locator: "C123:1752084000.000100",
    observedAt: "2026-07-09T18:00:00Z",
    excerpt: "UAT is July 17.",
  }],
  ...over,
});

const checkC = (over = {}) => ({
  severity: "warn",
  entity: { type: "project", name: "checkout" },
  draftClaim: "guest checkout ships Friday",
  conflict: "guest checkout was cut from scope",
  evidence: "project/checkout: field dropped in redesign",
  ...over,
});

test("parseCheckPayload parses a valid block", () => {
  const r = parseCheckPayload(wrap({ contradictions: [checkC()] }));
  assert.equal(r.contradictions.length, 1);
  assert.equal(r.contradictions[0].entity.name, "checkout");
});

test("parseCheckPayload accepts empty contradictions", () => {
  assert.deepEqual(parseCheckPayload(wrap({ contradictions: [] })).contradictions, []);
});

test("parseCheckPayload rejects a bad severity", () => {
  assert.throws(() => parseCheckPayload(wrap({ contradictions: [checkC({ severity: "info" })] })), /severity/);
});

test("parseCheckPayload rejects a bad entity type", () => {
  assert.throws(() => parseCheckPayload(wrap({ contradictions: [checkC({ entity: { type: "org", name: "x" } })] })), /type/);
});

test("parseCheckPayload rejects an unsafe entity name", () => {
  assert.throws(() => parseCheckPayload(wrap({ contradictions: [checkC({ entity: { type: "project", name: "../etc" } })] })), /name/);
});

test("parseCheckPayload rejects a missing field", () => {
  assert.throws(() => parseCheckPayload(wrap({ contradictions: [checkC({ conflict: undefined })] })), /conflict/);
});

test("parseCheckPayload throws when contradictions is not an array", () => {
  assert.throws(() => parseCheckPayload(wrap({ contradictions: {} })), /contradictions/);
});

test("extractJsonBlock reads a fenced block", () => {
  assert.equal(extractJsonBlock("```json\n{\"a\":1}\n```"), '{"a":1}');
});

test("extractJsonBlock picks the LAST fence", () => {
  const s = "```json\n{\"a\":1}\n```\ntext\n```json\n{\"a\":2}\n```";
  assert.equal(extractJsonBlock(s), '{"a":2}');
});

test("extractJsonBlock falls back to raw braces", () => {
  assert.equal(extractJsonBlock('noise {"a":1} tail'), '{"a":1}');
});

test("extractJsonBlock throws when no json", () => {
  assert.throws(() => extractJsonBlock("nothing here"), /no JSON/);
});

test("parsePayload parses a valid payload", () => {
  const p = parsePayload(wrap({ entities: [{ type: "person", name: "bob", rawEntries: [], analysis: {} }], consumedTranscripts: ["m.txt"] }));
  assert.equal(p.entities.length, 1);
  assert.deepEqual(p.consumedTranscripts, ["m.txt"]);
});

test("parsePayload defaults missing arrays", () => {
  const p = parsePayload(wrap({ entities: [{ type: "team", name: "platform" }] }));
  assert.deepEqual(p.entities[0].rawEntries, []);
  assert.deepEqual(p.entities[0].analysis.followUps, []);
  assert.deepEqual(p.entities[0].analysis.recommendedActions, []);
  assert.deepEqual(p.consumedTranscripts, []);
  assert.deepEqual(p.alerts, []);
});

test("parsePayload throws on bad entity type", () => {
  assert.throws(() => parsePayload(wrap({ entities: [{ type: "robot", name: "x" }] })), /invalid entity type/);
});

test("parsePayload throws on missing entities", () => {
  assert.throws(() => parsePayload(wrap({ nope: true })), /entities/);
});

test("parsePayload throws on invalid json", () => {
  assert.throws(() => parsePayload("```json\n{bad}\n```"), /valid JSON/);
});

test("parsePayload throws on path-traversal entity name", () => {
  assert.throws(
    () => parsePayload(wrap({ entities: [{ type: "person", name: "../../tmp/pwned" }] })),
    /invalid.*name/i,
  );
});

test("parsePayload throws on entity name containing a slash", () => {
  assert.throws(
    () => parsePayload(wrap({ entities: [{ type: "person", name: "a/b" }] })),
    /invalid.*name/i,
  );
});

test("parsePayload accepts a normal kebab-case name", () => {
  const p = parsePayload(wrap({ entities: [{ type: "person", name: "bob-smith" }] }));
  assert.equal(p.entities[0].name, "bob-smith");
});

test("parsePayload accepts version 1", () => {
  const data = parsePayload(wrap({ version: 1, entities: [] }));
  assert.deepEqual(data.entities, []);
  assert.deepEqual(data.alerts, []);
});

test("parsePayload accepts version 2 with alerts", () => {
  const data = parsePayload(wrap({
    version: 2,
    entities: [],
    alerts: [{
      severity: "info",
      kind: "mention",
      type: "person",
      name: "bob",
      evidence: "Slack @bob with no reply.",
    }],
  }));
  assert.equal(data.alerts.length, 1);
  assert.match(data.alerts[0].topic, /^legacy-[0-9a-f]{12}$/);
  assert.equal(data.alerts[0].receipts[0].source, "legacy-v2");
  assert.equal(data.warnings.length, 1);
  assert.match(data.warnings[0], /version 2/i);
});

test("version 2 identity follows exact evidence and warns once per sync", () => {
  const legacy = (evidence) => ({
    severity: "warn",
    kind: "blocker",
    type: "project",
    name: "staff",
    evidence,
  });
  const first = parsePayload(wrap({ version: 2, entities: [], alerts: [legacy("Blocked."), legacy("Still blocked.")] }));
  const repeat = parsePayload(wrap({ version: 2, entities: [], alerts: [legacy("Blocked.")] }));
  assert.equal(first.warnings.length, 1);
  assert.equal(first.alerts[0].topic, repeat.alerts[0].topic);
  assert.notEqual(first.alerts[0].topic, first.alerts[1].topic);
});

test("parsePayload accepts version 3 signal candidates", () => {
  const data = parsePayload(wrap({ version: 3, entities: [], alerts: [alertV3()] }));
  assert.equal(data.version, 3);
  assert.deepEqual(data.alerts, [alertV3()]);
  assert.deepEqual(data.warnings, []);
});

test("parsePayload validates v3 topics and receipts", () => {
  assert.throws(
    () => parsePayload(wrap({ version: 3, entities: [], alerts: [alertV3({ topic: "UAT date" })] })),
    /topic/,
  );
  assert.throws(
    () => parsePayload(wrap({ version: 3, entities: [], alerts: [alertV3({ receipts: [] })] })),
    /receipt/,
  );
  assert.throws(
    () => parsePayload(wrap({ version: 3, entities: [], alerts: [alertV3({ receipts: [{ ...alertV3().receipts[0], source: "legacy-alert" }] })] })),
    /source/,
  );
  assert.throws(
    () => parsePayload(wrap({ version: 3, entities: [], alerts: [alertV3({ receipts: [{ ...alertV3().receipts[0], observedAt: "yesterday" }] })] })),
    /observedAt/,
  );
  assert.throws(
    () => parsePayload(wrap({ version: 3, entities: [], alerts: [alertV3({ receipts: [{ ...alertV3().receipts[0], excerpt: "" }] })] })),
    /excerpt/,
  );
});

test("parsePayload rejects unsafe v3 locators", () => {
  for (const locator of [
    "https://example.com/message?token=secret",
    "https://example.com/message#reply",
    "//user:pass@example.com/message",
    "X-Amz-Signature=secret",
  ]) {
    assert.throws(
      () => parsePayload(wrap({ version: 3, entities: [], alerts: [alertV3({ receipts: [{ ...alertV3().receipts[0], locator }] })] })),
      /locator|credential|signed/,
    );
  }
});

test("parsePayload rejects clear in v3", () => {
  assert.throws(
    () => parsePayload(wrap({ version: 3, entities: [], alerts: [alertV3({ kind: "clear" })] })),
    /kind/,
  );
});

test("parsePayload ignores v2 clear with one warning", () => {
  const data = parsePayload(wrap({
    version: 2,
    entities: [],
    alerts: [{
      severity: "info",
      kind: "clear",
      type: "project",
      name: "kizuki",
      evidence: "No cross-team alignment signals this run.",
    }],
  }));
  assert.deepEqual(data.alerts, []);
  assert.equal(data.warnings.length, 1);
  assert.match(data.warnings[0], /clear.*ignored/i);
});

test("parsePayload rejects invalid alert enums", () => {
  assert.throws(
    () => parsePayload(wrap({
      version: 2,
      entities: [],
      alerts: [{ severity: "urgent", kind: "blocker", type: "person", name: "bob", evidence: "x" }],
    })),
    /invalid alert severity/,
  );
});

test("parsePayload rejects alerts with unsafe names", () => {
  assert.throws(
    () => parsePayload(wrap({
      version: 2,
      entities: [],
      alerts: [{ severity: "warn", kind: "blocker", type: "person", name: "../x", evidence: "x" }],
    })),
    /invalid alert name/,
  );
});

test("parsePayload accepts a payload without a version field", () => {
  const data = parsePayload(wrap({ entities: [] }));
  assert.deepEqual(data.entities, []);
  assert.deepEqual(data.alerts, []);
});

test("parsePayload rejects unsupported versions loudly", () => {
  assert.throws(
    () => parsePayload(wrap({ version: 4, entities: [] })),
    /payload version 4 not supported \(expected 1, 2, or 3\)/
  );
  assert.throws(
    () => parsePayload(wrap({ version: "1", entities: [] })),
    /payload version "1" not supported \(expected 1, 2, or 3\)/
  );
});

test("trimAlerts keeps the three highest-severity alerts", () => {
  const alerts = [
    { severity: "info", kind: "mention", type: "person", name: "a", evidence: "i1" },
    { severity: "critical", kind: "blocker", type: "project", name: "b", evidence: "c1" },
    { severity: "warn", kind: "deadline", type: "team", name: "c", evidence: "w1" },
    { severity: "info", kind: "mention", type: "person", name: "d", evidence: "i2" },
  ];
  const trimmed = trimAlerts(alerts);
  assert.equal(trimmed.length, 3);
  assert.equal(trimmed[0].severity, "critical");
  assert.equal(trimmed[1].severity, "warn");
});

test("finalizePayload strips entity follow-ups when an alert covers that entity", () => {
  const data = finalizePayload({
    entities: [{
      type: "project",
      name: "staff",
      rawEntries: [{ source: "slack", text: "x" }],
      analysis: { status: "risky", followUps: ["ask cole"], recommendedActions: [{ action: "ping", draft: "hi" }] },
    }],
    alerts: [{ severity: "warn", kind: "contradiction", type: "project", name: "staff", evidence: "UAT mismatch" }],
    consumedTranscripts: [],
  });
  assert.deepEqual(data.entities[0].analysis.followUps, []);
  assert.deepEqual(data.entities[0].analysis.recommendedActions, []);
});

test("finalizePayload allows one entity-local follow-up when no alert covers the entity", () => {
  const data = finalizePayload({
    entities: [{
      type: "person",
      name: "bob",
      rawEntries: [],
      analysis: { followUps: ["local dm", "extra"], recommendedActions: [{ action: "x", draft: "y" }] },
    }],
    alerts: [],
    consumedTranscripts: [],
  });
  assert.deepEqual(data.entities[0].analysis.followUps, ["local dm"]);
  assert.deepEqual(data.entities[0].analysis.recommendedActions, []);
});

test("finalizePayload does not persist an all-clear signal", () => {
  const data = finalizePayload({
    entities: [{ type: "person", name: "bob", rawEntries: [], analysis: {} }],
    alerts: [],
    consumedTranscripts: [],
  });
  assert.deepEqual(data.alerts, []);
});
