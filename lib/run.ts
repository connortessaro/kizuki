import type { Answer } from "./events";
import { MAX_ROUNDS } from "./limits";
import {
  failMaterial,
  indexMaterial,
  markMaterialStarted,
  markReviewed,
  proposeForMaterial,
  proposeLinksForMaterial,
  readMaterial,
} from "./materialFlow";
import type { Ask } from "./model";
import type { Embedder } from "./search";
import {
  failSession,
  proposeMisses,
  recordAnswers,
  runRound,
} from "./sessionFlow";
import { loadState, type MaterialStatus } from "./state";

/** The models the long steps call: the answer model, the meaning model, and the meaning model's name. */
export interface Models {
  /** Asks the answer model for a reply in a fixed shape. */
  ask: Ask;
  /** Turns text into numbers for meaning search. */
  embed: Embedder;
  /** The meaning model's name, saved with the search file so a change of model is noticed. */
  embedModel: string;
}

/** The run id saved with each start. Kept so older logs, written by the Workflow SDK, still read the same way. */
const RUN_ID = "terminal";

const UNFINISHED: MaterialStatus[] = [
  "waiting",
  "reading",
  "indexing",
  "proposing",
];

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reads a file, adds it to the search file, and proposes concepts, then stops: the file waits
 * in `review` until you confirm its concepts. A file that failed starts again. A file in
 * review or later is left alone. Errors mark the file failed with the message; this never throws
 * for a model or file problem.
 */
export async function processMaterial(
  home: string,
  materialId: string,
  models: Models,
): Promise<void> {
  const m = (await loadState(home)).materials.get(materialId);
  if (!m)
    throw new Error(
      `No file with id ${materialId}. It may have been added in another home folder.`,
    );
  if (m.status === "linking") return linkMaterial(home, materialId, models);
  if (!UNFINISHED.includes(m.status) && m.status !== "failed") return;
  try {
    if (m.status === "waiting" || m.status === "failed")
      await markMaterialStarted(home, materialId, RUN_ID);
    await readMaterial(home, materialId);
    await indexMaterial(home, materialId, models.embed, models.embedModel);
    await proposeForMaterial(home, materialId, models.ask);
  } catch (error) {
    await failMaterial(home, materialId, message(error));
  }
}

async function linkMaterial(
  home: string,
  materialId: string,
  models: Models,
): Promise<void> {
  try {
    await proposeLinksForMaterial(home, materialId, models.ask);
  } catch (error) {
    await failMaterial(home, materialId, message(error));
  }
}

/** Records that you finished reviewing a file's concepts, then proposes prerequisite links. Never throws for a model problem. */
export async function finishMaterialReview(
  home: string,
  materialId: string,
  models: Models,
): Promise<void> {
  await markReviewed(home, materialId);
  await linkMaterial(home, materialId, models);
}

/**
 * Moves a session to the next point where it waits for you: a round of questions to answer, or
 * the list of misses to confirm. Rounds already in the logs are skipped. Errors mark the session
 * failed with the message; this never throws for a model problem.
 */
export async function continueSession(
  home: string,
  sessionId: string,
  models: Models,
): Promise<void> {
  try {
    for (;;) {
      const session = (await loadState(home)).sessions.get(sessionId);
      if (!session) throw new Error(`No session with id ${sessionId}.`);
      if (session.status !== "thinking") return;
      const last = session.rounds[session.rounds.length - 1];
      const done =
        last &&
        (last.questions.length === 0 ||
          last.finish ||
          last.round >= MAX_ROUNDS);
      if (done) {
        await proposeMisses(home, sessionId, {
          ask: models.ask,
          embed: models.embed,
        });
        return;
      }
      await runRound(home, sessionId, (last?.round ?? 0) + 1, {
        ask: models.ask,
        embed: models.embed,
      });
    }
  } catch (error) {
    await failSession(home, sessionId, message(error));
  }
}

/** Saves your answers to one round, then moves the session on to its next round or to the misses. */
export async function answerRound(
  home: string,
  sessionId: string,
  round: number,
  payload: { answers: Answer[]; finish: boolean },
  models: Models,
): Promise<void> {
  await recordAnswers(home, sessionId, round, payload);
  await continueSession(home, sessionId, models);
}

/**
 * Finishes work left over from the last time Kizuki ran: files still being processed, and
 * sessions waiting on the model. Returns the files it processed and the sessions waiting for
 * your answers or your review of misses, oldest first.
 */
export async function resumeUnfinished(
  home: string,
  models: Models,
): Promise<{ materials: string[]; sessions: string[] }> {
  const state = await loadState(home);
  const materials = [...state.materials.values()]
    .filter((m) => UNFINISHED.includes(m.status) || m.status === "linking")
    .map((m) => m.materialId);
  for (const id of materials) await processMaterial(home, id, models);
  for (const s of state.sessions.values())
    if (s.status === "thinking")
      await continueSession(home, s.sessionId, models);
  const after = await loadState(home);
  const sessions = [...after.sessions.values()]
    .filter((s) => s.status === "answering" || s.status === "reviewing")
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map((s) => s.sessionId);
  return { materials, sessions };
}
