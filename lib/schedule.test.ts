import { describe, expect, it } from "vitest";
import { addDays, localDate, planReviews, type ReviewInput } from "./schedule";

const concept = (conceptId: string, confirmedAt = "2026-09-01T12:00:00.000Z") => ({ conceptId, courseId: "c1", name: conceptId, status: "confirmed" as const, confirmedAt });
const ended = (conceptId: string, day: string, clean: boolean) => ({ conceptId, endedAt: `${day}T12:00:00.000Z`, clean });

function plan(input: Partial<ReviewInput>) {
  return planReviews({ concepts: [], links: [], sessions: [], examDates: new Map(), today: "2026-09-10", timeZone: "UTC", ...input });
}

describe("dates", () => {
  it("adds days across month ends", () => {
    expect(addDays("2026-09-29", 3)).toBe("2026-10-02");
  });

  it("reads the local calendar day of a time", () => {
    expect(localDate("2026-09-10T23:30:00.000Z", "America/New_York")).toBe("2026-09-10");
    expect(localDate("2026-09-11T02:30:00.000Z", "America/New_York")).toBe("2026-09-10");
  });
});

describe("planReviews", () => {
  it("makes a new concept due right away", () => {
    expect(plan({ concepts: [concept("a")] }).get("a")).toMatchObject({ status: "due", due: "2026-09-01", streak: 0 });
  });

  it("doubles the wait after each clean session: 1, 2, 4 days", () => {
    const sessions = [ended("a", "2026-09-01", true), ended("a", "2026-09-02", true), ended("a", "2026-09-04", true)];
    expect(plan({ concepts: [concept("a")], sessions }).get("a")).toMatchObject({ due: "2026-09-08", streak: 3, gapDays: 4 });
  });

  it("brings a concept back tomorrow after a session with misses", () => {
    const sessions = [ended("a", "2026-09-01", true), ended("a", "2026-09-02", true), ended("a", "2026-09-09", false)];
    expect(plan({ concepts: [concept("a")], sessions }).get("a")).toMatchObject({ due: "2026-09-10", streak: 0, status: "due" });
  });

  it("never waits more than 60 days", () => {
    const sessions = Array.from({ length: 10 }, (_, i) => ended("a", addDays("2026-01-01", i * 70), true));
    expect(plan({ concepts: [concept("a")], sessions, today: "2027-09-01" }).get("a")!.gapDays).toBe(60);
  });

  it("marks a concept as upcoming when its day has not come", () => {
    expect(plan({ concepts: [concept("a")], sessions: [ended("a", "2026-09-09", true)], today: "2026-09-09" }).get("a")).toMatchObject({ status: "upcoming", due: "2026-09-10" });
  });

  it("holds a concept back until every concept it needs has had a clean session", () => {
    const concepts = [concept("a"), concept("b")];
    const links = [{ conceptId: "b", needsConceptId: "a" }];
    expect(plan({ concepts, links }).get("b")).toMatchObject({ status: "blocked", blockedBy: ["a"] });
    expect(plan({ concepts, links, sessions: [ended("a", "2026-09-09", true)] }).get("b")!.status).toBe("due");
  });

  it("moves a review that falls after the exam to the day before it", () => {
    const sessions = [ended("a", "2026-09-01", true), ended("a", "2026-09-02", true), ended("a", "2026-09-04", true), ended("a", "2026-09-08", true)];
    const out = plan({ concepts: [concept("a")], sessions, examDates: new Map([["c1", "2026-09-12"]]) });
    expect(out.get("a")).toMatchObject({ due: "2026-09-11", status: "upcoming" });
  });

  it("ignores an exam date that has passed", () => {
    const sessions = [ended("a", "2026-09-08", true)];
    const out = plan({ concepts: [concept("a")], sessions, examDates: new Map([["c1", "2026-09-05"]]) });
    expect(out.get("a")!.due).toBe("2026-09-09");
  });
});
