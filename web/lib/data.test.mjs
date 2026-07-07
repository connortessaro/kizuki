import { test } from "node:test";
import assert from "node:assert";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseEntityFile, listByType, getEntity, followups, searchVault, listDays, readDay, formatDate,
  lastUpdated, formatDateTime,
} from "./data.mjs";

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

test("parseEntityFile splits frontmatter pairs and body", () => {
  const { frontmatter, body } = parseEntityFile("---\ntype: person\nrole: \"eng\"\n---\n\n# bob\n");
  assert.deepEqual(frontmatter, [["type", "person"], ["role", '"eng"']]);
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
    assert.ok(e.frontmatter.some(([k, v]) => k === "role" && v === '"eng"'));
    assert.match(e.body, /## Log/);
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
