import Link from "next/link";
import { vaultDir, followups } from "../../../lib/data.mjs";

export const dynamic = "force-dynamic";

export default async function FollowupsPage() {
  const groups = await followups(vaultDir());
  return (
    <>
      <h1>Open follow-ups</h1>
      {groups.length ? (
        groups.map((g) => (
          <section key={`${g.type}/${g.name}`}>
            <h2><Link href={`/entity/${g.type}/${encodeURIComponent(g.name)}`}>{g.type}/{g.name}</Link></h2>
            <ul>
              {g.followUps.map((f, i) => <li key={`f${i}`}><span className="muted">[follow-up]</span> {f}</li>)}
              {g.actions.map((a, i) => <li key={`a${i}`}><span className="muted">[action]</span> {a}</li>)}
            </ul>
          </section>
        ))
      ) : (
        <p className="empty">No open follow-ups or actions.</p>
      )}
    </>
  );
}
