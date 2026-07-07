import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANALYSIS_START, ANALYSIS_END, entityDir, entityPath,
  newEntityFile, spliceManagedSection, appendLog, renderAnalysis,
} from "./vault.mjs";

const FIXED = new Date("2026-06-30T12:00:00Z");

test("entityDir maps types", () => {
  assert.equal(entityDir("person"), "people");
  assert.equal(entityDir("project"), "projects");
  assert.equal(entityDir("team"), "teams");
});

test("entityPath builds path", () => {
  assert.equal(entityPath("/v", "person", "bob"), "/v/people/bob.md");
});

test("newEntityFile has markers, log heading, frontmatter", () => {
  const f = newEntityFile("person", "bob");
  assert.match(f, /type: person/);
  assert.match(f, /## Log/);
  assert.ok(f.includes(ANALYSIS_START) && f.includes(ANALYSIS_END));
});

test("spliceManagedSection replaces between markers, preserves the rest", () => {
  const content = `# Bob\n\nMY HAND NOTE\n\n${ANALYSIS_START}\nold\n${ANALYSIS_END}\n\nFOOTER\n`;
  const out = spliceManagedSection(content, "new body");
  assert.match(out, /MY HAND NOTE/);
  assert.match(out, /FOOTER/);
  assert.match(out, /new body/);
  assert.doesNotMatch(out, /old/);
});

test("spliceManagedSection appends when markers absent", () => {
  const out = spliceManagedSection("# Bob\n\nnotes\n", "body");
  assert.ok(out.includes(ANALYSIS_START) && out.includes("body") && out.includes(ANALYSIS_END));
  assert.match(out, /notes/);
});

test("appendLog inserts under the Log heading", () => {
  const out = appendLog("# Bob\n\n## Log\n\n- old entry\n", [
    { source: "slack", timestamp: "2026-06-30", text: "hi" },
  ]);
  assert.match(out, /- \*\*slack\*\* 2026-06-30: hi/);
  assert.match(out, /- old entry/);
});

test("appendLog creates heading when absent", () => {
  const out = appendLog("# Bob\n", [{ source: "github", timestamp: "t", text: "PR" }]);
  assert.match(out, /## Log/);
  assert.match(out, /\*\*github\*\* t: PR/);
});

test("appendLog no-op on empty", () => {
  assert.equal(appendLog("# Bob\n", []), "# Bob\n");
});

test("appendLog is idempotent on re-run with identical entry", () => {
  const entries = [{ source: "slack", timestamp: "2026-06-30", text: "hi" }];
  const once = appendLog("# Bob\n\n## Log\n", entries);
  const twice = appendLog(once, entries);
  const matches = twice.match(/- \*\*slack\*\* 2026-06-30: hi/g) ?? [];
  assert.equal(matches.length, 1);
});

test("appendLog still appends a new distinct entry when some entries already match", () => {
  const existing = [{ source: "slack", timestamp: "2026-06-30", text: "hi" }];
  const once = appendLog("# Bob\n\n## Log\n", existing);
  const twice = appendLog(once, [
    ...existing,
    { source: "github", timestamp: "2026-06-30", text: "opened PR" },
  ]);
  assert.equal((twice.match(/- \*\*slack\*\* 2026-06-30: hi/g) ?? []).length, 1);
  assert.match(twice, /- \*\*github\*\* 2026-06-30: opened PR/);
});

test("appendLog appends a distinct entry even when it is a prefix of an existing line", () => {
  const once = appendLog("# Bob\n\n## Log\n", [
    { source: "slack", timestamp: "2026-06-30", text: "hi there" },
  ]);
  const twice = appendLog(once, [
    { source: "slack", timestamp: "2026-06-30", text: "hi" },
  ]);
  assert.match(twice, /- \*\*slack\*\* 2026-06-30: hi there/);
  assert.match(twice, /- \*\*slack\*\* 2026-06-30: hi$/m);
});

test("renderAnalysis person fields, fixed date", () => {
  const body = renderAnalysis(
    { type: "person", name: "bob", analysis: {
      status: "busy", needs: "review", doesntKnow: "the deadline",
      followUps: ["ask about API"], recommendedActions: [{ action: "Slack Bob", draft: "Hey Bob" }],
    } },
    FIXED,
  );
  assert.match(body, /\*\*Status:\*\* busy/);
  assert.match(body, /\*\*Needs:\*\* review/);
  assert.match(body, /\*\*Doesn't know:\*\* the deadline/);
  assert.match(body, /- ask about API/);
  assert.match(body, /Slack Bob/);
  assert.match(body, /Hey Bob/);
  assert.match(body, /_Updated [A-Z][a-z]+ \d{1,2}, 2026, \d{1,2}:\d{2} [AP]M_/);
});

test("renderAnalysis project uses blockers/open questions", () => {
  const body = renderAnalysis(
    { type: "project", name: "x", analysis: { status: "green", blockers: "none", openQuestions: "scope?" } },
    FIXED,
  );
  assert.match(body, /\*\*Blockers:\*\* none/);
  assert.match(body, /\*\*Open questions:\*\* scope\?/);
});

test("renderAnalysis stamps Updated in month-day-year local time", () => {
  const md = renderAnalysis({ type: "person", name: "b", analysis: {} }, new Date(2026, 6, 4, 9, 32));
  assert.match(md, /_Updated July 4, 2026, 9:32 AM_/);
});
