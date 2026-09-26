"use client";

/** Shown when a page fails, with the error message and a way to try again. */
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <>
      <h1>Something went wrong</h1>
      <div className="notice error">{error.message}</div>
      <button onClick={reset}>Try again</button>
    </>
  );
}
