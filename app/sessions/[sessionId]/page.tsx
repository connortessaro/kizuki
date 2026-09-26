import Link from "next/link";
import { notFound } from "next/navigation";
import { answerRoundAction, finishReviewAction, recordCatchAction, restartSessionAction } from "../../actions";
import { AutoRefresh } from "../../components/AutoRefresh";
import { Messages } from "../../components/Messages";
import { Quote } from "../../components/Quote";
import { SubmitButton } from "../../components/SubmitButton";
import { MAX_ROUNDS } from "@/lib/limits";
import { loadPageData, passageLabel } from "@/lib/pageData";
import { resolveConceptId } from "@/lib/state";
import { reviewPlans, weakPrerequisites } from "@/lib/views";

/** Always rendered fresh from the logs, never cached. */
export const dynamic = "force-dynamic";

const KIND = { contradiction: "Does this fit?", gap: "Something you left out", unclear: "Say more" } as const;

/**
 * One teach-back session: your explanation, each round of questions, what you may have missed, and the result.
 *
 * While Kizuki is choosing questions, the page reloads its data every 1.5 seconds.
 *
 * @openapi
 * GET /sessions/{sessionId}:
 *   summary: One teach-back session
 *   parameters:
 *     - name: sessionId
 *       in: path
 *       required: true
 *       description: The session id, as in `ses_` and 16 letters and digits.
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
 *       description: No session has this id. The "Not found" page.
 *       content:
 *         text/html:
 *           schema: { type: string }
 *     "500":
 *       description: >-
 *         Kizuki could not read your data, for example because a log line is broken. The page
 *         shows "Something went wrong"; the full message, with the file and line, is printed
 *         where Kizuki runs.
 */
export default async function SessionPage({ params, searchParams }: { params: Promise<{ sessionId: string }>; searchParams: Promise<{ note?: string }> }) {
  const { sessionId } = await params;
  const messages = await searchParams;
  const data = await loadPageData();
  const { state } = data;
  const session = state.sessions.get(sessionId);
  if (!session) notFound();
  const conceptId = resolveConceptId(state, session.conceptId);
  const concept = state.concepts.get(conceptId);
  const current = session.rounds[session.rounds.length - 1];
  const plan = reviewPlans(state, data.today).get(conceptId);
  const caught = state.catches.some((c) => c.sessionId === sessionId);
  const wrong = session.rounds.flatMap((r) => r.questions.filter((q) => q.quote && r.answers?.some((a) => a.questionId === q.questionId && a.verdict === "material-right")));
  const missed = (session.misses ?? []).filter((m) => session.ended?.confirmedMissIds.includes(m.missId));
  const weak = session.ended && !session.ended.clean ? weakPrerequisites(state, conceptId) : [];

  return (
    <>
      {session.status === "thinking" ? <AutoRefresh /> : null}
      <Messages {...messages} />
      <p className="eyebrow">
        <Link href={`/concepts/${conceptId}`}>{concept?.name ?? "concept"}</Link> · teach-back
      </p>
      <h1>Teaching {concept?.name}</h1>

      <h2>What you said</h2>
      <div className="passage">{session.explanation}</div>

      {session.rounds.map((round) => (
        <section key={round.round}>
          <h2>
            Round {round.round}
            {round.questions.length === 0 ? "" : ` · ${round.questions.length} ${round.questions.length === 1 ? "question" : "questions"}`}
          </h2>
          {round.notInMaterial ? (
            <div className="notice">Not in your material. Nothing in your material matches what you wrote, so Kizuki has nothing to ask about it. Check the passages for this concept, or explain it again.</div>
          ) : round.questions.length === 0 ? (
            <p className="muted">Kizuki has no questions it can back with your material.</p>
          ) : null}
          {round.dropped > 0 ? (
            <p className="muted small">
              {round.dropped} {round.dropped === 1 ? "question was" : "questions were"} dropped because {round.dropped === 1 ? "its quote was" : "their quotes were"} not in your
              material.
            </p>
          ) : null}
          {round.answers ? (
            round.questions.map((q) => {
              const a = round.answers!.find((x) => x.questionId === q.questionId);
              return (
                <div key={q.questionId} className={`question ${q.kind}`}>
                  <div className="eyebrow">{KIND[q.kind]}</div>
                  <p>{q.text}</p>
                  {q.quote ? <Link className="small" href={`/sources/${q.quote.passageId}`}>See the passage →</Link> : null}
                  <p className="small">
                    <strong>You:</strong> {a?.text || <span className="muted">no answer</span>}
                    {a?.verdict === "material-right" ? <span className="badge warn"> the material is right</span> : null}
                    {a?.verdict === "material-wrong" ? <span className="badge accent"> corrected: {a.correction}</span> : null}
                    {a?.verdict === "misread" ? <span className="badge"> Kizuki misread you</span> : null}
                  </p>
                </div>
              );
            })
          ) : session.status === "answering" && round === current ? (
            <form action={answerRoundAction.bind(null, sessionId, round.round)} className="stack">
              {round.questions.map((q) => (
                <div key={q.questionId} className={`question ${q.kind}`}>
                  <div className="eyebrow">{KIND[q.kind]}</div>
                  <p>{q.text}</p>
                  {q.quote ? <Link className="small" href={`/sources/${q.quote.passageId}`} target="_blank">See the passage →</Link> : null}
                  {q.kind === "contradiction" ? (
                    <div>
                      <label className="check">
                        <input type="radio" name={`verdict:${q.questionId}`} value="material-right" required /> The material is right. I got this wrong.
                      </label>
                      <label className="check">
                        <input type="radio" name={`verdict:${q.questionId}`} value="material-wrong" /> The material is wrong (a typo, or it was corrected in class).
                      </label>
                      <label className="check">
                        <input type="radio" name={`verdict:${q.questionId}`} value="misread" /> Neither: Kizuki misread what I wrote. They don't disagree.
                      </label>
                      <input type="text" name={`correction:${q.questionId}`} placeholder="If the material is wrong: the correct version" />
                    </div>
                  ) : null}
                  <textarea className="short" name={`answer:${q.questionId}`} placeholder="Your answer" />
                </div>
              ))}
              <div className="row">
                {round.round < MAX_ROUNDS ? (
                  <SubmitButton name="finish" value="no" pending="Sending…">
                    Send answers
                  </SubmitButton>
                ) : null}
                <SubmitButton className={round.round < MAX_ROUNDS ? "secondary" : ""} name="finish" value="yes" pending="Sending…">
                  Send and finish
                </SubmitButton>
              </div>
            </form>
          ) : null}
        </section>
      ))}

      {session.status === "thinking" ? <p className="muted">Kizuki is reading your material and what you wrote…</p> : null}
      {session.status === "thinking" && Date.now() - Date.parse(session.updatedAt) > 120_000 ? (
        <form action={restartSessionAction.bind(null, sessionId)} className="notice">
          This is taking longer than usual. If Kizuki was restarted, its work on this session may have stopped.{" "}
          <SubmitButton className="secondary" pending="Restarting…">
            Restart it
          </SubmitButton>
        </form>
      ) : null}

      {session.status === "reviewing" ? (
        <>
          <h2>What you may have missed</h2>
          <p className="muted small">These points are in your material. Tick the ones you really missed. Leave the ones you covered unticked.</p>
          <form action={finishReviewAction.bind(null, sessionId)} className="stack">
            {session.misses!.length === 0 ? <p className="muted">Kizuki found nothing important missing.</p> : null}
            {session.misses!.map((m) => (
              <label key={m.missId} className="check card">
                <input type="checkbox" name="missed" value={m.missId} />
                <span style={{ flex: 1 }}>
                  <Quote text={m.quote.text} passageId={m.quote.passageId} label={passageLabel(data, m.quote.passageId)} corrections={data.state.corrections} />
                </span>
              </label>
            ))}
            <SubmitButton pending="Finishing…">Finish session</SubmitButton>
          </form>
        </>
      ) : null}

      {session.status === "ended" ? (
        <>
          <h2>Result</h2>
          {session.ended!.clean ? (
            <div className="notice good">Clean session. {plan ? `Next review ${plan.due}.` : ""}</div>
          ) : (
            <div className="notice">
              {[
                wrong.length ? `You got ${wrong.length} ${wrong.length === 1 ? "point" : "points"} wrong` : "",
                missed.length ? `you missed ${missed.length} ${missed.length === 1 ? "point" : "points"}` : "",
              ]
                .filter(Boolean)
                .join(" and ")
                .replace(/^y/, "Y")}
              . {concept?.name} comes back {plan ? `on ${plan.due}` : "tomorrow"}.
            </div>
          )}
          {weak.length ? (
            <p>
              {weak.length === 1 ? "A concept it needs is" : "Concepts it needs are"} not solid yet (no clean session):{" "}
              {weak.map((c, i) => (
                <span key={c.conceptId}>
                  {i > 0 ? ", " : ""}
                  <Link href={`/concepts/${c.conceptId}`}>{c.name}</Link>
                </span>
              ))}
              . Teach {weak.length === 1 ? "it" : "them"} first.
            </p>
          ) : null}
          {wrong.length ? <h3>What you got wrong</h3> : null}
          {wrong.map((q) => (
            <Quote key={q.questionId} text={q.quote!.text} passageId={q.quote!.passageId} label={passageLabel(data, q.quote!.passageId)} corrections={data.state.corrections} />
          ))}
          {missed.length ? <h3>What you missed</h3> : null}
          {missed.map((m) => (
            <Quote key={m.missId} text={m.quote.text} passageId={m.quote.passageId} label={passageLabel(data, m.quote.passageId)} corrections={data.state.corrections} />
          ))}
          <h2>Catch</h2>
          {caught ? (
            <p className="muted">Recorded as a catch.</p>
          ) : (
            <form action={recordCatchAction.bind(null, sessionId)} className="card stack">
              <p className="small">Did this session catch something you would have gotten wrong on an exam? Record it. Kizuki counts catches each week.</p>
              <input type="text" name="note" placeholder="What you would have gotten wrong" />
              <SubmitButton className="secondary" pending="Saving…">
                Record a catch
              </SubmitButton>
            </form>
          )}
        </>
      ) : null}

      {session.status === "failed" ? (
        <div className="notice error">
          This session stopped: {session.error}. <Link href={`/concepts/${conceptId}`}>Start a new one</Link>
        </div>
      ) : null}
    </>
  );
}
