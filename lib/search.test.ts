import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { indexPassages, openIndex, removeMaterial, searchPassages, type Embedder } from "./search";
import { tempHome } from "./test-helpers/home";

const VOCAB = ["light", "energy", "glucose", "chloroplast", "enzyme", "reaction", "dna", "gene"];
/** A stand-in for a real meaning model: counts vocabulary words, with "sugar" meaning the same as "glucose". */
const fakeEmbed: Embedder = async (texts) =>
  texts.map((t) => {
    const words = t.toLowerCase().replace(/sugar/g, "glucose").split(/\W+/);
    return VOCAB.map((v) => words.filter((w) => w === v).length + 0.01);
  });

let home: string;
let cleanup: () => void;
beforeEach(() => ({ home, cleanup } = tempHome()));
afterEach(() => cleanup());

const passages = [
  { passageId: "p1", materialId: "m1", courseId: "bio", text: "Plants capture light energy in the chloroplast." },
  { passageId: "p2", materialId: "m1", courseId: "bio", text: "Cells break down glucose to release energy." },
  { passageId: "p3", materialId: "m2", courseId: "bio", text: "An enzyme speeds up a reaction." },
  { passageId: "p4", materialId: "m3", courseId: "gen", text: "A gene is a piece of DNA." },
];

async function built() {
  const db = openIndex(join(home, "index.sqlite"));
  await indexPassages(db, passages, fakeEmbed, "fake-embed");
  return db;
}

describe("search", () => {
  it("finds passages by keyword", async () => {
    const db = await built();
    const hits = await searchPassages(db, { courseId: "bio", text: "chloroplast", embed: fakeEmbed });
    expect(hits[0]!.passageId).toBe("p1");
  });

  it("finds passages by meaning when the words differ", async () => {
    const db = await built();
    const hits = await searchPassages(db, { courseId: "bio", text: "cells burn sugar", embed: fakeEmbed });
    expect(hits[0]!.passageId).toBe("p2");
  });

  it("only returns passages from the course asked for", async () => {
    const db = await built();
    const hits = await searchPassages(db, { courseId: "gen", text: "energy gene dna", embed: fakeEmbed });
    expect(hits.map((h) => h.passageId)).toEqual(["p4"]);
  });

  it("stops returning a material's passages once it is removed", async () => {
    const db = await built();
    removeMaterial(db, "m1");
    const hits = await searchPassages(db, { courseId: "bio", text: "light energy glucose", embed: fakeEmbed });
    expect(hits.some((h) => h.passageId === "p1" || h.passageId === "p2")).toBe(false);
  });

  it("re-indexing the same passages does not create duplicates", async () => {
    const db = await built();
    await indexPassages(db, passages, fakeEmbed, "fake-embed");
    const count = db.prepare("select count(*) as n from passages").get() as { n: number };
    expect(count.n).toBe(4);
  });

  it("refuses to mix meaning models in one search file", async () => {
    const db = await built();
    await expect(indexPassages(db, passages, fakeEmbed, "other-embed")).rejects.toThrow(/rebuild/i);
  });

  it("needs at least two matching words for a keyword match, so one common word is not enough", async () => {
    const db = await built();
    const far: Embedder = async (texts, kind) => (kind === "query" ? texts.map(() => [0, 0, 0, 0, 0, 0, 0, 1]) : fakeEmbed(texts, kind));
    expect(await searchPassages(db, { courseId: "bio", text: "tectonic plates release pressure", embed: far })).toEqual([]);
    expect((await searchPassages(db, { courseId: "bio", text: "glucose releases energy", embed: far })).map((h) => h.passageId)).toEqual(["p2"]);
  });

  it("ignores meaning matches that are too far away", async () => {
    const db = await built();
    const far: Embedder = async (texts, kind) => (kind === "query" ? texts.map(() => [0, 0, 0, 0, 0, 0, 0, 1]) : fakeEmbed(texts, kind));
    expect(await searchPassages(db, { courseId: "bio", text: "zzz", embed: far })).toEqual([]);
  });

  it("returns nothing for a query with no words", async () => {
    const db = await built();
    expect(await searchPassages(db, { courseId: "bio", text: "   ", embed: fakeEmbed })).toEqual([]);
  });
});

describe("meaning search across courses", () => {
  const near = (i: number) => [1, 0.001 * (i + 1), 0];

  it("finds this course's passages even when a big other course has hundreds that are closer", async () => {
    const db = openIndex(join(home, "index.sqlite"));
    const big = Array.from({ length: 450 }, (_, i) => ({ passageId: `a${i}`, materialId: "ma", courseId: "A", text: `zzz${i}` }));
    const vecs = new Map<string, number[]>([...big.map((p, i) => [p.text, near(i)] as const), ["qqq", [1, 0.5, 0]]]);
    const embed: Embedder = async (texts) => texts.map((t) => vecs.get(t) ?? [1, 0, 0]);
    await indexPassages(db, [...big, { passageId: "b0", materialId: "mb", courseId: "B", text: "qqq" }], embed, "fake");
    const hits = await searchPassages(db, { courseId: "B", text: "query words", embed: async () => [[1, 0, 0]] });
    expect(hits.map((h) => h.passageId)).toEqual(["b0"]);
  });

  it("upgrades a search file from an older version in place, keeping every passage's numbers", async () => {
    const path = join(home, "index.sqlite");
    const db = openIndex(path);
    await indexPassages(db, passages, fakeEmbed, "fake-embed");
    // Put the file back in the old layout: one table of numbers for all courses.
    db.exec("drop table passage_vectors; delete from meta where key = 'layout'");
    db.exec(`create virtual table passage_vec using vec0(embedding float[${VOCAB.length}] distance_metric=cosine)`);
    const [p1] = await fakeEmbed([passages[0]!.text], "document");
    db.prepare("insert into passage_vec (rowid, embedding) values (?, ?)").run(BigInt(1), new Float32Array(p1!));
    db.close();

    const again = openIndex(path);
    let embedded = 0;
    const counting: Embedder = async (texts, kind) => {
      if (kind === "document") embedded += texts.length;
      return fakeEmbed(texts, kind);
    };
    expect(again.prepare("select count(*) as n from passage_vectors where course_id = 'bio'").get()).toEqual({ n: 1 });
    expect(again.prepare("select 1 from sqlite_master where name = 'passage_vec'").get()).toBeUndefined();
    const hits = await searchPassages(again, { courseId: "bio", text: "capture light energy chloroplast", embed: counting, maxDistance: 0.5 });
    expect(hits.map((h) => h.passageId)).toContain("p1");
    expect(embedded).toBe(0);
    again.close();
  });
});
