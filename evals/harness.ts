import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { addMaterial, confirmConcept, createCourse } from "../lib/commands";
import { appendLog, readLog } from "../lib/log";
import { indexMaterial, readMaterial } from "../lib/materialFlow";
import { makeAsk, makeEmbedder, type Ask } from "../lib/model";
import { findQuote } from "../lib/quote";
import { DEFAULT_SETTINGS, type Settings } from "../lib/settings";
import { newId } from "../lib/ids";
import { tempHome } from "../lib/test-helpers/home";

const MATERIAL_DIR = join(import.meta.dirname, "material");

/**
 * The model settings under test. Defaults to Kizuki's defaults; override with
 * EVAL_CHAT_BASEURL, EVAL_CHAT_MODEL, EVAL_REASONING, EVAL_REPLY_SHAPE, EVAL_EMBED_BASEURL, EVAL_EMBED_MODEL
 * to compare models (for example Ollama against MLX).
 */
export function evalSettings(env = process.env): Settings {
  return {
    chat: {
      baseURL: env.EVAL_CHAT_BASEURL ?? DEFAULT_SETTINGS.chat.baseURL,
      model: env.EVAL_CHAT_MODEL ?? DEFAULT_SETTINGS.chat.model,
      apiKeyEnv: env.EVAL_CHAT_API_KEY_ENV,
      reasoning: env.EVAL_REASONING === "default" ? "default" : "none",
      replyShape: env.EVAL_REPLY_SHAPE === "prompt" ? "prompt" : "server",
    },
    embed: {
      baseURL: env.EVAL_EMBED_BASEURL ?? DEFAULT_SETTINGS.embed.baseURL,
      model: env.EVAL_EMBED_MODEL ?? DEFAULT_SETTINGS.embed.model,
    },
  };
}

/** The raw text of a material file. Used for the independent quote check. */
export async function materialText(file: string): Promise<string> {
  return readFile(join(MATERIAL_DIR, file), "utf8");
}

/**
 * An independent quote check, written separately from Kizuki's own so a bug there cannot
 * hide itself: the quote must appear in the raw file after removing markdown marks,
 * lowering case, and collapsing spaces.
 */
export function appearsIn(quote: string, fileText: string): boolean {
  const flat = (s: string) =>
    s
      .toLowerCase()
      .replace(/[#*_`>]/g, " ")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^["']|["']$/g, "")
      .replace(/[.,;:!?]+$/, "");
  const q = flat(quote);
  return q.length > 0 && flat(fileText).includes(q);
}

/** A course built from every file in `evals/material`, read and indexed with the real meaning model. */
export interface EvalCourse {
  home: string;
  courseId: string;
  materialIds: Map<string, string>;
}

let shared: Promise<EvalCourse> | null = null;

/** Builds the eval course once per test file and reuses it. */
export function evalCourse(): Promise<EvalCourse> {
  shared ??= (async () => {
    const { home } = tempHome();
    const settings = evalSettings();
    const courseId = await createCourse(home, "Eval biology");
    const materialIds = new Map<string, string>();
    for (const file of ["photosynthesis.md", "cells.md"]) {
      const id = await addMaterial(home, { courseId, fileName: file, bytes: new TextEncoder().encode(await materialText(file)) });
      await readMaterial(home, id);
      await indexMaterial(home, id, makeEmbedder(settings.embed), settings.embed.model);
      materialIds.set(file, id);
    }
    return { home, courseId, materialIds };
  })();
  return shared;
}

/** Adds and confirms a concept backed by exact quotes from one file, as if you had reviewed it. */
export async function confirmedConcept(course: EvalCourse, file: string, name: string, quotes: string[]): Promise<string> {
  const materialId = course.materialIds.get(file)!;
  const passages = (await readLog(course.home, "passages")).find((e) => e.materialId === materialId)!.passages;
  const checked = quotes.map((text) => {
    const passageId = findQuote(text, undefined, passages);
    if (!passageId) throw new Error(`answer key quote not in ${file}: ${text}`);
    return { passageId, text };
  });
  const conceptId = newId("con");
  await appendLog(course.home, "concepts", [
    { type: "concept.proposed", at: new Date().toISOString(), conceptId, courseId: course.courseId, materialId, sectionId: passages[0]!.sectionId, name, quotes: checked },
  ]);
  await confirmConcept(course.home, conceptId);
  return conceptId;
}

/** Wraps the real model so a test can see its raw replies, before Kizuki's checks. */
export function recordingAsk(): { ask: Ask; replies: unknown[] } {
  const inner = makeAsk(evalSettings().chat);
  const replies: unknown[] = [];
  const ask: Ask = async (request) => {
    const reply = await inner(request);
    replies.push(reply);
    return reply;
  };
  return { ask, replies };
}
