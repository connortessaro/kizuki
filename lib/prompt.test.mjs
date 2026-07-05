import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, PAYLOAD_SHAPE } from "./prompt.mjs";

test("person scope names the person and isolates them", () => {
  const p = buildPrompt({ scope: { kind: "person", name: "bob-smith" }, sources: ["slack"], vaultDir: "/v" });
  assert.match(p, /bob-smith/);
  assert.match(p, /ignore everyone else/i);
});

test("all scope processes everyone", () => {
  const p = buildPrompt({ scope: { kind: "all" }, sources: ["slack"], vaultDir: "/v" });
  assert.match(p, /all people, projects, and teams/i);
});

test("lists only the given sources", () => {
  const p = buildPrompt({ scope: { kind: "all" }, sources: ["slack", "github"], vaultDir: "/v" });
  assert.match(p, /slack, github/);
  assert.doesNotMatch(p, /outlook/);
});

test("prompt is agent-agnostic (no codex-specific config path or rovo mapping)", () => {
  const p = buildPrompt({ scope: { kind: "all" }, sources: ["atlassian"], vaultDir: "/v" });
  assert.doesNotMatch(p, /\.codex\/config\.toml/);
  assert.doesNotMatch(p, /rovo/i);
  assert.match(p, /configured MCP servers/i);
});

test("includes vault dir and the json contract", () => {
  const p = buildPrompt({ scope: { kind: "all" }, sources: ["slack"], vaultDir: "/my/vault" });
  assert.match(p, /\/my\/vault/);
  assert.match(p, /```json/);
  assert.match(p, /"entities"/);
  assert.match(p, /"consumedTranscripts"/);
});

test("PAYLOAD_SHAPE documents entity + analysis keys", () => {
  const e = PAYLOAD_SHAPE.entities[0];
  assert.ok(e.type && e.name && Array.isArray(e.rawEntries) && e.analysis);
  assert.ok("recommendedActions" in e.analysis);
});

test("prompt forbids inventing entities and relabeling sources", () => {
  const p = buildPrompt({ scope: { kind: "all" }, sources: ["slack"], vaultDir: "/v" });
  assert.match(p, /Only report entities directly evidenced/);
  assert.match(p, /always use source "transcript"/);
});
