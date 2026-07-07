// lib/payload.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePayload, extractJsonBlock } from "./payload.mjs";

const wrap = (obj) => "here you go:\n```json\n" + JSON.stringify(obj) + "\n```\ndone";

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
  assert.deepEqual(p.entities[0].analysis, {});
  assert.deepEqual(p.consumedTranscripts, []);
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
    () => parsePayload(wrap({ version: 3, entities: [] })),
    /payload version 3 not supported \(expected 1 or 2\)/
  );
  assert.throws(
    () => parsePayload(wrap({ version: "1", entities: [] })),
    /payload version "1" not supported \(expected 1 or 2\)/
  );
});
