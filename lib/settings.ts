import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { homePaths } from "./paths";

const envName = z
  .string()
  .regex(
    /^[A-Z][A-Z0-9_]*_API_KEY$/,
    "must be the name of an environment variable ending in _API_KEY (like OPENAI_API_KEY), never the key itself",
  )
  .optional();

/** Settings for the model that proposes concepts and asks questions. */
export const chatSettingsSchema = z.object({
  baseURL: z.url(),
  model: z.string().min(1),
  /** The name of the environment variable that holds the API key. The key itself is never saved. */
  apiKeyEnv: envName,
  /** `none` turns thinking off, which is faster on small local models. `default` leaves it to the model. */
  reasoning: z.enum(["none", "default"]),
  /**
   * How replies are kept in the right shape. `server`: the server enforces it (Ollama,
   * OpenAI). `prompt`: Kizuki describes the shape in the prompt and checks the reply itself,
   * for servers that ignore it (MLX).
   */
  replyShape: z.enum(["server", "prompt"]).default("server"),
});

/** Settings for the model that turns passages into numbers for meaning search. */
export const embedSettingsSchema = z.object({
  baseURL: z.url(),
  model: z.string().min(1),
  apiKeyEnv: envName,
});

/** All model settings. Saved in `settings.json` in the home folder. */
export const settingsSchema = z.object({
  chat: chatSettingsSchema,
  embed: embedSettingsSchema,
});
/** All model settings. */
export type Settings = z.infer<typeof settingsSchema>;
/** Settings for the answer model. */
export type ChatSettings = z.infer<typeof chatSettingsSchema>;
/** Settings for the meaning-search model. */
export type EmbedSettings = z.infer<typeof embedSettingsSchema>;

/** Ollama on this computer, with the small models Kizuki is tested with. */
export const DEFAULT_SETTINGS: Settings = {
  chat: { baseURL: "http://localhost:11434/v1", model: "qwen3.5:2b", reasoning: "none", replyShape: "server" },
  embed: { baseURL: "http://localhost:11434/v1", model: "nomic-embed-text" },
};

/** Ready-made settings for each way of running the answer model. Meaning search stays on Ollama. */
export const PRESETS: Record<"ollama" | "mlx" | "hosted", Settings> = {
  ollama: DEFAULT_SETTINGS,
  mlx: {
    chat: { baseURL: "http://localhost:8080/v1", model: "mlx-community/Qwen3.5-2B-4bit", reasoning: "none", replyShape: "prompt" },
    embed: DEFAULT_SETTINGS.embed,
  },
  hosted: {
    chat: { baseURL: "https://api.openai.com/v1", model: "gpt-5-mini", apiKeyEnv: "OPENAI_API_KEY", reasoning: "default", replyShape: "server" },
    embed: DEFAULT_SETTINGS.embed,
  },
};

/** True if the address is on this computer, so material sent there never leaves it. */
export function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

/** Reads the saved settings, or the defaults if none are saved. A broken settings file is an error, not a silent reset. */
export async function readSettings(home: string): Promise<Settings> {
  let raw: string;
  try {
    raw = await readFile(homePaths(home).settings, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return DEFAULT_SETTINGS;
    throw error;
  }
  const path = homePaths(home).settings;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${path} is not valid JSON (${(error as Error).message}). Fix it, or delete it to go back to the defaults.`, { cause: error });
  }
  const parsed = settingsSchema.safeParse(json);
  if (!parsed.success) throw new Error(`${path}: ${parsed.error.message}\nFix it in Settings, or delete the file to go back to the defaults.`);
  return parsed.data;
}

/** Checks and saves the settings. Writes to a temporary file first so a crash never leaves half a file. */
export async function writeSettings(home: string, settings: Settings): Promise<void> {
  const parsed = settingsSchema.safeParse(settings);
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const path = homePaths(home).settings;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(parsed.data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, path);
}
