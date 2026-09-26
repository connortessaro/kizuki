import Link from "next/link";

/** Shown for an address Kizuki has no page for. */
export default function NotFound() {
  return (
    <>
      <h1>Not found</h1>
      <p>
        <Link href="/">Back to Today</Link>
      </p>
    </>
  );
}
