import { addDays, localDate, planReviews, type ReviewPlan } from "./schedule";
import { resolveConceptId, type State } from "./state";

/** The Monday that starts the week containing `date` (`YYYY-MM-DD`). */
export function startOfWeek(date: string): string {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return addDays(date, -((day + 6) % 7));
}

/** How many catches were recorded in the week (Monday to Sunday) containing `today`. */
export function catchesThisWeek(state: State, today: string, timeZone?: string): number {
  const monday = startOfWeek(today);
  return state.catches.filter((c) => {
    const d = localDate(c.at, timeZone);
    return d >= monday && d <= addDays(monday, 6);
  }).length;
}

/** Works out the review plan for every confirmed concept, counting sessions for merged concepts toward their target. */
export function reviewPlans(state: State, today: string, timeZone?: string): Map<string, ReviewPlan> {
  const sessions = [...state.sessions.values()]
    .filter((s) => s.ended)
    .map((s) => ({ conceptId: resolveConceptId(state, s.conceptId), endedAt: s.ended!.at, clean: s.ended!.clean }));
  const links = [...state.links.values()]
    .filter((l) => l.status === "confirmed")
    .map((l) => ({ conceptId: resolveConceptId(state, l.conceptId), needsConceptId: resolveConceptId(state, l.needsConceptId) }));
  return planReviews({
    concepts: [...state.concepts.values()],
    links,
    sessions,
    examDates: new Map([...state.courses.values()].map((c) => [c.courseId, c.examDate])),
    today,
    timeZone,
  });
}

/** One line of the "due" list on the Today page. */
export interface DueItem {
  /** The concept's id. */
  conceptId: string;
  /** The concept's current name. */
  name: string;
  /** The course the concept belongs to. */
  courseId: string;
  /** The course's name, or an empty string if the course is missing. */
  courseName: string;
  /** The day the concept comes back, as `YYYY-MM-DD`. */
  due: string;
  /** Clean sessions in a row since the last miss. */
  streak: number;
}

/** What the Today page shows: concepts due now, coming up, and waiting on prerequisites. */
export interface TodayView {
  /** Concepts due today or earlier, soonest first. */
  due: DueItem[];
  /** Concepts due after today, soonest first. */
  upcoming: DueItem[];
  /** Concepts waiting on prerequisites, with the names of the concepts they wait on in `waitingOn` (an id if the concept is missing). */
  blocked: { conceptId: string; name: string; courseName: string; waitingOn: string[] }[];
}

/** Builds the Today page's lists from the current state. */
export function todayView(state: State, today: string, timeZone?: string): TodayView {
  const plans = reviewPlans(state, today, timeZone);
  const item = (p: ReviewPlan): DueItem => {
    const c = state.concepts.get(p.conceptId)!;
    return { conceptId: c.conceptId, name: c.name, courseId: c.courseId, courseName: state.courses.get(c.courseId)?.name ?? "", due: p.due, streak: p.streak };
  };
  const all = [...plans.values()].sort((a, b) => a.due.localeCompare(b.due) || a.conceptId.localeCompare(b.conceptId));
  return {
    due: all.filter((p) => p.status === "due").map(item),
    upcoming: all.filter((p) => p.status === "upcoming").map(item),
    blocked: all
      .filter((p) => p.status === "blocked")
      .map((p) => {
        const c = state.concepts.get(p.conceptId)!;
        return {
          conceptId: c.conceptId,
          name: c.name,
          courseName: state.courses.get(c.courseId)?.name ?? "",
          waitingOn: p.blockedBy.map((id) => state.concepts.get(id)?.name ?? id),
        };
      }),
  };
}

/**
 * The concepts a concept needs first that are not solid yet: confirmed, but without a clean
 * session. When you miss points on a concept, these are the likely reason ("Y is not solid yet").
 */
export function weakPrerequisites(state: State, conceptId: string): { conceptId: string; name: string }[] {
  const solid = new Set([...state.sessions.values()].filter((s) => s.ended?.clean).map((s) => resolveConceptId(state, s.conceptId)));
  const needs = new Set(
    [...state.links.values()]
      .filter((l) => l.status === "confirmed" && resolveConceptId(state, l.conceptId) === conceptId)
      .map((l) => resolveConceptId(state, l.needsConceptId)),
  );
  return [...needs]
    .map((id) => state.concepts.get(id))
    .filter((c): c is NonNullable<typeof c> => c !== undefined && c.status === "confirmed" && !solid.has(c.conceptId))
    .map((c) => ({ conceptId: c.conceptId, name: c.name }));
}
