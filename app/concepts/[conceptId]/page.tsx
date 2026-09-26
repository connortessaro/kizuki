import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { abandonSessionAction, dropConceptAction, mergeConceptAction, renameConceptAction, startSessionAction } from "../../actions";
import { Messages } from "../../components/Messages";
import { Quote } from "../../components/Quote";
import { SubmitButton } from "../../components/SubmitButton";
import { loadPageData, passageLabel } from "@/lib/pageData";
import { resolveConceptId } from "@/lib/state";
import { reviewPlans } from "@/lib/views";

/** Always rendered fresh from the logs, never cached. */
export const dynamic = "force-dynamic";

/**
 * One concept: its review date, the teach-back form, its quotes, and its past sessions.
 *
 * @openapi
 * GET /concepts/{conceptId}:
 *   summary: One concept
 *   parameters:
 *     - name: conceptId
 *       in: path
 *       required: true
 *       description: The concept id, as in `con_` and 16 letters and digits.
 *       schema: { type: string }
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
 *     "307":
 *       description: The concept was merged into another. The browser goes to the concept it was merged into.
 *       headers:
 *         location:
 *           description: The address of the concept this one was merged into, as in `/concepts/con_…`.
 *           schema: { type: string }
 *     "404":
 *       description: No concept has this id. The "Not found" page.
 *       content:
 *         text/html:
 *           schema: { type: string }
 *     "500":
 *       description: >-
 *         Kizuki could not read your data, for example because a log line is broken. The page
 *         shows "Something went wrong"; the full message, with the file and line, is printed
 *         where Kizuki runs.
 */
export default async function ConceptPage({ params, searchParams }: { params: Promise<{ conceptId: string }>; searchParams: Promise<{ note?: string }> }) {
  const { conceptId } = await params;
  const messages = await searchParams;
  const data = await loadPageData();
  const { state, today } = data;
  const resolved = resolveConceptId(state, conceptId);
  if (resolved !== conceptId) redirect(`/concepts/${resolved}`);
  const concept = state.concepts.get(conceptId);
  if (!concept) notFound();
  const course = state.courses.get(concept.courseId);
  const plan = reviewPlans(state, today).get(conceptId);
  const links = [...state.links.values()].filter((l) => l.status === "confirmed");
  const needs = links.filter((l) => resolveConceptId(state, l.conceptId) === conceptId).map((l) => state.concepts.get(resolveConceptId(state, l.needsConceptId))!);
  const neededBy = links.filter((l) => resolveConceptId(state, l.needsConceptId) === conceptId).map((l) => state.concepts.get(resolveConceptId(state, l.conceptId))!);
  const sessions = [...state.sessions.values()]
    .filter((s) => resolveConceptId(state, s.conceptId) === conceptId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const running = sessions.find((s) => s.status !== "ended" && s.status !== "failed");
  const others = [...state.concepts.values()].filter(
    (c) => c.courseId === concept.courseId && c.conceptId !== conceptId && (c.status === "confirmed" || c.status === "proposed"),
  );
  const here = `/concepts/${conceptId}`;

  return (
    <>
      <Messages {...messages} />
      <p className="eyebrow">
        <Link href={`/courses/${concept.courseId}`}>{course?.name ?? "course"}</Link>
      </p>
      <h1>{concept.name}</h1>
      <p className="muted small">
        {concept.status === "confirmed" ? null : `This concept is ${concept.status}. `}
        {plan?.status === "due" ? "Due now." : null}
        {plan?.status === "upcoming" ? `Next review ${plan.due}.` : null}
        {plan?.status === "blocked" ? `Waiting on ${plan.blockedBy.map((id) => state.concepts.get(id)?.name).join(", ")}.` : null}
        {plan && plan.streak > 0 ? ` ${plan.streak} clean ${plan.streak === 1 ? "session" : "sessions"} in a row.` : null}
      </p>

      {concept.status === "confirmed" ? (
        running ? (
          <div className="notice row">
            <span>
              A session on this concept is still open. <Link href={`/sessions/${running.sessionId}`}>Continue it</Link>
            </span>
            <form action={abandonSessionAction.bind(null, running.sessionId, conceptId)}>
              <SubmitButton className="secondary" pending="Stopping…">
                Stop it and start over
              </SubmitButton>
            </form>
          </div>
        ) : (
          <form action={startSessionAction.bind(null, conceptId)} className="card stack">
            <label htmlFor="explanation">
              <strong>Teach it.</strong> Explain {concept.name} in your own words, as if to a classmate. Don't look at your notes.
            </label>
            <textarea id="explanation" name="explanation" required />
            <SubmitButton pending="Starting…">Start teach-back</SubmitButton>
          </form>
        )
      ) : null}

      <h2>From your material</h2>
      {concept.quotes.map((q) => (
        <Quote key={`${q.passageId}:${q.text}`} text={q.text} passageId={q.passageId} label={passageLabel(data, q.passageId)} corrections={data.state.corrections} />
      ))}

      {needs.length > 0 || neededBy.length > 0 ? (
        <>
          <h2>Order</h2>
          {needs.length > 0 ? (
            <p>
              Needs first: {needs.map((c, i) => (
                <span key={c.conceptId}>
                  {i > 0 ? ", " : ""}
                  <Link href={`/concepts/${c.conceptId}`}>{c.name}</Link>
                </span>
              ))}
            </p>
          ) : null}
          {neededBy.length > 0 ? (
            <p>
              Needed by: {neededBy.map((c, i) => (
                <span key={c.conceptId}>
                  {i > 0 ? ", " : ""}
                  <Link href={`/concepts/${c.conceptId}`}>{c.name}</Link>
                </span>
              ))}
            </p>
          ) : null}
        </>
      ) : null}

      {concept.status === "confirmed" ? (
        <details className="card">
          <summary>Change this concept</summary>
          <form action={renameConceptAction.bind(null, conceptId, here)} className="row">
            <input type="text" name="name" defaultValue={concept.name} required style={{ flex: 1 }} aria-label="New name" />
            <SubmitButton className="secondary" pending="…">
              Rename
            </SubmitButton>
          </form>
          {others.length > 0 ? (
            <form action={mergeConceptAction.bind(null, conceptId, here)} className="row">
              <select name="into" required defaultValue="" aria-label="Merge into">
                <option value="" disabled>
                  Merge into…
                </option>
                {others.map((c) => (
                  <option key={c.conceptId} value={c.conceptId}>
                    {c.name}
                  </option>
                ))}
              </select>
              <SubmitButton className="secondary" pending="…">
                Merge
              </SubmitButton>
            </form>
          ) : null}
          <form action={dropConceptAction.bind(null, conceptId, `/courses/${concept.courseId}`)}>
            <SubmitButton className="danger" pending="…">
              Drop it
            </SubmitButton>
            <span className="muted small"> It stays in the logs, but is no longer taught or reviewed.</span>
          </form>
        </details>
      ) : null}

      <h2>Sessions</h2>
      {sessions.length === 0 ? (
        <p className="empty">No sessions yet.</p>
      ) : (
        <ul className="plain">
          {sessions.map((s) => (
            <li key={s.sessionId} className="row spread">
              <Link href={`/sessions/${s.sessionId}`}>{new Date(s.startedAt).toLocaleString()}</Link>
              <span className="small">
                {s.status === "ended" ? (
                  s.ended!.clean ? (
                    <span className="badge good">clean</span>
                  ) : (
                    <span className="badge warn">missed {s.ended!.confirmedMissIds.length || "points"}</span>
                  )
                ) : (
                  <span className="badge">{s.status}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
