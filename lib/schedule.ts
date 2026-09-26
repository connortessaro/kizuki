/** The longest wait between reviews, in days. */
export const MAX_GAP_DAYS = 60;

/** Adds whole days to a `YYYY-MM-DD` date. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The calendar day (`YYYY-MM-DD`) of a moment in time, in the given time zone (the computer's by default). */
export function localDate(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** What the schedule needs to know. Sessions must already point at the concept they count for (after merges). */
export interface ReviewInput {
  /** The concepts, with their course, status, and when they were confirmed (ISO time). Only confirmed ones get a plan. */
  concepts: { conceptId: string; courseId: string; status: string; confirmedAt?: string }[];
  /** The prerequisite links to respect: `conceptId` needs `needsConceptId` first. */
  links: { conceptId: string; needsConceptId: string }[];
  /** The ended sessions: the concept each counts for, when it ended (ISO time), and whether it was clean. */
  sessions: { conceptId: string; endedAt: string; clean: boolean }[];
  /** Each course's exam date as `YYYY-MM-DD`, by course id, or `null` when none is set. */
  examDates: Map<string, string | null>;
  /** Today's date as `YYYY-MM-DD`. */
  today: string;
  /** The time zone used to turn times into days. `undefined` means the computer's. */
  timeZone?: string;
}

/**
 * When a concept comes back: `due` (today or earlier), `upcoming`, or `blocked` (it needs
 * concepts that have not had a clean session yet, listed in `blockedBy`).
 */
export interface ReviewPlan {
  /** The concept this plan is for. */
  conceptId: string;
  /** The day the concept comes back, as `YYYY-MM-DD`. When the exam is today or later and this would fall on or after it, it moves to the day before the exam, but never before today. */
  due: string;
  /** `blocked` if `blockedBy` is not empty, otherwise `due` when `due` is today or earlier, and `upcoming` after that. */
  status: "due" | "upcoming" | "blocked";
  /** Clean sessions in a row since the last miss. */
  streak: number;
  /** The wait after the last session, in days: 0 with no session yet, 1 after a miss, and 1, 2, 4, 8 and so on (up to {@link MAX_GAP_DAYS}) for clean sessions in a row. */
  gapDays: number;
  /** The ids of confirmed concepts this one needs that have not had a clean session yet. Empty when nothing blocks it. */
  blockedBy: string[];
  /** When the concept's last session ended, as an ISO time string. `undefined` if it has no ended session. */
  lastSessionAt?: string;
}

/**
 * The review rule, in plain code with no model. A new concept is due right away. A clean
 * session doubles the wait (1, 2, 4, 8 days, up to {@link MAX_GAP_DAYS}); a session with
 * misses brings the concept back the next day. A concept waits until every concept it needs
 * has had a clean session. A review that would fall after the course's exam moves to the
 * day before it.
 */
export function planReviews(input: ReviewInput): Map<string, ReviewPlan> {
  const confirmed = input.concepts.filter((c) => c.status === "confirmed");
  const history = new Map<string, { endedAt: string; clean: boolean }[]>();
  for (const s of [...input.sessions].sort((a, b) => a.endedAt.localeCompare(b.endedAt))) {
    history.set(s.conceptId, [...(history.get(s.conceptId) ?? []), s]);
  }
  const hadClean = (id: string) => (history.get(id) ?? []).some((s) => s.clean);

  const plans = new Map<string, ReviewPlan>();
  for (const c of confirmed) {
    const sessions = history.get(c.conceptId) ?? [];
    let streak = 0;
    for (const s of sessions) streak = s.clean ? streak + 1 : 0;
    const last = sessions[sessions.length - 1];
    const gapDays = last ? (streak === 0 ? 1 : Math.min(2 ** (streak - 1), MAX_GAP_DAYS)) : 0;
    let due = last ? addDays(localDate(last.endedAt, input.timeZone), gapDays) : localDate(c.confirmedAt ?? `${input.today}T12:00:00.000Z`, input.timeZone);

    const exam = input.examDates.get(c.courseId);
    if (exam && exam >= input.today && due > addDays(exam, -1)) {
      const dayBefore = addDays(exam, -1);
      due = dayBefore < input.today ? input.today : dayBefore;
    }

    const blockedBy = input.links
      .filter((l) => l.conceptId === c.conceptId && confirmed.some((x) => x.conceptId === l.needsConceptId))
      .map((l) => l.needsConceptId)
      .filter((id) => !hadClean(id));

    plans.set(c.conceptId, {
      conceptId: c.conceptId,
      due,
      status: blockedBy.length ? "blocked" : due <= input.today ? "due" : "upcoming",
      streak,
      gapDays,
      blockedBy,
      lastSessionAt: last?.endedAt,
    });
  }
  return plans;
}
