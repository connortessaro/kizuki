import type { Answer, Passage } from "./events";
import { addCorrection } from "./commands";
import { appendLog } from "./log";
import type { Ask } from "./model";
import { homePaths } from "./paths";
import { openIndex, searchPassages, type Embedder } from "./search";
import { describeLocation } from "./sources";
import { loadPassages, loadState, resolveConceptId, type SessionState, type State } from "./state";
import { askMisses, askQuestions } from "./teach";

const now = () => new Date().toISOString();

/** The models a session step needs. */
export interface SessionModels {
  /** Asks the answer model for questions and for what you missed. */
  ask: Ask;
  /** Turns your words into numbers to search for related passages. */
  embed: Embedder;
}

/** The most passages shown to the model in one session request. */
export const MAX_SESSION_PASSAGES = 8;

function mustSession(state: State, sessionId: string): SessionState {
  const s = state.sessions.get(sessionId);
  if (!s) throw new Error(`there is no session ${sessionId}`);
  return s;
}

/** Your own words in a session: the explanation and every answer so far. */
function studentWords(session: SessionState): string {
  return [session.explanation, ...session.rounds.flatMap((r) => (r.answers ?? []).map((a) => a.text))].filter(Boolean).join("\n\n");
}

function transcript(session: SessionState): string {
  const lines = [`Explanation:\n${session.explanation}`];
  for (const round of session.rounds) {
    for (const q of round.questions) {
      const answer = round.answers?.find((a) => a.questionId === q.questionId);
      lines.push(`Question: ${q.text}\nAnswer: ${answer?.text ?? "(no answer)"}`);
    }
  }
  return lines.join("\n\n");
}

async function sessionContext(home: string, sessionId: string, embed: Embedder) {
  const state = await loadState(home);
  const session = mustSession(state, sessionId);
  const concept = state.concepts.get(resolveConceptId(state, session.conceptId));
  if (!concept) throw new Error(`the concept of session ${sessionId} is missing`);
  const byId = await loadPassages(home);
  const fileNames = new Map([...state.materials.values()].map((m) => [m.materialId, m.fileName]));
  const words = studentWords(session);

  const db = openIndex(homePaths(home).index);
  let hits: { passageId: string }[];
  try {
    hits = await searchPassages(db, { courseId: concept.courseId, text: words, embed, limit: 6 });
  } finally {
    db.close();
  }
  const own: Passage[] = [];
  for (const q of concept.quotes) {
    const p = byId.get(q.passageId);
    if (p && !own.some((x) => x.passageId === p.passageId)) own.push(p);
  }
  const picked: Passage[] = own.slice(0, MAX_SESSION_PASSAGES);
  for (const h of hits) {
    const p = byId.get(h.passageId);
    if (picked.length >= MAX_SESSION_PASSAGES) break;
    if (p && !picked.some((x) => x.passageId === p.passageId)) picked.push(p);
  }

  const notes = new Map<string, string[]>();
  const note = (id: string, text: string) => notes.set(id, [...(notes.get(id) ?? []), text]);
  for (const c of state.corrections) note(c.passageId, `Your correction: “${c.quote}” should be “${c.correction}”.${c.note ? ` (${c.note})` : ""}`);
  for (const c of state.clarifications.values()) if (c.answer) note(c.passageId, `Your reading of “${c.quote}”: ${c.answer}`);

  const labelFor = (passageId: string) => {
    const p = byId.get(passageId);
    return p ? describeLocation(p.location, fileNames.get(p.materialId) ?? "your material") : "Your material";
  };
  return { state, session, concept, passages: picked, own, notes, labelFor, words, matched: hits.length };
}

/** Records the workflow run that runs a session. */
export async function markSessionRunning(home: string, sessionId: string, runId: string): Promise<void> {
  await appendLog(home, "sessions", [{ type: "session.running", at: now(), sessionId, runId }]);
}

/** Records that a session failed, with the error. */
export async function failSession(home: string, sessionId: string, error: string): Promise<void> {
  const session = mustSession(await loadState(home), sessionId);
  if (!session.ended) await appendLog(home, "sessions", [{ type: "session.failed", at: now(), sessionId, error }]);
}

/**
 * Chooses and saves one round of questions. If nothing in the material matches what you wrote
 * and no question is left, the round says "not in your material". Safe to run again: a round
 * is only saved once.
 */
export async function runRound(home: string, sessionId: string, round: number, models: SessionModels): Promise<void> {
  // Checked before the search, which calls the meaning model, so a restart skips finished rounds even with the models down.
  const done = mustSession(await loadState(home), sessionId);
  if (done.rounds.some((r) => r.round === round) || done.ended) return;
  const ctx = await sessionContext(home, sessionId, models.embed);
  const out = await askQuestions({
    conceptName: ctx.concept.name,
    passages: ctx.passages,
    studentText: ctx.words,
    previous: ctx.session.rounds.flatMap((r) => r.questions),
    corrections: ctx.state.corrections.map((c) => ({ passageId: c.passageId, quote: c.quote })),
    notes: ctx.notes,
    labelFor: ctx.labelFor,
    ask: models.ask,
    transcript: transcript(ctx.session),
  });
  // Nothing in the material matched what you wrote, and no question survived the checks.
  const notInMaterial = out.notInMaterial || (out.questions.length === 0 && ctx.matched === 0);
  await appendLog(home, "sessions", [{ type: "session.questions", at: now(), sessionId, round, ...out, notInMaterial }]);
}

/**
 * Saves your answers to one round. A "the material is wrong" answer with your version
 * becomes a correction, which wins from then on. Answers must be to questions asked in that
 * round. Safe to run again.
 */
export async function recordAnswers(home: string, sessionId: string, round: number, payload: { answers: Answer[]; finish: boolean }): Promise<void> {
  const state = await loadState(home);
  const session = mustSession(state, sessionId);
  const r = session.rounds.find((x) => x.round === round);
  if (!r) throw new Error(`round ${round} of this session has no questions yet`);
  if (r.answers) return;
  for (const a of payload.answers) {
    if (!r.questions.some((q) => q.questionId === a.questionId)) throw new Error(`question ${a.questionId} was not asked in round ${round}`);
  }
  for (const a of payload.answers) {
    const q = r.questions.find((x) => x.questionId === a.questionId)!;
    const correction = a.correction?.trim();
    if (a.verdict !== "material-wrong" || !correction || !q.quote) continue;
    const duplicate = state.corrections.some((c) => c.passageId === q.quote!.passageId && c.quote === q.quote!.text && c.correction === correction);
    if (!duplicate) await addCorrection(home, { passageId: q.quote.passageId, quote: q.quote.text, correction, note: a.text, sessionId });
  }
  await appendLog(home, "sessions", [{ type: "session.answered", at: now(), sessionId, round, answers: payload.answers, finish: payload.finish }]);
}

/**
 * Asks the model what you missed and saves the checked list for you to confirm. Only the
 * concept's own passages count, so points from other topics are never listed. Safe to run again.
 */
export async function proposeMisses(home: string, sessionId: string, models: SessionModels): Promise<void> {
  const done = mustSession(await loadState(home), sessionId);
  if (done.misses || done.ended) return;
  const ctx = await sessionContext(home, sessionId, models.embed);
  const out = await askMisses({
    conceptName: ctx.concept.name,
    passages: ctx.own,
    studentText: ctx.words,
    notes: ctx.notes,
    corrections: ctx.state.corrections,
    ask: models.ask,
    transcript: transcript(ctx.session),
  });
  await appendLog(home, "sessions", [{ type: "session.missesProposed", at: now(), sessionId, ...out }]);
}

/**
 * Ends a session with the misses you confirmed. The session is clean only if you confirmed
 * no misses and never answered "the material is right" to a contradiction.
 */
export async function endSession(home: string, sessionId: string, confirmedMissIds: string[]): Promise<void> {
  const session = mustSession(await loadState(home), sessionId);
  if (session.ended) return;
  const all = (session.misses ?? []).map((m) => m.missId);
  for (const id of confirmedMissIds) if (!all.includes(id)) throw new Error(`${id} is not one of this session's proposed misses`);
  const materialRight = session.rounds.some((r) => (r.answers ?? []).some((a) => a.verdict === "material-right"));
  await appendLog(home, "sessions", [
    {
      type: "session.ended",
      at: now(),
      sessionId,
      confirmedMissIds,
      rejectedMissIds: all.filter((id) => !confirmedMissIds.includes(id)),
      clean: confirmedMissIds.length === 0 && !materialRight,
    },
  ]);
}
