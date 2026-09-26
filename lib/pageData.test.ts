import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addMaterial, createCourse } from "./commands";
import { appendLog } from "./log";
import { loadPageData, passageLabel } from "./pageData";
import { tempHome } from "./test-helpers/home";

let home: string;
let cleanup: () => void;
const before = process.env.KIZUKI_HOME;
beforeEach(() => {
  ({ home, cleanup } = tempHome());
  process.env.KIZUKI_HOME = home;
});
afterEach(() => {
  process.env.KIZUKI_HOME = before;
  cleanup();
});

describe("loadPageData", () => {
  it("reads fresh state and passages from the home folder, and today's date", async () => {
    const courseId = await createCourse(home, "Biology");
    const materialId = await addMaterial(home, { courseId, fileName: "deck.pptx", bytes: new Uint8Array([1]) });
    await appendLog(home, "passages", [
      { type: "passages.extracted", at: new Date().toISOString(), materialId, passages: [{ passageId: "psg_1", materialId, sectionId: "s", ordinal: 0, text: "Hi.", location: { slide: 3 } }] },
    ]);
    const data = await loadPageData();
    expect(data.home).toBe(home);
    expect(data.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(passageLabel(data, "psg_1")).toBe("Slide 3 of deck.pptx");
    expect(passageLabel(data, "psg_gone")).toBe("Your material");
  });
});
