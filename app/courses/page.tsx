import Link from "next/link";
import { createCourseAction } from "../actions";
import { Messages } from "../components/Messages";
import { SubmitButton } from "../components/SubmitButton";
import { loadPageData } from "@/lib/pageData";

/** Always rendered fresh from the logs, never cached. */
export const dynamic = "force-dynamic";

/**
 * The list of your courses, with a form to add one.
 *
 * @openapi
 * GET /courses:
 *   summary: Courses
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
export default async function CoursesPage({ searchParams }: { searchParams: Promise<{ note?: string }> }) {
  const params = await searchParams;
  const { state } = await loadPageData();
  const courses = [...state.courses.values()].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <Messages {...params} />
      <h1>Courses</h1>
      {courses.length === 0 ? <p className="empty">No courses yet.</p> : null}
      <ul className="plain">
        {courses.map((c) => {
          const concepts = [...state.concepts.values()].filter((x) => x.courseId === c.courseId && x.status === "confirmed").length;
          const files = [...state.materials.values()].filter((m) => m.courseId === c.courseId && m.status !== "failed").length;
          return (
            <li key={c.courseId} className="row spread">
              <Link href={`/courses/${c.courseId}`}>
                <strong>{c.name}</strong>
              </Link>
              <span className="muted small">
                {files} {files === 1 ? "file" : "files"} · {concepts} {concepts === 1 ? "concept" : "concepts"}
                {c.examDate ? ` · exam ${c.examDate}` : ""}
              </span>
            </li>
          );
        })}
      </ul>
      <h2>New course</h2>
      <form action={createCourseAction} className="row">
        <input type="text" name="name" placeholder="Course name" required style={{ flex: 1 }} />
        <SubmitButton pending="Creating…">Create course</SubmitButton>
      </form>
    </>
  );
}
