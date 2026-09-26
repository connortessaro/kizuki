import type { Location } from "../events";

/** The largest passage Kizuki makes, in characters. Small enough for a small model to read many at once. */
export const MAX_PASSAGE = 900;

/** One paragraph of text before chunking. Paragraphs join only when they share a `group`. */
export interface Paragraph {
  /** The paragraph's text. A paragraph that is only spaces is skipped. */
  text: string;
  /** Where the paragraph sits in the file. `undefined` means an empty location. */
  location?: Location;
  /** Paragraphs with the same group may be joined. Defaults to the location. */
  group?: string;
}

/** A passage made from one or more paragraphs. */
export interface Chunk {
  /** The passage's text, trimmed, at most `max` characters. Joined paragraphs are separated by a blank line. */
  text: string;
  /** The location of the first paragraph in the passage. */
  location: Location;
}

function splitLong(text: string, max: number): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const out: string[] = [];
  let current = "";
  const flush = () => {
    if (current) out.push(current);
    current = "";
  };
  for (const sentence of sentences) {
    if (sentence.length > max) {
      flush();
      let rest = sentence;
      while (rest.length > max) {
        let cut = rest.lastIndexOf(" ", max);
        if (cut <= 0) cut = max;
        out.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      current = rest;
      continue;
    }
    if (current && current.length + 1 + sentence.length > max) flush();
    current = current ? `${current} ${sentence}` : sentence;
  }
  flush();
  return out;
}

/**
 * Turns paragraphs into passages of at most `max` characters.
 * Short neighbouring paragraphs in the same group are joined; long ones are split at sentence ends.
 */
export function chunkParagraphs(paragraphs: Paragraph[], max = MAX_PASSAGE): Chunk[] {
  const out: Chunk[] = [];
  let current: (Chunk & { group: string }) | null = null;
  for (const paragraph of paragraphs) {
    const text = paragraph.text.trim();
    if (!text) continue;
    const location = paragraph.location ?? {};
    const group = paragraph.group ?? JSON.stringify(location);
    const pieces = text.length > max ? splitLong(text, max) : [text];
    for (const piece of pieces) {
      if (current && current.group === group && current.text.length + 2 + piece.length <= max) {
        current.text = `${current.text}\n\n${piece}`;
        continue;
      }
      if (current) out.push({ text: current.text, location: current.location });
      current = { text: piece, location, group };
    }
  }
  if (current) out.push({ text: current.text, location: current.location });
  return out;
}
