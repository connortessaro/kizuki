import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readShift, startShift, endShift, readLastStop, recordStop, renderBrief } from "./shift.mjs";

test("shift flag lifecycle", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vigil-s-"));
  assert.equal(await readShift(dir), null);
  await startShift(dir, new Date("2026-07-06T09:00:00Z"));
  assert.deepEqual(await readShift(dir), { started: "2026-07-06T09:00:00.000Z" });
  await endShift(dir);
  assert.equal(await readShift(dir), null);
  await endShift(dir); // idempotent — no throw
});

test("last-stop record lifecycle", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vigil-s-"));
  assert.equal(await readLastStop(dir), null);
  await recordStop(dir, new Date("2026-07-06T17:00:00Z"));
  assert.deepEqual(await readLastStop(dir), { stopped: "2026-07-06T17:00:00.000Z" });
});

const ENTITY = `---
type: person
name: maya
---

# maya

## Log

<!-- VIGIL:ANALYSIS:START -->
**Status:** busy
**Follow-ups:**
- chase creds
<!-- VIGIL:ANALYSIS:END -->
`;

async function seedEntity(dir, rel, content, mtime) {
  await mkdir(join(dir, rel, ".."), { recursive: true });
  await writeFile(join(dir, rel), content, "utf8");
  if (mtime) await utimes(join(dir, rel), mtime, mtime);
}

test("renderBrief without baseline lists all entities and follow-ups", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vigil-b-"));
  await seedEntity(dir, "people/maya.md", ENTITY);
  const brief = await renderBrief(dir, new Date("2026-07-06T09:00:00Z"));
  assert.match(brief, /# Vigil brief — 2026-07-06/);
  assert.match(brief, /## Changed since last shift/);
  assert.match(brief, /- person\/maya/);
  assert.match(brief, /## Open follow-ups/);
  assert.match(brief, /- person\/maya: \[follow-up\] chase creds/);
});

test("renderBrief with baseline only lists entities modified after last stop", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vigil-b-"));
  await seedEntity(dir, "people/old.md", ENTITY.replaceAll("maya", "old"), new Date("2026-07-01T00:00:00Z"));
  await seedEntity(dir, "people/fresh.md", ENTITY.replaceAll("maya", "fresh"), new Date("2026-07-06T08:00:00Z"));
  await recordStop(dir, new Date("2026-07-05T17:00:00Z"));
  const brief = await renderBrief(dir, new Date("2026-07-06T09:00:00Z"));
  const [changedSection] = brief.split("## Open follow-ups");
  assert.doesNotMatch(changedSection, /- person\/old/);
  assert.match(brief, /- person\/fresh/);
});
