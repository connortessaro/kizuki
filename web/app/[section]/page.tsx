import Link from "next/link";
import { notFound } from "next/navigation";
import { vaultDir, listByType } from "../../lib/data.mjs";

export const dynamic = "force-dynamic";

const TYPE_BY_SECTION: Record<string, "person" | "project" | "team"> = {
  people: "person",
  projects: "project",
  teams: "team",
};

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const type = TYPE_BY_SECTION[section];
  if (!type) notFound();
  const entities = (await listByType(vaultDir()))[type];
  return (
    <>
      <h1>{section}</h1>
      {entities.length ? (
        <ul>
          {entities.map((e) => (
            <li key={e.name}>
              <Link href={`/entity/${type}/${encodeURIComponent(e.name)}`}>{e.name}</Link>
              {e.status ? <span className="muted"> — {e.status}</span> : <span className="muted"> — (no status)</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">No {section} yet.</p>
      )}
    </>
  );
}
