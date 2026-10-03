import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addMaterial,
  confirmConcept,
  createCourse,
  startRetry,
  startSession,
} from "./commands";
import { endSession } from "./sessionFlow";
import { reviewPlans } from "./views";
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

describe("asking again until clean", () => {
  async function sessionWithMiss(conceptId: string, retryOf?: string): Promise<string> {
    const text = "Photosynthesis makes chemical energy from light.";
    const sessionId = retryOf ? await startRetry(home, retryOf, text) : await startSession(home, conceptId, text);
    await continueSession(home, sessionId, models);
    await answerRound(home, sessionId, 1, { answers: [], finish: true }, models);
    const misses = (await loadState(home)).sessions.get(sessionId)!.misses!;
    expect(misses.length).toBeGreaterThan(0);
    await endSession(home, sessionId, [misses[0]!.missId]);
    return sessionId;
  }

  it("starts another try of the same concept that points back at the first try", async () => {
    const conceptId = await confirmedConcept();
    const first = await sessionWithMiss(conceptId);
    const second = await startRetry(home, first, "Photosynthesis happens in the chloroplast and makes chemical energy from light.");
    const s = (await loadState(home)).sessions.get(second)!;
    expect([s.conceptId, s.retryOf]).toEqual([conceptId, first]);
  });

  it("refuses another try after a clean session, while a try is still open, and after three tries", async () => {
    const conceptId = await confirmedConcept();
    const first = await sessionWithMiss(conceptId);
    const second = await sessionWithMiss(conceptId, first);
    const third = await sessionWithMiss(conceptId, second);
    await expect(startRetry(home, third, "Again.")).rejects.toThrow(/3 tries/);

    const other = await startSession(home, conceptId, "Photosynthesis makes chemical energy from light.");
    await expect(startRetry(home, other, "Again.")).rejects.toThrow(/has not ended/);
    await continueSession(home, other, models);
    await answerRound(home, other, 1, { answers: [], finish: true }, models);
    await endSession(home, other, []);
    await expect(startRetry(home, other, "Again.")).rejects.toThrow(/clean/);
  });

  it("lets only the first try set the next review, so a clean second try still brings the concept back tomorrow", async () => {
    const conceptId = await confirmedConcept();
    const first = await sessionWithMiss(conceptId);
    const second = await startRetry(home, first, "Photosynthesis happens in the chloroplast and makes chemical energy from light.");
    await continueSession(home, second, models);
    await answerRound(home, second, 1, { answers: [], finish: true }, models);
    await endSession(home, second, []);
    const state = await loadState(home);
    expect(state.sessions.get(second)!.ended!.clean).toBe(true);
    const today = state.sessions.get(first)!.ended!.at.slice(0, 10);
    const plan = reviewPlans(state, today, "UTC").get(conceptId)!;
    expect([plan.streak, plan.gapDays, plan.lastSessionAt]).toEqual([0, 1, state.sessions.get(first)!.ended!.at]);
  });
});
