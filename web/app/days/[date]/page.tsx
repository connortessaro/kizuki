import Markdown from "react-markdown";
import { notFound } from "next/navigation";
import { vaultDir, readDay } from "../../../lib/data.mjs";

export const dynamic = "force-dynamic";

export default async function DayPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();
  const content = await readDay(vaultDir(), date);
  if (content === null) notFound();
  return <Markdown>{content}</Markdown>;
}
