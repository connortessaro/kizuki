import { describe, expect, it } from "vitest";
import { makePdf, makeZip } from "../test-helpers/fixtures";
import { extract } from "./index";
import { extractPdf } from "./pdf";

// Files a classmate could share on purpose to hang or crash Kizuki. Each must be refused or
// read quickly, never left to run the computer out of memory or time.

describe("hostile files", () => {
  it("refuses a PDF with far more pages than any course file, before reading them", async () => {
    const pdf = makePdf([...Array(6)].map((_, i) => [`Page ${i + 1}`]));
    await expect(extractPdf(pdf, 5)).rejects.toThrow(/6 pages.*at most 5/);
  });

  it("refuses a Word file whose XML is nested thousands of levels deep, quickly", async () => {
    const deep = `${"<w:p>".repeat(5000)}x${"</w:p>".repeat(5000)}`;
    const docx = makeZip({
      "[Content_Types].xml": "<Types/>",
      "word/document.xml": `<w:document xmlns:w="w"><w:body>${deep}</w:body></w:document>`,
    });
    const started = Date.now();
    await expect(extract("docx", docx, "deep.docx")).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("refuses a Word file that expands entities into gigabytes, quickly", async () => {
    const lol = `<!DOCTYPE d [<!ENTITY a "aaaaaaaaaa">${[...Array(9)].map((_, i) => `<!ENTITY ${String.fromCharCode(98 + i)} "${`&${String.fromCharCode(97 + i)};`.repeat(10)}">`).join("")}]>`;
    const docx = makeZip({
      "[Content_Types].xml": "<Types/>",
      "word/document.xml": `${lol}<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>&j;</w:t></w:r></w:p></w:body></w:document>`,
    });
    const started = Date.now();
    const out = await extract("docx", docx, "lol.docx").catch((e: Error) => e);
    expect(Date.now() - started).toBeLessThan(2000);
    if (!(out instanceof Error)) expect(out.passages.map((p) => p.text).join("").length).toBeLessThan(1_000_000);
  });
});
