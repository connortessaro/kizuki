import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createGateway, embedMany, generateText, Output, type EmbeddingModel, type LanguageModel } from "ai";
import { z } from "zod";
import type { Embedder } from "./search";
import { isLocalUrl, type ChatSettings, type EmbedSettings, type Settings } from "./settings";

/** Environment variables, such as `process.env`. Tests pass their own. */
export type Env = Record<string, string | undefined>;

const PROVIDER = "kizuki";

function apiKeyFrom(apiKeyEnv: string | undefined, env: Env): string | undefined {
  const apiKey = apiKeyEnv ? env[apiKeyEnv] : undefined;
  if (apiKeyEnv && !apiKey) throw new Error(`The environment variable ${apiKeyEnv} is not set. Set it where you start Kizuki (for example: ${apiKeyEnv}=... kizuki), or pick other models with /model.`);
  return apiKey;
}

function provider(baseURL: string, apiKeyEnv: string | undefined, env: Env, transformRequestBody?: (body: Record<string, unknown>) => Record<string, unknown>) {
  return createOpenAICompatible({ name: PROVIDER, baseURL, apiKey: apiKeyFrom(apiKeyEnv, env), supportsStructuredOutputs: true, transformRequestBody });
}

/** The AI SDK's own AI Gateway provider. Needs a key: Kizuki never falls back to one it was not told about. */
function gatewayProvider(baseURL: string, apiKeyEnv: string | undefined, env: Env, fetchImpl?: typeof fetch) {
  if (!apiKeyEnv) throw new Error("AI Gateway needs an API key. Set the key variable to AI_GATEWAY_API_KEY with /model.");
  return createGateway({ baseURL, apiKey: apiKeyFrom(apiKeyEnv, env), fetch: fetchImpl });
}

/**
 * Adjusts each request for the server. With thinking off it also sends the switch Qwen
 * models read through their chat template (`enable_thinking: false`), which MLX needs and
 * Ollama ignores. When Kizuki checks reply shapes itself, the shape the server would ignore
 * is left out.
 */
export function requestBodyFor(chat: ChatSettings): (body: Record<string, unknown>) => Record<string, unknown> {
  return (body) => {
    const out: Record<string, unknown> = { ...body };
    if (chat.replyShape === "prompt") delete out.response_format;
    if (chat.reasoning === "none") out.chat_template_kwargs = { ...(out.chat_template_kwargs as object | undefined), enable_thinking: false };
    return out;
  };
}

/** The words added to the instructions when the server does not enforce reply shapes. */
export function shapeInstructions(schema: z.ZodType): string {
  return `Reply with one JSON object and nothing else, no code fence and no explanation. It must match this JSON Schema:\n${JSON.stringify(z.toJSONSchema(schema))}`;
}

/** Reads a JSON reply that may be wrapped in a code fence or extra words, and checks its shape. */
export function parseJsonReply<T>(text: string, schema: z.ZodType<T>): T {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  // The model's own words never go into these errors: errors are saved and shown on the page.
  if (start < 0 || end <= start) throw new Error(`the model did not reply with JSON (its reply was ${text.length} characters of plain text)`);
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch (error) {
    throw new Error(`the model did not reply with valid JSON (${(error as Error).name})`, { cause: error });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new Error(`the model's reply has the wrong shape: ${parsed.error.message}`);
  return parsed.data;
}

/** Extra options sent with each request. With reasoning `none`, thinking is turned off, which is much faster on small models. */
export function providerOptionsFor(chat: ChatSettings): Record<string, Record<string, string>> {
  return chat.reasoning === "none" ? { [PROVIDER]: { reasoningEffort: "none" } } : {};
}

/** The answer model, ready for the AI SDK. The API key, if any, is read from the environment at call time. */
export function chatModel(chat: ChatSettings, env: Env = process.env): LanguageModel {
  if (chat.provider === "gateway") return gatewayProvider(chat.baseURL, chat.apiKeyEnv, env).languageModel(chat.model);
  return provider(chat.baseURL, chat.apiKeyEnv, env, requestBodyFor(chat)).chatModel(chat.model);
}

function embeddingModel(embed: EmbedSettings, env: Env): EmbeddingModel {
  if (embed.provider === "gateway") return gatewayProvider(embed.baseURL, embed.apiKeyEnv, env).embeddingModel(embed.model);
  return provider(embed.baseURL, embed.apiKeyEnv, env).embeddingModel(embed.model);
}

/** The temperature for answers. Hosted reasoning models on AI Gateway reject one, so they get none. */
function temperatureFor(chat: ChatSettings): number | undefined {
  return chat.provider === "gateway" ? undefined : 0.2;
}

/** The words nomic meaning models expect before a passage or a search. Other models get nothing. */
export function embedPrefix(model: string, kind: "document" | "query"): string {
  if (!model.toLowerCase().includes("nomic")) return "";
  return kind === "document" ? "search_document: " : "search_query: ";
}

/**
 * A function that turns texts into numbers for meaning search, using the configured model.
 */
export function makeEmbedder(embed: EmbedSettings, env: Env = process.env): Embedder {
  return async (texts, kind) => {
    const model = embeddingModel(embed, env);
    const prefix = embedPrefix(embed.model, kind);
    const { embeddings } = await embedMany({ model, values: texts.map((t) => prefix + t) });
    return embeddings;
  };
}

/**
 * Asks for a reply in a fixed shape on a server that does not enforce shapes: the shape goes
 * into the instructions, and Kizuki reads and checks the reply. After a broken reply it asks
 * once more, saying what was wrong; a second broken reply is an error.
 */
export async function askWithShapeInPrompt<T>(
  generate: (system: string, prompt: string) => Promise<string>,
  request: { system: string; prompt: string; schema: z.ZodType<T> },
): Promise<T> {
  const system = `${request.system}\n\n${shapeInstructions(request.schema)}`;
  const first = await generate(system, request.prompt);
  try {
    return parseJsonReply(first, request.schema);
  } catch (error) {
    const again = `${request.prompt}\n\nYour last reply could not be used (${(error as Error).message.slice(0, 200)}). Reply again with only the JSON object.`;
    return parseJsonReply(await generate(system, again), request.schema);
  }
}

/** A function that asks the answer model for a reply in a fixed shape. Tests pass a fake one. */
export type Ask = <T>(request: { system: string; prompt: string; schema: z.ZodType<T> }) => Promise<T>;

/**
 * Makes an {@link Ask} function for the configured answer model. With `replyShape: "prompt"`
 * the shape goes into the instructions and Kizuki reads and checks the reply itself.
 */
export function makeAsk(chat: ChatSettings, env: Env = process.env): Ask {
  return async ({ system, prompt, schema }) => {
    if (chat.replyShape === "prompt") {
      const generate = async (fullSystem: string, fullPrompt: string) =>
        (await generateText({ model: chatModel(chat, env), system: fullSystem, prompt: fullPrompt, temperature: temperatureFor(chat), providerOptions: providerOptionsFor(chat) })).text;
      return askWithShapeInPrompt(generate, { system, prompt, schema });
    }
    const { output } = await generateText({
      model: chatModel(chat, env),
      system,
      prompt,
      temperature: temperatureFor(chat),
      output: Output.object({ schema }),
      providerOptions: providerOptionsFor(chat),
    });
    return output as z.infer<typeof schema>;
  };
}

function modelListed(ids: string[], model: string): boolean {
  const bare = (id: string) => id.replace(/:latest$/, "");
  return ids.some((id) => id === model || bare(id) === bare(model));
}

/** The result of {@link checkModels}. Each problem says what is wrong and how to fix it. */
export interface ModelCheck {
  /** True when no problem was found. */
  ok: boolean;
  /** One message per problem found. Empty when both models are ready. */
  problems: string[];
}

/**
 * Checks that the model servers answer and both models are installed, with fix-it messages.
 */
export async function checkModels(settings: Settings, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<ModelCheck> {
  const problems: string[] = [];
  const targets = [
    { label: "answer model", provider: settings.chat.provider, baseURL: settings.chat.baseURL, model: settings.chat.model, apiKeyEnv: settings.chat.apiKeyEnv },
    { label: "meaning-search model", provider: settings.embed.provider, baseURL: settings.embed.baseURL, model: settings.embed.model, apiKeyEnv: settings.embed.apiKeyEnv },
  ];
  const listings = new Map<string, string[] | null>();
  for (const t of targets) {
    if (t.apiKeyEnv && !env[t.apiKeyEnv]) {
      problems.push(`The environment variable ${t.apiKeyEnv} is not set, so the ${t.label} cannot be reached.`);
      continue;
    }
    if (t.provider === "gateway") {
      if (!listings.has(t.baseURL)) {
        try {
          const { models } = await gatewayProvider(t.baseURL, t.apiKeyEnv, env, fetchImpl).getAvailableModels();
          listings.set(t.baseURL, models.map((m) => m.id));
        } catch (error) {
          listings.set(t.baseURL, null);
          problems.push(`AI Gateway did not answer at ${t.baseURL} (${(error as Error).message}).`);
        }
      }
      const ids = listings.get(t.baseURL);
      if (ids && !ids.includes(t.model)) problems.push(`AI Gateway has no ${t.label} "${t.model}". Pick one from https://vercel.com/ai-gateway/models`);
      continue;
    }
    if (!listings.has(t.baseURL)) {
      try {
        const headers: Record<string, string> = t.apiKeyEnv ? { authorization: `Bearer ${env[t.apiKeyEnv]}` } : {};
        const res = await fetchImpl(`${t.baseURL}/models`, { headers, signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { data?: { id: string }[] };
        listings.set(t.baseURL, (body.data ?? []).map((m) => m.id));
      } catch (error) {
        listings.set(t.baseURL, null);
        const hint = t.baseURL.includes(":11434")
          ? " Start Ollama with: ollama serve"
          : t.baseURL.includes(":8080")
            ? " Start MLX with: mlx_lm.server --model <model>"
            : "";
        problems.push(`Nothing is answering at ${t.baseURL} (${(error as Error).message}).${hint}`);
      }
    }
    const ids = listings.get(t.baseURL);
    if (ids && !modelListed(ids, t.model)) {
      const install = t.baseURL.includes(":11434") ? ` Install it with: ollama pull ${t.model}` : "";
      problems.push(`The ${t.label === "answer model" ? "answer" : "meaning-search"} model "${t.model}" is not installed.${install}`);
    }
  }
  return { ok: problems.length === 0, problems };
}

/** True if any configured model sends your material off this computer. */
export function sendsMaterialOut(settings: Settings): boolean {
  return !isLocalUrl(settings.chat.baseURL) || !isLocalUrl(settings.embed.baseURL);
}
