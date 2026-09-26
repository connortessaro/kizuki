import { createHash, randomUUID } from "node:crypto";

/** An id that is always the same for the same inputs, such as a passage's position in a file. */
export function stableId(prefix: string, ...parts: (string | number)[]): string {
  return `${prefix}_${createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 16)}`;
}

/** A new random id, for things that happen once, such as a session or a correction. */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/** The SHA-256 fingerprint of a file's bytes, as hex. */
export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
