import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, PAYLOAD_SHAPE, buildCheckPrompt, CHECK_PAYLOAD_SHAPE } from "./prompt.mjs";

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
  assert.match(p, /Pull recent work activity ONLY from these sources: slack, github\./);
  assert.doesNotMatch(p, /Pull recent work activity ONLY from these sources:.*outlook/);
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

test("prompt contract declares payload version 3", () => {
  const prompt = buildPrompt({ scope: { kind: "all" }, sources: ["slack"], vaultDir: "/v" });
  assert.match(prompt, /"version": 3/);
});

test("prompt includes alerts in the contract", () => {
  assert.ok(Array.isArray(PAYLOAD_SHAPE.alerts));
  assert.match(PAYLOAD_SHAPE.alerts[0].severity, /info.*warn.*critical/);
  const prompt = buildPrompt({ scope: { kind: "all" }, sources: ["slack"], vaultDir: "/v" });
  assert.match(prompt, /"alerts"/);
  assert.match(prompt, /contradiction/);
  assert.match(prompt, /"topic"/);
  assert.match(prompt, /"receipts"/);
  assert.match(prompt, /slack.*github.*atlassian.*outlook.*transcript/i);
  assert.match(prompt, /query strings, fragments, credentials, or signed parameters/i);
});

test("prompt requires stable topics and receipts without persisted all-clear", () => {
  const prompt = buildPrompt({ scope: { kind: "all" }, sources: ["slack"], vaultDir: "/v" });
  assert.match(prompt, /topic.*lowercase kebab-case/i);
  assert.match(prompt, /at least one receipt/i);
  assert.match(prompt, /return alerts: \[\]/i);
  assert.doesNotMatch(prompt, /pipeline may add an all-clear/i);
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

test("prompt tells alert drafts to ask when evidence is contested", () => {
  const p = buildPrompt({ scope: { kind: "all" }, sources: ["slack"], vaultDir: "/v" });
  assert.match(p, /If evidence is contested or incomplete/);
  assert.match(p, /ask for confirmation/);
});

test("buildCheckPrompt embeds the draft and requests the check shape", () => {
  const p = buildCheckPrompt({ draft: "We ship guest checkout Friday.", scope: { kind: "all" }, vaultDir: "/v" });
  assert.match(p, /We ship guest checkout Friday\./);
  assert.match(p, /contradictions/);
  assert.match(p, /draftClaim/);
  assert.match(p, /\/v/);
  assert.match(p, /source of truth/i);
});

test("buildCheckPrompt honors project scope", () => {
  const p = buildCheckPrompt({ draft: "x", scope: { kind: "project", name: "checkout" }, vaultDir: "/v" });
  assert.match(p, /project "checkout"/);
});

test("buildCheckPrompt treats too-narrow scoped context as an evidence gap", () => {
  const p = buildCheckPrompt({
    draft: "I am checking the STAFF UI, backend, and terraform PRs.",
    scope: { kind: "person", name: "aniket-sinha" },
    vaultDir: "/v",
    vaultContext: "## person/aniket-sinha\nNo project-wide PR status here.",
  });
  assert.match(p, /If the scoped context is too narrow/);
  assert.match(p, /warn contradiction/);
  assert.match(p, /evidence gap/);
});

test("buildCheckPrompt allows supplemental included context for scoped checks", () => {
  const p = buildCheckPrompt({
    draft: "I am checking STAFF PRs.",
    scope: { kind: "person", name: "aniket-sinha" },
    vaultDir: "/v",
    vaultContext: "## person/aniket-sinha\n...\n\n## project/staff\n...",
  });
  assert.match(p, /person "aniket-sinha"/);
  assert.match(p, /also consider any other entity sections included/);
});

test("buildCheckPrompt treats approval asks as stale when context says merged", () => {
  const p = buildCheckPrompt({ draft: "I am checking the approval asks.", scope: { kind: "all" }, vaultDir: "/v" });
  assert.match(p, /approval asks/);
  assert.match(p, /merged, landed, approved, or complete/);
});

test("CHECK_PAYLOAD_SHAPE has contradictions with the locked fields", () => {
  const c = CHECK_PAYLOAD_SHAPE.contradictions[0];
  assert.ok("severity" in c && "entity" in c && "draftClaim" in c && "conflict" in c && "evidence" in c);
});

test("sync prompt preserves epistemic labels for captured insights", () => {
  const p = buildPrompt({
    scope: { kind: "project", name: "staff" },
    sources: ["slack"],
    vaultDir: "/v",
    insightContext: "## Captured insights\nins_123 hypothesis",
  });
  assert.match(p, /ins_123 hypothesis/);
  assert.match(p, /Decisions.*user intent/i);
  assert.match(p, /hypotheses.*unverified/i);
  assert.match(p, /rawEntry.*source "insight"/i);
  assert.match(p, /cannot support.*signal/i);
});

test("check prompt treats captured hypotheses as evidence gaps", () => {
  const p = buildCheckPrompt({
    draft: "One global pointer is correct.",
    scope: { kind: "project", name: "staff" },
    vaultDir: "/v",
    vaultContext: "## Captured insights\nkind: hypothesis",
  });
  assert.match(p, /must not treat.*hypotheses.*fact/i);
  assert.match(p, /evidence gap/i);
});
