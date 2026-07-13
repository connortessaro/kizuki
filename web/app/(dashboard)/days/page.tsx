import Link from "next/link";
import { vaultDir, listDays, formatDate } from "../../../lib/data.mjs";

export const dynamic = "force-dynamic";

export default async function DaysPage() {
  const days = await listDays(vaultDir());
  return (
    <>
      <h1>Day summaries</h1>
      {days.length ? (
        <ul>
          {days.map((d) => <li key={d}><Link href={`/days/${d}`}>{formatDate(d)}</Link></li>)}
        </ul>
      ) : (
        <p className="empty">No day summaries yet.</p>
      )}
    </>
  );
}
