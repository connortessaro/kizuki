import Link from "next/link";
import { vaultDir, searchVault } from "../../../lib/data.mjs";

export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const hits = query ? await searchVault(vaultDir(), query) : [];
  return (
    <>
      <h1>Search{query ? `: ${query}` : ""}</h1>
      {!query ? (
        <p className="empty">Type a query in the search box.</p>
      ) : hits.length ? (
        <ul>
          {hits.map((h, i) => (
            <li key={i}>
              <Link href={`/entity/${h.type}/${encodeURIComponent(h.name)}`}>{h.type}/{h.name}</Link>
              <span className="muted">:{h.line}</span> {h.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">No matches for “{query}”.</p>
      )}
    </>
  );
}
