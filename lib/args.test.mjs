// lib/args.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, VALID_SOURCES } from "./args.mjs";

test("no args -> all scope, all sources, no dry-run", () => {
  const r = parseArgs([]);
  assert.deepEqual(r.scope, { kind: "all" });
  assert.deepEqual(r.sources, VALID_SOURCES);
  assert.equal(r.dryRun, false);
});

test("positional arg -> person scope", () => {
  const r = parseArgs(["bob-smith"]);
  assert.deepEqual(r.scope, { kind: "person", name: "bob-smith" });
});

test("--source single", () => {
  assert.deepEqual(parseArgs(["--source", "slack"]).sources, ["slack"]);
});

test("--source comma list, deduped", () => {
  assert.deepEqual(parseArgs(["--source", "slack,github,slack"]).sources, ["slack", "github"]);
});

test("person + source together", () => {
  const r = parseArgs(["bob-smith", "--source", "slack"]);
  assert.deepEqual(r.scope, { kind: "person", name: "bob-smith" });
  assert.deepEqual(r.sources, ["slack"]);
});

test("--dry-run sets flag", () => {
  assert.equal(parseArgs(["--dry-run"]).dryRun, true);
});

test("unknown source throws", () => {
  assert.throws(() => parseArgs(["--source", "telegram"]), /unknown source/);
});

test("--source without value throws", () => {
  assert.throws(() => parseArgs(["--source"]), /requires a value/);
});

test("two people throws", () => {
  assert.throws(() => parseArgs(["bob", "alice"]), /only one person/);
});

test("unknown flag throws", () => {
  assert.throws(() => parseArgs(["--wat"]), /unknown flag/);
});
