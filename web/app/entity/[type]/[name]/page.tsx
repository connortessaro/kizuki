import Markdown from "react-markdown";
import { notFound } from "next/navigation";
import { vaultDir, getEntity, TYPES } from "../../../../lib/data.mjs";

export const dynamic = "force-dynamic";

export default async function EntityPage({ params }: { params: Promise<{ type: string; name: string }> }) {
  const { type, name: rawName } = await params;
  let name: string;
  try {
    name = decodeURIComponent(rawName);
  } catch {
    notFound();
  }
  if (!TYPES.includes(type) || !name || /[/\\]|\.\./.test(name)) notFound();
  const entity = await getEntity(vaultDir(), type, name);
  if (!entity) notFound();
  return (
    <>
      <h1>{entity.type}/{entity.name}</h1>
      {entity.frontmatter.length ? (
        <table>
          <tbody>
            {entity.frontmatter.map(([k, v]) => (
              <tr key={k}><th>{k}</th><td>{v}</td></tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <Markdown>{entity.body}</Markdown>
    </>
  );
}
