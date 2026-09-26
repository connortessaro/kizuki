import Link from "next/link";
import { loadPageData } from "@/lib/pageData";
import { addDays, localDate } from "@/lib/schedule";
import { resolveConceptId } from "@/lib/state";
import { startOfWeek } from "@/lib/views";

/** Always rendered fresh from the logs, never cached. */
export const dynamic = "force-dynamic";

/**
 * Your weeks of study (sessions and catches each week, against the goal of one catch a week) and every catch, newest first.
 *
 * The weeks table covers the current week and the seven before it.
 *
 * @openapi
 * GET /history:
 *   summary: History
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
export default async function HistoryPage() {
  const { state, today } = await loadPageData();
  const sessions = [...state.sessions.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const weeks = Array.from({ length: 8 }, (_, i) => addDays(startOfWeek(today), -7 * i));
  const inWeek = (iso: string, monday: string) => {
    const d = localDate(iso);
    return d >= monday && d <= addDays(monday, 6);
  };

  return (
    <>
      <h1>History</h1>
      <h2>Weeks</h2>
      <p className="muted small">The goal is at least one catch a week: something Kizuki caught that you would have gotten wrong on an exam.</p>
      <table>
        <thead>
          <tr>
            <th>Week of</th>
            <th>Sessions</th>
            <th>Clean</th>
            <th>Catches</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((monday) => {
            const ended = sessions.filter((s) => s.ended && inWeek(s.ended.at, monday));
            const catches = state.catches.filter((c) => inWeek(c.at, monday)).length;
            return (
              <tr key={monday}>
                <td>{monday}</td>
                <td>{ended.length}</td>
                <td>{ended.filter((s) => s.ended!.clean).length}</td>
                <td>{catches > 0 ? <span className="badge good">{catches}</span> : <span className="muted">0</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2>Catches</h2>
      {state.catches.length === 0 ? (
        <p className="empty">No catches yet.</p>
      ) : (
        <ul className="plain">
          {[...state.catches].reverse().map((c) => (
            <li key={c.catchId}>
              <Link href={`/sessions/${c.sessionId}`}>{state.concepts.get(resolveConceptId(state, c.conceptId))?.name}</Link>{" "}
              <span className="muted small">· {localDate(c.at)}</span>
              {c.note ? <div className="small">{c.note}</div> : null}
            </li>
          ))}
        </ul>
      )}

      <h2>Sessions</h2>
      {sessions.length === 0 ? (
        <p className="empty">No sessions yet.</p>
      ) : (
        <ul className="plain">
          {sessions.map((s) => (
            <li key={s.sessionId} className="row spread">
              <span>
                <Link href={`/sessions/${s.sessionId}`}>{state.concepts.get(resolveConceptId(state, s.conceptId))?.name}</Link>{" "}
                <span className="muted small">· {new Date(s.startedAt).toLocaleString()}</span>
              </span>
              {s.ended ? (
                s.ended.clean ? (
                  <span className="badge good">clean</span>
                ) : (
                  <span className="badge warn">missed points</span>
                )
              ) : (
                <span className="badge">{s.status}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
