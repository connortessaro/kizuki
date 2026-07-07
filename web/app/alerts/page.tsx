import Link from "next/link";
import CopyButton from "../copy-button";
import {
  vaultDir, listAlertDates, alertsForDate, formatDate,
} from "../../lib/data.mjs";

export const dynamic = "force-dynamic";

export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const dir = vaultDir();
  const dates = await listAlertDates(dir);
  const { date: q } = await searchParams;
  const date = q && /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : dates[0] ?? new Date().toISOString().slice(0, 10);
  const alerts = await alertsForDate(dir, date);

  return (
    <>
      <h1>Alerts</h1>
      {dates.length ? (
        <p className="muted">
          {dates.map((d) => (
            <span key={d}>
              {d === date ? <strong>{formatDate(d)}</strong> : <Link href={`/alerts?date=${d}`}>{formatDate(d)}</Link>}
              {" · "}
            </span>
          ))}
        </p>
      ) : null}
      {alerts.length ? (
        <ul className="alert-list">
          {alerts.map((a, i) => (
            <li key={`${a.type}/${a.name}/${i}`} className={`alert alert-${a.severity}`}>
              <div>
                <span className="eyebrow">[{a.severity}] {a.kind}</span>{" "}
                <Link href={`/entity/${a.type}/${encodeURIComponent(a.name)}`}>{a.type}/{a.name}</Link>
              </div>
              <p>{a.evidence}</p>
              {a.draft ? (
                <div className="draft-block">
                  <pre>{a.draft}</pre>
                  <CopyButton text={a.draft} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">No alerts for {formatDate(date)}.</p>
      )}
    </>
  );
}
