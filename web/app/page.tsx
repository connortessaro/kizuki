import Link from "next/link";
import {
  vaultDir, listByType, followups, listDays, formatDate, lastUpdated, formatDateTime,
  todayAlerts, getShift, alertTrends, listAlertDates,
} from "../lib/data.mjs";

export const dynamic = "force-dynamic";

export default async function Home() {
  const dir = vaultDir();
  const [byType, groups, days, updated, alerts, shift, trends, alertDates] = await Promise.all([
    listByType(dir), followups(dir), listDays(dir), lastUpdated(dir),
    todayAlerts(dir), getShift(dir), alertTrends(dir), listAlertDates(dir),
  ]);
  const preview = groups.slice(0, 5);

  return (
    <>
      <h1>Dashboard</h1>
      {updated ? <p className="muted">Last vault update: {formatDateTime(updated)}</p> : null}

      <section>
        <h2>Shift {shift ? <span className="badge-on">on</span> : <span className="badge-off">off</span>}</h2>
        {shift ? (
          <p>Active since {formatDateTime(new Date(shift.started))}. <Link href="/shift">Copy queue →</Link></p>
        ) : (
          <p className="muted">Run <code>./kizuki start</code> to begin a shift.</p>
        )}
      </section>

      <div className="cards">
        <Link className="card" href="/people"><span className="count">{byType.person.length}</span>people</Link>
        <Link className="card" href="/projects"><span className="count">{byType.project.length}</span>projects</Link>
        <Link className="card" href="/teams"><span className="count">{byType.team.length}</span>teams</Link>
        <Link className="card" href="/alerts"><span className="count">{alerts.length}</span>alerts today</Link>
      </div>

      <h2>Alerts today {alerts.length ? <Link className="muted" href="/alerts">(all)</Link> : null}</h2>
      {alerts.length ? (
        <ul>
          {alerts.slice(0, 3).map((a, i) => (
            <li key={`a${i}`} className={a.severity === "critical" || a.severity === "warn" ? "noticed" : undefined}>
              <span className="eyebrow">[{a.severity}] {a.kind}</span>{" "}
              <Link href={`/entity/${a.type}/${encodeURIComponent(a.name)}`}>{a.type}/{a.name}</Link>
              {" "}{a.evidence}
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">{alertDates.length ? "No alerts today." : "No alert history yet."}</p>
      )}

      {trends.length ? (
        <>
          <h2>Recurring (7d)</h2>
          <ul>
            {trends.slice(0, 3).map((t) => (
              <li key={`${t.type}/${t.name}:${t.kind}`}>
                <Link href={`/entity/${t.type}/${encodeURIComponent(t.name)}`}>{t.type}/{t.name}</Link>
                {" "}<span className="muted">{t.kind} · {t.days.length} days</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h2>Latest day summary</h2>
      {days.length ? (
        <p><Link href={`/days/${days[0]}`}>{formatDate(days[0])}</Link></p>
      ) : (
        <p className="empty">No day summaries yet.</p>
      )}

      <h2>Open follow-ups {groups.length ? <Link className="muted" href="/followups">(all)</Link> : null}</h2>
      {preview.length ? (
        <ul>
          {preview.map((g) =>
            [...g.followUps.map((f) => ({ kind: "follow-up", text: f })), ...g.actions.map((a) => ({ kind: "action", text: a }))].map((item, i) => (
              <li key={`${g.type}/${g.name}/${i}`}>
                <Link href={`/entity/${g.type}/${encodeURIComponent(g.name)}`}>{g.type}/{g.name}</Link>
                {" "}<span className="muted">[{item.kind}]</span> {item.text}
              </li>
            )),
          )}
        </ul>
      ) : (
        <p className="empty">No open follow-ups.</p>
      )}
    </>
  );
}
