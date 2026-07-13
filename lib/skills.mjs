import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

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

function parseExportArgs(argv) {
  let agent = "all";
  let check = false;
  let dist = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--check") {
      check = true;
      continue;
    }
    if (arg === "--dist") {
      dist = true;
      continue;
    }
    if (arg === "--agent") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error("--agent requires a value");
      agent = value;
      index++;
      continue;
    }
    throw new Error("unknown option for skills export: " + arg);
  }
  if (!["claude", "codex", "all"].includes(agent)) throw new Error("invalid agent " + JSON.stringify(agent));
  if (check && dist) throw new Error("--check and --dist are mutually exclusive");
  return { agent, check, dist };
}

export async function runSkillsCommand(vaultDir, argv, { home = homedir() } = {}) {
  const [action, ...rest] = argv;
  if (action !== "export") throw new Error("unknown skills command " + JSON.stringify(action));
  const { agent, check, dist } = parseExportArgs(rest);
  const rituals = await readRituals(join(vaultDir, "skills"));
  const targets = agent === "all" ? Object.keys(TARGETS) : [agent];
  const distRoot = join(vaultDir, "dist", "skills");
  const written = [];

  for (const targetName of targets) {
    const target = TARGETS[targetName];
    for (const ritual of rituals) {
      const rendered = target.render(ritual);
      const distFile = join(distRoot, target.distPath(ritual.name));
      if (check) {
        let existing = null;
        try {
          existing = await readFile(distFile, "utf8");
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        if (existing !== rendered) {
          throw new Error("skills dist drift: " + distFile + " — run kizuki skills export --dist");
        }
        continue;
      }
      const path = dist ? distFile : target.homePath(ritual.name, home);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, rendered, "utf8");
      written.push(path);
    }
  }
  return check ? "skills dist up to date" : written.map((path) => "wrote " + path).join("\n");
}
