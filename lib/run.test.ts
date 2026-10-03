import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addMaterial,
  confirmConcept,
  createCourse,
  startSession,
} from "./commands";
import type { Ask } from "./model";
import {
  answerRound,
  continueSession,
  finishMaterialReview,
  processMaterial,
  resumeUnfinished,
  type Models,
} from "./run";
import type { Embedder } from "./search";
import { loadState } from "./state";
import { tempHome } from "./test-helpers/home";

const MATERIAL = `# Photosynthesis

Photosynthesis converts light energy into chemical energy. It happens in the chloroplast.

# Respiration

Cellular respiration releases energy from glucose in the mitochondria.
`;

const fakeEmbed: Embedder = async (texts) =>
  texts.map((t) =>
    ["light", "glucose", "chloroplast", "mitochondria"].map((w) =>
      t.toLowerCase().includes(w) ? 1 : 0.01,
    ),
  );

const fakeAsk: Ask = async ({ system, prompt }) => {
  if (system.includes("concept map"))
    return { concepts: [], unclear: [] } as never;
  if (system.includes("order the concepts"))
    return { links: [{ concept: "C2", needs: "C1" }] } as never;
  const chloroplast =
    /\[(S\d+)\] It happens in the chloroplast\./.exec(prompt)?.[1] ?? "S1";
  if (system.includes("curious student"))
    return {
      questions: [{ kind: "gap", sentence: chloroplast, term: "" }],
    } as never;
  return { missed: [] } as never;
};

const models: Models = { ask: fakeAsk, embed: fakeEmbed, embedModel: "fake" };

const down = async () => {
  throw new Error(
    "Nothing is answering at http://localhost:11434/v1. Start Ollama with: ollama serve",
  );
};

let home: string;
let cleanup: () => void;
beforeEach(() => ({ home, cleanup } = tempHome()));
afterEach(() => cleanup());

async function addBio(): Promise<string> {
  const courseId = await createCourse(home, "Biology");
  return addMaterial(home, {
    courseId,
    fileName: "bio.md",
    bytes: new TextEncoder().encode(MATERIAL),
  });
}

async function confirmedConcept(): Promise<string> {
  const materialId = await addBio();
  await processMaterial(home, materialId, models);
  const [concept] = (await loadState(home)).concepts.values();
  await confirmConcept(home, concept!.conceptId);
  return concept!.conceptId;
}

describe("processing a file", () => {
  it("reads, indexes, and proposes concepts, then stops to wait for your review", async () => {
    const materialId = await addBio();
    await processMaterial(home, materialId, models);
    const state = await loadState(home);
    expect(state.materials.get(materialId)!.status).toBe("review");
    expect([...state.concepts.values()].map((c) => c.name)).toEqual([
      "Photosynthesis",
      "Respiration",
    ]);
  });

  it("suggests links once you finish reviewing, and marks the file done", async () => {
    const materialId = await addBio();
    await processMaterial(home, materialId, models);
    for (const c of (await loadState(home)).concepts.values())
      await confirmConcept(home, c.conceptId);
    await finishMaterialReview(home, materialId, models);
    const state = await loadState(home);
    expect(state.materials.get(materialId)!.status).toBe("done");
    expect([...state.links.values()]).toHaveLength(1);
  });

  it("marks the file failed with the model's message instead of throwing", async () => {
    const materialId = await addBio();
    await processMaterial(home, materialId, { ...models, embed: down });
    const m = (await loadState(home)).materials.get(materialId)!;
    expect(m.status).toBe("failed");
    expect(m.error).toContain("ollama serve");
  });

  it("starts a failed file again from where it stopped", async () => {
    const materialId = await addBio();
    await processMaterial(home, materialId, { ...models, embed: down });
    await processMaterial(home, materialId, models);
    expect((await loadState(home)).materials.get(materialId)!.status).toBe(
      "review",
    );
  });

  it("does nothing to a file that is already waiting for review or done", async () => {
    const materialId = await addBio();
    await processMaterial(home, materialId, models);
    await processMaterial(home, materialId, {
      ask: down,
      embed: down,
      embedModel: "fake",
    });
    expect((await loadState(home)).materials.get(materialId)!.status).toBe(
      "review",
    );
  });
});

describe("resuming after Kizuki was closed", () => {
  it("finishes files that were added but not processed, and leaves files in review alone", async () => {
    const waiting = await addBio();
    const result = await resumeUnfinished(home, models);
    expect(result.materials).toEqual([waiting]);
    expect((await loadState(home)).materials.get(waiting)!.status).toBe(
      "review",
    );
    expect((await resumeUnfinished(home, models)).materials).toEqual([]);
  });

  it("lists sessions still waiting for your answers", async () => {
    const conceptId = await confirmedConcept();
    const sessionId = await startSession(
      home,
      conceptId,
      "Photosynthesis makes chemical energy from light.",
    );
    await continueSession(home, sessionId, models);
    expect((await resumeUnfinished(home, models)).sessions).toEqual([
      sessionId,
    ]);
  });
});

describe("a teach-back session", () => {
  it("asks the first round and waits for your answers", async () => {
    const conceptId = await confirmedConcept();
    const sessionId = await startSession(
      home,
      conceptId,
      "Photosynthesis makes chemical energy from light.",
    );
    await continueSession(home, sessionId, models);
    const session = (await loadState(home)).sessions.get(sessionId)!;
    expect(session.status).toBe("answering");
    expect(session.rounds).toHaveLength(1);
  });

  it("asks the next round after your answers, and proposes misses after you finish", async () => {
    const conceptId = await confirmedConcept();
    const sessionId = await startSession(
      home,
      conceptId,
      "Photosynthesis makes chemical energy from light.",
    );
    await continueSession(home, sessionId, models);
    const q = (await loadState(home)).sessions.get(sessionId)!.rounds[0]!
      .questions[0]!;
    await answerRound(
      home,
      sessionId,
      1,
      {
        answers: [{ questionId: q.questionId, text: "In the chloroplast." }],
        finish: false,
      },
      models,
    );
    expect(
      (await loadState(home)).sessions.get(sessionId)!.rounds,
    ).toHaveLength(2);
    await answerRound(
      home,
      sessionId,
      2,
      { answers: [], finish: true },
      models,
    );
    expect((await loadState(home)).sessions.get(sessionId)!.status).toBe(
      "reviewing",
    );
  });

  it("goes straight to misses when a round has no questions", async () => {
    const conceptId = await confirmedConcept();
    const sessionId = await startSession(
      home,
      conceptId,
      "Photosynthesis makes chemical energy from light.",
    );
    await continueSession(home, sessionId, {
      ...models,
      ask: async ({ system }) =>
        (system.includes("curious student")
          ? { questions: [] }
          : { missed: [] }) as never,
    });
    expect((await loadState(home)).sessions.get(sessionId)!.status).toBe(
      "reviewing",
    );
  });

  it("marks the session failed with the model's message instead of throwing", async () => {
    const conceptId = await confirmedConcept();
    const sessionId = await startSession(
      home,
      conceptId,
      "Photosynthesis makes chemical energy from light.",
    );
    await continueSession(home, sessionId, { ...models, ask: down });
    const session = (await loadState(home)).sessions.get(sessionId)!;
    expect(session.status).toBe("failed");
    expect(session.error).toContain("ollama serve");
  });
});
