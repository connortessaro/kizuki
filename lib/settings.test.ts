import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { homePaths } from "./paths";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, isLocalUrl, PRESETS, readSettings, writeSettings } from "./settings";
import { tempHome } from "./test-helpers/home";

let home: string;
let cleanup: () => void;
beforeEach(() => ({ home, cleanup } = tempHome()));
afterEach(() => cleanup());

describe("settings", () => {
  it("defaults to Ollama on this computer with the small models", async () => {
    const s = await readSettings(home);
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect(s.chat).toMatchObject({ baseURL: "http://localhost:11434/v1", model: "qwen3.5:2b", reasoning: "none" });
    expect(s.embed).toMatchObject({ baseURL: "http://localhost:11434/v1", model: "nomic-embed-text" });
  });

  it("saves and reads back settings", async () => {
    await writeSettings(home, { ...DEFAULT_SETTINGS, chat: { ...DEFAULT_SETTINGS.chat, model: "qwen3.5:4b" } });
    expect((await readSettings(home)).chat.model).toBe("qwen3.5:4b");
  });

  it("refuses to save an API key itself, only the name of the variable that holds it", async () => {
    await expect(writeSettings(home, { ...DEFAULT_SETTINGS, chat: { ...DEFAULT_SETTINGS.chat, apiKeyEnv: "sk-abc123def456" } })).rejects.toThrow(/name of an environment variable/);
  });

  it("only sends a variable whose name says it holds a key, so settings can never send some other secret, like a cloud password", async () => {
    for (const apiKeyEnv of ["AWS_SECRET_ACCESS_KEY", "GITHUB_TOKEN", "HOME"]) {
      await expect(writeSettings(home, { ...DEFAULT_SETTINGS, chat: { ...DEFAULT_SETTINGS.chat, apiKeyEnv } })).rejects.toThrow(/ending in _API_KEY/);
    }
    for (const apiKeyEnv of ["OPENAI_API_KEY", "GROQ_API_KEY"]) {
      await expect(writeSettings(home, { ...DEFAULT_SETTINGS, chat: { ...DEFAULT_SETTINGS.chat, apiKeyEnv } })).resolves.toBeUndefined();
    }
  });

  it("names the settings file and says how to fix it when it is not valid JSON", async () => {
    mkdirSync(home, { recursive: true });
    writeFileSync(homePaths(home).settings, "{ broken");
    await expect(readSettings(home)).rejects.toThrow(/settings\.json is not valid JSON.*Fix it, or delete it to go back to the defaults/);
  });

  it("keeps the settings file and the data folder private to your user account", async () => {
    await writeSettings(home, DEFAULT_SETTINGS);
    expect(statSync(homePaths(home).settings).mode & 0o077).toBe(0);
  });

  it("offers MLX and hosted presets", () => {
    expect(PRESETS.mlx.chat.baseURL).toBe("http://localhost:8080/v1");
    expect(PRESETS.hosted.chat.apiKeyEnv).toBe("OPENAI_API_KEY");
  });
});

describe("isLocalUrl", () => {
  it("knows which addresses stay on this computer", () => {
    expect(isLocalUrl("http://localhost:11434/v1")).toBe(true);
    expect(isLocalUrl("http://127.0.0.1:8080/v1")).toBe(true);
    expect(isLocalUrl("https://api.openai.com/v1")).toBe(false);
  });
});
