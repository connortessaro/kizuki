import Link from "next/link";
import { isCorrected } from "@/lib/teach";

/**
 * A quote from your material, with a link to the exact passage it came from. If you corrected
 * words of it, your correction is shown under it, because your version wins.
 */
export function Quote({ text, passageId, label, corrections = [] }: { text: string; passageId: string; label: string; corrections?: { quote: string; correction: string }[] }) {
  const yours = corrections.filter((c) => isCorrected(text, [c]));
  return (
    <blockquote className="quote">
      “{text}”
      <Link className="source muted" href={`/sources/${passageId}`}>
        {label} →
      </Link>
      {yours.map((c) => (
        <span key={`${c.quote}:${c.correction}`} className="badge accent small">
          Your correction: “{c.quote}” should be “{c.correction}”
        </span>
      ))}
    </blockquote>
  );
}
