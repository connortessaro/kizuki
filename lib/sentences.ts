import type { Passage } from "./events";
import { quoteMatches } from "./quote";

/** A sentence the model can point to by its label, with the passage it belongs to. */
export interface SentenceRef {
  /** The passage the sentence comes from. */
  passageId: string;
  /** The sentence, as `splitSentences` cut it from the passage's text. */
  text: string;
}

const ABBREVIATIONS = /\b(e\.g|i\.e|etc|vs|approx|fig|eq|no|dr|mr|mrs|ms|st)\.$/i;

/** Words a sentence cannot end on, so a line that ends with one runs on to the next line. */
const RUNS_ON = new Set("a an the of by and or but to in on at for with from into as that which who whose than is are was were be been has have had not".split(" "));

/**
 * True if a printed line break falls inside a sentence: the line does not end a sentence,
 * and either the next line starts in lower case or the line ends on a word like "of" or "by".
 * List lines and titles (next line starts with a capital, a digit, or a bullet) stay apart.
 */
function runsOn(line: string, next: string): boolean {
  if (/[.!?:;]["'”’)]*$/.test(line) || /^[-–—•*▪◦·]/.test(next)) return false;
  if (/^\p{Ll}/u.test(next)) return true;
  if (/[,(]$/.test(line)) return true;
  const last = /([\p{L}]+)$/u.exec(line)?.[1]?.toLowerCase();
  return last !== undefined && RUNS_ON.has(last);
}

/** Joins the printed lines of a paragraph where a sentence runs over a line break, and joins words split by a hyphen at a line end. */
function joinLines(paragraph: string): string[] {
  const out: string[] = [];
  for (const raw of paragraph.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const prev = out[out.length - 1];
    if (prev !== undefined && /\p{L}-$/u.test(prev) && /^\p{Ll}/u.test(line)) out[out.length - 1] = `${prev.slice(0, -1)}${line}`;
    else if (prev !== undefined && runsOn(prev, line)) out[out.length - 1] = `${prev} ${line}`;
    else out.push(line);
  }
  return out;
}

/**
 * Splits text into sentences at sentence ends, blank lines, and line breaks between list
 * lines or titles. A sentence that runs over a printed line break (as in PDFs and wrapped
 * notes) stays whole, and abbreviations and decimal numbers stay inside their sentence.
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\n\s*\n/).flatMap(joinLines)) {
    let current = "";
    for (const piece of line.split(/(?<=[.!?])\s+/)) {
      current = current ? `${current} ${piece}` : piece;
      if (!ABBREVIATIONS.test(current)) {
        if (current.trim()) out.push(current.trim());
        current = "";
      }
    }
    if (current.trim()) out.push(current.trim());
  }
  return out;
}

/**
 * Writes passages for the model with every sentence labeled S1, S2, and so on. The model
 * answers with labels only; Kizuki looks up the exact sentence, so a quote can never be
 * made up. `notes` (your corrections and readings) are shown under their passage.
 */
export function numberSentences(passages: Passage[], notes: Map<string, string[]> = new Map()): { block: string; refs: Map<string, SentenceRef> } {
  const refs = new Map<string, SentenceRef>();
  let n = 0;
  const blocks = passages.map((p, i) => {
    const lines = splitSentences(p.text).map((sentence) => {
      n += 1;
      refs.set(`S${n}`, { passageId: p.passageId, text: sentence });
      return `[S${n}] ${sentence}`;
    });
    const extra = (notes.get(p.passageId) ?? []).map((note) => `  ${note}`);
    return [`Passage ${i + 1}:`, ...lines, ...extra].join("\n");
  });
  return { block: blocks.join("\n\n"), refs };
}

/** The fewest words a written-out part of a sentence needs, so it points at one sentence and not at a common phrase. */
export const MIN_WRITTEN_WORDS = 4;

/**
 * Looks up a sentence label from the model. Small models often wrap the label in extra
 * text ("Passage 2: [S6] Most of…", " s3 "), so the first S-number found is used. Some
 * write the sentence out instead of its label: that is accepted only when it appears word
 * for word in exactly one sentence of the material (at least {@link MIN_WRITTEN_WORDS}
 * words), and the whole real sentence is returned.
 */
export function lookupSentence<T extends SentenceRef>(refs: Map<string, T>, label: string): T | undefined {
  const match = /\bS\s*(\d+)\b/i.exec(label);
  if (match && refs.has(`S${match[1]}`)) return refs.get(`S${match[1]}`);
  if (label.trim().split(/\s+/).length < MIN_WRITTEN_WORDS) return undefined;
  const hits = [...refs.values()].filter((ref) => quoteMatches(label, ref.text));
  return hits.length === 1 ? hits[0] : undefined;
}
