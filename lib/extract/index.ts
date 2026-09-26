import { basename, extname } from "node:path";
import type { Format, Passage, Section } from "../events";
import { stableId } from "../ids";
import { extractCsv } from "./csv";
import { extractDocx } from "./docx";
import { extractPdf } from "./pdf";
import { extractPptx } from "./pptx";
import { extractMarkdown, extractText } from "./text";
import type { Extracted } from "./types";
import { extractXlsx } from "./xlsx";

export type { Extracted } from "./types";

const EXTENSIONS: Record<string, Format> = {
  ".pdf": "pdf",
  ".pptx": "pptx",
  ".docx": "docx",
  ".xlsx": "xlsx",
  ".csv": "csv",
  ".md": "md",
  ".markdown": "md",
  ".txt": "txt",
};

/** The format of a file from its name, or `null` if Kizuki cannot read it yet. */
export function formatOf(fileName: string): Format | null {
  return EXTENSIONS[extname(fileName).toLowerCase()] ?? null;
}

/**
 * Reads the text out of a file, with its sections and where each passage came from.
 * Throws if the file has no readable text, such as a scanned PDF.
 */
export async function extract(format: Format, bytes: Uint8Array, fileName: string): Promise<Extracted> {
  const base = basename(fileName, extname(fileName));
  const out =
    format === "pdf"
      ? await extractPdf(bytes)
      : format === "docx"
        ? extractDocx(bytes, base)
        : format === "pptx"
          ? extractPptx(bytes)
          : format === "xlsx"
            ? extractXlsx(bytes)
            : format === "csv"
              ? extractCsv(bytes, base)
              : format === "md"
                ? extractMarkdown(bytes, base)
                : extractText(bytes, base);
  if (out.passages.length === 0) {
    throw new Error(
      `${fileName}: no readable text found. If it is a scanned PDF or an image, it needs text recognition, which comes in a later version.`,
    );
  }
  return out;
}

/** Gives the extracted sections and passages their ids. The same material always gets the same ids. */
export function toRecords(materialId: string, extracted: Extracted): { sections: Section[]; passages: Passage[] } {
  const sections = extracted.sections.map((s, ordinal) => ({
    sectionId: stableId("sec", materialId, ordinal),
    title: s.title,
    level: Math.min(Math.max(s.level, 1), 6),
    ordinal,
    ...(s.heading ? { heading: true } : {}),
  }));
  const passages = extracted.passages.map((p, ordinal) => ({
    passageId: stableId("psg", materialId, ordinal),
    materialId,
    sectionId: sections[p.sectionIndex]!.sectionId,
    ordinal,
    text: p.text,
    location: p.location,
  }));
  return { sections, passages };
}
