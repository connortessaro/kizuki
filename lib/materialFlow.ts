import { readFile } from "node:fs/promises";
import { nameKey, proposeConcepts } from "./concepts";
import { extract, toRecords } from "./extract/index";
import { newId } from "./ids";
import { proposeLinks } from "./links";
import { appendLog, readLog } from "./log";
import type { Ask } from "./model";
import { homePaths, storedFilePath } from "./paths";
import { hasPassages, indexPassages, openIndex, type Embedder } from "./search";
import { loadState, resolveConceptId, type MaterialState, type State } from "./state";

const now = () => new Date().toISOString();

function mustMaterial(state: State, materialId: string): MaterialState {
  const m = state.materials.get(materialId);
  if (!m) throw new Error(`there is no material ${materialId}`);
  return m;
}

async function materialPassages(home: string, materialId: string) {
  return (await readLog(home, "passages")).find((e) => e.materialId === materialId)?.passages;
}

/** Records that processing of a material has started, with the workflow run that does it. */
export async function markMaterialStarted(home: string, materialId: string, runId: string): Promise<void> {
  await appendLog(home, "materials", [{ type: "material.started", at: now(), materialId, runId }]);
}

/** Records that processing failed, with the error, so it shows on the course page. */
export async function failMaterial(home: string, materialId: string, error: string): Promise<void> {
  await appendLog(home, "materials", [{ type: "material.failed", at: now(), materialId, error }]);
}

/** Records that you finished reviewing a material's proposed concepts. */
export async function markReviewed(home: string, materialId: string): Promise<void> {
  const m = mustMaterial(await loadState(home), materialId);
  if (m.status === "review") await appendLog(home, "materials", [{ type: "material.reviewed", at: now(), materialId }]);
}

/**
 * Reads the text out of a material's file and saves its sections and passages. Safe to run
 * again: passages are only written once, and ids are the same every time.
 */
export async function readMaterial(home: string, materialId: string): Promise<void> {
  const m = mustMaterial(await loadState(home), materialId);
  const bytes = new Uint8Array(await readFile(storedFilePath(home, m)));
  const { sections, passages } = toRecords(materialId, await extract(m.format, bytes, m.fileName));
  if (!(await materialPassages(home, materialId))) {
    await appendLog(home, "passages", [{ type: "passages.extracted", at: now(), materialId, passages }]);
  }
  if (m.status === "waiting" || m.status === "reading") {
    await appendLog(home, "materials", [{ type: "material.extracted", at: now(), materialId, sections, passageCount: passages.length }]);
  }
}

/** Adds a material's passages to the search file. Safe to run again. */
export async function indexMaterial(home: string, materialId: string, embed: Embedder, embedModel: string): Promise<void> {
  const state = await loadState(home);
  const m = mustMaterial(state, materialId);
  const passages = await materialPassages(home, materialId);
  if (!passages) throw new Error(`${m.fileName} has not been read yet`);
  const db = openIndex(homePaths(home).index);
  try {
    // A retry after a later step failed finds them already there, and skips the meaning model.
    if (!hasPassages(db, passages.map((p) => p.passageId), embedModel)) {
      await indexPassages(
        db,
        passages.map((p) => ({ passageId: p.passageId, materialId, courseId: m.courseId, text: p.text })),
        embed,
        embedModel,
      );
    }
  } finally {
    db.close();
  }
  if (m.status === "indexing") await appendLog(home, "materials", [{ type: "material.indexed", at: now(), materialId, passageCount: passages.length }]);
}

/**
 * Asks the model for concepts in a material and saves those that pass the checks as
 * proposed, plus any "what does this mean?" questions. Safe to run again: if concepts were
 * already saved for this material, it only records that the step is done.
 */
export async function proposeForMaterial(home: string, materialId: string, ask: Ask): Promise<void> {
  const state = await loadState(home);
  const m = mustMaterial(state, materialId);
  if (m.status === "review" || m.status === "linking" || m.status === "done") return;
  const existing = [...state.concepts.values()].filter((c) => c.materialId === materialId);
  if (existing.length > 0) {
    await appendLog(home, "materials", [{ type: "material.conceptsProposed", at: now(), materialId, proposed: existing.length, dropped: 0 }]);
    return;
  }
  const passages = await materialPassages(home, materialId);
  if (!passages) throw new Error(`${m.fileName} has not been read yet`);
  const names = new Set(
    [...state.concepts.values()].filter((c) => c.courseId === m.courseId && (c.status === "proposed" || c.status === "confirmed")).map((c) => nameKey(c.name)),
  );
  const out = await proposeConcepts({ sections: m.sections, passages, existingNames: names, ask });
  // A try that stopped after saving its questions but before the concepts left them in the log already.
  const asked = [...state.clarifications.values()];
  const unclear = out.unclear.filter((u) => !asked.some((c) => c.passageId === u.passageId && c.quote === u.quote));
  await appendLog(
    home,
    "corrections",
    unclear.map((u) => ({ type: "clarification.asked" as const, at: now(), clarificationId: newId("clar"), passageId: u.passageId, quote: u.quote, question: u.question })),
  );
  await appendLog(
    home,
    "concepts",
    out.concepts.map((c) => ({
      type: "concept.proposed" as const,
      at: now(),
      conceptId: newId("con"),
      courseId: m.courseId,
      materialId,
      sectionId: c.sectionId,
      name: c.name,
      quotes: c.quotes,
    })),
  );
  await appendLog(home, "materials", [{ type: "material.conceptsProposed", at: now(), materialId, proposed: out.concepts.length, dropped: out.dropped }]);
}

/**
 * Asks the model for prerequisite links between the course's confirmed concepts and saves
 * those that pass the checks as proposed. Safe to run again.
 */
export async function proposeLinksForMaterial(home: string, materialId: string, ask: Ask): Promise<void> {
  const state = await loadState(home);
  const m = mustMaterial(state, materialId);
  if (m.status === "done") return;
  const concepts = [...state.concepts.values()].filter((c) => c.courseId === m.courseId && c.status === "confirmed");
  const existing = [...state.links.values()]
    .filter((l) => l.courseId === m.courseId)
    .map((l) => ({ conceptId: resolveConceptId(state, l.conceptId), needsConceptId: resolveConceptId(state, l.needsConceptId) }));
  const out = await proposeLinks({ concepts: concepts.map((c) => ({ conceptId: c.conceptId, name: c.name })), existing, ask });
  await appendLog(
    home,
    "links",
    out.links.map((l) => ({ type: "link.proposed" as const, at: now(), linkId: newId("link"), courseId: m.courseId, conceptId: l.conceptId, needsConceptId: l.needsConceptId })),
  );
  await appendLog(home, "materials", [{ type: "material.linksProposed", at: now(), materialId, proposed: out.links.length, dropped: out.dropped }]);
}
