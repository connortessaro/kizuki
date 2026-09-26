import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addMaterial, confirmConcept, createCourse, startSession } from "./commands";
import { indexMaterial, proposeForMaterial, proposeLinksForMaterial, readMaterial } from "./materialFlow";
import type { Ask } from "./model";
import { appendLog, readLog } from "./log";
import type { Embedder } from "./search";
import { endSession, proposeMisses, recordAnswers, runRound } from "./sessionFlow";
import { loadState } from "./state";
import { tempHome } from "./test-helpers/home";

const MATERIAL = `# Photosynthesis

Photosynthesis converts light energy into chemical energy. It happens in the chloroplast.

# Respiration

Cellular respiration releases energy from glucose in the mitochondria.
`;

const fakeEmbed: Embedder = async (texts) => texts.map((t) => ["light", "glucose", "chloroplast", "mitochondria"].map((w) => (t.toLowerCase().includes(w) ? 1 : 0.01)));

/** A fake model that answers by the kind of request, like a very obedient small model. */
const fakeAsk: Ask = async ({ system, prompt }) => {
  if (system.includes("concept map")) {
    const concepts = prompt
      .split("## Section: ")
      .slice(1)
      .map((block) => /\[(S\d+)\] (\S+)/.exec(block)!)
      .map(([, label, firstWord]) => ({ name: firstWord!, sentences: [label!] }));
    return { concepts, unclear: [] } as never;
  }
  if (system.includes("order the concepts")) return { links: [{ concept: "C2", needs: "C1" }] } as never;
  const chloroplast = /\[(S\d+)\] It happens in the chloroplast\./.exec(prompt)?.[1] ?? "S1";
  if (system.includes("curious student")) return { questions: [{ kind: "contradiction", sentence: chloroplast, term: "" }] } as never;
  return { missed: [{ sentence: "S1" }] } as never;
};

let home: string;
let cleanup: () => void;
beforeEach(() => ({ home, cleanup } = tempHome()));
afterEach(() => cleanup());

describe("material and session flow", () => {
  it("counts a session as clean when you say Kizuki misread you, and saves no correction", async () => {
    const courseId = await createCourse(home, "Biology");
    const materialId = await addMaterial(home, { courseId, fileName: "bio.md", bytes: new TextEncoder().encode(MATERIAL) });
    await readMaterial(home, materialId);
    await indexMaterial(home, materialId, fakeEmbed, "fake");
    await proposeForMaterial(home, materialId, fakeAsk);
    const [concept] = (await loadState(home)).concepts.values();
    await confirmConcept(home, concept!.conceptId);
    const sessionId = await startSession(home, concept!.conceptId, "Photosynthesis happens in the chloroplast.");
    await runRound(home, sessionId, 1, { ask: fakeAsk, embed: fakeEmbed });
    const q = (await loadState(home)).sessions.get(sessionId)!.rounds[0]!.questions[0]!;
    expect(q.kind).toBe("contradiction");
    await recordAnswers(home, sessionId, 1, { answers: [{ questionId: q.questionId, text: "I said chloroplast.", verdict: "misread" }], finish: true });
    await proposeMisses(home, sessionId, { ask: async () => ({ missed: [] }) as never, embed: fakeEmbed });
    await endSession(home, sessionId, []);
    const state = await loadState(home);
    expect(state.sessions.get(sessionId)!.ended!.clean).toBe(true);
    expect(state.corrections).toEqual([]);
  });

  it("says \"not in your material\" when nothing in the material matches what you wrote and no question is left", async () => {
    const courseId = await createCourse(home, "Biology");
    const materialId = await addMaterial(home, { courseId, fileName: "bio.md", bytes: new TextEncoder().encode(MATERIAL) });
    await readMaterial(home, materialId);
    await indexMaterial(home, materialId, fakeEmbed, "fake");
    await proposeForMaterial(home, materialId, fakeAsk);
    const [concept] = (await loadState(home)).concepts.values();
    await confirmConcept(home, concept!.conceptId);
    const silent: Ask = async () => ({ questions: [] }) as never;
    const offTopic = await startSession(home, concept!.conceptId, "Plate tectonics moves continents over millions of years.");
    // A meaning model that finds the off-topic text unrelated to every passage.
    const unrelated: Embedder = async (texts, kind) => (kind === "query" && texts[0]!.includes("tectonics") ? [[-1, -1, -1, -1]] : fakeEmbed(texts, kind));
    await runRound(home, offTopic, 1, { ask: silent, embed: unrelated });
    expect((await loadState(home)).sessions.get(offTopic)!.rounds[0]).toMatchObject({ questions: [], notInMaterial: true });

    await recordAnswers(home, offTopic, 1, { answers: [], finish: true });
    const onTopic = await startSession(home, concept!.conceptId, "Photosynthesis turns light energy into chemical energy.");
    await runRound(home, onTopic, 1, { ask: silent, embed: fakeEmbed });
    expect((await loadState(home)).sessions.get(onTopic)!.rounds[0]).toMatchObject({ questions: [], notInMaterial: false });
  });

  it("does not send a file's passages to the meaning model again when they are already in the search file", async () => {
    const courseId = await createCourse(home, "Biology");
    const materialId = await addMaterial(home, { courseId, fileName: "bio.md", bytes: new TextEncoder().encode(MATERIAL) });
    await readMaterial(home, materialId);
    let calls = 0;
    const counting: Embedder = async (texts, kind) => {
      calls += 1;
      return fakeEmbed(texts, kind);
    };
    await indexMaterial(home, materialId, counting, "fake");
    const first = calls;
    await indexMaterial(home, materialId, counting, "fake");
    expect(first).toBeGreaterThan(0);
    expect(calls).toBe(first);
  });

  it("skips a round that already has questions without calling any model, so a restart works while the models are down", async () => {
    const courseId = await createCourse(home, "Biology");
    const materialId = await addMaterial(home, { courseId, fileName: "bio.md", bytes: new TextEncoder().encode(MATERIAL) });
    await readMaterial(home, materialId);
    await indexMaterial(home, materialId, fakeEmbed, "fake");
    await proposeForMaterial(home, materialId, fakeAsk);
    const [concept] = (await loadState(home)).concepts.values();
    await confirmConcept(home, concept!.conceptId);
    const sessionId = await startSession(home, concept!.conceptId, "Photosynthesis happens in the mitochondria.");
    await runRound(home, sessionId, 1, { ask: fakeAsk, embed: fakeEmbed });
    const down = async () => {
      throw new Error("the model server is not running");
    };
    await expect(runRound(home, sessionId, 1, { ask: down, embed: down })).resolves.toBeUndefined();
    await recordAnswers(home, sessionId, 1, { answers: [], finish: true });
    await proposeMisses(home, sessionId, { ask: fakeAsk, embed: fakeEmbed });
    await expect(proposeMisses(home, sessionId, { ask: down, embed: down })).resolves.toBeUndefined();
  });

  it("does not ask the same \"what does this mean?\" question twice when the concept step runs again after a crash", async () => {
    const courseId = await createCourse(home, "Biology");
    const materialId = await addMaterial(home, { courseId, fileName: "bio.md", bytes: new TextEncoder().encode(MATERIAL) });
    await readMaterial(home, materialId);
    await indexMaterial(home, materialId, fakeEmbed, "fake");
    const passage = (await readLog(home, "passages"))[0]!.passages[0]!;
    const quote = "It happens in the chloroplast.";
    // The first try saved its question, then stopped before saving the concepts.
    await appendLog(home, "corrections", [{ type: "clarification.asked", at: new Date().toISOString(), clarificationId: "clar_1", passageId: passage.passageId, quote, question: "x" }]);
    const ask: Ask = async (request) => {
      const reply = (await fakeAsk(request)) as { concepts: unknown[] };
      const label = /\[(S\d+)\] It happens in the chloroplast\./.exec(request.prompt)?.[1];
      return { ...reply, unclear: label ? [{ sentence: label }] : [] } as never;
    };
    await proposeForMaterial(home, materialId, ask);
    expect([...(await loadState(home)).clarifications.values()].map((c) => c.quote)).toEqual([quote]);
  });

  it("goes from a file to reviewed concepts to a finished teach-back session", async () => {
    const courseId = await createCourse(home, "Biology");
    const materialId = await addMaterial(home, { courseId, fileName: "bio.md", bytes: new TextEncoder().encode(MATERIAL) });

    await readMaterial(home, materialId);
    await readMaterial(home, materialId);
    expect((await readLog(home, "passages")).length).toBe(1);

    await indexMaterial(home, materialId, fakeEmbed, "fake");
    await proposeForMaterial(home, materialId, fakeAsk);
    await proposeForMaterial(home, materialId, fakeAsk);
    let state = await loadState(home);
    const concepts = [...state.concepts.values()];
    expect(concepts.map((c) => c.name)).toEqual(["Photosynthesis", "Respiration", "Cellular"]);
    expect(state.materials.get(materialId)!.status).toBe("review");

    for (const c of concepts) await confirmConcept(home, c.conceptId);
    await proposeLinksForMaterial(home, materialId, fakeAsk);
    state = await loadState(home);
    expect([...state.links.values()]).toHaveLength(1);
    expect(state.materials.get(materialId)!.status).toBe("done");

    const photosynthesis = concepts[0]!.conceptId;
    const sessionId = await startSession(home, photosynthesis, "Photosynthesis happens in the mitochondria.");
    await runRound(home, sessionId, 1, { ask: fakeAsk, embed: fakeEmbed });
    await runRound(home, sessionId, 1, { ask: fakeAsk, embed: fakeEmbed });
    state = await loadState(home);
    let session = state.sessions.get(sessionId)!;
    expect(session.rounds).toHaveLength(1);
    expect(session.status).toBe("answering");
    const question = session.rounds[0]!.questions[0]!;
    expect(question.text).toBe("The section “Photosynthesis” of bio.md says: “It happens in the chloroplast.” How does that fit with what you said?");

    await recordAnswers(home, sessionId, 1, { answers: [{ questionId: question.questionId, text: "Oh, chloroplast.", verdict: "material-right" }], finish: true });
    await proposeMisses(home, sessionId, { ask: fakeAsk, embed: fakeEmbed });
    session = (await loadState(home)).sessions.get(sessionId)!;
    expect(session.status).toBe("reviewing");
    const miss = session.misses![0]!;

    await endSession(home, sessionId, [miss.missId]);
    session = (await loadState(home)).sessions.get(sessionId)!;
    expect(session.ended).toMatchObject({ clean: false, confirmedMissIds: [miss.missId], rejectedMissIds: [] });
  });

  it("turns a 'the material is wrong' answer into a correction", async () => {
    const courseId = await createCourse(home, "Biology");
    const materialId = await addMaterial(home, { courseId, fileName: "bio.md", bytes: new TextEncoder().encode(MATERIAL) });
    await readMaterial(home, materialId);
    await indexMaterial(home, materialId, fakeEmbed, "fake");
    await proposeForMaterial(home, materialId, fakeAsk);
    const concept = [...(await loadState(home)).concepts.values()][0]!;
    await confirmConcept(home, concept.conceptId);
    const sessionId = await startSession(home, concept.conceptId, "It happens in the mitochondria.");
    await runRound(home, sessionId, 1, { ask: fakeAsk, embed: fakeEmbed });
    const q = (await loadState(home)).sessions.get(sessionId)!.rounds[0]!.questions[0]!;
    await recordAnswers(home, sessionId, 1, {
      answers: [{ questionId: q.questionId, text: "My professor corrected this.", verdict: "material-wrong", correction: "It happens in the chloroplasts" }],
      finish: false,
    });
    const state = await loadState(home);
    expect(state.corrections[0]).toMatchObject({ passageId: q.quote!.passageId, quote: "It happens in the chloroplast.", correction: "It happens in the chloroplasts", sessionId });
  });

  it("refuses answers to questions that were not asked in that round", async () => {
    const courseId = await createCourse(home, "Biology");
    const materialId = await addMaterial(home, { courseId, fileName: "bio.md", bytes: new TextEncoder().encode(MATERIAL) });
    await readMaterial(home, materialId);
    await indexMaterial(home, materialId, fakeEmbed, "fake");
    await proposeForMaterial(home, materialId, fakeAsk);
    const concept = [...(await loadState(home)).concepts.values()][0]!;
    await confirmConcept(home, concept.conceptId);
    const sessionId = await startSession(home, concept.conceptId, "x y z");
    await runRound(home, sessionId, 1, { ask: fakeAsk, embed: fakeEmbed });
    await expect(recordAnswers(home, sessionId, 1, { answers: [{ questionId: "q_nope", text: "?" }], finish: true })).rejects.toThrow(/not asked/);
  });
});
