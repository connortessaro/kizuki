import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatAlertLine, appendAlerts, parseAlertLine, parseAlertsWithDrafts } from "./alerts.mjs";

const FIXED = new Date("2026-07-07T15:00:00Z");

const sample = {
  severity: "critical",
  kind: "contradiction",
  type: "project",
  name: "staff",
  evidence: "Team A Jira says UAT July 10; Team B standup transcript says July 17.",
  draft: "Hi both — can we align on the inbound UAT date?",
};

test("formatAlertLine renders severity, kind, entity, and evidence", () => {
  assert.equal(
    formatAlertLine(sample),
    "- **[critical] contradiction** project/staff: Team A Jira says UAT July 10; Team B standup transcript says July 17.",
  );
});

test("appendAlerts creates the daily file and returns new alerts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-alerts-"));
  const added = await appendAlerts(dir, [sample], { now: FIXED });
  assert.equal(added.length, 1);
  const file = await readFile(join(dir, "alerts", "2026-07-07.md"), "utf8");
  assert.match(file, /\[critical\] contradiction/);
  assert.match(file, /Hi both — can we align/);
});

test("appendAlerts dedupes exact list lines", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-alerts-"));
  const first = await appendAlerts(dir, [sample], { now: FIXED });
  const second = await appendAlerts(dir, [sample], { now: FIXED });
  assert.equal(first.length, 1);
  assert.equal(second.length, 0);
  const file = await readFile(join(dir, "alerts", "2026-07-07.md"), "utf8");
  assert.equal(file.split("- **[critical]").length - 1, 1);
});

test("appendAlerts keeps a line that is only a prefix of an existing line", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-alerts-"));
  await mkdir(join(dir, "alerts"), { recursive: true });
  const longLine = formatAlertLine(sample);
  const short = { ...sample, evidence: "Team A Jira says UAT July 10;" };
  const shortLine = formatAlertLine(short);
  assert.ok(longLine.startsWith(shortLine.slice(0, 20)));
  await writeFile(join(dir, "alerts", "2026-07-07.md"), `${longLine}\n`, "utf8");
  const added = await appendAlerts(dir, [short], { now: FIXED });
  assert.equal(added.length, 1);
});

test("appendAlerts skips alerts without a draft block", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-alerts-"));
  const { draft, ...noDraft } = sample;
  const added = await appendAlerts(dir, [noDraft], { now: FIXED });
  assert.equal(added.length, 1);
  const file = await readFile(join(dir, "alerts", "2026-07-07.md"), "utf8");
  assert.doesNotMatch(file, /```/);
});

test("parseAlertLine round-trips formatAlertLine", () => {
  const line = formatAlertLine(sample);
  const parsed = parseAlertLine(line);
  assert.equal(parsed.severity, sample.severity);
  assert.equal(parsed.name, sample.name);
});

test("parseAlertsWithDrafts extracts draft blocks", () => {
  const content = `${formatAlertLine(sample)}\n  \`\`\`\n  ${sample.draft}\n  \`\`\`\n`;
  const alerts = parseAlertsWithDrafts(content);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].draft, sample.draft);
});
