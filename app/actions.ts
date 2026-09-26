"use server";

import { redirect } from "next/navigation";
import { resumeHook, start } from "workflow/api";
import {
  addCorrection,
  addMaterial,
  answerClarification,
  confirmConcept,
  confirmLink,
  createCourse,
  dropConcept,
  dropLink,
  mergeConcept,
  recordCatch,
  renameConcept,
  setExamDate,
  startSession,
} from "@/lib/commands";
import type { Answer } from "@/lib/events";
import { withMessage } from "@/lib/messages";
import { markMaterialStarted, markReviewed, proposeLinksForMaterial } from "@/lib/materialFlow";
import { makeAsk, makeEmbedder, sendsMaterialOut } from "@/lib/model";
import { kizukiHome } from "@/lib/paths";
import { quoteMatches } from "@/lib/quote";
import { rebuildIndex } from "@/lib/rebuild";
import { failSession, markSessionRunning } from "@/lib/sessionFlow";
import { PRESETS, readSettings, writeSettings, type Settings } from "@/lib/settings";
import { loadPassages, loadState } from "@/lib/state";
import { materialReviewToken, sessionAnswersToken, sessionReviewToken } from "@/lib/tokens";
import { processMaterial } from "@/workflows/material";
import { teachSession } from "@/workflows/session";

const home = () => kizukiHome();
const text = (form: FormData, key: string) => String(form.get(key) ?? "");


/**
 * Runs an action and returns the page to go back to, with the error if it failed.
 *
 * @openapi
 * actions:
 *   summary: Forms on this page
 *   description: >-
 *     The forms on this page post here. The React code in the page sends the form as
 *     `multipart/form-data` with the action's id in the `Next-Action` header, and adds values the
 *     page bound when it rendered the form (such as the course id). With JavaScript on, React
 *     puts a prefix such as `_1_` before each field name. Without JavaScript, the browser posts
 *     the form itself, with the action id in a field named `$ACTION_ID_<id>`, and gets a 303
 *     answer instead of a 200. Every action ends by sending the browser to a page: on success
 *     the next page, on an error the same page with a `note` id that shows the message.
 *     The body may be up to 200 MB (`serverActions.bodySizeLimit` in next.config.ts).
 *   parameters:
 *     - name: Next-Action
 *       in: header
 *       required: false
 *       description: >-
 *         The id of the action to run. Next.js makes the ids when it builds the app, so they
 *         change with every build. Sent by React when JavaScript is on.
 *       schema: { type: string, examples: ["409ac59643feb68cc6f88f4b937fd7218dd032ba25"] }
 *     - name: Origin
 *       in: header
 *       required: false
 *       description: >-
 *         Set by the browser. Next.js refuses to run an action when Origin names a different
 *         host from the Host header, so another site's page cannot post Kizuki's forms.
 *       schema: { type: string, examples: ["http://127.0.0.1:3700"] }
 *   responses:
 *     "200":
 *       description: >-
 *         The action ran (JavaScript on). The body is React's page data, and the browser then
 *         opens the address in `x-action-redirect`.
 *       headers:
 *         x-action-redirect:
 *           description: >-
 *             Where the browser goes next, followed by `;push`, as in
 *             `/courses/course_…;push` or, after an error, `/courses?note=…;push`.
 *           schema: { type: string }
 *       content:
 *         text/x-component:
 *           schema: { type: string }
 *     "303":
 *       description: The action ran (form posted without JavaScript). The browser goes to the next page.
 *       headers:
 *         location:
 *           description: The next page, as for `x-action-redirect` but without `;push`.
 *           schema: { type: string }
 *     "404":
 *       description: The action id is not one this build knows. The body is `Server action not found.`
 *       headers:
 *         x-nextjs-action-not-found:
 *           description: Always `1`.
 *           schema: { type: string, const: "1" }
 *       content:
 *         text/plain:
 *           schema: { type: string }
 *     "500":
 *       description: Next.js refused to run the action because Origin names a different host from Host.
 */
async function attempt(back: string, fn: () => Promise<string | void>): Promise<never> {
  let target: string;
  try {
    target = (await fn()) ?? back;
  } catch (error) {
    target = withMessage(back, "error", (error as Error).message);
  }
  redirect(target);
}

/** Resumes a paused workflow. Tries for a few seconds, because the pause may be a moment from being ready. */
async function resume(token: string, payload: unknown, tries = 20): Promise<void> {
  let last: unknown;
  for (let i = 0; i < tries; i += 1) {
    try {
      await resumeHook(token, payload);
      return;
    } catch (error) {
      last = error;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(`Kizuki could not reach the waiting step (${(last as Error)?.message ?? "unknown error"}).`);
}

/** Waits until the logs show a workflow step took effect, so the next page shows the new state. */
async function waitUntil(check: (state: Awaited<ReturnType<typeof loadState>>) => boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check(await loadState(home()))) return;
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function startSessionRun(sessionId: string): Promise<void> {
  const run = await start(teachSession, [home(), sessionId]);
  await markSessionRunning(home(), sessionId, run.runId);
}

/**
 * Resumes a session's paused step. If the step is gone (for example Kizuki was stopped
 * mid-session and its run was lost), starts a new run for the session, which skips what is
 * already done, and tries again.
 */
async function resumeSession(sessionId: string, token: string, payload: unknown): Promise<void> {
  try {
    await resume(token, payload, 8);
  } catch (error) {
    if (!/not found/i.test((error as Error).message)) throw error;
    await startSessionRun(sessionId);
    await resume(token, payload, 60);
  }
}

async function startProcessing(materialId: string): Promise<void> {
  const run = await start(processMaterial, [home(), materialId]);
  await markMaterialStarted(home(), materialId, run.runId);
}

/**
 * Creates a course and opens it.
 *
 * @openapi
 * action:
 *   fields:
 *     "name": "The course name. It must differ from your other courses' names, ignoring letter case."
 *   result: "Opens the new course at `/courses/{courseId}`. On an error, goes to `/courses` with the message."
 */
export async function createCourseAction(form: FormData) {
  return attempt("/courses", async () => `/courses/${await createCourse(home(), text(form, "name"))}`);
}

/**
 * Sets or clears a course's exam date.
 *
 * @openapi
 * action:
 *   fields:
 *     "examDate": "The exam date as `YYYY-MM-DD`, or empty to clear it."
 *   result: "Back to the course."
 */
export async function setExamDateAction(courseId: string, form: FormData) {
  return attempt(`/courses/${courseId}`, () => setExamDate(home(), courseId, text(form, "examDate") || null));
}

/**
 * Adds uploaded files to a course and starts processing each one.
 *
 * @openapi
 * action:
 *   fields:
 *     "files": "One or more files; repeat the field for each. Kizuki reads `.pdf`, `.pptx`, `.docx`, `.xlsx`, `.csv`, `.md`, `.markdown`, and `.txt`. Empty entries are skipped. The whole request may be up to 200 MB."
 *   result: "Back to the course. Each file is copied into the data folder and its processing starts in the background. A file Kizuki can't read, or one already in the course, is named in the error message; the other files are still added."
 */
export async function uploadAction(courseId: string, form: FormData) {
  const back = `/courses/${courseId}`;
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  return attempt(back, async () => {
    if (files.length === 0) throw new Error("choose at least one file");
    const problems: string[] = [];
    for (const file of files) {
      try {
        const materialId = await addMaterial(home(), { courseId, fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
        await startProcessing(materialId);
      } catch (error) {
        problems.push(`${file.name}: ${(error as Error).message}`);
      }
    }
    if (problems.length) return withMessage(back, "error", problems.join(" · "));
  });
}

/**
 * Starts processing a file again after it failed.
 *
 * @openapi
 * action:
 *   result: "Starts processing the file again, then back to the course."
 */
export async function retryMaterialAction(courseId: string, materialId: string) {
  return attempt(`/courses/${courseId}`, () => startProcessing(materialId));
}

/**
 * Tells a file's workflow you finished reviewing its concepts, so it goes on to suggest links.
 *
 * @openapi
 * action:
 *   result: "Tells the file's paused workflow that you finished reviewing its concepts, waits up to 15 seconds for the file to leave review, then back to the course. If that workflow is gone (for example after a restart), Kizuki records the review and asks the model for links itself."
 */
export async function doneReviewingAction(courseId: string, materialId: string) {
  return attempt(`/courses/${courseId}`, async () => {
    try {
      await resume(materialReviewToken(materialId), { reviewed: true });
      await waitUntil((s) => s.materials.get(materialId)?.status !== "review");
    } catch (error) {
      // Only a pause that no longer exists (for example after a restart) is handled here; any other error is shown.
      if (!/not found/i.test((error as Error).message)) throw error;
      // The workflow that was waiting is gone, so finish its last steps here.
      const settings = await readSettings(home());
      await markReviewed(home(), materialId);
      await proposeLinksForMaterial(home(), materialId, makeAsk(settings.chat));
    }
  });
}

/**
 * Confirms a concept.
 *
 * @openapi
 * action:
 *   result: "Back to the page in `back`."
 */
export async function confirmConceptAction(conceptId: string, back: string) {
  return attempt(back, () => confirmConcept(home(), conceptId));
}

/**
 * Confirms every proposed concept from one file.
 *
 * @openapi
 * action:
 *   result: "Confirms every proposed concept from the file, then back to the page in `back`."
 */
export async function confirmAllAction(materialId: string, back: string) {
  return attempt(back, async () => {
    const state = await loadState(home());
    for (const c of state.concepts.values()) if (c.materialId === materialId && c.status === "proposed") await confirmConcept(home(), c.conceptId);
  });
}

/**
 * Drops a concept.
 *
 * @openapi
 * action:
 *   result: "Back to the page in `back`."
 */
export async function dropConceptAction(conceptId: string, back: string) {
  return attempt(back, () => dropConcept(home(), conceptId));
}

/**
 * Renames a concept.
 *
 * @openapi
 * action:
 *   fields:
 *     "name": "The new name: 1 to 120 characters, not used by another proposed or confirmed concept in the course."
 *   result: "Back to the page in `back`."
 */
export async function renameConceptAction(conceptId: string, back: string, form: FormData) {
  return attempt(back, () => renameConcept(home(), conceptId, text(form, "name")));
}

/**
 * Merges a concept into another one.
 *
 * @openapi
 * action:
 *   fields:
 *     "into": "The id of the concept to merge into. It must be in the same course, and the merge must not make a loop in the confirmed order."
 *   result: "Back to the page in `back`."
 */
export async function mergeConceptAction(conceptId: string, back: string, form: FormData) {
  return attempt(back, () => mergeConcept(home(), conceptId, text(form, "into")));
}

/**
 * Confirms a prerequisite link.
 *
 * @openapi
 * action:
 *   result: "Back to the page in `back`. Refused if the link would make a loop."
 */
export async function confirmLinkAction(linkId: string, back: string) {
  return attempt(back, () => confirmLink(home(), linkId));
}

/**
 * Drops a prerequisite link.
 *
 * @openapi
 * action:
 *   result: "Back to the page in `back`."
 */
export async function dropLinkAction(linkId: string, back: string) {
  return attempt(back, () => dropLink(home(), linkId));
}

/**
 * Saves your answer to a "what does this mean?" question.
 *
 * @openapi
 * action:
 *   fields:
 *     "answer": "What the sentence means, in your words. Required."
 *   result: "Back to the page in `back`."
 */
export async function answerClarificationAction(clarificationId: string, back: string, form: FormData) {
  return attempt(back, () => answerClarification(home(), clarificationId, text(form, "answer")));
}

/**
 * Records your correction to a passage. The wrong text must appear in the passage word for word.
 *
 * @openapi
 * action:
 *   fields:
 *     "quote": "The wrong text, copied from the passage. It must pass the word-for-word quote check against the passage."
 *     "correction": "Your version. Required."
 *     "note": "Optional: where the correction comes from, such as a lecture date."
 *   result: "Back to the passage with \"Correction saved. Your version wins from now on.\""
 */
export async function addCorrectionAction(passageId: string, form: FormData) {
  return attempt(`/sources/${passageId}`, async () => {
    const passage = (await loadPassages(home())).get(passageId);
    if (!passage) throw new Error("that passage no longer exists");
    const quote = text(form, "quote");
    if (!quoteMatches(quote, passage.text)) throw new Error("copy the wrong text exactly as it appears in the passage");
    await addCorrection(home(), { passageId, quote, correction: text(form, "correction"), note: text(form, "note") });
    return withMessage(`/sources/${passageId}`, "done", "Correction saved. Your version wins from now on.");
  });
}

/**
 * Starts a teach-back session with your explanation.
 *
 * @openapi
 * action:
 *   fields:
 *     "explanation": "Your explanation of the concept, in your own words. Required."
 *   result: "Starts the session and its background run, then opens `/sessions/{sessionId}`. On an error, back to the concept."
 */
export async function startSessionAction(conceptId: string, form: FormData) {
  return attempt(`/concepts/${conceptId}`, async () => {
    const sessionId = await startSession(home(), conceptId, text(form, "explanation"));
    await startSessionRun(sessionId);
    return `/sessions/${sessionId}`;
  });
}

/**
 * Sends your answers to one round of questions.
 *
 * @openapi
 * action:
 *   fields:
 *     "answer:{questionId}": "Your answer to one question. May be empty."
 *     "verdict:{questionId}": "For a \"Does this fit?\" question, required: `material-right` (you got it wrong), `material-wrong` (the material is wrong), or `misread` (Kizuki misread you)."
 *     "correction:{questionId}": "Your version, required when the verdict is `material-wrong`. It is saved as a correction."
 *     "finish": "`yes` to stop asking after this round. Any other value asks for another round, up to three."
 *   result: "Sends the answers to the session's paused run, waits up to 15 seconds for them to be saved, then back to the session. If the run is gone, Kizuki starts a new run that skips finished steps and sends the answers again."
 */
export async function answerRoundAction(sessionId: string, round: number, form: FormData) {
  return attempt(`/sessions/${sessionId}`, async () => {
    const session = (await loadState(home())).sessions.get(sessionId);
    const questions = session?.rounds.find((r) => r.round === round)?.questions ?? [];
    const answers: Answer[] = questions.map((q) => {
      const verdict = text(form, `verdict:${q.questionId}`);
      return {
        questionId: q.questionId,
        text: text(form, `answer:${q.questionId}`).trim(),
        verdict: verdict === "material-right" || verdict === "material-wrong" || verdict === "misread" ? verdict : undefined,
        correction: text(form, `correction:${q.questionId}`).trim() || undefined,
      };
    });
    for (const [i, a] of answers.entries()) {
      if (questions[i]!.kind === "contradiction" && !a.verdict) throw new Error("for each “how does that fit” question, say whether the material or your explanation is right");
      if (a.verdict === "material-wrong" && !a.correction) throw new Error("when the material is wrong, write the correct version");
    }
    await resumeSession(sessionId, sessionAnswersToken(sessionId, round), { answers, finish: text(form, "finish") === "yes" });
    await waitUntil((s) => Boolean(s.sessions.get(sessionId)?.rounds.find((r) => r.round === round)?.answers) || s.sessions.get(sessionId)?.status === "failed");
  });
}

/**
 * Sends which proposed misses you confirm, which ends the session.
 *
 * @openapi
 * action:
 *   fields:
 *     "missed": "The id of a proposed miss you missed; repeat the field for each. Leave it out if you missed none."
 *   result: "Sends your choice to the session's paused run, which ends the session, waits up to 15 seconds, then back to the session."
 */
export async function finishReviewAction(sessionId: string, form: FormData) {
  return attempt(`/sessions/${sessionId}`, async () => {
    await resumeSession(sessionId, sessionReviewToken(sessionId), { confirmedMissIds: form.getAll("missed").map(String) });
    await waitUntil((s) => {
      const status = s.sessions.get(sessionId)?.status;
      return status === "ended" || status === "failed";
    });
  });
}

/**
 * Starts a new run for a session that stopped making progress. Finished steps are skipped.
 *
 * @openapi
 * action:
 *   result: "Starts a new run for the session (finished steps are skipped), then back to the session."
 */
export async function restartSessionAction(sessionId: string) {
  return attempt(`/sessions/${sessionId}`, () => startSessionRun(sessionId));
}

/**
 * Stops an open session so a new one can start.
 *
 * @openapi
 * action:
 *   result: "Marks the session as stopped (\"You stopped this session.\"), then opens the concept page so you can start again."
 */
export async function abandonSessionAction(sessionId: string, conceptId: string) {
  return attempt(`/concepts/${conceptId}`, () => failSession(home(), sessionId, "You stopped this session."));
}

/**
 * Records a catch for a finished session.
 *
 * @openapi
 * action:
 *   fields:
 *     "note": "What you would have gotten wrong. May be empty."
 *   result: "Back to the session with \"Catch recorded.\" Refused if the session has not ended."
 */
export async function recordCatchAction(sessionId: string, form: FormData) {
  return attempt(`/sessions/${sessionId}`, async () => {
    await recordCatch(home(), sessionId, text(form, "note"));
    return withMessage(`/sessions/${sessionId}`, "done", "Catch recorded.");
  });
}

/**
 * Refuses settings that would start sending your material off this computer unless you ticked
 * the box saying you understand. Checked before saving, so nothing leaves before you agree.
 */
function mustAgreeToSendOut(before: Settings, after: Settings, form: FormData): void {
  if (sendsMaterialOut(after) && !sendsMaterialOut(before) && text(form, "sendOut") !== "yes") {
    throw new Error("these settings send your material off this computer to a hosted model. Tick the box to say you understand, then try again.");
  }
}

/**
 * Saves the model settings from the settings form.
 *
 * @openapi
 * action:
 *   fields:
 *     "chatBaseURL": "The answer model's server address, such as `http://localhost:11434/v1`."
 *     "chatModel": "The answer model's name, such as `qwen3.5:2b`."
 *     "chatApiKeyEnv": "Optional: the name of the environment variable that holds the API key, ending in `_API_KEY`. Never the key itself."
 *     "reasoning": "`default` leaves thinking to the model. Any other value turns thinking off."
 *     "replyShape": "`prompt` makes Kizuki describe and check the reply shape itself (for MLX). Any other value leaves it to the server."
 *     "embedBaseURL": "The meaning-search model's server address."
 *     "embedModel": "The meaning-search model's name, such as `nomic-embed-text`."
 *     "embedApiKeyEnv": "Optional: the environment variable that holds its API key."
 *     "sendOut": "`yes` means you agree to send your material off this computer. Required when the new settings would start doing that."
 *   result: "Checks and saves `settings.json`, then back to Settings with \"Settings saved.\" If the meaning model changed, the message says to rebuild the search file."
 */
export async function saveSettingsAction(form: FormData) {
  return attempt("/settings", async () => {
    const settings: Settings = {
      chat: {
        baseURL: text(form, "chatBaseURL").trim(),
        model: text(form, "chatModel").trim(),
        apiKeyEnv: text(form, "chatApiKeyEnv").trim() || undefined,
        reasoning: text(form, "reasoning") === "default" ? "default" : "none",
        replyShape: text(form, "replyShape") === "prompt" ? "prompt" : "server",
      },
      embed: {
        baseURL: text(form, "embedBaseURL").trim(),
        model: text(form, "embedModel").trim(),
        apiKeyEnv: text(form, "embedApiKeyEnv").trim() || undefined,
      },
    };
    const before = await readSettings(home());
    mustAgreeToSendOut(before, settings, form);
    await writeSettings(home(), settings);
    const note = before.embed.model !== settings.embed.model ? " The meaning model changed: rebuild the search file below." : "";
    return withMessage("/settings", "done", `Settings saved.${note}`);
  });
}

/**
 * Switches to one of the ready-made model settings. The hosted one needs your OK first, because it sends your material out.
 *
 * @openapi
 * action:
 *   fields:
 *     "sendOut": "`yes` means you agree to send your material off this computer. Required for the hosted preset when your current settings keep everything local."
 *   result: "Saves the ready-made settings (`preset` is `ollama`, `mlx`, or `hosted`), then back to Settings."
 */
export async function presetAction(preset: keyof typeof PRESETS, form: FormData) {
  return attempt("/settings", async () => {
    mustAgreeToSendOut(await readSettings(home()), PRESETS[preset], form);
    await writeSettings(home(), PRESETS[preset]);
    return withMessage("/settings", "done", `Switched to the ${preset === "mlx" ? "MLX" : preset === "hosted" ? "hosted" : "Ollama"} settings.`);
  });
}

/**
 * Rebuilds the search file from the logs with the current meaning model.
 *
 * @openapi
 * action:
 *   result: "Builds the search file again from the logs with the current meaning model, then back to Settings with the number of passages."
 */
export async function rebuildIndexAction() {
  return attempt("/settings", async () => {
    const settings = await readSettings(home());
    const count = await rebuildIndex(home(), makeEmbedder(settings.embed), settings.embed.model);
    return withMessage("/settings", "done", `Search file rebuilt with ${count} passages.`);
  });
}
