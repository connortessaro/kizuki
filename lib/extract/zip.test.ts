import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { openZip } from "./zip";

const text = (s: string) => new TextEncoder().encode(s);

describe("openZip", () => {
  it("unpacks only the XML parts Kizuki reads, and skips pictures and other files", () => {
    const files = openZip(zipSync({ "word/document.xml": text("<w/>"), "word/_rels/document.xml.rels": text("<r/>"), "word/media/big.png": new Uint8Array(10) }), "docx");
    expect(Object.keys(files).sort()).toEqual(["word/_rels/document.xml.rels", "word/document.xml"]);
  });

  it("refuses a file whose parts unpack to far more than any real course file", () => {
    const bomb = zipSync({ "word/document.xml": new Uint8Array(2_000_000) });
    expect(() => openZip(bomb, "docx", { maxEntryBytes: 1_000_000, maxTotalBytes: 5_000_000, maxEntries: 100 })).toThrow(/too big to read safely/);
  });

  it("refuses a file whose parts add up to too much, even when each part is small", () => {
    const parts = Object.fromEntries([...Array(6)].map((_, i) => [`ppt/slides/slide${i}.xml`, new Uint8Array(900_000)]));
    expect(() => openZip(zipSync(parts), "pptx", { maxEntryBytes: 1_000_000, maxTotalBytes: 5_000_000, maxEntries: 100 })).toThrow(/too big to read safely/);
  });

  it("refuses a file with too many parts", () => {
    const parts = Object.fromEntries([...Array(20)].map((_, i) => [`xl/worksheets/sheet${i}.xml`, text("<x/>")]));
    expect(() => openZip(zipSync(parts), "xlsx", { maxEntryBytes: 1_000_000, maxTotalBytes: 5_000_000, maxEntries: 10 })).toThrow(/too many parts/);
  });
});
