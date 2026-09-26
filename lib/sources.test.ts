import { describe, expect, it } from "vitest";
import { describeLocation } from "./sources";

describe("describeLocation", () => {
  it("names the slide, page, sheet, or section", () => {
    expect(describeLocation({ slide: 12 }, "Week 3.pptx")).toBe("Slide 12 of Week 3.pptx");
    expect(describeLocation({ slide: 2, notes: true }, "deck.pptx")).toBe("The notes on slide 2 of deck.pptx");
    expect(describeLocation({ page: 4 }, "ch1.pdf")).toBe("Page 4 of ch1.pdf");
    expect(describeLocation({ sheet: "Enzymes", cells: "A1:B3" }, "t.xlsx")).toBe("Cells A1:B3 of sheet “Enzymes” in t.xlsx");
    expect(describeLocation({ cells: "A1:B2" }, "t.csv")).toBe("Cells A1:B2 of t.csv");
    expect(describeLocation({ heading: "Alleles" }, "notes.md")).toBe("The section “Alleles” of notes.md");
    expect(describeLocation({}, "ideas.txt")).toBe("ideas.txt");
  });

  it("names the paragraph of a plain text file", () => {
    expect(describeLocation({ paragraph: 3 }, "ideas.txt")).toBe("Paragraph 3 of ideas.txt");
  });
});
