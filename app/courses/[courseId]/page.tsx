import Link from "next/link";
import { notFound } from "next/navigation";
import {
  answerClarificationAction,
  confirmAllAction,
  confirmConceptAction,
  confirmLinkAction,
  doneReviewingAction,
  dropConceptAction,
  dropLinkAction,
  mergeConceptAction,
  renameConceptAction,
  retryMaterialAction,
  setExamDateAction,
  uploadAction,
} from "../../actions";
import { AutoRefresh } from "../../components/AutoRefresh";
import { Messages } from "../../components/Messages";
import { Quote } from "../../components/Quote";
import { SubmitButton } from "../../components/SubmitButton";
import { UNCLEAR_QUESTION } from "@/lib/concepts";
import { loadPageData, passageLabel } from "@/lib/pageData";
import type { MaterialStatus } from "@/lib/state";
import { reviewPlans } from "@/lib/views";

/** Always rendered fresh from the logs, never cached. */
export const dynamic = "force-dynamic";

const STATUS: Record<MaterialStatus, { label: string; tone: string }> = {
  waiting: { label: "waiting", tone: "" },
  reading: { label: "reading the text", tone: "accent" },
  indexing: { label: "building search", tone: "accent" },
  proposing: { label: "finding concepts", tone: "accent" },
  review: { label: "ready for your review", tone: "accent" },
  linking: { label: "suggesting links", tone: "accent" },
  done: { label: "done", tone: "good" },
  failed: { label: "failed", tone: "warn" },
};

/**
 * One course: its files, the concepts and links to review, questions about the material, and the concept map.
 *
 * While a file is being processed, the page reloads its data every two seconds.
 *
 * @openapi
 * GET /courses/{courseId}:
 *   summary: One course
 *   parameters:
 *     - name: courseId
 *       in: path
 *       required: true
 *       description: The course id, as in `course_` and 16 letters and digits.
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
 *     "404":
 *       description: No course has this id. The "Not found" page.
 *       content:
 *         text/html:
 *           schema: { type: string }
 *     "500":
 *       description: >-
 *         Kizuki could not read your data, for example because a log line is broken. The page
 *         shows "Something went wrong"; the full message, with the file and line, is printed
 *         where Kizuki runs.
 */
export default async function CoursePage({ params, searchParams }: { params: Promise<{ courseId: string }>; searchParams: Promise<{ note?: string }> }) {
  const { courseId } = await params;
  const messages = await searchParams;
  const data = await loadPageData();
  const { state, today } = data;
  const course = state.courses.get(courseId);
  if (!course) notFound();
  const back = `/courses/${courseId}`;

  const materials = [...state.materials.values()].filter((m) => m.courseId === courseId).sort((a, b) => a.addedAt.localeCompare(b.addedAt));
  const concepts = [...state.concepts.values()].filter((c) => c.courseId === courseId);
  const proposed = concepts.filter((c) => c.status === "proposed");
  const confirmed = concepts.filter((c) => c.status === "confirmed").sort((a, b) => a.name.localeCompare(b.name));
  const live = [...proposed, ...confirmed];
  const links = [...state.links.values()].filter((l) => l.courseId === courseId);
  const coursePassages = new Set(materials.map((m) => m.materialId));
  const clarifications = [...state.clarifications.values()].filter((c) => !c.answer && coursePassages.has(data.passages.get(c.passageId)?.materialId ?? ""));
  const plans = reviewPlans(state, today);
  const busy = materials.some((m) => ["waiting", "reading", "indexing", "proposing", "linking"].includes(m.status));
  const name = (id: string) => state.concepts.get(id)?.name ?? "a removed concept";

  return (
    <>
      {busy ? <AutoRefresh everyMs={2000} /> : null}
      <Messages {...messages} />
      <p className="eyebrow">
        <Link href="/courses">courses</Link>
      </p>
      <h1>{course.name}</h1>
      <form action={setExamDateAction.bind(null, courseId)} className="row">
        <span className="muted small">Exam date</span>
        <input type="date" name="examDate" defaultValue={course.examDate ?? ""} />
        <SubmitButton className="secondary" pending="Saving…">
          Save
        </SubmitButton>
        <span className="muted small">Reviews that would fall after the exam move to the day before it.</span>
      </form>

      <h2>Material</h2>
      <form action={uploadAction.bind(null, courseId)} className="card stack">
        <input type="file" name="files" multiple accept=".pdf,.pptx,.docx,.xlsx,.csv,.md,.markdown,.txt" />
        <div className="row">
          <SubmitButton pending="Adding…">Add files</SubmitButton>
          <span className="muted small">PDF (with a text layer), PowerPoint, Word, Excel, CSV, markdown, and text. Your files stay on this computer.</span>
        </div>
      </form>
      {materials.length === 0 ? <p className="empty">No files yet.</p> : null}
      <ul className="plain">
        {materials.map((m) => (
          <li key={m.materialId}>
            <div className="row spread">
              <span>
                <a href={`/files/${m.materialId}`}>{m.fileName}</a> <span className={`badge ${STATUS[m.status].tone}`}>{STATUS[m.status].label}</span>
              </span>
              <span className="row">
                {m.status === "failed" || (["waiting", "reading", "indexing", "proposing", "linking"].includes(m.status) && Date.now() - Date.parse(m.updatedAt) > 10 * 60_000) ? (
                  <form action={retryMaterialAction.bind(null, courseId, m.materialId)}>
                    <SubmitButton className="secondary" pending="Starting…">
                      {m.status === "failed" ? "Try again" : "Stuck? Start again"}
                    </SubmitButton>
                  </form>
                ) : null}
                {m.status === "review" ? (
                  <form action={doneReviewingAction.bind(null, courseId, m.materialId)}>
                    <SubmitButton pending="Sending…">Done reviewing: suggest links</SubmitButton>
                  </form>
                ) : null}
              </span>
            </div>
            <div className="muted small">
              {m.passageCount > 0 ? `${m.passageCount} passages` : null}
              {m.status === "review" || m.status === "linking" || m.status === "done" ? ` · ${m.proposed} concepts proposed` : null}
              {m.dropped > 0 ? ` · ${m.dropped} more dropped by Kizuki's checks (a sentence that does not exist, a name that was a sentence, or a repeat)` : null}
            </div>
            {m.error ? <div className="notice error small">{m.error}</div> : null}
          </li>
        ))}
      </ul>

      {proposed.length > 0 ? (
        <>
          <h2 id="review">Concepts to review</h2>
          <p className="muted small">
            Kizuki proposed these from your files. Each quote was checked word for word against the file. Only concepts you confirm are used for
            teach-back and review.
          </p>
          {materials
            .filter((m) => proposed.some((c) => c.materialId === m.materialId))
            .map((m) => (
              <section key={m.materialId}>
                <div className="row spread">
                  <h3>{m.fileName}</h3>
                  <form action={confirmAllAction.bind(null, m.materialId, back)}>
                    <SubmitButton className="secondary" pending="Confirming…">
                      Confirm all from this file
                    </SubmitButton>
                  </form>
                </div>
                {proposed
                  .filter((c) => c.materialId === m.materialId)
                  .map((c) => (
                    <div key={c.conceptId} className="card">
                      <div className="row spread">
                        <strong>{c.name}</strong>
                        <span className="muted small">{m.sections.find((s) => s.sectionId === c.sectionId)?.title}</span>
                      </div>
                      {c.quotes.map((q) => (
                        <Quote key={`${q.passageId}:${q.text}`} text={q.text} passageId={q.passageId} label={passageLabel(data, q.passageId)} corrections={data.state.corrections} />
                      ))}
                      <div className="row">
                        <form action={confirmConceptAction.bind(null, c.conceptId, back)}>
                          <SubmitButton pending="…">Confirm</SubmitButton>
                        </form>
                        <form action={dropConceptAction.bind(null, c.conceptId, back)}>
                          <SubmitButton className="danger" pending="…">
                            Drop
                          </SubmitButton>
                        </form>
                        <details>
                          <summary className="small">Rename or merge</summary>
                          <form action={renameConceptAction.bind(null, c.conceptId, back)} className="row">
                            <input type="text" name="name" defaultValue={c.name} required style={{ flex: 1 }} />
                            <SubmitButton className="secondary" pending="…">
                              Rename
                            </SubmitButton>
                          </form>
                          {live.length > 1 ? (
                            <form action={mergeConceptAction.bind(null, c.conceptId, back)} className="row">
                              <select name="into" required defaultValue="">
                                <option value="" disabled>
                                  Merge into…
                                </option>
                                {live
                                  .filter((x) => x.conceptId !== c.conceptId)
                                  .map((x) => (
                                    <option key={x.conceptId} value={x.conceptId}>
                                      {x.name}
                                    </option>
                                  ))}
                              </select>
                              <SubmitButton className="secondary" pending="…">
                                Merge
                              </SubmitButton>
                            </form>
                          ) : null}
                        </details>
                      </div>
                    </div>
                  ))}
              </section>
            ))}
        </>
      ) : null}

      {clarifications.length > 0 ? (
        <>
          <h2>Questions about your material</h2>
          <p className="muted small">Kizuki was not sure how to read these passages. Your answer is shown to the model next to the passage from now on.</p>
          {clarifications.map((c) => (
            <div key={c.clarificationId} className="card">
              <Quote text={c.quote} passageId={c.passageId} label={passageLabel(data, c.passageId)} corrections={data.state.corrections} />
              <p>{UNCLEAR_QUESTION}</p>
              <form action={answerClarificationAction.bind(null, c.clarificationId, back)} className="stack">
                <textarea className="short" name="answer" required placeholder="What it means" />
                <SubmitButton className="secondary" pending="Saving…">
                  Save answer
                </SubmitButton>
              </form>
            </div>
          ))}
        </>
      ) : null}

      {links.some((l) => l.status === "proposed") ? (
        <>
          <h2>Suggested order</h2>
          <p className="muted small">Kizuki suggests learning some concepts before others. A concept is only reviewed once the concepts it needs are solid.</p>
          <ul className="plain">
            {links
              .filter((l) => l.status === "proposed")
              .map((l) => (
                <li key={l.linkId} className="row spread">
                  <span>
                    <strong>{name(l.conceptId)}</strong> needs <strong>{name(l.needsConceptId)}</strong> first
                  </span>
                  <span className="row">
                    <form action={confirmLinkAction.bind(null, l.linkId, back)}>
                      <SubmitButton pending="…">Confirm</SubmitButton>
                    </form>
                    <form action={dropLinkAction.bind(null, l.linkId, back)}>
                      <SubmitButton className="danger" pending="…">
                        Drop
                      </SubmitButton>
                    </form>
                  </span>
                </li>
              ))}
          </ul>
        </>
      ) : null}

      <h2>Concepts</h2>
      {confirmed.length === 0 ? (
        <p className="empty">No confirmed concepts yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Concept</th>
              <th>Needs first</th>
              <th>Review</th>
            </tr>
          </thead>
          <tbody>
            {confirmed.map((c) => {
              const plan = plans.get(c.conceptId);
              const needs = links.filter((l) => l.status === "confirmed" && l.conceptId === c.conceptId).map((l) => name(l.needsConceptId));
              return (
                <tr key={c.conceptId}>
                  <td>
                    <Link href={`/concepts/${c.conceptId}`}>{c.name}</Link>
                  </td>
                  <td className="small">{needs.join(", ") || <span className="muted">nothing</span>}</td>
                  <td className="small">
                    {plan?.status === "due" ? <span className="badge accent">due</span> : null}
                    {plan?.status === "upcoming" ? <span className="muted">{plan.due}</span> : null}
                    {plan?.status === "blocked" ? <span className="muted">waiting</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {links.some((l) => l.status === "confirmed") ? (
        <details className="small">
          <summary>Confirmed order</summary>
          <ul className="plain">
            {links
              .filter((l) => l.status === "confirmed")
              .map((l) => (
                <li key={l.linkId} className="row spread">
                  <span>
                    {name(l.conceptId)} needs {name(l.needsConceptId)} first
                  </span>
                  <form action={dropLinkAction.bind(null, l.linkId, back)}>
                    <SubmitButton className="danger" pending="…">
                      Remove
                    </SubmitButton>
                  </form>
                </li>
              ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}
