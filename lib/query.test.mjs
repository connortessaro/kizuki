import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eachEntity, followupsByEntity, managedSection, bulletsUnder, TYPES, assertType, assertName, statusOf } from "./query.mjs";

async function vaultWith(files) {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-q-"));
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(join(dir, rel, ".."), { recursive: true });
    await writeFile(join(dir, rel), content, "utf8");
  }
  return dir;
}

const ENTITY = `---
type: person
name: maya
---

# maya

## Log

<!-- KIZUKI:ANALYSIS:START -->
**Status:** busy
**Follow-ups:**
- chase creds
**Recommended actions:**
- escalate ticket
<!-- KIZUKI:ANALYSIS:END -->
`;

test("TYPES lists the three entity types", () => {
  assert.deepEqual(TYPES, ["person", "project", "team"]);
});

test("eachEntity returns type, name, content, and path", async () => {
  const dir = await vaultWith({ "people/maya.md": ENTITY });
  const all = await eachEntity(dir);
  assert.equal(all.length, 1);
  assert.equal(all[0].type, "person");
  assert.equal(all[0].name, "maya");
  assert.equal(all[0].path, join(dir, "people", "maya.md"));
  assert.match(all[0].content, /# maya/);
});

test("eachEntity skips missing type dirs and honors filterType", async () => {
  const dir = await vaultWith({ "people/maya.md": ENTITY });
  assert.equal((await eachEntity(dir, "project")).length, 0);
  assert.equal((await eachEntity(dir, "person")).length, 1);
});

test("followupsByEntity extracts follow-ups and actions", async () => {
  const dir = await vaultWith({ "people/maya.md": ENTITY });
  const groups = await followupsByEntity(dir);
  assert.deepEqual(groups, [
    { type: "person", name: "maya", followUps: ["chase creds"], actions: ["escalate ticket"] },
  ]);
});

test("managedSection and bulletsUnder work on raw strings", () => {
  const section = managedSection(ENTITY);
  assert.match(section, /\*\*Status:\*\* busy/);
  assert.deepEqual(bulletsUnder(section, "**Follow-ups:"), ["chase creds"]);
});

test("assertType accepts valid types and rejects others", () => {
  for (const t of ["person", "project", "team"]) assert.doesNotThrow(() => assertType(t));
  assert.throws(() => assertType("company"), /invalid type/);
  assert.throws(() => assertType(undefined), /invalid type/);
});

test("assertName rejects path-unsafe and empty names", () => {
  assert.doesNotThrow(() => assertName("bob-smith"));
  assert.throws(() => assertName("a/b"), /invalid entity name/);
  assert.throws(() => assertName("a\\b"), /invalid entity name/);
  assert.throws(() => assertName(".."), /invalid entity name/);
  assert.throws(() => assertName(""), /name is required/);
  assert.throws(() => assertName(null), /name is required/);
});

test("statusOf extracts Status line from managed section", () => {
  const content = [
    "# x", "",
    "<!-- KIZUKI:ANALYSIS:START -->",
    "**Status:** on track",
    "<!-- KIZUKI:ANALYSIS:END -->", "",
  ].join("\n");
  assert.equal(statusOf(content), "on track");
  assert.equal(statusOf("# x\n"), "");
});
