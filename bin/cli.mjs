import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";

/** The defaults Kizuki ships with. Kept in step with lib/settings.ts by a test. */
export const DEFAULT_MODELS = {
  chat: { baseURL: "http://localhost:11434/v1", model: "qwen3.5:2b" },
  embed: { baseURL: "http://localhost:11434/v1", model: "nomic-embed-text" },
};

/** Reads `kizuki` options. Unknown options are an error, so typos are caught. */
export function parseArgs(argv) {
  const out = { port: 3700, home: undefined, open: true, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--no-open") out.open = false;
    else if (arg === "--port") {
      const port = Number(argv[++i]);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`--port needs a number from 1 to 65535`);
      out.port = port;
    } else if (arg === "--home") {
      const home = argv[++i];
      if (!home) throw new Error("--home needs a folder");
      out.home = home;
    } else throw new Error(`unknown option ${arg}. Run kizuki --help`);
  }
  return out;
}

/** The data folder: --home, then KIZUKI_HOME, then ~/.kizuki. A leading ~ is expanded. */
export function resolveHome(flag, env = process.env) {
  const set = (flag ?? env.KIZUKI_HOME ?? "").trim();
  if (!set) return join(homedir(), ".kizuki");
  if (set === "~") return homedir();
  if (set.startsWith("~/")) return join(homedir(), set.slice(2));
  return set;
}

/** Checks that the model servers answer and the models are installed. Returns fix-it messages. */
export async function checkModels(settings, env = process.env, fetchImpl = fetch) {
  const problems = [];
  const listings = new Map();
  for (const [label, target] of [
    ["answer", settings.chat],
    ["meaning-search", settings.embed],
  ]) {
    let address;
    try {
      address = new URL(target.baseURL);
    } catch {
      address = null;
    }
    if (!address || (address.protocol !== "http:" && address.protocol !== "https:")) {
      problems.push(`The ${label} model address in settings.json is not an http or https address.`);
      continue;
    }
    if (target.apiKeyEnv && !/^[A-Z][A-Z0-9_]*_API_KEY$/.test(target.apiKeyEnv)) {
      problems.push(`settings.json names the ${label} model's key variable "${target.apiKeyEnv}"; it must be an environment variable name ending in _API_KEY.`);
      continue;
    }
    if (target.apiKeyEnv && !env[target.apiKeyEnv]) {
      problems.push(`The environment variable ${target.apiKeyEnv} is not set, so the ${label} model cannot be reached.`);
      continue;
    }
    if (!listings.has(target.baseURL)) {
      try {
        const headers = target.apiKeyEnv ? { authorization: `Bearer ${env[target.apiKeyEnv]}` } : {};
        const res = await fetchImpl(`${target.baseURL}/models`, { headers, signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        listings.set(target.baseURL, ((await res.json()).data ?? []).map((m) => m.id));
      } catch (error) {
        listings.set(target.baseURL, null);
        const hint = target.baseURL.includes(":11434")
          ? " Start Ollama with: ollama serve"
          : target.baseURL.includes(":8080")
            ? " Start MLX with: mlx_lm.server --model <model>"
            : "";
        problems.push(`Nothing is answering at ${target.baseURL} (${error.message}).${hint}`);
      }
    }
    const ids = listings.get(target.baseURL);
    const bare = (id) => id.replace(/:latest$/, "");
    if (ids && !ids.some((id) => bare(id) === bare(target.model))) {
      const install = target.baseURL.includes(":11434") ? ` Install it with: ollama pull ${target.model}` : "";
      problems.push(`The ${label} model "${target.model}" is not installed.${install}`);
    }
  }
  return problems;
}

/** Reads settings.json, or the defaults if there is none. A broken file names itself and says how to fix it. */
export function readSettingsFile(path) {
  if (!existsSync(path)) return DEFAULT_MODELS;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${path} is not valid JSON (${error.message}). Fix it, or delete it to go back to the defaults.`, { cause: error });
  }
}

/** Waits until the dashboard answers. True if it did, false if it gave up. */
export async function waitForServer(url, { tries = 300, everyMs = 200, fetchImpl = fetch } = {}) {
  for (let i = 0; i < tries; i += 1) {
    try {
      if ((await fetchImpl(url)).status < 500) return true;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, everyMs));
  }
  return false;
}

/** The command that opens a web address in the default browser on this system. */
export function openCommand(url, platform = process.platform) {
  if (platform === "darwin") return ["open", [url]];
  if (platform === "win32") return ["cmd", ["/c", "start", "", url]];
  return ["xdg-open", [url]];
}

const LINKS_FILE = "kizuki-links.json";

/**
 * Records the links the build made in .next/node_modules for native packages (such as
 * better-sqlite3), as { name, package } pairs in .next/kizuki-links.json. npm leaves every
 * node_modules folder out of a package, so the links must be recreated after install.
 */
export function recordLinks(root) {
  const dir = join(root, ".next", "node_modules");
  const links = existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => lstatSync(join(dir, name)).isSymbolicLink())
        .map((name) => ({ name, package: basename(readlinkSync(join(dir, name))) }))
    : [];
  writeFileSync(join(root, ".next", LINKS_FILE), `${JSON.stringify(links, null, 2)}\n`);
  return links;
}

/**
 * Recreates the links recorded by recordLinks, pointing at wherever each package is
 * installed (`locate` returns a package's folder). Links that already work are left alone.
 * Returns the names of the links it made.
 */
export function restoreLinks(root, locate) {
  const file = join(root, ".next", LINKS_FILE);
  if (!existsSync(file)) return [];
  const dir = join(root, ".next", "node_modules");
  mkdirSync(dir, { recursive: true });
  const made = [];
  for (const { name, package: pkg } of JSON.parse(readFileSync(file, "utf8"))) {
    const link = join(dir, name);
    if (existsSync(join(link, "package.json"))) continue;
    rmSync(link, { force: true });
    symlinkSync(locate(pkg), link, "junction");
    made.push(name);
  }
  return made;
}

/**
 * The folder a package is installed in, as Node would find it from `from`. Works for
 * packages whose package.json is not exported: resolves the main file and walks up to the
 * package.json with the package's name.
 */
export function packageDir(pkg, from) {
  const require = createRequire(join(from, "noop.js"));
  let dir = dirname(require.resolve(pkg));
  for (;;) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, "utf8")).name === pkg) return dir;
    const up = dirname(dir);
    if (up === dir) throw new Error(`cannot find the folder of the package ${pkg}`);
    dir = up;
  }
}
