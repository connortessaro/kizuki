import { describe, expect, it } from "vitest";
import { z } from "zod";
import { askWithShapeInPrompt, checkModels, embedPrefix, parseJsonReply, providerOptionsFor, requestBodyFor, shapeInstructions } from "./model";
import { DEFAULT_SETTINGS } from "./settings";

describe("providerOptionsFor", () => {
  it("turns thinking off when reasoning is none", () => {
    expect(providerOptionsFor(DEFAULT_SETTINGS.chat)).toEqual({ kizuki: { reasoningEffort: "none" } });
  });

  it("sends nothing extra when reasoning is left to the model", () => {
    expect(providerOptionsFor({ ...DEFAULT_SETTINGS.chat, reasoning: "default" })).toEqual({});
  });
});

describe("embedPrefix", () => {
  it("adds the task words nomic models expect", () => {
    expect(embedPrefix("nomic-embed-text", "document")).toBe("search_document: ");
    expect(embedPrefix("nomic-embed-text:latest", "query")).toBe("search_query: ");
    expect(embedPrefix("text-embedding-3-small", "query")).toBe("");
  });
});

describe("checkModels", () => {
  const listing = (ids: string[]) => async () => new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), { status: 200 });

  it("is happy when both models are installed", async () => {
    const r = await checkModels(DEFAULT_SETTINGS, {}, listing(["qwen3.5:2b", "nomic-embed-text:latest"]));
    expect(r).toEqual({ ok: true, problems: [] });
  });

  it("says how to install a missing Ollama model", async () => {
    const r = await checkModels(DEFAULT_SETTINGS, {}, listing(["nomic-embed-text:latest"]));
    expect(r.ok).toBe(false);
    expect(r.problems).toContain('The answer model "qwen3.5:2b" is not installed. Install it with: ollama pull qwen3.5:2b');
  });

  it("says how to start Ollama when nothing answers", async () => {
    const r = await checkModels(DEFAULT_SETTINGS, {}, async () => {
      throw new TypeError("fetch failed");
    });
    expect(r.problems[0]).toMatch(/Nothing is answering at http:\/\/localhost:11434\/v1.*ollama serve/);
  });

  it("says which environment variable is missing for a hosted model", async () => {
    const hosted = { ...DEFAULT_SETTINGS, chat: { ...DEFAULT_SETTINGS.chat, baseURL: "https://api.openai.com/v1", apiKeyEnv: "OPENAI_API_KEY" } };
    const r = await checkModels(hosted, {}, listing(["qwen3.5:2b", "nomic-embed-text"]));
    expect(r.problems).toContain("The environment variable OPENAI_API_KEY is not set, so the answer model cannot be reached.");
  });
});

describe("requestBodyFor", () => {
  it("also sends the Qwen thinking switch when thinking is off, for servers like MLX", () => {
    expect(requestBodyFor(DEFAULT_SETTINGS.chat)({ model: "m" })).toEqual({ model: "m", chat_template_kwargs: { enable_thinking: false } });
    expect(requestBodyFor({ ...DEFAULT_SETTINGS.chat, reasoning: "default" })({ model: "m" })).toEqual({ model: "m" });
  });

  it("drops the response shape the server cannot enforce when Kizuki checks replies itself", () => {
    const body = { model: "m", response_format: { type: "json_schema" } };
    expect(requestBodyFor({ ...DEFAULT_SETTINGS.chat, replyShape: "prompt" })(body)).toEqual({ model: "m", chat_template_kwargs: { enable_thinking: false } });
  });
});

describe("parseJsonReply", () => {
  const schema = z.object({ items: z.array(z.string()) });

  it("reads a plain JSON reply", () => {
    expect(parseJsonReply('{"items":["a"]}', schema)).toEqual({ items: ["a"] });
  });

  it("reads JSON wrapped in a code fence or extra words", () => {
    expect(parseJsonReply('Here you go:\n```json\n{"items": ["a", "b"]}\n```', schema)).toEqual({ items: ["a", "b"] });
  });

  it("fails with a clear message when there is no JSON or it has the wrong shape", () => {
    expect(() => parseJsonReply("Apple and banana", schema)).toThrow(/did not reply with JSON/);
    expect(() => parseJsonReply('{"items": "a"}', schema)).toThrow(/wrong shape/);
  });

  it("never puts the model's own words into the error, because errors are saved and shown", () => {
    const reply = "The exam moved to Friday. Mitochondria make glucose.";
    expect(() => parseJsonReply(reply, schema)).toThrow(/did not reply with JSON/);
    expect(() => parseJsonReply(reply, schema)).not.toThrow(/Mitochondria|exam/);
    expect(() => parseJsonReply('{"items": "Mitochondria make glucose"}', schema)).not.toThrow(/Mitochondria/);
  });
});

describe("shapeInstructions", () => {
  it("describes the reply shape for the model", () => {
    const text = shapeInstructions(z.object({ items: z.array(z.string()) }));
    expect(text).toContain("Reply with one JSON object and nothing else");
    expect(text).toContain('"items"');
  });
});

describe("askWithShapeInPrompt", () => {
  const schema = z.object({ items: z.array(z.string()) });

  it("adds the shape to the instructions and reads the reply", async () => {
    let seen = "";
    const out = await askWithShapeInPrompt(async (system) => {
      seen = system;
      return '{"items":["a"]}';
    }, { system: "List things.", prompt: "go", schema });
    expect(out).toEqual({ items: ["a"] });
    expect(seen).toContain("List things.");
    expect(seen).toContain("Reply with one JSON object");
  });

  it("asks once more after a broken reply, saying what was wrong", async () => {
    const prompts: string[] = [];
    const replies = ['{"items": ["a",}', '{"items":["a"]}'];
    const out = await askWithShapeInPrompt(async (_system, prompt) => {
      prompts.push(prompt);
      return replies.shift()!;
    }, { system: "s", prompt: "go", schema });
    expect(out).toEqual({ items: ["a"] });
    expect(prompts[1]).toContain("go");
    expect(prompts[1]).toContain("Your last reply could not be used");
  });

  it("gives up after the second broken reply with the reason", async () => {
    await expect(askWithShapeInPrompt(async () => "no json here", { system: "s", prompt: "go", schema })).rejects.toThrow(/did not reply with JSON/);
  });
});
