import { describe, expect, it } from "vitest";
import { coverage, matchedWords } from "./words";

describe("words", () => {
  it("counts shared meaningful words, allowing simple endings", () => {
    expect(matchedWords("glucose releases energy", "Cells break down glucose to release energy.")).toBe(3);
    expect(matchedWords("the of and", "the of and")).toBe(0);
  });

  it("measures how much of a sentence a text covers", () => {
    expect(coverage("It requires energy, usually from ATP.", "Active transport moves substances against their concentration gradient.")).toBe(0);
    expect(coverage("Active transport moves substances against their concentration gradient.", "Active transport moves substances against their concentration gradient.")).toBe(1);
  });
});
