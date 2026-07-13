import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TARGETS, parseRitual, readRituals, renderClaude, renderCodex } from "./skills.mjs";

const SOURCE = `---
name: kizuki-start
description: Begin a Kizuki shift
invoke: kizuki start
---

Run \`kizuki start\`. Then report.
`;

test("parseRitual extracts frontmatter keys and body", () => {
  const ritual = parseRitual(SOURCE);
  assert.deepEqual(ritual, {
    name: "kizuki-start",
    description: "Begin a Kizuki shift",
    invoke: "kizuki start",
    body: "Run `kizuki start`. Then report.\n",
  });
});

test("parseRitual throws on missing frontmatter or missing keys", () => {
  assert.throws(() => parseRitual("no frontmatter"), /missing frontmatter/);
  assert.throws(
    () => parseRitual("---\nname: x\ndescription: y\n---\n\nbody\n"),
    /missing invoke/,
  );
});

test("parseRitual rejects an unsafe name", () => {
  const unsafe = SOURCE.replace("name: kizuki-start", "name: ../evil");
  assert.throws(() => parseRitual(unsafe), /not path-safe/);
});

test("renderClaude emits SKILL.md frontmatter plus body; renderCodex emits body only", () => {
  const ritual = parseRitual(SOURCE);
  assert.equal(
    renderClaude(ritual),
    "---\nname: kizuki-start\ndescription: Begin a Kizuki shift\n---\n\nRun `kizuki start`. Then report.\n",
  );
  assert.equal(renderCodex(ritual), "Run `kizuki start`. Then report.\n");
});

test("TARGETS map dist and home paths", () => {
  assert.equal(TARGETS.claude.distPath("kizuki-start"), join("claude", "kizuki-start", "SKILL.md"));
  assert.equal(
    TARGETS.claude.homePath("kizuki-start", "/home/u"),
    join("/home/u", ".claude", "skills", "kizuki-start", "SKILL.md"),
  );
  assert.equal(TARGETS.codex.distPath("kizuki-start"), join("codex", "kizuki-start.md"));
  assert.equal(
    TARGETS.codex.homePath("kizuki-start", "/home/u"),
    join("/home/u", ".codex", "prompts", "kizuki-start.md"),
  );
});

test("readRituals reads skills/*/ritual.md sorted and validates names match dirs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-skills-"));
  await mkdir(join(dir, "kizuki-start"), { recursive: true });
  await writeFile(join(dir, "kizuki-start", "ritual.md"), SOURCE, "utf8");
  const rituals = await readRituals(dir);
  assert.equal(rituals.length, 1);
  assert.equal(rituals[0].name, "kizuki-start");

  await mkdir(join(dir, "renamed"), { recursive: true });
  await writeFile(join(dir, "renamed", "ritual.md"), SOURCE, "utf8");
  await assert.rejects(readRituals(dir), /frontmatter name must match directory name/);
});

test("readRituals throws on a missing or empty skills dir", async () => {
  await assert.rejects(readRituals("/nonexistent/skills"), /no skills directory/);
  const empty = await mkdtemp(join(tmpdir(), "kizuki-skills-empty-"));
  await assert.rejects(readRituals(empty), /no rituals found/);
});

test("repo ritual sources parse and invoke the global kizuki binary", async () => {
  const rituals = await readRituals(join(import.meta.dirname, "..", "skills"));
  assert.deepEqual(rituals.map((ritual) => ritual.name), ["kizuki-start", "kizuki-stop"]);
  for (const ritual of rituals) {
    assert.doesNotMatch(ritual.body, /\.\/kizuki/);
    assert.match(ritual.body, /`kizuki (start|stop)`/);
  }
});
