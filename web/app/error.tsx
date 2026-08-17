"use client";

export default function Error({ error }: { error: Error }) {
  return (
    <>
      <h1>Something broke</h1>
      <pre>{error.message}</pre>
    </>
  );
}
