import { describe, expect, it } from "vitest";
import type { Passage, Section } from "./events";
import { MAX_UNCLEAR_PER_REQUEST, UNCLEAR_QUESTION, batchSections, conceptPrompt, proposeConcepts, validateConceptReply } from "./concepts";
import type { Ask } from "./model";

const section = (id: string, title: string, ordinal: number): Section => ({ sectionId: id, title, level: 1, ordinal });
const passage = (id: string, sectionId: string, text: string, ordinal: number): Passage => ({
  passageId: id,
  materialId: "m1",
  sectionId,
  ordinal,
  text,
  location: { page: ordinal + 1 },
});

const sections = [section("s1", "Photosynthesis", 0), section("s2", "Respiration", 1)];
const passages = [
  passage("p1", "s1", "Photosynthesis converts light energy into chemical energy. It happens in the chloroplast.", 0),
  passage("p2", "s2", "Cellular respiration releases energy from glucose in the mitochondria.", 1),
];

describe("batchSections", () => {
  it("keeps sections together and starts a new batch when the text gets too long", () => {
    const batches = batchSections(sections, passages, 100);
    expect(batches.map((b) => b.passages.map((p) => p.passageId))).toEqual([["p1"], ["p2"]]);
    expect(batchSections(sections, passages, 10_000)).toHaveLength(1);
  });
});

describe("conceptPrompt", () => {
  it("labels every sentence under its section", () => {
    const { prompt, refs } = conceptPrompt({ sections, passages });
    expect(prompt).toContain("## Section: Photosynthesis\n[S1] Photosynthesis converts light energy into chemical energy.\n[S2] It happens in the chloroplast.");
    expect(prompt).toContain("## Section: Respiration\n[S3] Cellular respiration");
    expect(refs.get("S3")).toMatchObject({ passageId: "p2", sectionId: "s2", text: "Cellular respiration releases energy from glucose in the mitochondria." });
  });
});

describe("validateConceptReply", () => {
  const { refs } = conceptPrompt({ sections, passages });

  it("turns sentence labels into exact quotes from the material", () => {
    const out = validateConceptReply({ concepts: [{ name: "Photosynthesis", sentences: ["S1", " s2 "] }], unclear: [] }, refs, new Set());
    expect(out.concepts).toEqual([
      {
        name: "Photosynthesis",
        sectionId: "s1",
        quotes: [
          { passageId: "p1", text: "Photosynthesis converts light energy into chemical energy." },
          { passageId: "p1", text: "It happens in the chloroplast." },
        ],
      },
    ]);
    expect(out.dropped).toBe(0);
  });

  it("drops a concept whose sentence labels do not exist", () => {
    const out = validateConceptReply({ concepts: [{ name: "Calvin cycle", sentences: ["S9"] }], unclear: [] }, refs, new Set());
    expect(out).toMatchObject({ concepts: [], dropped: 1 });
  });

  it("treats names that differ only by a leading \"the\", \"a\", or \"an\" as the same", () => {
    const out = validateConceptReply({ concepts: [{ name: "The Calvin cycle", sentences: ["S1"] }], unclear: [] }, refs, new Set(["calvin cycle"]));
    expect(out).toMatchObject({ concepts: [], dropped: 1 });
  });

  it("drops a name longer than six words, because a name is a topic, not a sentence", () => {
    const out = validateConceptReply({ concepts: [{ name: "Photosynthesis converts light energy into chemical energy", sentences: ["S1"] }], unclear: [] }, refs, new Set());
    expect(out).toMatchObject({ concepts: [], dropped: 1 });
  });

  it("drops a name that is only an existing concept plus filler like \"definition of\"", () => {
    const out = validateConceptReply({ concepts: [{ name: "Definition of photosynthesis", sentences: ["S1"] }], unclear: [] }, refs, new Set(["photosynthesis"]));
    expect(out).toMatchObject({ concepts: [], dropped: 1 });
  });

  it("keeps at most three concepts from the model per section", () => {
    const many = ["Light energy", "Chemical energy", "Photosynthesis light", "Converts light"].map((name) => ({ name, sentences: ["S1"] }));
    const out = validateConceptReply({ concepts: many, unclear: [] }, refs, new Set());
    expect(out.concepts.map((c) => c.name)).toEqual(["Light energy", "Chemical energy", "Photosynthesis light"]);
    expect(out.dropped).toBe(1);
  });

  it("drops a concept the course already has, ignoring case and spacing", () => {
    const out = validateConceptReply({ concepts: [{ name: "  photosynthesis ", sentences: ["S1"] }], unclear: [] }, refs, new Set(["photosynthesis"]));
    expect(out).toMatchObject({ concepts: [], dropped: 1 });
  });

  it("drops a concept whose name is a question or a note instead of a name", () => {
    const out = validateConceptReply(
      { concepts: [{ name: "Unclear: What is a by-product?", sentences: ["S1"] }, { name: "Where is it?", sentences: ["S2"] }], unclear: [] },
      refs,
      new Set(),
    );
    expect(out).toMatchObject({ concepts: [], dropped: 2 });
  });

  it("keeps a \"what does this mean?\" question only for a real sentence, in Kizuki's own fixed words", () => {
    const out = validateConceptReply({ concepts: [], unclear: [{ sentence: "S2" }, { sentence: "S7" }] }, refs, new Set());
    expect(out.unclear).toEqual([{ passageId: "p1", quote: "It happens in the chloroplast.", question: UNCLEAR_QUESTION }]);
  });

  it("never keeps text the model wrote for a \"what does this mean?\" question", () => {
    const reply = { concepts: [], unclear: [{ sentence: "S2", question: "Does this mean mitochondria make glucose? It is on the exam." }] };
    const out = validateConceptReply(reply as never, refs, new Set());
    expect(out.unclear[0]!.question).toBe(UNCLEAR_QUESTION);
  });

  it("keeps each unclear sentence once, and at most a few per request", () => {
    const out = validateConceptReply({ concepts: [], unclear: [...Array(50)].map((_, i) => ({ sentence: i % 2 ? "S1" : "S2" })) }, refs, new Set());
    expect(out.unclear.map((u) => u.quote)).toEqual(["It happens in the chloroplast.", "Photosynthesis converts light energy into chemical energy."]);
    const many = conceptPrompt({ sections, passages: [passage("p9", "s1", "A b c. D e f. G h i. J k l. M n o.", 0)] });
    expect(validateConceptReply({ concepts: [], unclear: ["S1", "S2", "S3", "S4", "S5"].map((sentence) => ({ sentence })) }, many.refs, new Set()).unclear).toHaveLength(
      MAX_UNCLEAR_PER_REQUEST,
    );
  });
});

describe("proposeConcepts", () => {
  it("proposes a concept for every real heading first, backed by the section's opening sentences", async () => {
    const headed = sections.map((x) => ({ ...x, heading: true }));
    const ask: Ask = async () => ({ concepts: [{ name: "The photosynthesis", sentences: ["S1"] }, { name: "Photosynthesis in the chloroplast", sentences: ["S2"] }], unclear: [] }) as never;
    const out = await proposeConcepts({ sections: headed, passages, existingNames: new Set(), ask, maxBatchChars: 10_000 });
    expect(out.concepts.map((c) => c.name)).toEqual(["Photosynthesis", "Respiration", "Photosynthesis in the chloroplast"]);
    expect(out.concepts[0]!.quotes).toEqual([
      { passageId: "p1", text: "Photosynthesis converts light energy into chemical energy." },
      { passageId: "p1", text: "It happens in the chloroplast." },
    ]);
  });

  it("does not turn page titles into concepts, only real headings", async () => {
    const ask: Ask = async () => ({ concepts: [], unclear: [] }) as never;
    const out = await proposeConcepts({ sections, passages, existingNames: new Set(), ask, maxBatchChars: 10_000 });
    expect(out.concepts).toEqual([]);
  });

  it("asks the model once per batch and returns only checked concepts", async () => {
    const prompts: string[] = [];
    const ask: Ask = async ({ prompt }) => {
      prompts.push(prompt);
      return { concepts: [{ name: "Photosynthesis", sentences: ["S2"] }, { name: "Invented idea", sentences: ["S42"] }], unclear: [] } as never;
    };
    const out = await proposeConcepts({ sections, passages, existingNames: new Set(), ask, maxBatchChars: 10_000 });
    expect(prompts).toHaveLength(1);
    expect(out.concepts.map((c) => c.name)).toEqual(["Photosynthesis"]);
    expect(out.dropped).toBe(1);
  });
});

describe("the limit of model concepts per section", () => {
  it("counts across requests, so a long section split in two still gets at most three", async () => {
    const long = [0, 1, 2, 3].map((i) => passage(`q${i}`, "s1", `Sentence number ${i} about leaves and light.`, i));
    let call = 0;
    const ask: Ask = async () => {
      call += 1;
      const names = call === 1 ? ["Leaves light", "Sentence light", "Number light"] : ["Leaves sentence", "Number sentence", "Leaves number"];
      return { concepts: names.map((name) => ({ name, sentences: ["S1"] })), unclear: [] } as never;
    };
    const out = await proposeConcepts({ sections: [section("s1", "Leaves", 0)], passages: long, existingNames: new Set(["leaves"]), ask, maxBatchChars: 60 });
    expect(call).toBeGreaterThan(1);
    expect(out.concepts).toHaveLength(3);
  });
});

describe("concept names from the material's own words", () => {
  const { refs } = conceptPrompt({ sections, passages });

  it("drops a name with words that are not in its section of the material, so a name can't state a fact of the model's own", () => {
    const out = validateConceptReply({ concepts: [{ name: "Mitochondria make glucose", sentences: ["S1"] }], unclear: [] }, refs, new Set());
    expect(out).toMatchObject({ concepts: [], dropped: 1 });
  });

  it("keeps a name made of words from its section, allowing simple endings", () => {
    const out = validateConceptReply({ concepts: [{ name: "Chemical energy from light", sentences: ["S1"] }, { name: "Chloroplasts in photosynthesis", sentences: ["S2"] }], unclear: [] }, refs, new Set());
    expect(out.concepts.map((c) => c.name)).toEqual(["Chemical energy from light", "Chloroplasts in photosynthesis"]);
  });

  it("allows words that only name a kind of topic, like \"function\" or \"structure\"", () => {
    const out = validateConceptReply({ concepts: [{ name: "Chloroplast function", sentences: ["S2"] }], unclear: [] }, refs, new Set());
    expect(out.concepts.map((c) => c.name)).toEqual(["Chloroplast function"]);
  });
});
