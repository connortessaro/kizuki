import { describe, expect, it } from "vitest";
import type { Passage } from "./events";
import { lookupSentence, numberSentences, splitSentences } from "./sentences";

const passage = (id: string, text: string): Passage => ({ passageId: id, materialId: "m", sectionId: "s", ordinal: 0, text, location: {} });

describe("splitSentences", () => {
  it("splits at sentence ends and line breaks", () => {
    expect(splitSentences("One idea. Two ideas!\nName | Value\n\nThree?")).toEqual(["One idea.", "Two ideas!", "Name | Value", "Three?"]);
  });

  it("keeps abbreviations like e.g. and numbers like 3.5 inside a sentence", () => {
    expect(splitSentences("Use a buffer, e.g. saline. The pH is 7.4 here.")).toEqual(["Use a buffer, e.g. saline.", "The pH is 7.4 here."]);
  });

  it("keeps a sentence whole when it runs over a printed line break, so a quote never drops the rest of it", () => {
    expect(splitSentences("Vaccines cause autism, according to a 1998 study\nthat was later retracted as fraudulent.")).toEqual([
      "Vaccines cause autism, according to a 1998 study that was later retracted as fraudulent.",
    ]);
    expect(splitSentences("Mitochondria are found in all eukaryotic cells\nexcept mature red blood cells.")).toEqual([
      "Mitochondria are found in all eukaryotic cells except mature red blood cells.",
    ]);
    expect(splitSentences("The enzyme was first described by\nBuchner in 1897.")).toEqual(["The enzyme was first described by Buchner in 1897."]);
  });

  it("joins a word split by a hyphen at a line end", () => {
    expect(splitSentences("Plants use photo-\nsynthesis to make sugar.")).toEqual(["Plants use photosynthesis to make sugar."]);
  });

  it("still splits list lines and titles that start with a capital letter or a bullet", () => {
    expect(splitSentences("Light reactions\nCalvin cycle\n- Stroma\n• Thylakoid")).toEqual(["Light reactions", "Calvin cycle", "- Stroma", "• Thylakoid"]);
  });
});

describe("numberSentences", () => {
  it("labels every sentence S1, S2, ... across passages and remembers where each came from", () => {
    const { block, refs } = numberSentences([passage("p1", "A is B. C is D."), passage("p2", "E is F.")], new Map([["p2", ["Your note: F is G."]]]));
    expect(block).toBe("Passage 1:\n[S1] A is B.\n[S2] C is D.\n\nPassage 2:\n[S3] E is F.\n  Your note: F is G.");
    expect(refs.get("S2")).toEqual({ passageId: "p1", text: "C is D." });
    expect(refs.get("S3")).toEqual({ passageId: "p2", text: "E is F." });
  });
});

describe("lookupSentence", () => {
  it("finds the label inside the extra text small models add", () => {
    const refs = new Map([["S6", { passageId: "p", text: "x" }]]);
    expect(lookupSentence(refs, "Passage 2: [S6] Most of the ATP")).toEqual({ passageId: "p", text: "x" });
    expect(lookupSentence(refs, " s6 ")).toEqual({ passageId: "p", text: "x" });
    expect(lookupSentence(refs, "S66")).toBeUndefined();
    expect(lookupSentence(refs, "none")).toBeUndefined();
  });
});

describe("lookupSentence with written-out sentences", () => {
  const refs = new Map([
    ["S1", { passageId: "p1", text: "They split water and release oxygen as a by-product." }],
    ["S2", { passageId: "p1", text: "The Calvin cycle takes place in the stroma." }],
  ]);

  it("accepts a sentence written out word for word instead of its label", () => {
    expect(lookupSentence(refs, "They split water and release oxygen as a by-product.")).toBe(refs.get("S1"));
    expect(lookupSentence(refs, "the calvin cycle takes place in the stroma")).toBe(refs.get("S2"));
  });

  it("accepts a long enough exact part of one sentence, and shows the whole sentence", () => {
    expect(lookupSentence(refs, "release oxygen as a by-product")).toBe(refs.get("S1"));
  });

  it("refuses text that is not in the material, or too short to point at one sentence", () => {
    expect(lookupSentence(refs, "They split water and release carbon dioxide.")).toBeUndefined();
    expect(lookupSentence(refs, "the stroma")).toBeUndefined();
  });
});
