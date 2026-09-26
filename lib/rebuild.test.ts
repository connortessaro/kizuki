import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addMaterial, createCourse } from "./commands";
import { readMaterial } from "./materialFlow";
import { homePaths } from "./paths";
import { rebuildIndex } from "./rebuild";
import { openIndex, searchPassages, type Embedder } from "./search";
import { tempHome } from "./test-helpers/home";

const embed: Embedder = async (texts) => texts.map((t) => [t.includes("cell") ? 1 : 0.01, t.includes("gene") ? 1 : 0.01]);

let home: string;
let cleanup: () => void;
beforeEach(() => ({ home, cleanup } = tempHome()));
afterEach(() => cleanup());

describe("rebuildIndex", () => {
  it("rebuilds the search file from the logs alone", async () => {
    const courseId = await createCourse(home, "Bio");
    const id = await addMaterial(home, { courseId, fileName: "a.md", bytes: new TextEncoder().encode("A cell is small.\n\nA gene is DNA.") });
    await readMaterial(home, id);
    expect(existsSync(homePaths(home).index)).toBe(false);
    const count = await rebuildIndex(home, embed, "fake");
    expect(count).toBe(1);
    const db = openIndex(homePaths(home).index);
    expect((await searchPassages(db, { courseId, text: "cell", embed })).length).toBe(1);
    db.close();
  });

  it("keeps the old search file when the new meaning model fails, such as after a typo in its name", async () => {
    const courseId = await createCourse(home, "Bio");
    const id = await addMaterial(home, { courseId, fileName: "a.md", bytes: new TextEncoder().encode("A cell is small.\n\nA gene is DNA.") });
    await readMaterial(home, id);
    await rebuildIndex(home, embed, "fake");
    const broken: Embedder = async () => {
      throw new Error('model "nomic-embed-txt" not found');
    };
    await expect(rebuildIndex(home, broken, "nomic-embed-txt")).rejects.toThrow(/not found/);
    const db = openIndex(homePaths(home).index);
    expect((await searchPassages(db, { courseId, text: "cell", embed })).length).toBe(1);
    db.close();
  });
});
