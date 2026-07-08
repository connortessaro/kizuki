import { test } from "node:test";
import assert from "node:assert";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import {
  parseEntityFile, listByType, getEntity, followups, searchVault, listDays, readDay, formatDate,
  lastUpdated, formatDateTime, alertsForDate, extractDraftsFromBody, listAlertDates, vaultDir,
} from "./data.mjs";
import { formatAlertLine } from "../../lib/alerts.mjs";

test("vaultDir resolves to demo-vault when KIZUKI_DEMO is set", () => {
  const savedVault = process.env.KIZUKI_VAULT;
  const savedDemo = process.env.KIZUKI_DEMO;
  try {
    delete process.env.KIZUKI_VAULT;
    process.env.KIZUKI_DEMO = "1";
    assert.match(vaultDir(), /web[/\\]demo-vault$/);
  } finally {
    if (savedVault === undefined) delete process.env.KIZUKI_VAULT;
    else process.env.KIZUKI_VAULT = savedVault;
    if (savedDemo === undefined) delete process.env.KIZUKI_DEMO;
    else process.env.KIZUKI_DEMO = savedDemo;
  }
});

test("KIZUKI_VAULT wins over KIZUKI_DEMO", () => {
  const savedVault = process.env.KIZUKI_VAULT;
  const savedDemo = process.env.KIZUKI_DEMO;
  try {
    process.env.KIZUKI_VAULT = "/tmp/explicit-vault";
    process.env.KIZUKI_DEMO = "1";
    assert.equal(vaultDir(), "/tmp/explicit-vault");
  } finally {
    if (savedVault === undefined) delete process.env.KIZUKI_VAULT;
    else process.env.KIZUKI_VAULT = savedVault;
    if (savedDemo === undefined) delete process.env.KIZUKI_DEMO;
    else process.env.KIZUKI_DEMO = savedDemo;
  }
});

test("committed demo-vault parses through the data helpers", async () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "demo-vault");
  const byType = await listByType(dir);
  assert.ok(byType.person.length > 0, "has people");
  assert.ok(byType.project.length > 0, "has projects");
  const fu = await followups(dir);
  assert.ok(fu.length > 0, "has follow-ups");
  const days = await listDays(dir);
  assert.ok(days.length > 0, "has day summaries");
  const alertDates = await listAlertDates(dir);
  assert.ok(alertDates.length > 0, "has alert dates");
  const alerts = await alertsForDate(dir, alertDates[0]);
  assert.ok(alerts.length > 0, "alerts parse");
});

async function emptyVault() {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-web-"));
  await mkdir(join(dir, "people"), { recursive: true });
  await mkdir(join(dir, "projects"), { recursive: true });
  await mkdir(join(dir, "teams"), { recursive: true });
  await mkdir(join(dir, "days"), { recursive: true });
  return dir;
}

async function makeVault() {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-web-"));
  await mkdir(join(dir, "people"), { recursive: true });
  await mkdir(join(dir, "projects"), { recursive: true });
  await mkdir(join(dir, "days"), { recursive: true });
  await writeFile(
    join(dir, "people", "bob-smith.md"),
    [
      "---", "type: person", "name: bob-smith", 'role: "eng"', 'team: "checkout"', 'manager: ""', "---",
      "", "# bob-smith", "", "## Log", "",
      "- **slack** 2026-07-04T10:00:00Z: shipped checkout fix", "",
      "<!-- KIZUKI:ANALYSIS:START -->",
      "**Status:** on track",
      "",
      "**Follow-ups:**",
      "- ask about sandbox creds",
      "<!-- KIZUKI:ANALYSIS:END -->", "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(join(dir, "days", "2026-07-04.md"), "# 2026-07-04 — day summary\n", "utf8");
  return dir;
}

test("parseEntityFile splits frontmatter pairs, strips quotes, keeps body", () => {
  const { frontmatter, body } = parseEntityFile("---\ntype: person\nrole: \"eng\"\nteam: 'checkout'\nmanager: \"\"\n---\n\n# bob\n");
  assert.deepEqual(frontmatter, [["type", "person"], ["role", "eng"], ["team", "checkout"], ["manager", ""]]);
  assert.equal(body, "\n# bob\n");
});

test("parseEntityFile without frontmatter returns whole content as body", () => {
  const { frontmatter, body } = parseEntityFile("# bob\n");
  assert.deepEqual(frontmatter, []);
  assert.equal(body, "# bob\n");
});

test("listByType groups entities with status", async () => {
  const dir = await makeVault();
  try {
    const byType = await listByType(dir);
    assert.deepEqual(byType.person, [{ name: "bob-smith", status: "on track" }]);
    assert.deepEqual(byType.project, []);
    assert.deepEqual(byType.team, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("getEntity returns parsed entity, null when missing, throws on unsafe name", async () => {
  const dir = await makeVault();
  try {
    const e = await getEntity(dir, "person", "bob-smith");
    assert.equal(e.name, "bob-smith");
    assert.ok(e.frontmatter.some(([k, v]) => k === "role" && v === "eng"));
    assert.match(e.body, /## Log/);
    assert.doesNotMatch(e.body, /KIZUKI:ANALYSIS/, "analysis markers stripped from rendered body");
    assert.match(e.body, /\*\*Status:\*\* on track/, "analysis content preserved");
    assert.equal(await getEntity(dir, "person", "nobody"), null);
    await assert.rejects(() => getEntity(dir, "person", "../etc"), /invalid entity name/);
    await assert.rejects(() => getEntity(dir, "company", "bob-smith"), /invalid type/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("followups returns structured groups", async () => {
  const dir = await makeVault();
  try {
    const groups = await followups(dir);
    assert.deepEqual(groups, [
      { type: "person", name: "bob-smith", followUps: ["ask about sandbox creds"], actions: [] },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("searchVault returns structured case-insensitive hits", async () => {
  const dir = await makeVault();
  try {
    const hits = await searchVault(dir, "CHECKOUT FIX");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].type, "person");
    assert.equal(hits[0].name, "bob-smith");
    assert.ok(hits[0].line > 0);
    assert.match(hits[0].text, /checkout fix/);
    assert.deepEqual(await searchVault(dir, "zzz-no-match"), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("listDays newest first; empty when days/ missing", async () => {
  const dir = await makeVault();
  try {
    await writeFile(join(dir, "days", "2026-07-05.md"), "# later\n", "utf8");
    await writeFile(join(dir, "days", "notes.md"), "not a day\n", "utf8");
    assert.deepEqual(await listDays(dir), ["2026-07-05", "2026-07-04"]);
    const empty = await mkdtemp(join(tmpdir(), "kizuki-empty-"));
    try {
      assert.deepEqual(await listDays(empty), []);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readDay returns content, null when missing, throws on bad date", async () => {
  const dir = await makeVault();
  try {
    assert.match(await readDay(dir, "2026-07-04"), /day summary/);
    assert.equal(await readDay(dir, "2026-01-01"), null);
    await assert.rejects(() => readDay(dir, "../secrets"), /invalid date/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("re-exports formatDate for pages", () => {
  assert.equal(formatDate("2026-07-04"), "July 4, 2026");
});

test("lastUpdated is null on an empty vault", async () => {
  const dir = await emptyVault();
  try {
    assert.equal(await lastUpdated(dir), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("lastUpdated returns the newest entity mtime", async () => {
  const dir = await emptyVault();
  try {
    const before = Date.now() - 1000;
    await writeFile(join(dir, "people", "bob.md"), "# bob\n", "utf8");
    const updated = await lastUpdated(dir);
    assert.ok(updated instanceof Date);
    assert.ok(updated.getTime() >= before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("re-exports formatDateTime for pages", () => {
  assert.equal(formatDateTime(new Date(2026, 6, 4, 9, 32)), "July 4, 2026, 9:32 AM");
});

test("alertsForDate parses alert files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-web-alerts-"));
  try {
    await mkdir(join(dir, "alerts"), { recursive: true });
    const alert = {
      severity: "warn",
      kind: "blocker",
      type: "project",
      name: "staff",
      evidence: "UAT mismatch",
      draft: "Can we align on UAT?",
    };
    await writeFile(
      join(dir, "alerts", "2026-07-07.md"),
      `${formatAlertLine(alert)}\n  \`\`\`\n  ${alert.draft}\n  \`\`\`\n`,
      "utf8",
    );
    const alerts = await alertsForDate(dir, "2026-07-07");
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].draft, alert.draft);
    assert.deepEqual(await listAlertDates(dir), ["2026-07-07"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("extractDraftsFromBody finds fenced blocks", () => {
  const body = "**Recommended actions:**\n\n```\nHi team — draft\n```\n";
  assert.deepEqual(extractDraftsFromBody(body), ["Hi team — draft"]);
});
