import { chunkParagraphs, type Paragraph } from "./chunk";
import type { Extracted, ExtractedSection } from "./types";

/** Removes markdown formatting marks so quotes can be checked against the words alone. */
export function stripInlineMarkdown(line: string): string {
  return line
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^*\w])\*(?!\s)([^*]+?)\*(?!\w)/g, "$1$2")
    .replace(/^\s*>\s?/, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "");
}

/** Reads a markdown file. `#` headings become sections; formatting marks are removed from the text. */
export function extractMarkdown(bytes: Uint8Array, baseName: string): Extracted {
  const lines = new TextDecoder().decode(bytes).split(/\r?\n/);
  const sections: ExtractedSection[] = [];
  const paragraphs: Paragraph[][] = [];
  let buffer: string[] = [];
  let inFence = false;
  const ensureSection = () => {
    if (sections.length === 0) {
      sections.push({ title: baseName, level: 1 });
      paragraphs.push([]);
    }
  };
  const flush = () => {
    if (buffer.length === 0) return;
    ensureSection();
    const sectionIndex = sections.length - 1;
    paragraphs[sectionIndex]!.push({ text: buffer.join("\n"), location: { heading: sections[sectionIndex]!.title }, group: String(sectionIndex) });
    buffer = [];
  };
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      buffer.push(line);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      sections.push({ title: stripInlineMarkdown(heading[2]!), level: heading[1]!.length, heading: true });
      paragraphs.push([]);
    } else if (line.trim() === "") flush();
    else buffer.push(stripInlineMarkdown(line));
  }
  flush();
  const passages = paragraphs.flatMap((paras, sectionIndex) =>
    chunkParagraphs(paras).map((chunk) => ({ sectionIndex, text: chunk.text, location: chunk.location })),
  );
  return { sections, passages };
}

/** Reads a plain text file as one section named after the file, split at blank lines. Each passage knows its paragraph number. */
export function extractText(bytes: Uint8Array, baseName: string): Extracted {
  const text = new TextDecoder().decode(bytes);
  const paras = text
    .split(/\r?\n\s*\r?\n/)
    .filter((p) => p.trim())
    .map((p, i) => ({ text: p, group: "0", location: { paragraph: i + 1 } }));
  return {
    sections: [{ title: baseName, level: 1 }],
    // Each passage is placed by its first paragraph, counted from the top of the file.
    passages: chunkParagraphs(paras).map((chunk) => ({ sectionIndex: 0, text: chunk.text, location: chunk.location })),
  };
}
