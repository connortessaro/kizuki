import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

/**
 * Splits typed or pasted text into file paths. Handles the forms terminals paste when you drop
 * a file: quoted paths ('a b.pdf' or "a b.pdf"), spaces escaped with a backslash (a\ b.pdf),
 * and `~` for the home folder.
 */
export function splitPaths(text: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: string | null = null;
  let started = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      started = true;
      continue;
    }
    if (ch === "\\" && i + 1 < text.length) {
      current += text[i + 1];
      i += 1;
      started = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (started) out.push(current);
      current = "";
      started = false;
      continue;
    }
    current += ch;
    started = true;
  }
  if (started) out.push(current);
  return out.map(expandHome);
}

/** Replaces a leading `~` with the home folder. */
export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return path;
}

/** True when the text is one or more paths to files that exist, as when you drop files onto the terminal. */
export function looksLikeFiles(text: string): boolean {
  const paths = splitPaths(text.trim());
  return (
    paths.length > 0 &&
    paths.every((p) => existsSync(p) && statSync(p).isFile())
  );
}

/** Writes a path the way a terminal pastes a dropped file: spaces, quotes, and backslashes get a backslash first. The reverse of {@link splitPaths}. */
export function escapePath(path: string): string {
  return path.replace(/[\\\s'"]/g, (ch) => `\\${ch}`);
}
