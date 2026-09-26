import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Creates an empty Kizuki home folder for one test and returns it with a cleanup function. */
export function tempHome(): { home: string; cleanup: () => void } {
  const home = mkdtempSync(join(tmpdir(), "kizuki-test-"));
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}
