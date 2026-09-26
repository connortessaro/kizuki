import { describe, expect, it } from "vitest";
import { makeDocx, makePdf, makePptx, makeXlsx } from "../test-helpers/fixtures";
import { chunkParagraphs } from "./chunk";
import { extract, formatOf, toRecords } from "./index";

const enc = (s: string) => new TextEncoder().encode(s);

describe("formatOf", () => {
  it("reads the format from the file name, ignoring case", () => {
    expect(formatOf("Lecture 3.PDF")).toBe("pdf");
    expect(formatOf("deck.pptx")).toBe("pptx");
    expect(formatOf("notes.markdown")).toBe("md");
    expect(formatOf("data.tsv")).toBeNull();
    expect(formatOf("scan.png")).toBeNull();
  });
});

describe("chunkParagraphs", () => {
  it("joins short paragraphs up to the size limit", () => {
    const out = chunkParagraphs([{ text: "One." }, { text: "Two." }, { text: "Three." }], 12);
    expect(out.map((p) => p.text)).toEqual(["One.\n\nTwo.", "Three."]);
  });

  it("splits a long paragraph at sentence ends", () => {
    const out = chunkParagraphs([{ text: "Alpha beta. Gamma delta. Epsilon zeta." }], 26);
    expect(out.map((p) => p.text)).toEqual(["Alpha beta. Gamma delta.", "Epsilon zeta."]);
  });

  it("never joins paragraphs with different locations", () => {
    const out = chunkParagraphs([{ text: "A.", location: { page: 1 } }, { text: "B.", location: { page: 2 } }], 100);
    expect(out).toHaveLength(2);
    expect(out[1]!.location).toEqual({ page: 2 });
  });
});

describe("extract", () => {
  it("reads a PDF page by page, one section per page titled by its first line", async () => {
    const pdf = makePdf([
      ["Photosynthesis", "Plants turn light into chemical energy."],
      ["Respiration", "Cells release energy from glucose."],
    ]);
    const out = await extract("pdf", pdf, "bio.pdf");
    expect(out.sections.map((s) => s.title)).toEqual(["Photosynthesis", "Respiration"]);
    expect(out.passages[0]!.location).toEqual({ page: 1 });
    expect(out.passages.map((p) => p.text).join(" ")).toContain("Plants turn light into chemical energy.");
    expect(out.passages.find((p) => p.text.includes("glucose"))!.sectionIndex).toBe(1);
  });

  it("reads a docx with its headings as sections", async () => {
    const docx = makeDocx([
      { style: "Heading1", text: "Cell parts" },
      { text: "The nucleus holds DNA." },
      { style: "Heading2", text: "Mitochondria" },
      { text: "Mitochondria release energy." },
    ]);
    const out = await extract("docx", docx, "notes.docx");
    expect(out.sections.map((s) => [s.title, s.level])).toEqual([["Cell parts", 1], ["Mitochondria", 2]]);
    expect(out.passages.map((p) => [p.sectionIndex, p.text])).toEqual([
      [0, "The nucleus holds DNA."],
      [1, "Mitochondria release energy."],
    ]);
    expect(out.passages[1]!.location.heading).toBe("Mitochondria");
  });

  it("reads a pptx slide by slide, with speaker notes as their own passages", async () => {
    const pptx = makePptx([
      { title: "Enzymes", body: ["Enzymes speed up reactions.", "They are not used up."], notes: "Mention temperature." },
      { title: "Inhibitors", body: ["Inhibitors slow enzymes."] },
    ]);
    const out = await extract("pptx", pptx, "deck.pptx");
    expect(out.sections.map((s) => s.title)).toEqual(["Enzymes", "Inhibitors"]);
    const slide1 = out.passages.filter((p) => p.location.slide === 1);
    expect(slide1.map((p) => p.text)).toEqual(["Enzymes speed up reactions.\nThey are not used up.", "Mention temperature."]);
    expect(slide1[1]!.location.notes).toBe(true);
    expect(out.passages.some((p) => p.text === "1")).toBe(false);
  });

  it("reads an xlsx sheet by sheet, rows as cell text with their cell range", async () => {
    const xlsx = makeXlsx([{ name: "Enzymes", rows: [["Name", "Optimum pH"], ["Pepsin", 2], ["Amylase", 7]] }]);
    const out = await extract("xlsx", xlsx, "table.xlsx");
    expect(out.sections.map((s) => s.title)).toEqual(["Enzymes"]);
    expect(out.passages[0]!.text).toBe("Name | Optimum pH\nPepsin | 2\nAmylase | 7");
    expect(out.passages[0]!.location).toEqual({ sheet: "Enzymes", cells: "A1:B3" });
  });

  it("reads a csv with quoted fields", async () => {
    const out = await extract("csv", enc('term,meaning\n"ATP","energy, stored"\n'), "terms.csv");
    expect(out.passages[0]!.text).toBe("term | meaning\nATP | energy, stored");
    expect(out.passages[0]!.location).toEqual({ cells: "A1:B2" });
  });

  it("reads markdown with headings as sections and without formatting marks", async () => {
    const md = "# Genetics\n\nA **gene** is a unit of [heredity](https://x.y).\n\n## Alleles\n\n- An allele is a gene variant.\n";
    const out = await extract("md", enc(md), "notes.md");
    expect(out.sections.map((s) => [s.title, s.level])).toEqual([["Genetics", 1], ["Alleles", 2]]);
    expect(out.passages.map((p) => p.text)).toEqual(["A gene is a unit of heredity.", "An allele is a gene variant."]);
  });

  it("reads plain text as one section named after the file", async () => {
    const out = await extract("txt", enc("First idea.\n\nSecond idea.\n"), "ideas.txt");
    expect(out.sections).toEqual([{ title: "ideas", level: 1 }]);
    expect(out.passages[0]!.text).toBe("First idea.\n\nSecond idea.");
    expect(out.passages[0]!.location).toEqual({ paragraph: 1 });
  });

  it("fails loudly on a file with no readable text", async () => {
    await expect(extract("txt", enc("   \n\n"), "empty.txt")).rejects.toThrow(/no readable text/);
  });
});

describe("toRecords", () => {
  it("gives sections and passages ids that stay the same for the same material", () => {
    const extracted = { sections: [{ title: "A", level: 1 }], passages: [{ sectionIndex: 0, text: "x", location: {} }] };
    const a = toRecords("mat_1", extracted);
    const b = toRecords("mat_1", extracted);
    expect(a).toEqual(b);
    expect(a.passages[0]).toMatchObject({ materialId: "mat_1", sectionId: a.sections[0]!.sectionId, ordinal: 0, text: "x" });
    expect(toRecords("mat_2", extracted).passages[0]!.passageId).not.toBe(a.passages[0]!.passageId);
  });
});
