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

test("project scope names the project", () => {
  const p = buildPrompt({ scope: { kind: "project", name: "staff" }, sources: ["slack"], vaultDir: "/v" });
  assert.match(p, /project "staff"/i);
});

test("team scope names the team", () => {
  const p = buildPrompt({ scope: { kind: "team", name: "checkout" }, sources: ["slack"], vaultDir: "/v" });
  assert.match(p, /team "checkout"/i);
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

test("prompt contract declares payload version 2", () => {
  const prompt = buildPrompt({ scope: { kind: "all" }, sources: ["slack"], vaultDir: "/v" });
  assert.match(prompt, /"version": 2/);
});

test("prompt includes alerts in the contract", () => {
  assert.ok(Array.isArray(PAYLOAD_SHAPE.alerts));
  const prompt = buildPrompt({ scope: { kind: "all" }, sources: ["slack"], vaultDir: "/v" });
  assert.match(prompt, /"alerts"/);
  assert.match(prompt, /contradiction/);
});

test("prompt frames personal alignment assistant and limits follow-up noise", () => {
  const p = buildPrompt({ scope: { kind: "all" }, sources: ["slack"], vaultDir: "/v" });
  assert.match(p, /personal alignment assistant/i);
  assert.match(p, /0–3 alerts/i);
  assert.match(p, /followUps: \[\]/);
  assert.match(p, /Default every entity to followUps: \[\]/);
});

test("prompt forbids inventing entities and relabeling sources", () => {
  const p = buildPrompt({ scope: { kind: "all" }, sources: ["slack"], vaultDir: "/v" });
  assert.match(p, /entities and alerts directly evidenced/);
  assert.match(p, /always use source "transcript"/);
});
