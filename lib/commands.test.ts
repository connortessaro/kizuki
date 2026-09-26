import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addCorrection,
  addMaterial,
  answerClarification,
  confirmConcept,
  confirmLink,
  createCourse,
  dropConcept,
  mergeConcept,
  recordCatch,
  renameConcept,
  setExamDate,
  startSession,
} from "./commands";
import { appendLog } from "./log";
import { homePaths } from "./paths";
import { loadState } from "./state";
import { tempHome } from "./test-helpers/home";

let home: string;
let cleanup: () => void;
beforeEach(() => ({ home, cleanup } = tempHome()));
afterEach(() => cleanup());

const now = () => new Date().toISOString();
const enc = (s: string) => new TextEncoder().encode(s);

async function withConcepts(...names: string[]) {
  const courseId = await createCourse(home, "Biology");
  const ids = names.map((_, i) => `con_${i}`);
  await appendLog(
    home,
    "concepts",
    names.map((name, i) => ({ type: "concept.proposed" as const, at: now(), conceptId: ids[i]!, courseId, materialId: "m1", sectionId: "s1", name, quotes: [{ passageId: "p1", text: name }] })),
  );
  return { courseId, ids };
}

describe("courses", () => {
  it("creates a course and refuses a second one with the same name", async () => {
    const id = await createCourse(home, "  Biology ");
    expect((await loadState(home)).courses.get(id)!.name).toBe("Biology");
    await expect(createCourse(home, "biology")).rejects.toThrow(/already have a course/);
  });

  it("sets and clears an exam date", async () => {
    const id = await createCourse(home, "Biology");
    await setExamDate(home, id, "2026-12-01");
    expect((await loadState(home)).courses.get(id)!.examDate).toBe("2026-12-01");
    await setExamDate(home, id, null);
    expect((await loadState(home)).courses.get(id)!.examDate).toBeNull();
    await expect(setExamDate(home, id, "next week")).rejects.toThrow();
  });
});

describe("addMaterial", () => {
  it("keeps a copy of the file and records it", async () => {
    const courseId = await createCourse(home, "Biology");
    const materialId = await addMaterial(home, { courseId, fileName: "notes.md", bytes: enc("# Cells\n\nCells are small.") });
    const m = (await loadState(home)).materials.get(materialId)!;
    expect(m).toMatchObject({ fileName: "notes.md", format: "md", status: "waiting" });
    expect(existsSync(join(homePaths(home).files, m.storedName))).toBe(true);
  });

  it("refuses formats it cannot read yet, with the reason", async () => {
    const courseId = await createCourse(home, "Biology");
    await expect(addMaterial(home, { courseId, fileName: "scan.png", bytes: enc("x") })).rejects.toThrow(/can't read \.png files yet/);
  });

  it("refuses the same file twice in one course", async () => {
    const courseId = await createCourse(home, "Biology");
    await addMaterial(home, { courseId, fileName: "a.md", bytes: enc("same") });
    await expect(addMaterial(home, { courseId, fileName: "b.md", bytes: enc("same") })).rejects.toThrow(/already added as a\.md/);
  });
});

describe("concepts", () => {
  it("confirms, renames, and drops", async () => {
    const { ids } = await withConcepts("Cells", "Tissues");
    await confirmConcept(home, ids[0]!);
    await renameConcept(home, ids[0]!, "Cell structure");
    await dropConcept(home, ids[1]!);
    const state = await loadState(home);
    expect(state.concepts.get(ids[0]!)).toMatchObject({ status: "confirmed", name: "Cell structure" });
    expect(state.concepts.get(ids[1]!)!.status).toBe("dropped");
  });

  it("refuses to rename a concept to a name the course already has", async () => {
    const { ids } = await withConcepts("Cells", "Tissues");
    await expect(renameConcept(home, ids[0]!, "tissues")).rejects.toThrow(/already has a concept/);
  });

  it("merges one concept into another, and refuses merging into itself or a dropped one", async () => {
    const { ids } = await withConcepts("Cells", "Cell", "Organs");
    await mergeConcept(home, ids[1]!, ids[0]!);
    expect((await loadState(home)).concepts.get(ids[1]!)!.status).toBe("merged");
    await expect(mergeConcept(home, ids[0]!, ids[0]!)).rejects.toThrow();
    await dropConcept(home, ids[2]!);
    await expect(mergeConcept(home, ids[0]!, ids[2]!)).rejects.toThrow(/dropped/);
  });
});

describe("links", () => {
  it("refuses to confirm a link that would make a loop", async () => {
    const { courseId, ids } = await withConcepts("A", "B");
    await confirmConcept(home, ids[0]!);
    await confirmConcept(home, ids[1]!);
    await appendLog(home, "links", [
      { type: "link.proposed", at: now(), linkId: "l1", courseId, conceptId: ids[1]!, needsConceptId: ids[0]! },
      { type: "link.proposed", at: now(), linkId: "l2", courseId, conceptId: ids[0]!, needsConceptId: ids[1]! },
    ]);
    await confirmLink(home, "l1");
    await expect(confirmLink(home, "l2")).rejects.toThrow(/loop/);
  });
});

describe("links and merges without loops", () => {
  it("refuses one of two opposite links confirmed at the same moment, such as from two tabs", async () => {
    const { courseId, ids } = await withConcepts("A", "B");
    await confirmConcept(home, ids[0]!);
    await confirmConcept(home, ids[1]!);
    await appendLog(home, "links", [
      { type: "link.proposed", at: now(), linkId: "l1", courseId, conceptId: ids[1]!, needsConceptId: ids[0]! },
      { type: "link.proposed", at: now(), linkId: "l2", courseId, conceptId: ids[0]!, needsConceptId: ids[1]! },
    ]);
    const results = await Promise.allSettled([confirmLink(home, "l1"), confirmLink(home, "l2")]);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect([...(await loadState(home)).links.values()].filter((l) => l.status === "confirmed")).toHaveLength(1);
  });

  it("refuses a merge that would make a concept need itself through its confirmed links", async () => {
    const { courseId, ids } = await withConcepts("A", "B", "C");
    for (const id of ids) await confirmConcept(home, id);
    await appendLog(home, "links", [
      { type: "link.proposed", at: now(), linkId: "l1", courseId, conceptId: ids[0]!, needsConceptId: ids[1]! },
      { type: "link.proposed", at: now(), linkId: "l2", courseId, conceptId: ids[1]!, needsConceptId: ids[2]! },
      { type: "link.confirmed", at: now(), linkId: "l1" },
      { type: "link.confirmed", at: now(), linkId: "l2" },
    ]);
    await expect(mergeConcept(home, ids[1]!, ids[0]!)).rejects.toThrow(/loop/);
    await expect(mergeConcept(home, ids[2]!, ids[0]!)).rejects.toThrow(/loop/);
  });
});

describe("sessions and catches", () => {
  it("only starts a session on a confirmed concept with an explanation", async () => {
    const { ids } = await withConcepts("Cells");
    await expect(startSession(home, ids[0]!, "They are small.")).rejects.toThrow(/confirm/);
    await confirmConcept(home, ids[0]!);
    await expect(startSession(home, ids[0]!, "   ")).rejects.toThrow(/explanation/);
    const sessionId = await startSession(home, ids[0]!, "They are small.");
    expect((await loadState(home)).sessions.get(sessionId)!.status).toBe("thinking");
  });

  it("records a catch only for a session that has ended", async () => {
    const { ids } = await withConcepts("Cells");
    await confirmConcept(home, ids[0]!);
    const sessionId = await startSession(home, ids[0]!, "They are small.");
    await expect(recordCatch(home, sessionId, "I mixed up cells and tissues")).rejects.toThrow(/ended/);
    await appendLog(home, "sessions", [{ type: "session.ended", at: now(), sessionId, confirmedMissIds: [], rejectedMissIds: [], clean: false }]);
    await recordCatch(home, sessionId, "I mixed up cells and tissues");
    expect((await loadState(home)).catches).toHaveLength(1);
  });
});

describe("corrections", () => {
  it("records a correction and answers a clarification", async () => {
    await addCorrection(home, { passageId: "p1", quote: "chloroplast", correction: "chloroplasts", note: "Slide typo" });
    await appendLog(home, "corrections", [{ type: "clarification.asked", at: now(), clarificationId: "cl1", passageId: "p1", quote: "it", question: "Does it mean X?" }]);
    await answerClarification(home, "cl1", "It means photosynthesis.");
    const state = await loadState(home);
    expect(state.corrections[0]).toMatchObject({ quote: "chloroplast", correction: "chloroplasts" });
    expect(state.clarifications.get("cl1")!.answer).toBe("It means photosynthesis.");
    await expect(answerClarification(home, "missing", "x")).rejects.toThrow();
  });
});
