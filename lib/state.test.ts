import { describe, expect, it } from "vitest";
import { reduceState, resolveConceptId, type Logs } from "./state";

const at = (m: number) => new Date(Date.UTC(2026, 8, 24, 10, m)).toISOString();
const empty = (): Logs => ({ courses: [], materials: [], concepts: [], links: [], sessions: [], corrections: [], catches: [] });

describe("reduceState", () => {
  it("tracks a material's progress from upload to review", () => {
    const logs = empty();
    logs.materials.push(
      { type: "material.added", at: at(0), materialId: "m1", courseId: "c1", fileName: "a.pdf", storedName: "m1.pdf", format: "pdf", bytes: 10, sha256: "0".repeat(64) },
      { type: "material.started", at: at(1), materialId: "m1", runId: "run1" },
    );
    expect(reduceState(logs).materials.get("m1")!.status).toBe("reading");
    logs.materials.push({ type: "material.extracted", at: at(2), materialId: "m1", sections: [], passageCount: 3 });
    logs.materials.push({ type: "material.indexed", at: at(3), materialId: "m1", passageCount: 3 });
    logs.materials.push({ type: "material.conceptsProposed", at: at(4), materialId: "m1", proposed: 2, dropped: 1 });
    const m = reduceState(logs).materials.get("m1")!;
    expect(m.status).toBe("review");
    expect([m.passageCount, m.proposed, m.dropped]).toEqual([3, 2, 1]);
  });

  it("marks a material failed with the error", () => {
    const logs = empty();
    logs.materials.push(
      { type: "material.added", at: at(0), materialId: "m1", courseId: "c1", fileName: "a.pdf", storedName: "m1.pdf", format: "pdf", bytes: 10, sha256: "0".repeat(64) },
      { type: "material.failed", at: at(1), materialId: "m1", error: "no readable text" },
    );
    expect(reduceState(logs).materials.get("m1")).toMatchObject({ status: "failed", error: "no readable text" });
  });

  it("merging a concept moves its quotes to the target and follows merges for links", () => {
    const logs = empty();
    logs.concepts.push(
      { type: "concept.proposed", at: at(0), conceptId: "a", courseId: "c1", materialId: "m1", sectionId: "s1", name: "Light reactions", quotes: [{ passageId: "p1", text: "light" }] },
      { type: "concept.proposed", at: at(0), conceptId: "b", courseId: "c1", materialId: "m1", sectionId: "s1", name: "Light-dependent reactions", quotes: [{ passageId: "p2", text: "dependent" }] },
      { type: "concept.confirmed", at: at(1), conceptId: "a" },
      { type: "concept.merged", at: at(2), conceptId: "b", intoConceptId: "a" },
    );
    const state = reduceState(logs);
    expect(state.concepts.get("a")!.quotes.map((q) => q.passageId)).toEqual(["p1", "p2"]);
    expect(state.concepts.get("b")!.status).toBe("merged");
    expect(resolveConceptId(state, "b")).toBe("a");
  });

  it("uses the latest name after a rename", () => {
    const logs = empty();
    logs.concepts.push(
      { type: "concept.proposed", at: at(0), conceptId: "a", courseId: "c1", materialId: "m1", sectionId: "s1", name: "Old", quotes: [{ passageId: "p1", text: "x" }] },
      { type: "concept.renamed", at: at(1), conceptId: "a", name: "New" },
    );
    expect(reduceState(logs).concepts.get("a")!.name).toBe("New");
  });

  it("follows a teach-back session through its states", () => {
    const logs = empty();
    const s = (): string => reduceState(logs).sessions.get("s1")!.status;
    logs.sessions.push({ type: "session.started", at: at(0), sessionId: "s1", conceptId: "a", explanation: "It makes sugar." });
    expect(s()).toBe("thinking");
    logs.sessions.push({ type: "session.questions", at: at(1), sessionId: "s1", round: 1, questions: [{ questionId: "q1", kind: "gap", text: "Where does light fit?", quote: { passageId: "p1", text: "light" } }], dropped: 0, notInMaterial: false });
    expect(s()).toBe("answering");
    logs.sessions.push({ type: "session.answered", at: at(2), sessionId: "s1", round: 1, answers: [{ questionId: "q1", text: "It powers it." }], finish: true });
    expect(s()).toBe("thinking");
    logs.sessions.push({ type: "session.missesProposed", at: at(3), sessionId: "s1", misses: [], dropped: 0 });
    expect(s()).toBe("reviewing");
    logs.sessions.push({ type: "session.ended", at: at(4), sessionId: "s1", confirmedMissIds: [], rejectedMissIds: [], clean: true });
    expect(s()).toBe("ended");
  });

  it("keeps the latest exam date for a course", () => {
    const logs = empty();
    logs.courses.push(
      { type: "course.created", at: at(0), courseId: "c1", name: "Biology" },
      { type: "course.examDateSet", at: at(1), courseId: "c1", examDate: "2026-10-01" },
      { type: "course.examDateSet", at: at(2), courseId: "c1", examDate: null },
    );
    expect(reduceState(logs).courses.get("c1")).toMatchObject({ name: "Biology", examDate: null });
  });
});

describe("event order", () => {
  it("does not move a material back to reading when the start is recorded after work began", () => {
    const logs: Logs = { courses: [], materials: [], concepts: [], links: [], sessions: [], corrections: [], catches: [] };
    logs.materials.push(
      { type: "material.added", at: at(0), materialId: "m1", courseId: "c1", fileName: "a.md", storedName: "m1.md", format: "md", bytes: 1, sha256: "0".repeat(64) },
      { type: "material.extracted", at: at(1), materialId: "m1", sections: [], passageCount: 1 },
      { type: "material.started", at: at(2), materialId: "m1", runId: "run1" },
    );
    expect(reduceState(logs).materials.get("m1")).toMatchObject({ status: "indexing", runId: "run1" });
  });
});
