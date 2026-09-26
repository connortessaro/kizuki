import Link from "next/link";
import { createCourseAction } from "./actions";
import { Messages } from "./components/Messages";
import { SubmitButton } from "./components/SubmitButton";
import { checkModels } from "@/lib/model";
import { loadPageData } from "@/lib/pageData";
import { readSettings } from "@/lib/settings";
import { catchesThisWeek, todayView } from "@/lib/views";

/** Always rendered fresh from the logs, never cached. */
export const dynamic = "force-dynamic";

/**
 * The Today page: concepts due now, coming up, and waiting on others, and this week's catches.
 *
 * Also checks that both models answer, and lists the problems if not.
 *
 * @openapi
 * GET /:
 *   summary: Today
 *   parameters:
 *     - name: note
 *       in: query
 *       required: false
 *       description: >-
 *         The id of a message a form action left for this page, such as "Settings saved." or an
 *         error. Only ids this running Kizuki made show anything; any other value is ignored.
 *       schema: { type: string }
 *   responses:
 *     "200":
 *       description: The page.
 *       content:
 *         text/html:
 *           schema: { type: string }
 *     "500":
 *       description: >-
 *         Kizuki could not read your data, for example because a log line is broken. The page
 *         shows "Something went wrong"; the full message, with the file and line, is printed
 *         where Kizuki runs.
 */
export default async function TodayPage({ searchParams }: { searchParams: Promise<{ note?: string }> }) {
  const params = await searchParams;
  const data = await loadPageData();
  const { state, today } = data;
  const check = await checkModels(await readSettings(data.home));
  const view = todayView(state, today);
  const catches = catchesThisWeek(state, today);
  const toReview = [...state.materials.values()].filter((m) => m.status === "review");
  const working = [...state.materials.values()].filter((m) => ["waiting", "reading", "indexing", "proposing", "linking"].includes(m.status));
  const openQuestions = [...state.clarifications.values()].filter((c) => !c.answer).length;

  return (
    <>
      <Messages {...params} />
      {!check.ok ? (
        <div className="notice error">
          <strong>Kizuki can't reach its models.</strong>
          <ul>
            {check.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <Link href="/settings">Open settings</Link>
        </div>
      ) : null}

      <h1>Today</h1>
      {state.courses.size === 0 ? (
        <div className="card stack">
          <p>
            Kizuki is a study tool. You add your course material, then teach a concept in your own words. Kizuki plays the student: it asks about
            what you got wrong, what you left out, and what you said unclearly, always quoting your material.
          </p>
          <p>Start with a course.</p>
          <form action={createCourseAction} className="row">
            <input type="text" name="name" placeholder="Course name, like Biology 101" required style={{ flex: 1 }} />
            <SubmitButton pending="Creating…">Create course</SubmitButton>
          </form>
        </div>
      ) : (
        <>
          <p className="muted">
            {catches === 0
              ? "No catches yet this week. A catch is something you would have gotten wrong on an exam."
              : `${catches} ${catches === 1 ? "catch" : "catches"} this week: things you would have gotten wrong on an exam.`}
          </p>

          {toReview.length > 0 || openQuestions > 0 ? (
            <div className="notice">
              {toReview.map((m) => (
                <div key={m.materialId}>
                  Concepts from <Link href={`/courses/${m.courseId}#review`}>{m.fileName}</Link> are ready for you to review.
                </div>
              ))}
              {openQuestions > 0 ? (
                <div>
                  Kizuki has {openQuestions} {openQuestions === 1 ? "question" : "questions"} about how to read your material.
                </div>
              ) : null}
            </div>
          ) : null}
          {working.length > 0 ? <p className="muted small">Reading {working.map((m) => m.fileName).join(", ")}…</p> : null}

          <h2>Due now</h2>
          {view.due.length === 0 ? (
            <p className="empty">Nothing is due. {view.upcoming[0] ? `Next up: ${view.upcoming[0].name} on ${view.upcoming[0].due}.` : ""}</p>
          ) : (
            <ul className="plain">
              {view.due.map((d) => (
                <li key={d.conceptId} className="row spread">
                  <span>
                    <strong>{d.name}</strong> <span className="muted small">· {d.courseName}</span>
                  </span>
                  <Link className="button" href={`/concepts/${d.conceptId}`}>
                    Teach it
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {view.upcoming.length > 0 ? (
            <>
              <h2>Coming up</h2>
              <ul className="plain">
                {view.upcoming.slice(0, 8).map((d) => (
                  <li key={d.conceptId} className="row spread">
                    <Link href={`/concepts/${d.conceptId}`}>{d.name}</Link>
                    <span className="muted small">
                      {d.courseName} · {d.due}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {view.blocked.length > 0 ? (
            <>
              <h2>Waiting on other concepts</h2>
              <ul className="plain">
                {view.blocked.map((b) => (
                  <li key={b.conceptId}>
                    <Link href={`/concepts/${b.conceptId}`}>{b.name}</Link>{" "}
                    <span className="muted small">needs a clean session on {b.waitingOn.join(", ")} first</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
    </>
  );
}
