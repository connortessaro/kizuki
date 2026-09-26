import { describe, expect, it } from "vitest";
import { makeDocx, makePdf, makePptx } from "../test-helpers/fixtures";
import { normalizeForMatch, quoteMatches } from "../quote";
import { splitSentences } from "../sentences";
import { coverage } from "../words";
import { extract } from "./index";

// Material shaped like real course files: sentences wrapped over printed lines, words split by a
// hyphen at a line end, bullet lists, contractions, and one-digit numbers. Each sentence below is
// how the author wrote it; Kizuki must never show a piece of one as if it were the whole.
const SENTENCES = [
  "Vaccines cause autism, according to a 1998 study that was later retracted as fraudulent.",
  "Mitochondria are found in all eukaryotic cells except mature red blood cells.",
  "Plants use photosynthesis to make sugar.",
  "Enzymes can't be reused once they are denatured.",
  "The human heart has 4 chambers.",
];
const WRAPPED = [
  "Vaccines cause autism, according to a 1998 study",
  "that was later retracted as fraudulent.",
  "Mitochondria are found in all eukaryotic cells",
  "except mature red blood cells. Plants use photo-",
  "synthesis to make sugar.",
  "Enzymes can't be reused once they are",
  "denatured. The human heart has 4 chambers.",
];
const enc = (s: string) => new TextEncoder().encode(s);

const FILES: [string, () => Promise<Awaited<ReturnType<typeof extract>>>][] = [
  ["pdf", () => extract("pdf", makePdf([["Cells", ...WRAPPED]]), "cells.pdf")],
  ["md", () => extract("md", enc(`# Cells\n\n${WRAPPED.join("\n")}\n`), "cells.md")],
  ["txt", () => extract("txt", enc(`${WRAPPED.join("\n")}\n`), "cells.txt")],
  ["docx", () => extract("docx", makeDocx([{ style: "Heading1", text: "Cells" }, ...SENTENCES.map((text) => ({ text }))]), "cells.docx")],
  ["pptx", () => extract("pptx", makePptx([{ title: "Cells", body: SENTENCES }]), "cells.pptx")],
];

describe.each(FILES)("sentences read from a %s file", (_format, read) => {
  it("are each a whole sentence the author wrote, never a piece of one", async () => {
    const sentences = (await read()).passages.flatMap((p) => splitSentences(p.text)).map(normalizeForMatch);
    const wanted = SENTENCES.map(normalizeForMatch);
    for (const s of sentences.filter((s) => s !== "cells")) expect(wanted, `"${s}" is not a whole sentence`).toContain(s);
    for (const w of wanted) expect(sentences, `"${w}" is missing`).toContain(w);
  });

  it("each pass the word-for-word check against their own passage", async () => {
    for (const p of (await read()).passages) for (const s of splitSentences(p.text)) expect(quoteMatches(s, p.text), s).toBe(true);
  });
});

describe("the quote check on real-shaped text", () => {
  it("never lets a quote stop inside a contraction, which would drop a \"not\"", () => {
    expect(quoteMatches("Enzymes can", "Enzymes can't be reused once they are denatured.")).toBe(false);
    expect(quoteMatches("You don", "You don’t need light.")).toBe(false);
    expect(quoteMatches("Enzymes can't", "Enzymes can't be reused once they are denatured.")).toBe(true);
  });
});

describe("the barely-used check on real-shaped text", () => {
  it("counts one-digit numbers, so \"3 chambers\" does not cover \"4 chambers\"", () => {
    expect(coverage("The human heart has 4 chambers.", "The human heart has 3 chambers.")).toBeLessThan(1);
    expect(coverage("The human heart has 4 chambers.", "A human heart has 4 chambers.")).toBe(1);
  });
});
