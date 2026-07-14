import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TARGETS,
  parseRitual,
  readRituals,
  renderClaude,
  renderCodex,
  renderCursor,
  renderGemini,
  renderGeneric,
  runSkillsCommand,
} from "./skills.mjs";

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

test("renderCursor emits mdc frontmatter, renderGemini emits toml, renderGeneric emits headed markdown", () => {
  const ritual = parseRitual(SOURCE);
  assert.equal(
    renderCursor(ritual),
    "---\ndescription: Begin a Kizuki shift\nalwaysApply: false\n---\n\nRun `kizuki start`. Then report.\n",
  );
  const toml = renderGemini(ritual);
  assert.match(toml, /^description = "Begin a Kizuki shift"\n/);
  assert.match(toml, /prompt = """\nRun `kizuki start`\. Then report\.\n"""\n$/);
  assert.equal(
    renderGeneric(ritual),
    "<!-- kizuki ritual: kizuki-start — invoke: kizuki start -->\n\nRun `kizuki start`. Then report.\n",
  );
});

test("renderGemini rejects a ritual body containing a TOML-breaking triple quote", () => {
  const ritual = { ...parseRitual(SOURCE), body: 'body with """ inside\n' };
  assert.throws(() => renderGemini(ritual), /triple quote/);
});

test("new targets map paths; cursor and generic are dist-only (no native global rules dir)", () => {
  assert.equal(TARGETS.cursor.distPath("kizuki-start"), join("cursor", "kizuki-start.mdc"));
  assert.equal(TARGETS.cursor.homePath, null);
  assert.equal(
    TARGETS.gemini.homePath("kizuki-start", "/home/u"),
    join("/home/u", ".gemini", "commands", "kizuki-start.toml"),
  );
  assert.equal(TARGETS.gemini.distPath("kizuki-start"), join("gemini", "kizuki-start.toml"));
  assert.equal(TARGETS.generic.homePath, null);
  assert.equal(TARGETS.generic.distPath("kizuki-start"), join("generic", "kizuki-start.md"));
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

async function seededVault() {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-skills-vault-"));
  await mkdir(join(vault, "skills", "kizuki-start"), { recursive: true });
  await writeFile(join(vault, "skills", "kizuki-start", "ritual.md"), SOURCE, "utf8");
  return vault;
}

test("skills export installs rendered rituals into the home dirs", async () => {
  const vault = await seededVault();
  const home = await mkdtemp(join(tmpdir(), "kizuki-skills-home-"));
  const out = await runSkillsCommand(vault, ["export"], { home });
  const claudePath = join(home, ".claude", "skills", "kizuki-start", "SKILL.md");
  const codexPath = join(home, ".codex", "prompts", "kizuki-start.md");
  assert.match(out, new RegExp("wrote .*SKILL\\.md"));
  assert.equal(await readFile(claudePath, "utf8"), renderClaude(parseRitual(SOURCE)));
  assert.equal(await readFile(codexPath, "utf8"), renderCodex(parseRitual(SOURCE)));
});

test("skills export --agent codex writes only the codex target", async () => {
  const vault = await seededVault();
  const home = await mkdtemp(join(tmpdir(), "kizuki-skills-home-"));
  await runSkillsCommand(vault, ["export", "--agent", "codex"], { home });
  await assert.rejects(readFile(join(home, ".claude", "skills", "kizuki-start", "SKILL.md"), "utf8"));
  await readFile(join(home, ".codex", "prompts", "kizuki-start.md"), "utf8");
});

test("skills export installs gemini into the home dir; cursor and generic require --dist/--check", async () => {
  const vault = await seededVault();
  const home = await mkdtemp(join(tmpdir(), "kizuki-skills-home-"));
  await runSkillsCommand(vault, ["export"], { home });
  await readFile(join(home, ".gemini", "commands", "kizuki-start.toml"), "utf8");
  await assert.rejects(readFile(join(home, ".cursor", "rules", "kizuki-start.mdc"), "utf8"));
  await assert.rejects(
    runSkillsCommand(vault, ["export", "--agent", "cursor"], { home }),
    /cursor renders to dist only/,
  );
  await assert.rejects(
    runSkillsCommand(vault, ["export", "--agent", "generic"], { home }),
    /generic renders to dist only/,
  );
  await runSkillsCommand(vault, ["export", "--dist"]);
  await readFile(join(vault, "dist", "skills", "cursor", "kizuki-start.mdc"), "utf8");
  await readFile(join(vault, "dist", "skills", "gemini", "kizuki-start.toml"), "utf8");
  await readFile(join(vault, "dist", "skills", "generic", "kizuki-start.md"), "utf8");
});

test("skills export --dist writes the committed tree and --check verifies it", async () => {
  const vault = await seededVault();
  await runSkillsCommand(vault, ["export", "--dist"]);
  assert.equal(
    await readFile(join(vault, "dist", "skills", "claude", "kizuki-start", "SKILL.md"), "utf8"),
    renderClaude(parseRitual(SOURCE)),
  );
  assert.equal(await runSkillsCommand(vault, ["export", "--check"]), "skills dist up to date");
  await writeFile(
    join(vault, "skills", "kizuki-start", "ritual.md"),
    SOURCE.replace("Then report.", "Then drifted."),
    "utf8",
  );
  await assert.rejects(runSkillsCommand(vault, ["export", "--check"]), /skills dist drift: .*kizuki-start/);
});

test("skills export rejects bad argv", async () => {
  const vault = await seededVault();
  await assert.rejects(runSkillsCommand(vault, ["install"]), /unknown skills command/);
  await assert.rejects(runSkillsCommand(vault, ["export", "--agent", "vim"]), /invalid agent/);
  await assert.rejects(runSkillsCommand(vault, ["export", "--check", "--dist"]), /mutually exclusive/);
  await assert.rejects(runSkillsCommand(vault, ["export", "--nope"]), /unknown option for skills export/);
});
