import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { nameKey } from "./concepts";
import { formatOf } from "./extract/index";
import { newId, sha256 } from "./ids";
import { wouldCreateLoop, type Link } from "./links";
import { appendLog, withWriteLock } from "./log";
import { homePaths } from "./paths";
import { loadState, resolveConceptId, type ConceptState, type State } from "./state";

const now = () => new Date().toISOString();

function mustConcept(state: State, conceptId: string): ConceptState {
  const c = state.concepts.get(conceptId);
  if (!c) throw new Error(`there is no concept ${conceptId}`);
  return c;
}

function liveNames(state: State, courseId: string, except?: string): Set<string> {
  return new Set(
    [...state.concepts.values()]
      .filter((c) => c.courseId === courseId && c.conceptId !== except && (c.status === "proposed" || c.status === "confirmed"))
      .map((c) => nameKey(c.name)),
  );
}

/** Creates a course. Names must be unique, ignoring case. Returns the new course id. */
export async function createCourse(home: string, name: string): Promise<string> {
  const clean = name.replace(/\s+/g, " ").trim();
  if (!clean) throw new Error("a course needs a name");
  const state = await loadState(home);
  if ([...state.courses.values()].some((c) => nameKey(c.name) === nameKey(clean))) throw new Error(`you already have a course called ${clean}`);
  const courseId = newId("course");
  await appendLog(home, "courses", [{ type: "course.created", at: now(), courseId, name: clean }]);
  return courseId;
}

/** Sets a course's exam date (`YYYY-MM-DD`), or clears it with `null`. */
export async function setExamDate(home: string, courseId: string, examDate: string | null): Promise<void> {
  const state = await loadState(home);
  if (!state.courses.has(courseId)) throw new Error(`there is no course ${courseId}`);
  if (examDate !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(examDate) || Number.isNaN(Date.parse(examDate)))) throw new Error(`${examDate} is not a date like 2026-12-01`);
  await appendLog(home, "courses", [{ type: "course.examDateSet", at: now(), courseId, examDate }]);
}

/**
 * Adds a file to a course: keeps a copy in `files/` and records it. Processing (reading,
 * search, concept proposals) is started separately. Refuses formats Kizuki cannot read yet,
 * and the same file twice in one course.
 */
export async function addMaterial(home: string, input: { courseId: string; fileName: string; bytes: Uint8Array }): Promise<string> {
  const format = formatOf(input.fileName);
  const ext = extname(input.fileName).toLowerCase() || "(no extension)";
  if (!format) throw new Error(`Kizuki can't read ${ext} files yet. It reads PDF, PowerPoint, Word, Excel, CSV, markdown, and text files.`);
  const state = await loadState(home);
  if (!state.courses.has(input.courseId)) throw new Error(`there is no course ${input.courseId}`);
  const hash = sha256(input.bytes);
  const duplicate = [...state.materials.values()].find((m) => m.courseId === input.courseId && m.sha256 === hash && m.status !== "failed");
  if (duplicate) throw new Error(`this file was already added as ${duplicate.fileName}`);
  const materialId = newId("mat");
  const storedName = `${materialId}${ext}`;
  const paths = homePaths(home);
  await mkdir(paths.files, { recursive: true, mode: 0o700 });
  await writeFile(join(/*turbopackIgnore: true*/ paths.files, storedName), input.bytes, { mode: 0o600 });
  await appendLog(home, "materials", [
    {
      type: "material.added",
      at: now(),
      materialId,
      courseId: input.courseId,
      fileName: input.fileName,
      storedName,
      format,
      bytes: input.bytes.byteLength,
      sha256: hash,
    },
  ]);
  return materialId;
}

/** Confirms a proposed concept, so it is used for teach-back and review. */
export async function confirmConcept(home: string, conceptId: string): Promise<void> {
  const c = mustConcept(await loadState(home), conceptId);
  if (c.status === "confirmed") return;
  if (c.status !== "proposed") throw new Error(`${c.name} was ${c.status} and can't be confirmed`);
  await appendLog(home, "concepts", [{ type: "concept.confirmed", at: now(), conceptId }]);
}

/** Renames a concept. The course may not already have a live concept with that name. */
export async function renameConcept(home: string, conceptId: string, name: string): Promise<void> {
  const clean = name.replace(/\s+/g, " ").trim();
  if (!clean || clean.length > 120) throw new Error("a concept name must be 1 to 120 characters");
  const state = await loadState(home);
  const c = mustConcept(state, conceptId);
  if (liveNames(state, c.courseId, conceptId).has(nameKey(clean))) throw new Error(`the course already has a concept called ${clean}`);
  await appendLog(home, "concepts", [{ type: "concept.renamed", at: now(), conceptId, name: clean }]);
}

/** Drops a concept. It stays in the logs but is never used. */
export async function dropConcept(home: string, conceptId: string): Promise<void> {
  const c = mustConcept(await loadState(home), conceptId);
  if (c.status === "dropped") return;
  if (c.status === "merged") throw new Error(`${c.name} was merged and can't be dropped`);
  await appendLog(home, "concepts", [{ type: "concept.dropped", at: now(), conceptId }]);
}

/** Merges one concept into another in the same course. The target keeps its name and gains the other's quotes. Refuses a merge that would make a loop in the confirmed links. */
export async function mergeConcept(home: string, conceptId: string, intoConceptId: string): Promise<void> {
  if (conceptId === intoConceptId) throw new Error("a concept can't be merged into itself");
  const state = await loadState(home);
  const from = mustConcept(state, conceptId);
  const into = mustConcept(state, intoConceptId);
  if (from.courseId !== into.courseId) throw new Error("concepts can only be merged within one course");
  for (const c of [from, into]) {
    if (c.status === "dropped" || c.status === "merged") throw new Error(`${c.name} was ${c.status} and can't be merged`);
  }
  if (hasLoop(confirmedLinks(state, new Map([[conceptId, intoConceptId]])))) {
    throw new Error(`merging ${from.name} into ${into.name} would make a loop in the order, where a concept needs itself. Remove one of their links first.`);
  }
  await appendLog(home, "concepts", [{ type: "concept.merged", at: now(), conceptId, intoConceptId }]);
}

/** Confirmed links with merged concepts followed to the concept each now points to. */
function confirmedLinks(state: State, merged: Map<string, string> = new Map()): Link[] {
  const to = (id: string) => {
    const r = resolveConceptId(state, id);
    return merged.get(r) ?? r;
  };
  return [...state.links.values()].filter((l) => l.status === "confirmed").map((l) => ({ conceptId: to(l.conceptId), needsConceptId: to(l.needsConceptId) }));
}

/** True if the links make a concept need itself, directly or through a chain. */
function hasLoop(links: Link[]): boolean {
  return links.some((l, i) => wouldCreateLoop(links.filter((_, j) => j !== i), l));
}

/**
 * Confirms a proposed prerequisite link. Refuses a link that would make a loop with the
 * confirmed ones. The check and the write happen under one lock, so two links confirmed at
 * the same moment can't make a loop together.
 */
export async function confirmLink(home: string, linkId: string): Promise<void> {
  await withWriteLock(home, async (append) => {
    const state = await loadState(home);
    const link = state.links.get(linkId);
    if (!link) throw new Error(`there is no link ${linkId}`);
    if (link.status === "confirmed") return;
    const candidate = { conceptId: resolveConceptId(state, link.conceptId), needsConceptId: resolveConceptId(state, link.needsConceptId) };
    if (wouldCreateLoop(confirmedLinks(state), candidate)) throw new Error("confirming this link would make a loop, where a concept needs itself");
    await append("links", [{ type: "link.confirmed", at: now(), linkId }]);
  });
}

/** Drops a proposed or confirmed prerequisite link. */
export async function dropLink(home: string, linkId: string): Promise<void> {
  const state = await loadState(home);
  if (!state.links.has(linkId)) throw new Error(`there is no link ${linkId}`);
  await appendLog(home, "links", [{ type: "link.dropped", at: now(), linkId }]);
}

/** Starts a teach-back session with your explanation. The concept must be confirmed. Returns the session id. */
export async function startSession(home: string, conceptId: string, explanation: string): Promise<string> {
  const state = await loadState(home);
  const c = mustConcept(state, resolveConceptId(state, conceptId));
  if (c.status !== "confirmed") throw new Error(`confirm ${c.name} before teaching it`);
  const text = explanation.trim();
  if (!text) throw new Error("write your explanation first");
  const sessionId = newId("ses");
  await appendLog(home, "sessions", [{ type: "session.started", at: now(), sessionId, conceptId: c.conceptId, explanation: text }]);
  return sessionId;
}

/** Records a catch: something you would have gotten wrong on an exam. Only for a session that has ended. */
export async function recordCatch(home: string, sessionId: string, note: string): Promise<void> {
  const session = (await loadState(home)).sessions.get(sessionId);
  if (!session) throw new Error(`there is no session ${sessionId}`);
  if (session.status !== "ended") throw new Error("record a catch after the session has ended");
  await appendLog(home, "catches", [{ type: "catch.recorded", at: now(), catchId: newId("catch"), sessionId, conceptId: session.conceptId, note: note.trim() }]);
}

/** Records your correction to the material. From then on your version wins. */
export async function addCorrection(
  home: string,
  input: { passageId: string; quote: string; correction: string; note: string; sessionId?: string },
): Promise<void> {
  if (!input.quote.trim() || !input.correction.trim()) throw new Error("a correction needs the wrong text and your version");
  await appendLog(home, "corrections", [
    {
      type: "correction.added",
      at: now(),
      correctionId: newId("cor"),
      passageId: input.passageId,
      quote: input.quote.trim(),
      correction: input.correction.trim(),
      note: input.note.trim(),
      sessionId: input.sessionId,
    },
  ]);
}

/** Records your answer to a "what does this mean?" question about a passage. */
export async function answerClarification(home: string, clarificationId: string, answer: string): Promise<void> {
  const state = await loadState(home);
  if (!state.clarifications.has(clarificationId)) throw new Error(`there is no question ${clarificationId}`);
  if (!answer.trim()) throw new Error("write an answer first");
  await appendLog(home, "corrections", [{ type: "clarification.answered", at: now(), clarificationId, answer: answer.trim() }]);
}
