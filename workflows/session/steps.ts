import type { Answer } from "../../lib/events";
import { makeAsk, makeEmbedder } from "../../lib/model";
import { endSession, failSession, proposeMisses, recordAnswers, runRound } from "../../lib/sessionFlow";
import { readSettings } from "../../lib/settings";
import { loadState } from "../../lib/state";
import { ownHome } from "../home";

async function models(home: string) {
  const settings = await readSettings(home);
  return { ask: makeAsk(settings.chat), embed: makeEmbedder(settings.embed) };
}

/**
 * Chooses one round of questions, unless the round already exists. Returns how many
 * questions passed the checks, and whether you already answered them (so a restarted
 * session skips rounds that are done).
 */
export async function roundStep(home: string, sessionId: string, round: number): Promise<{ asked: number; answered: boolean; finish: boolean }> {
  "use step";
  home = ownHome(home);
  await runRound(home, sessionId, round, await models(home));
  const found = (await loadState(home)).sessions.get(sessionId)?.rounds.find((r) => r.round === round);
  return { asked: found?.questions.length ?? 0, answered: Boolean(found?.answers), finish: Boolean(found?.finish) };
}

/** Saves your answers to one round. */
export async function answersStep(home: string, sessionId: string, round: number, payload: { answers: Answer[]; finish: boolean }): Promise<void> {
  "use step";
  home = ownHome(home);
  await recordAnswers(home, sessionId, round, payload);
}

/** Asks what you missed and saves the checked list. */
export async function missesStep(home: string, sessionId: string): Promise<void> {
  "use step";
  home = ownHome(home);
  await proposeMisses(home, sessionId, await models(home));
}

/** Ends the session with the misses you confirmed. */
export async function endStep(home: string, sessionId: string, confirmedMissIds: string[]): Promise<void> {
  "use step";
  home = ownHome(home);
  await endSession(home, sessionId, confirmedMissIds);
}

/** Records that the session failed. */
export async function failStep(home: string, sessionId: string, message: string): Promise<void> {
  "use step";
  home = ownHome(home);
  await failSession(home, sessionId, message);
}
