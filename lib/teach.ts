import { z } from "zod";
import { nameKey } from "./concepts";
import { QUESTION_KINDS, type Miss, type Passage, type Question } from "./events";
import { newId } from "./ids";
import { MAX_MISSES, MAX_QUESTIONS } from "./limits";
import type { Ask } from "./model";
import { quoteMatches, termInText } from "./quote";
import { lookupSentence, numberSentences, type SentenceRef } from "./sentences";
import { coverage } from "./words";

export { MAX_MISSES, MAX_QUESTIONS, MAX_ROUNDS } from "./limits";

/**
 * The shape the model must reply in when choosing questions. The model only picks the kind,
 * a sentence label, and (for unclear and contradiction questions) words from your own text.
 * Kizuki looks up the sentence and writes the question itself with {@link renderQuestion}.
 */
export const teachReplySchema = z.object({
  questions: z.array(
    z.object({
      kind: z.enum(QUESTION_KINDS),
      sentence: z.string().describe('The label of a material sentence, like "S3". Empty for an unclear question.'),
      term: z.string().describe("Words copied exactly from what the student wrote. Empty for a gap question."),
    }),
  ),
});
/** The model's reply when choosing questions, before any checks. */
export type TeachReply = z.infer<typeof teachReplySchema>;

/** The shape the model must reply in when listing what you missed: sentence labels only. */
export const missesReplySchema = z.object({
  missed: z.array(z.object({ sentence: z.string().describe('The label of a material sentence, like "S3".') })),
});
/** The model's reply when listing what you missed, before any checks. */
export type MissesReply = z.infer<typeof missesReplySchema>;

/** The instructions given to the model for choosing teach-back questions. */
export const TEACH_SYSTEM = `You are a curious student. Someone is teaching you a concept, and you have their course material. Every sentence of the material has a label like [S3].
Your job is to find where their explanation does not match the material, and ask about it.

Step 1. Read each sentence they wrote. Compare its details with the material: places, numbers, names, directions, causes, and results.
If a detail they wrote differs from the material, that is a "contradiction". Give the label of the material sentence that states the detail correctly as "sentence", and copy their words that disagree as "term".
Step 2. If an important idea in the material is missing from what they wrote, that is a "gap". Give the label of the sentence with that idea as "sentence".
Step 3. If they used vague words (like "stuff" or "thing"), that is "unclear". Copy their exact vague words as "term" and leave "sentence" empty.

Ask contradictions first. Ask at most ${MAX_QUESTIONS} questions in total.
Rules:
- Copy their words exactly. Never change a word.
- Never explain, never give answers, never add facts.
- Do not repeat a question already asked.
- If their explanation matches the material well, ask fewer questions or none.`;

/** The instructions given to the model for listing what you missed. */
export const MISSES_SYSTEM = `You compare a student's explanation of a concept with their course material. Every sentence of the material has a label like [S3].
List the labels of up to ${MAX_MISSES} sentences with important points that the explanation and answers did not cover.
Rules:
- Only list a sentence if its point is really missing from what the student wrote.
- If nothing important is missing, return an empty list.`;

/**
 * Writes a question from its kind, where the quote comes from, and the exact quote or term.
 * For a contradiction, `yourWords` (the words of yours that disagree, already checked) are
 * shown too when known.
 */
export function renderQuestion(kind: Question["kind"], sourceLabel: string, words: string, yourWords?: string): string {
  if (kind === "contradiction") {
    return yourWords
      ? `${sourceLabel} says: “${words}” You wrote: “${yourWords}”. How does that fit?`
      : `${sourceLabel} says: “${words}” How does that fit with what you said?`;
  }
  if (kind === "gap") return `${sourceLabel} says: “${words}” Where does that fit in your explanation?`;
  return `What do you mean by “${words}”?`;
}

function clean(text: string): string {
  return text.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
}

/**
 * True if you corrected words of this sentence, in any passage: the corrected text is in the
 * sentence, or the sentence is inside the corrected text. The same wrong words stay wrong
 * wherever they appear, including a new copy of the file. Quote marks and punctuation typed
 * around a correction are ignored.
 */
export function isCorrected(sentence: string, corrections: { quote: string }[]): boolean {
  return corrections.some((c) => quoteMatches(c.quote, sentence) || quoteMatches(sentence, c.quote));
}

function realSentence(refs: Map<string, SentenceRef>, passages: Passage[], label: string): SentenceRef | undefined {
  const ref = lookupSentence(refs, label);
  const passage = ref && passages.find((p) => p.passageId === ref.passageId);
  return ref && passage && quoteMatches(ref.text, passage.text) ? ref : undefined;
}

/** What the teach-back guard needs to check the model's questions. */
export interface TeachCheckInput {
  /** The sentences shown to the model, by label (`S1`, `S2`, and so on). */
  refs: Map<string, SentenceRef>;
  /** The passages shown to the model. A quoted sentence must be found word for word in its passage here. */
  passages: Passage[];
  /** Your own words only: the explanation and your answers. Terms must come from here. */
  studentText: string;
  /** The questions asked in earlier rounds of this session. A question that repeats one is dropped. */
  previous: Question[];
  /** Text you corrected. A question may not quote it, because your correction wins. */
  corrections: { passageId: string; quote: string }[];
  /** Describes where a passage is, such as "Page 4 of ch1.pdf". */
  labelFor: (passageId: string) => string;
}

/**
 * The guard for teach-back questions. Contradiction and gap questions must point at a real
 * sentence of the material, which becomes the quote; unclear questions must use words you
 * wrote. An unclear question that points at a sentence but not at your words becomes a gap.
 * Repeats of earlier questions, and quotes of text you corrected, are dropped. At most
 * {@link MAX_QUESTIONS} are kept.
 */
export function validateTeachReply(reply: TeachReply, input: TeachCheckInput): { questions: Question[]; dropped: number } {
  const questions: Question[] = [];
  let dropped = 0;
  const keyOf = (q: Pick<Question, "quote" | "term">) => (q.quote ? `${q.quote.passageId}:${nameKey(q.quote.text)}` : `term:${nameKey(q.term ?? "")}`);
  const asked = new Set(input.previous.map(keyOf));
  for (const raw of reply.questions) {
    if (questions.length >= MAX_QUESTIONS) break;
    const term = clean(raw.term);
    const termIsYours = Boolean(term) && term.length <= 120 && termInText(term, input.studentText);
    const sentence = raw.sentence.trim() ? realSentence(input.refs, input.passages, raw.sentence) : undefined;
    const kind = raw.kind === "unclear" && !termIsYours && sentence ? "gap" : raw.kind;

    if (kind === "unclear") {
      const key = `term:${nameKey(term)}`;
      if (!termIsYours || term.split(/\s+/).length > 6 || asked.has(key)) {
        dropped += 1;
        continue;
      }
      asked.add(key);
      questions.push({ questionId: newId("q"), kind, term, text: renderQuestion(kind, "", term) });
      continue;
    }

    const key = sentence ? `${sentence.passageId}:${nameKey(sentence.text)}` : "";
    const corrected = sentence && isCorrected(sentence.text, input.corrections);
    if (!sentence || asked.has(key) || corrected) {
      dropped += 1;
      continue;
    }
    asked.add(key);
    questions.push({
      questionId: newId("q"),
      kind,
      quote: { passageId: sentence.passageId, text: sentence.text },
      text: renderQuestion(kind, input.labelFor(sentence.passageId), sentence.text, kind === "contradiction" && termIsYours ? term : undefined),
    });
  }
  return { questions, dropped };
}

/**
 * The guard for "what you missed": only real sentences of the material, at most
 * {@link MAX_MISSES}, no repeats, and never a sentence you corrected, because your correction wins.
 */
export function validateMisses(
  reply: MissesReply,
  refs: Map<string, SentenceRef>,
  passages: Passage[],
  corrections: { passageId?: string; quote: string }[] = [],
): { misses: Miss[]; dropped: number } {
  const misses: Miss[] = [];
  let dropped = 0;
  const seen = new Set<string>();
  for (const raw of reply.missed) {
    const sentence = realSentence(refs, passages, raw.sentence);
    const key = sentence ? `${sentence.passageId}:${nameKey(sentence.text)}` : "";
    if (!sentence || seen.has(key) || misses.length >= MAX_MISSES || isCorrected(sentence.text, corrections)) {
      dropped += 1;
      continue;
    }
    seen.add(key);
    misses.push({ missId: newId("miss"), quote: { passageId: sentence.passageId, text: sentence.text } });
  }
  return { misses, dropped };
}

/**
 * Chooses the next round of questions. With no passages at all, it returns
 * `notInMaterial` without asking the model. `notes` holds your corrections and readings per
 * passage; the model sees them under the passage.
 */
export async function askQuestions(input: {
  conceptName: string;
  passages: Passage[];
  studentText: string;
  previous: Question[];
  corrections: { passageId: string; quote: string }[];
  notes: Map<string, string[]>;
  labelFor: (passageId: string) => string;
  ask: Ask;
  transcript?: string;
}): Promise<{ questions: Question[]; dropped: number; notInMaterial: boolean }> {
  if (input.passages.length === 0) return { questions: [], dropped: 0, notInMaterial: true };
  const { block, refs } = numberSentences(input.passages, input.notes);
  const asked = input.previous.length ? `\n\nQuestions already asked:\n${input.previous.map((q) => `- ${q.text}`).join("\n")}` : "";
  const prompt = `Concept: ${input.conceptName}\n\nCourse material:\n${block}\n\nWhat they wrote:\n${input.transcript ?? input.studentText}${asked}`;
  const reply = await input.ask({ system: TEACH_SYSTEM, prompt, schema: teachReplySchema });
  const checked = validateTeachReply(reply, {
    refs,
    passages: input.passages,
    studentText: input.studentText,
    previous: input.previous,
    corrections: input.corrections,
    labelFor: input.labelFor,
  });
  return { ...checked, notInMaterial: false };
}

/** A sentence counts as barely used when less than this share of its meaningful words appears in what you wrote. */
export const MISS_COVERAGE = 0.5;

/**
 * Proposes what you missed: first, in plain code, the sentences whose meaningful words you
 * barely used (see {@link MISS_COVERAGE}); then any sentences the model adds. Only real
 * sentences of the material, at most {@link MAX_MISSES}. You confirm each one.
 */
export async function askMisses(input: {
  conceptName: string;
  passages: Passage[];
  studentText: string;
  notes: Map<string, string[]>;
  /** Text you corrected. It is never proposed as missed, because your correction wins. */
  corrections?: { passageId?: string; quote: string }[];
  ask: Ask;
  transcript?: string;
}): Promise<{ misses: Miss[]; dropped: number }> {
  if (input.passages.length === 0) return { misses: [], dropped: 0 };
  const { block, refs } = numberSentences(input.passages, input.notes);
  const barelyUsed = [...refs.entries()]
    .map(([label, ref]) => ({ label, score: coverage(ref.text, input.studentText) }))
    .filter((x) => x.score < MISS_COVERAGE)
    .sort((a, b) => a.score - b.score)
    .map((x) => ({ sentence: x.label }));
  const prompt = `Concept: ${input.conceptName}\n\nCourse material:\n${block}\n\nWhat the student wrote:\n${input.transcript ?? input.studentText}`;
  const reply = await input.ask({ system: MISSES_SYSTEM, prompt, schema: missesReplySchema });
  const corrections = input.corrections ?? [];
  const merged = validateMisses({ missed: [...barelyUsed, ...reply.missed] }, refs, input.passages, corrections);
  return { misses: merged.misses, dropped: validateMisses(reply, refs, input.passages, corrections).dropped };
}
