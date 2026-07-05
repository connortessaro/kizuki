import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { upsertAnalysis, readEntity, listEntities, listFollowups, search } from "./tools.mjs";

async function makeVault() {
  const dir = await mkdtemp(join(tmpdir(), "vigil-mcp-"));
  for (const d of ["people", "projects", "teams", "transcripts"]) await mkdir(join(dir, d), { recursive: true });
  return dir;
}

test("upsertAnalysis creates a person file and splices the managed section", async () => {
  const v = await makeVault();
  const res = await upsertAnalysis(v, {
    type: "person", name: "priya-shah",
    rawEntries: [{ source: "slack", timestamp: "t1", text: "blocked on schema" }],
    analysis: { status: "blocked", needs: "schema" },
  });
  const file = await readFile(join(v, "people", "priya-shah.md"), "utf8");
  assert.match(file, /type: person/);
  assert.match(file, /\*\*Status:\*\* blocked/);
  assert.match(file, /blocked on schema/);
  assert.match(res, /priya-shah/);
});

test("upsertAnalysis is idempotent — no duplicate log lines on re-run", async () => {
  const v = await makeVault();
  const entity = { type: "person", name: "bob", rawEntries: [{ source: "slack", timestamp: "t", text: "hi" }], analysis: { status: "ok" } };
  await upsertAnalysis(v, entity);
  await upsertAnalysis(v, entity);
  const file = await readFile(join(v, "people", "bob.md"), "utf8");
  assert.equal((file.match(/hi/g) || []).length, 1);
});

test("upsertAnalysis preserves hand-notes outside the markers", async () => {
  const v = await makeVault();
  await upsertAnalysis(v, { type: "person", name: "bob", analysis: { status: "one" } });
  const path = join(v, "people", "bob.md");
  let c = await readFile(path, "utf8");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path, c.replace("<!-- VIGIL:ANALYSIS:START -->", "> HANDNOTE keep me\n<!-- VIGIL:ANALYSIS:START -->"));
  await upsertAnalysis(v, { type: "person", name: "bob", analysis: { status: "two" } });
  const after = await readFile(path, "utf8");
  assert.match(after, /HANDNOTE keep me/);
  assert.match(after, /\*\*Status:\*\* two/);
});

test("upsertAnalysis rejects path-unsafe names", async () => {
  const v = await makeVault();
  await assert.rejects(upsertAnalysis(v, { type: "person", name: "../../etc/passwd", analysis: {} }), /invalid.*name/i);
});

test("upsertAnalysis rejects invalid type", async () => {
  const v = await makeVault();
  await assert.rejects(upsertAnalysis(v, { type: "robot", name: "x", analysis: {} }), /type/i);
});

test("readEntity returns file content and rejects bad names", async () => {
  const v = await makeVault();
  await upsertAnalysis(v, { type: "project", name: "billing", analysis: { status: "in progress" } });
  const c = await readEntity(v, "project", "billing");
  assert.match(c, /in progress/);
  await assert.rejects(readEntity(v, "project", "../x"), /invalid.*name/i);
  await assert.rejects(readEntity(v, "project", "missing"), /not found/i);
});

test("listEntities lists entities with one-line status", async () => {
  const v = await makeVault();
  await upsertAnalysis(v, { type: "person", name: "priya", analysis: { status: "blocked" } });
  await upsertAnalysis(v, { type: "project", name: "billing", analysis: { status: "in progress" } });
  const all = await listEntities(v);
  assert.match(all, /person\/priya/);
  assert.match(all, /blocked/);
  assert.match(all, /project\/billing/);
  const onlyPeople = await listEntities(v, "person");
  assert.match(onlyPeople, /priya/);
  assert.doesNotMatch(onlyPeople, /billing/);
});

test("listFollowups aggregates follow-ups across entities", async () => {
  const v = await makeVault();
  await upsertAnalysis(v, { type: "person", name: "priya", analysis: { status: "x", followUps: ["confirm refunds scope"] } });
  await upsertAnalysis(v, { type: "project", name: "billing", analysis: { status: "x", followUps: ["name a schema owner"] } });
  const f = await listFollowups(v);
  assert.match(f, /confirm refunds scope/);
  assert.match(f, /name a schema owner/);
  assert.match(f, /priya/);
});

test("search finds a term across the vault", async () => {
  const v = await makeVault();
  await upsertAnalysis(v, { type: "person", name: "priya", analysis: { status: "blocked on refunds field" } });
  const r = await search(v, "refunds");
  assert.match(r, /priya/);
  assert.match(r, /refunds/);
  const none = await search(v, "zzzznotthere");
  assert.match(none, /no matches/i);
});
