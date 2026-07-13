import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const FRONTMATTER_KEYS = ["name", "description", "invoke"];

function assertSafeName(name) {
  if (name.includes("..") || name.includes("/") || name.includes("\\") || name.includes("\0")) {
    throw new Error("ritual name is not path-safe: " + JSON.stringify(name));
  }
}

export function parseRitual(source) {
  const match = /^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/.exec(source);
  if (!match) throw new Error("ritual is missing frontmatter");
  const fields = {};
  for (const line of match[1].split("\n")) {
    const keyValue = /^([a-z]+):\s*(\S.*)$/.exec(line);
    if (!keyValue) throw new Error("invalid ritual frontmatter line: " + JSON.stringify(line));
    fields[keyValue[1]] = keyValue[2].trim();
  }
  for (const key of FRONTMATTER_KEYS) {
    if (!fields[key]) throw new Error("ritual frontmatter is missing " + key);
  }
  assertSafeName(fields.name);
  const body = match[2].trim();
  if (!body) throw new Error("ritual body is empty");
  return {
    name: fields.name,
    description: fields.description,
    invoke: fields.invoke,
    body: body + "\n",
  };
}

export async function readRituals(skillsDir) {
  let names;
  try {
    names = await readdir(skillsDir);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("no skills directory at " + skillsDir);
    throw error;
  }
  const rituals = [];
  for (const name of names.sort()) {
    const path = join(skillsDir, name, "ritual.md");
    let source;
    try {
      source = await readFile(path, "utf8");
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") continue;
      throw error;
    }
    let ritual;
    try {
      ritual = parseRitual(source);
    } catch (error) {
      throw new Error(path + ": " + error.message);
    }
    if (ritual.name !== name) throw new Error(path + ": frontmatter name must match directory name");
    rituals.push(ritual);
  }
  if (!rituals.length) throw new Error("no rituals found in " + skillsDir);
  return rituals;
}

export function renderClaude(ritual) {
  return ["---", "name: " + ritual.name, "description: " + ritual.description, "---", "", ritual.body].join("\n");
}

export function renderCodex(ritual) {
  return ritual.body;
}

export const TARGETS = Object.freeze({
  claude: {
    render: renderClaude,
    distPath: (name) => join("claude", name, "SKILL.md"),
    homePath: (name, home) => join(home, ".claude", "skills", name, "SKILL.md"),
  },
  codex: {
    render: renderCodex,
    distPath: (name) => join("codex", name + ".md"),
    homePath: (name, home) => join(home, ".codex", "prompts", name + ".md"),
  },
});
