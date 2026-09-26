import { describe, expect, it } from "vitest";
import { reduceState, type Logs } from "./state";
import { catchesThisWeek, startOfWeek, todayView, weakPrerequisites } from "./views";

const at = (d: string) => `${d}T12:00:00.000Z`;

function logs(): Logs {
  return {
    courses: [{ type: "course.created", at: at("2026-09-01"), courseId: "c1", name: "Biology" }],
    materials: [],
    concepts: [
      { type: "concept.proposed", at: at("2026-09-01"), conceptId: "a", courseId: "c1", materialId: "m", sectionId: "s", name: "Atoms", quotes: [{ passageId: "p", text: "x" }] },
      { type: "concept.proposed", at: at("2026-09-01"), conceptId: "b", courseId: "c1", materialId: "m", sectionId: "s", name: "Bonds", quotes: [{ passageId: "p", text: "y" }] },
      { type: "concept.confirmed", at: at("2026-09-02"), conceptId: "a" },
      { type: "concept.confirmed", at: at("2026-09-03"), conceptId: "b" },
    ],
    links: [
      { type: "link.proposed", at: at("2026-09-03"), linkId: "l", courseId: "c1", conceptId: "b", needsConceptId: "a" },
      { type: "link.confirmed", at: at("2026-09-03"), linkId: "l" },
    ],
    sessions: [],
    corrections: [],
    catches: [],
  };
}

describe("todayView", () => {
  it("lists due concepts oldest first and shows what blocked ones are waiting on", () => {
    const view = todayView(reduceState(logs()), "2026-09-10", "UTC");
    expect(view.due.map((d) => d.name)).toEqual(["Atoms"]);
    expect(view.blocked).toEqual([{ conceptId: "b", name: "Bonds", courseName: "Biology", waitingOn: ["Atoms"] }]);
  });
});

describe("weeks", () => {
  it("starts weeks on Monday", () => {
    expect(startOfWeek("2026-09-24")).toBe("2026-09-21");
    expect(startOfWeek("2026-09-21")).toBe("2026-09-21");
    expect(startOfWeek("2026-09-20")).toBe("2026-09-14");
  });

  it("counts catches recorded this week", () => {
    const l = logs();
    l.catches.push(
      { type: "catch.recorded", at: at("2026-09-22"), catchId: "k1", sessionId: "s", conceptId: "a", note: "" },
      { type: "catch.recorded", at: at("2026-09-18"), catchId: "k2", sessionId: "s", conceptId: "a", note: "" },
    );
    expect(catchesThisWeek(reduceState(l), "2026-09-24", "UTC")).toBe(1);
  });
});

describe("weakPrerequisites", () => {
  it("names the concepts this one needs that have not had a clean session yet", () => {
    const l = logs();
    expect(weakPrerequisites(reduceState(l), "b").map((c) => c.name)).toEqual(["Atoms"]);
    l.sessions.push(
      { type: "session.started", at: at("2026-09-04"), sessionId: "s1", conceptId: "a", explanation: "x" },
      { type: "session.ended", at: at("2026-09-04"), sessionId: "s1", confirmedMissIds: [], rejectedMissIds: [], clean: true },
    );
    expect(weakPrerequisites(reduceState(l), "b")).toEqual([]);
    expect(weakPrerequisites(reduceState(l), "a")).toEqual([]);
  });
});
