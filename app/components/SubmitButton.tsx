"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/** A submit button that disables itself and shows `pending` text while the form is being sent. */
export function SubmitButton({ children, pending, className, name, value }: { children: ReactNode; pending?: string; className?: string; name?: string; value?: string }) {
  const status = useFormStatus();
  return (
    <button type="submit" className={className} disabled={status.pending} name={name} value={value}>
      {status.pending ? (pending ?? "Working…") : children}
    </button>
  );
}
