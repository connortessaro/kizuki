import { describe, expect, it } from "vitest";
import type { Passage, Question } from "./events";
import type { Ask } from "./model";
import { numberSentences } from "./sentences";
import { askMisses, askQuestions, renderQuestion, validateMisses, validateTeachReply } from "./teach";

const passage = (id: string, text: string, page: number): Passage => ({ passageId: id, materialId: "m1", sectionId: "s1", ordinal: page, text, location: { page } });
const passages = [
  passage("p1", "Photosynthesis happens in the chloroplast.", 1),
  passage("p2", "Light energy is converted into chemical energy. It is stored in glucose.", 2),
];
const { refs } = numberSentences(passages);
const labelFor = (id: string) => (id === "p1" ? "Page 1 of bio.pdf" : "Page 2 of bio.pdf");
const student = "Photosynthesis happens in the mitochondria and makes some energy stuff.";

type Raw = { kind: "contradiction" | "gap" | "unclear"; sentence: string; term: string };
const check = (questions: Raw[], previous: Question[] = [], corrections: { passageId: string; quote: string }[] = []) =>
  validateTeachReply({ questions }, { refs, passages, studentText: student, previous, corrections, labelFor });

describe("renderQuestion", () => {
  it("writes every question from a fixed template, so the model never writes words of its own", () => {
    expect(renderQuestion("contradiction", "Page 1 of bio.pdf", "It happens in the chloroplast.")).toBe(
      "Page 1 of bio.pdf says: “It happens in the chloroplast.” How does that fit with what you said?",
    );
    expect(renderQuestion("contradiction", "Page 1 of bio.pdf", "It happens in the chloroplast.", "in the mitochondria")).toBe(
      "Page 1 of bio.pdf says: “It happens in the chloroplast.” You wrote: “in the mitochondria”. How does that fit?",
    );
    expect(renderQuestion("gap", "Page 2 of bio.pdf", "It is stored in glucose.")).toBe("Page 2 of bio.pdf says: “It is stored in glucose.” Where does that fit in your explanation?");
    expect(renderQuestion("unclear", "", "energy stuff")).toBe("What do you mean by “energy stuff”?");
  });
});

describe("validateTeachReply", () => {
  it("turns a sentence label into the exact sentence, pointing at its page", () => {
    const out = check([{ kind: "contradiction", sentence: "S1", term: "happens in the mitochondria" }]);
    expect(out.dropped).toBe(0);
    expect(out.questions[0]).toMatchObject({
      kind: "contradiction",
      quote: { passageId: "p1", text: "Photosynthesis happens in the chloroplast." },
      text: "Page 1 of bio.pdf says: “Photosynthesis happens in the chloroplast.” You wrote: “happens in the mitochondria”. How does that fit?",
    });
  });

  it("does not show words as yours unless you wrote them", () => {
    const out = check([{ kind: "contradiction", sentence: "S1", term: "in the nucleus" }]);
    expect(out.questions[0]!.text).toBe("Page 1 of bio.pdf says: “Photosynthesis happens in the chloroplast.” How does that fit with what you said?");
  });

  it("drops a question whose sentence label does not exist", () => {
    expect(check([{ kind: "gap", sentence: "S9", term: "" }])).toMatchObject({ questions: [], dropped: 1 });
  });

  it("keeps an unclear question only for words you actually wrote", () => {
    const out = check([
      { kind: "unclear", sentence: "", term: "energy stuff" },
      { kind: "unclear", sentence: "", term: "ATP synthase" },
    ]);
    expect(out.questions.map((q) => q.term)).toEqual(["energy stuff"]);
    expect(out.dropped).toBe(1);
  });

  it("treats an unclear question that points at a sentence but not at words of yours as a gap", () => {
    const out = check([{ kind: "unclear", sentence: "S3", term: "" }]);
    expect(out.questions[0]).toMatchObject({ kind: "gap", quote: { passageId: "p2", text: "It is stored in glucose." } });
  });

  it("drops a question already asked in an earlier round", () => {
    const earlier: Question = { questionId: "q0", kind: "gap", text: "x", quote: { passageId: "p2", text: "It is stored in glucose." } };
    expect(check([{ kind: "gap", sentence: "S3", term: "" }], [earlier])).toMatchObject({ questions: [], dropped: 1 });
  });

  it("drops a question that quotes text you corrected, because your correction wins", () => {
    const out = check([{ kind: "contradiction", sentence: "S1", term: "" }], [], [{ passageId: "p1", quote: "in the chloroplast" }]);
    expect(out).toMatchObject({ questions: [], dropped: 1 });
  });

  it("drops a question that quotes text you corrected in another file or passage, because the same words are still wrong", () => {
    const out = check([{ kind: "gap", sentence: "S1", term: "" }], [], [{ passageId: "p_elsewhere", quote: "in the chloroplast" }]);
    expect(out).toMatchObject({ questions: [], dropped: 1 });
  });

  it("recognizes a correction typed with quote marks or trailing punctuation", () => {
    for (const quote of ['"in the chloroplast"', "in the chloroplast,", "“happens in the chloroplast.”"]) {
      expect(check([{ kind: "gap", sentence: "S1", term: "" }], [], [{ passageId: "p1", quote }])).toMatchObject({ questions: [], dropped: 1 });
    }
  });

  it("keeps at most three questions", () => {
    const raw: Raw[] = [...["S1", "S2", "S3"].map((sentence): Raw => ({ kind: "gap", sentence, term: "" })), { kind: "unclear", sentence: "", term: "energy stuff" }];
    const out = check(raw);
    expect(out.questions).toHaveLength(3);
  });
});

describe("validateMisses", () => {
  it("keeps only real sentences, at most five, no repeats", () => {
    const out = validateMisses({ missed: [{ sentence: "S3" }, { sentence: "S3" }, { sentence: "S12" }] }, refs, passages);
    expect(out.misses.map((m) => m.quote)).toEqual([{ passageId: "p2", text: "It is stored in glucose." }]);
    expect(out.dropped).toBe(2);
  });
});

describe("validateMisses with corrections", () => {
  it("never proposes a sentence you corrected, because your correction wins", () => {
    const out = validateMisses({ missed: [{ sentence: "S1" }, { sentence: "S3" }] }, refs, passages, [{ passageId: "p1", quote: "in the chloroplast" }]);
    expect(out.misses.map((m) => m.quote.text)).toEqual(["It is stored in glucose."]);
  });
});

describe("askQuestions", () => {
  it("says the concept is not in your material, without asking the model, when there are no passages", async () => {
    const ask: Ask = async () => {
      throw new Error("should not be called");
    };
    const out = await askQuestions({ conceptName: "Quantum tunnelling", passages: [], studentText: "x", previous: [], corrections: [], notes: new Map(), labelFor, ask });
    expect(out).toEqual({ questions: [], dropped: 0, notInMaterial: true });
  });

  it("shows the model labeled sentences, your notes, and what you wrote", async () => {
    let prompt = "";
    const ask: Ask = async (r) => {
      prompt = r.prompt;
      return { questions: [] } as never;
    };
    const notes = new Map([["p1", ["Your correction: “chloroplast” should be “chloroplasts”."]]]);
    await askQuestions({ conceptName: "Photosynthesis", passages, studentText: student, previous: [], corrections: [], notes, labelFor, ask });
    expect(prompt).toContain("[S1] Photosynthesis happens in the chloroplast.\n  Your correction: “chloroplast” should be “chloroplasts”.");
    expect(prompt).toContain(student);
  });
});

describe("askMisses", () => {
  it("proposes sentences whose words you barely used, even when the model finds nothing", async () => {
    const ask: Ask = async () => ({ missed: [] }) as never;
    const out = await askMisses({ conceptName: "Energy", passages, studentText: "Light energy is converted into chemical energy.", notes: new Map(), ask });
    expect(out.misses.map((m) => m.quote.text)).toEqual(["Photosynthesis happens in the chloroplast.", "It is stored in glucose."]);
  });

  it("leaves out sentences you corrected, even when you barely used their words", async () => {
    const ask: Ask = async () => ({ missed: [{ sentence: "S1" }] }) as never;
    const out = await askMisses({
      conceptName: "Energy",
      passages,
      studentText: "Light energy is converted into chemical energy.",
      notes: new Map(),
      corrections: [{ passageId: "p1", quote: "in the chloroplast" }],
      ask,
    });
    expect(out.misses.map((m) => m.quote.text)).toEqual(["It is stored in glucose."]);
  });

  it("returns checked misses from the model", async () => {
    const ask: Ask = async () => ({ missed: [{ sentence: "S1" }] }) as never;
    const out = await askMisses({ conceptName: "Photosynthesis", passages, studentText: student, notes: new Map(), ask });
    expect(out.misses.map((m) => m.quote)).toContainEqual({ passageId: "p1", text: "Photosynthesis happens in the chloroplast." });
  });
});
