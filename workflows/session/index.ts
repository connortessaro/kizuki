import { createHook } from "workflow";
import type { Answer } from "../../lib/events";
import { MAX_ROUNDS } from "../../lib/limits";
import { sessionAnswersToken, sessionReviewToken } from "../../lib/tokens";
import { answersStep, endStep, failStep, missesStep, roundStep } from "./steps";

/**
 * Runs one teach-back session: up to three rounds of questions, each pausing for your
 * answers, then a list of what you may have missed, pausing until you confirm it. Every
 * step checks the logs first, so a new run for a half-finished session picks up where the
 * old one stopped.
 */
export async function teachSession(home: string, sessionId: string): Promise<void> {
  "use workflow";
  try {
    for (let round = 1; round <= MAX_ROUNDS; round += 1) {
      const answers = createHook<{ answers: Answer[]; finish: boolean }>({ token: sessionAnswersToken(sessionId, round) });
      if (await answers.getConflict()) return;
      const done = await roundStep(home, sessionId, round);
      if (done.asked === 0) break;
      if (done.answered) {
        if (done.finish) break;
        continue;
      }
      const payload = await answers;
      await answersStep(home, sessionId, round, payload);
      if (payload.finish) break;
    }
    const review = createHook<{ confirmedMissIds: string[] }>({ token: sessionReviewToken(sessionId) });
    if (await review.getConflict()) return;
    await missesStep(home, sessionId);
    const { confirmedMissIds } = await review;
    await endStep(home, sessionId, confirmedMissIds);
  } catch (error) {
    await failStep(home, sessionId, error instanceof Error ? error.message : String(error));
  }
}
