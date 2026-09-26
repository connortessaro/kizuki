import { mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../lib/settings";
import { checkModels, DEFAULT_MODELS, openCommand, parseArgs, readSettingsFile, resolveHome, waitForServer } from "./cli.mjs";

describe("the kizuki start command", () => {
  it("reads its options and refuses unknown ones", () => {
    expect(parseArgs([])).toEqual({ port: 3700, home: undefined, open: true, help: false });
    expect(parseArgs(["--port", "4000", "--home", "/tmp/k", "--no-open"])).toEqual({ port: 4000, home: "/tmp/k", open: false, help: false });
    expect(() => parseArgs(["--prot", "1"])).toThrow(/unknown option --prot/);
    expect(() => parseArgs(["--port", "http"])).toThrow(/--port/);
  });

  it("finds the data folder the same way the app does", () => {
    expect(resolveHome(undefined, {})).toBe(join(homedir(), ".kizuki"));
    expect(resolveHome(undefined, { KIZUKI_HOME: "~/study" })).toBe(join(homedir(), "study"));
    expect(resolveHome("/tmp/x", { KIZUKI_HOME: "/tmp/y" })).toBe("/tmp/x");
  });

  it("ships the same default models as the app", () => {
    expect(DEFAULT_MODELS.chat).toMatchObject({ baseURL: DEFAULT_SETTINGS.chat.baseURL, model: DEFAULT_SETTINGS.chat.model });
    expect(DEFAULT_MODELS.embed).toMatchObject({ baseURL: DEFAULT_SETTINGS.embed.baseURL, model: DEFAULT_SETTINGS.embed.model });
  });

  it("says how to install a missing model", async () => {
    const problems = await checkModels(DEFAULT_MODELS, {}, async () => new Response(JSON.stringify({ data: [{ id: "nomic-embed-text:latest" }] })));
    expect(problems).toEqual([`The answer model "qwen3.5:2b" is not installed. Install it with: ollama pull qwen3.5:2b`]);
  });

  it("refuses a model address that is not http or https", async () => {
    const bad = { ...DEFAULT_MODELS, chat: { ...DEFAULT_MODELS.chat, baseURL: "file:///etc/passwd" } };
    const problems = await checkModels(bad, {}, async () => new Response(JSON.stringify({ data: [{ id: "nomic-embed-text" }] })));
    expect(problems[0]).toBe("The answer model address in settings.json is not an http or https address.");
  });

  it("opens the browser with the right command on each system", () => {
    expect(openCommand("http://x", "darwin")).toEqual(["open", ["http://x"]]);
    expect(openCommand("http://x", "linux")).toEqual(["xdg-open", ["http://x"]]);
  });
});

describe("native module links", () => {
  it("records the build's links and recreates them where the packages really are", async () => {
    const { mkdtempSync, mkdirSync, symlinkSync, readlinkSync, existsSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { recordLinks, restoreLinks } = await import("./cli.mjs");
    const root = mkdtempSync(join(tmpdir(), "kizuki-links-"));
    try {
      mkdirSync(join(root, ".next", "node_modules"), { recursive: true });
      symlinkSync("../../node_modules/vitest", join(root, ".next", "node_modules", "vitest-abc123"));
      expect(recordLinks(root)).toEqual([{ name: "vitest-abc123", package: "vitest" }]);
      rmSync(join(root, ".next", "node_modules"), { recursive: true });
      const made = restoreLinks(root, (pkg: string) => join(process.cwd(), "node_modules", pkg));
      expect(made).toEqual(["vitest-abc123"]);
      expect(readlinkSync(join(root, ".next", "node_modules", "vitest-abc123"))).toBe(join(process.cwd(), "node_modules", "vitest"));
      expect(existsSync(join(root, ".next", "node_modules", "vitest-abc123", "package.json"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("packageDir", () => {
  it("finds a package's folder even when its package.json is not exported", async () => {
    const { packageDir } = await import("./cli.mjs");
    expect(packageDir("sqlite-vec", process.cwd())).toBe(join(process.cwd(), "node_modules", "sqlite-vec"));
    expect(packageDir("better-sqlite3", process.cwd())).toBe(join(process.cwd(), "node_modules", "better-sqlite3"));
  });
});

describe("starting up", () => {
  it("reads settings.json, or the defaults when there is none", () => {
    const dir = mkdtempSync(join(tmpdir(), "kizuki-cli-"));
    expect(readSettingsFile(join(dir, "settings.json"))).toEqual(DEFAULT_MODELS);
    writeFileSync(join(dir, "settings.json"), JSON.stringify(DEFAULT_SETTINGS));
    expect(readSettingsFile(join(dir, "settings.json")).chat.model).toBe(DEFAULT_SETTINGS.chat.model);
  });

  it("names a broken settings.json and says how to fix it", () => {
    const dir = mkdtempSync(join(tmpdir(), "kizuki-cli-"));
    writeFileSync(join(dir, "settings.json"), "{ broken");
    expect(() => readSettingsFile(join(dir, "settings.json"))).toThrow(/settings\.json is not valid JSON.*Fix it, or delete it/);
  });

  it("says whether the dashboard answered before it gave up", async () => {
    const down = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const up = (async () => new Response("ok")) as unknown as typeof fetch;
    expect(await waitForServer("http://127.0.0.1:1", { tries: 3, everyMs: 1, fetchImpl: down })).toBe(false);
    expect(await waitForServer("http://127.0.0.1:1", { tries: 3, everyMs: 1, fetchImpl: up })).toBe(true);
  });
});

describe("model check hints", () => {
  it("says how to start MLX when nothing answers on its port, like the app does", async () => {
    const down = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const mlx = { chat: { baseURL: "http://localhost:8080/v1", model: "m" }, embed: DEFAULT_MODELS.embed };
    const problems = await checkModels(mlx, {}, down);
    expect(problems.some((p) => p.includes("Start MLX with: mlx_lm.server"))).toBe(true);
  });
});
