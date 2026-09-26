import { z } from "zod";
import type { Passage, Quote, Section } from "./events";
import type { Ask } from "./model";
import { quoteMatches } from "./quote";
import { lookupSentence, splitSentences, type SentenceRef } from "./sentences";
import { contentWords, sameWord } from "./words";

/** The most characters of passages sent to the model in one concept request. */
export const MAX_BATCH_CHARS = 5000;

/** The shape the model must reply in when proposing concepts: names and sentence labels, never quotes of its own. */
export const conceptReplySchema = z.object({
  concepts: z.array(
    z.object({
      name: z.string().describe("The concept's name, 2 to 6 words."),
      sentences: z.array(z.string().describe('The label of a material sentence, like "S3".')),
    }),
  ),
  unclear: z.array(z.object({ sentence: z.string().describe('The label of a material sentence that is hard to read or could mean two things, like "S3".') })),
});
/** The model's reply when proposing concepts, before any checks. */
export type ConceptReply = z.infer<typeof conceptReplySchema>;

/** The instructions given to the model for proposing concepts. */
export const CONCEPT_SYSTEM = `You help a student build a concept map from their own course material.
The material is split into sections, and every sentence has a label like [S3].
Rules:
- Propose the main ideas a student should be able to explain in a few sentences, not single terms. A section usually has 1 to 3.
- Often the section's own topic is the first concept.
- Name each concept in 2 to 6 words, using only words from its section of the material. A name is a topic, never a sentence.
- The section headings are already concepts. Only add ideas inside a section that deserve their own name.
- For each concept, list the labels of the 1 to 3 sentences that state it, like ["S1", "S2"].
- Never add facts or explanations of your own.
- If a sentence is hard to read or could mean two things, add its label to "unclear".
- If the sentences have no real concepts (for example a title page), return an empty list.`;

/** A group of passages sent to the model in one request. */
export interface Batch {
  /** The sections the passages belong to, in file order. A section split across batches is in each of them. */
  sections: Section[];
  /** The passages in this request, in file order. */
  passages: Passage[];
}

/** Groups passages into requests of about `maxChars` characters, keeping each section together where possible. */
export function batchSections(sections: Section[], passages: Passage[], maxChars = MAX_BATCH_CHARS): Batch[] {
  const bySection = new Map<string, Passage[]>();
  for (const p of [...passages].sort((a, b) => a.ordinal - b.ordinal)) {
    bySection.set(p.sectionId, [...(bySection.get(p.sectionId) ?? []), p]);
  }
  const batches: Batch[] = [];
  let current: Batch = { sections: [], passages: [] };
  let size = 0;
  const flush = () => {
    if (current.passages.length) batches.push(current);
    current = { sections: [], passages: [] };
    size = 0;
  };
  for (const section of [...sections].sort((a, b) => a.ordinal - b.ordinal)) {
    const own = bySection.get(section.sectionId) ?? [];
    if (own.length === 0) continue;
    const total = own.reduce((n, p) => n + p.text.length, 0);
    if (size > 0 && size + total > maxChars) flush();
    current.sections.push(section);
    for (const p of own) {
      if (size > 0 && size + p.text.length > maxChars) {
        flush();
        current.sections.push(section);
      }
      current.passages.push(p);
      size += p.text.length;
    }
  }
  flush();
  return batches;
}

/** Normalizes a concept name for comparing: trimmed, single spaces, lower case, without a leading "the", "a", or "an". */
export function nameKey(name: string): string {
  return name
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/^(the|a|an) /, "");
}

/** The longest concept name the model may propose, in words. A name is a topic, not a sentence. */
export const MAX_NAME_WORDS = 6;
/** The most concepts the model may add to one section, on top of the heading's own concept. */
export const MAX_MODEL_CONCEPTS_PER_SECTION = 3;

const FILLER = new Set(["definition", "of", "the", "a", "an", "role", "function", "meaning", "what", "is", "overview", "introduction", "basics", "concept", "about"]);

/**
 * Words that name a kind of topic without stating anything about it, so a concept name may use
 * them even when the material does not ("Sodium-potassium pump function").
 */
const TOPIC_WORDS = new Set([
  ...FILLER,
  "structure", "structures", "mechanism", "mechanisms", "process", "processes", "type", "types", "example", "examples",
  "location", "use", "uses", "usage", "properties", "property", "characteristics", "requirement", "requirements",
  "response", "responses", "stages", "stage", "steps", "step", "parts", "part", "components", "overview", "summary", "key", "main",
]);

function coreWords(name: string): string {
  return nameKey(name)
    .split(/[^\p{L}\p{N}-]+/u)
    .filter((w) => w && !FILLER.has(w))
    .sort()
    .join(" ");
}

/**
 * Concepts for the material's real headings, made in plain code: each heading becomes a
 * concept named after it, backed by the first two sentences of its section and the first
 * sentence of up to two more of its passages, so teach-back covers the whole section. A
 * heading is almost always a main idea, so these do not depend on the model at all.
 */
export function headingConcepts(sections: Section[], passages: Passage[], existingNames: Set<string>): CheckedConcept[] {
  const out: CheckedConcept[] = [];
  const names = new Set(existingNames);
  for (const section of [...sections].sort((a, b) => a.ordinal - b.ordinal)) {
    const name = section.title.replace(/\s+/g, " ").replace(/[:.]+$/, "").trim();
    const first = passages.filter((p) => p.sectionId === section.sectionId).sort((a, b) => a.ordinal - b.ordinal)[0];
    if (!section.heading || !first || !name || name.length > 120 || names.has(nameKey(name))) continue;
    const rest = passages.filter((p) => p.sectionId === section.sectionId && p !== first).sort((a, b) => a.ordinal - b.ordinal);
    const picks = [
      ...splitSentences(first.text)
        .slice(0, 2)
        .map((text) => ({ passage: first, text })),
      ...rest.slice(0, 2).map((p) => ({ passage: p, text: splitSentences(p.text)[0] ?? "" })),
    ];
    const quotes = picks.filter((q) => q.text && quoteMatches(q.text, q.passage.text)).map((q) => ({ passageId: q.passage.passageId, text: q.text }));
    if (quotes.length === 0) continue;
    names.add(nameKey(name));
    out.push({ name, sectionId: section.sectionId, quotes });
  }
  return out;
}

/** A concept that passed the checks, ready to be saved as proposed. */
export interface CheckedConcept {
  /** The concept's name, at most 120 characters, with runs of spaces made single. A heading's concept is named after the heading, without colons or full stops at the end. */
  name: string;
  /** The section the concept belongs to: its heading's section, or the section of its first quote. */
  sectionId: string;
  /** The sentences from the material that state the concept, each checked against its passage. At least one. */
  quotes: Quote[];
}

/**
 * The question Kizuki asks about a sentence it is not sure how to read. Always these fixed
 * words: the model only points at the sentence and never writes the question.
 */
export const UNCLEAR_QUESTION = "Kizuki is not sure how to read this sentence. What does it mean?";

/** The most "what does this mean?" questions kept from one model request. */
export const MAX_UNCLEAR_PER_REQUEST = 2;

/** A "what does this mean?" question that passed the quote check. */
export interface CheckedUnclear {
  /** The passage the sentence comes from. */
  passageId: string;
  /** The sentence Kizuki is not sure how to read, taken from the material and checked against its passage. */
  quote: string;
  /** The question's words. Always `UNCLEAR_QUESTION`. */
  question: string;
}

/**
 * The guard for concept proposals. The model only gives sentence labels; each label is
 * looked up to get the exact sentence, which is then checked word for word against its
 * passage. A concept is kept only if at least one of its sentences is real, its name is a
 * name (at most {@link MAX_NAME_WORDS} words, not a question or a note) made only of words
 * from its section of the material, so it can't state a fact of the model's own, the course does not
 * already have it (even as "definition of …"), and its section has fewer than
 * {@link MAX_MODEL_CONCEPTS_PER_SECTION} model concepts. Everything else is dropped and counted.
 */
export function validateConceptReply(
  reply: ConceptReply,
  refs: Map<string, SectionSentenceRef>,
  existingNames: Set<string>,
  /** Model concepts already kept per section, from earlier requests for the same material. Updated as concepts are kept. */
  perSection: Map<string, number> = new Map(),
): { concepts: CheckedConcept[]; unclear: CheckedUnclear[]; dropped: number } {
  const concepts: CheckedConcept[] = [];
  let dropped = 0;
  const seen = new Set(existingNames);
  const cores = new Set([...existingNames].map(coreWords));
  for (const proposal of reply.concepts) {
    const name = proposal.name.replace(/\s+/g, " ").trim();
    const key = nameKey(name);
    const quotes: (Quote & { sectionId: string; sectionText: string })[] = [];
    for (const label of proposal.sentences) {
      const ref = lookupSentence(refs, label);
      if (ref && quoteMatches(ref.text, ref.passageText) && !quotes.some((q) => q.passageId === ref.passageId && q.text === ref.text)) {
        quotes.push({ passageId: ref.passageId, text: ref.text, sectionId: ref.sectionId, sectionText: ref.sectionText });
      }
      if (quotes.length === 3) break;
    }
    // Every meaningful word of the name must come from its section: the heading and the section's text.
    const source = contentWords(quotes.map((q) => q.sectionText).join(" "));
    const ownWords = contentWords(name).some((w) => !TOPIC_WORDS.has(w) && !source.some((t) => sameWord(w, t)));
    const notAName = name.includes("?") || /^(unclear|note|question)\b/i.test(name) || name.split(/\s+/).length > MAX_NAME_WORDS;
    const section = quotes[0]?.sectionId ?? "";
    const full = (perSection.get(section) ?? 0) >= MAX_MODEL_CONCEPTS_PER_SECTION;
    if (!name || name.length > 120 || notAName || ownWords || seen.has(key) || cores.has(coreWords(name)) || quotes.length === 0 || full) {
      dropped += 1;
      continue;
    }
    seen.add(key);
    cores.add(coreWords(name));
    perSection.set(section, (perSection.get(section) ?? 0) + 1);
    concepts.push({ name, sectionId: quotes[0]!.sectionId, quotes: quotes.map(({ passageId, text }) => ({ passageId, text })) });
  }

  const unclear: CheckedUnclear[] = [];
  for (const u of reply.unclear) {
    if (unclear.length >= MAX_UNCLEAR_PER_REQUEST) break;
    const ref = lookupSentence(refs, u.sentence);
    if (!ref || !quoteMatches(ref.text, ref.passageText) || unclear.some((x) => x.passageId === ref.passageId && x.quote === ref.text)) continue;
    unclear.push({ passageId: ref.passageId, quote: ref.text, question: UNCLEAR_QUESTION });
  }
  return { concepts, unclear, dropped };
}

/** A sentence label as used for concepts: also knows its section and its passage's full text. */
export interface SectionSentenceRef extends SentenceRef {
  /** The section of the sentence's passage. */
  sectionId: string;
  /** The section's heading and all its text in this request, where a concept's name must take its words from. */
  sectionText: string;
  /** The full text of the sentence's passage, which the sentence is checked against. */
  passageText: string;
}

/** Writes the request for one batch, with every sentence labeled S1, S2, and so on under its section. */
export function conceptPrompt(batch: Batch): { prompt: string; refs: Map<string, SectionSentenceRef> } {
  const refs = new Map<string, SectionSentenceRef>();
  const lines: string[] = [];
  let n = 0;
  for (const section of batch.sections) {
    lines.push(`## Section: ${section.title}`);
    const own = batch.passages.filter((p) => p.sectionId === section.sectionId);
    const sectionText = [section.title, ...own.map((p) => p.text)].join("\n");
    for (const p of own) {
      for (const sentence of splitSentences(p.text)) {
        n += 1;
        refs.set(`S${n}`, { passageId: p.passageId, text: sentence, sectionId: p.sectionId, sectionText, passageText: p.text });
        lines.push(`[S${n}] ${sentence}`);
      }
    }
    lines.push("");
  }
  lines.push("Propose the main concepts in these sections.");
  return { prompt: lines.join("\n"), refs };
}

/**
 * Proposes concepts for a material: first one per real heading ({@link headingConcepts}),
 * then the model's, batch by batch, keeping only those that pass {@link validateConceptReply}
 * and are not already there.
 */
export async function proposeConcepts(input: {
  sections: Section[];
  passages: Passage[];
  existingNames: Set<string>;
  ask: Ask;
  maxBatchChars?: number;
}): Promise<{ concepts: CheckedConcept[]; unclear: CheckedUnclear[]; dropped: number }> {
  const names = new Set(input.existingNames);
  const out = { concepts: headingConcepts(input.sections, input.passages, names), unclear: [] as CheckedUnclear[], dropped: 0 };
  // Shared by every request, because a long section is split across several.
  const perSection = new Map<string, number>();
  for (const c of out.concepts) names.add(nameKey(c.name));
  for (const batch of batchSections(input.sections, input.passages, input.maxBatchChars)) {
    const { prompt, refs } = conceptPrompt(batch);
    const reply = await input.ask({ system: CONCEPT_SYSTEM, prompt, schema: conceptReplySchema });
    const checked = validateConceptReply(reply, refs, names, perSection);
    for (const c of checked.concepts) names.add(nameKey(c.name));
    out.concepts.push(...checked.concepts);
    out.unclear.push(...checked.unclear);
    out.dropped += checked.dropped;
  }
  return out;
}
