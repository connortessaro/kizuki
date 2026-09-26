import { describe, expect, it } from "vitest";
import { findQuote, normalizeForMatch, quoteMatches, termInText } from "./quote";

describe("normalizeForMatch", () => {
  it("ignores differences in spaces, line breaks, letter case, and quote-mark style", () => {
    expect(normalizeForMatch("The  “cell”\n wall’s   role — key")).toBe(normalizeForMatch("the \"cell\" wall's role - KEY"));
  });

  it("unpacks ligatures that PDFs produce", () => {
    expect(normalizeForMatch("ﬁrst")).toBe("first");
  });
});

describe("quoteMatches", () => {
  const passage = "Photosynthesis converts light energy into chemical energy.\nIt happens in the chloroplast.";

  it("passes a quote that appears word for word", () => {
    expect(quoteMatches("converts light energy into chemical energy", passage)).toBe(true);
  });

  it("passes a quote that crosses a line break", () => {
    expect(quoteMatches("chemical energy. It happens", passage)).toBe(true);
  });

  it("fails a quote with any changed word", () => {
    expect(quoteMatches("converts light energy into stored energy", passage)).toBe(false);
  });

  it("fails an empty quote or one with no letters or digits", () => {
    expect(quoteMatches("", passage)).toBe(false);
    expect(quoteMatches(" ... ", passage)).toBe(false);
  });

  it("does not match part of a word", () => {
    expect(quoteMatches("synthesis converts", passage)).toBe(false);
    expect(quoteMatches("chloro", passage)).toBe(false);
  });

  it("passes a quote across a word split by a hyphen at a line end", () => {
    expect(quoteMatches("light energy into chemical", "light en-\nergy into chemical")).toBe(true);
  });

  it("stays fast on long runs of punctuation", () => {
    const started = Date.now();
    expect(quoteMatches(`${".".repeat(50_000)}x`, "x")).toBe(true);
    expect(quoteMatches(`x${"...".repeat(20_000)}!`, "x")).toBe(true);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("ignores wrapping quote marks and trailing punctuation the model adds", () => {
    expect(quoteMatches('"It happens in the chloroplast"', passage)).toBe(true);
    expect(quoteMatches("It happens in the chloroplast...", passage)).toBe(true);
  });
});

describe("findQuote", () => {
  const passages = [
    { passageId: "p1", text: "Enzymes speed up reactions." },
    { passageId: "p2", text: "Inhibitors slow enzymes down." },
  ];

  it("keeps the cited passage when the quote is there", () => {
    expect(findQuote("speed up reactions", "p1", passages)).toBe("p1");
  });

  it("points to the right passage when the model cited the wrong one", () => {
    expect(findQuote("slow enzymes down", "p1", passages)).toBe("p2");
  });

  it("returns null when the quote is in none of the passages", () => {
    expect(findQuote("enzymes are proteins", "p1", passages)).toBeNull();
  });
});

describe("termInText", () => {
  it("passes words that appear in your explanation", () => {
    expect(termInText("energy thing", "Plants make an Energy  thing from light")).toBe(true);
  });

  it("fails words you did not write", () => {
    expect(termInText("glucose", "Plants make an energy thing")).toBe(false);
  });
});
