import Link from "next/link";
import { vaultDir, listByType, followups, listDays } from "../lib/data.mjs";

export const dynamic = "force-dynamic";

export default async function Home() {
  const dir = vaultDir();
  const [byType, groups, days] = await Promise.all([listByType(dir), followups(dir), listDays(dir)]);
  const preview = groups.slice(0, 5);
  return (
    <>
      <h1>Dashboard</h1>
      <div className="cards">
        <Link className="card" href="/people"><span className="count">{byType.person.length}</span>people</Link>
        <Link className="card" href="/projects"><span className="count">{byType.project.length}</span>projects</Link>
        <Link className="card" href="/teams"><span className="count">{byType.team.length}</span>teams</Link>
      </div>

      <h2>Latest day summary</h2>
      {days.length ? (
        <p><Link href={`/days/${days[0]}`}>{days[0]}</Link></p>
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
