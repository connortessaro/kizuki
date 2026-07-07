import { access, constants } from "node:fs/promises";
import { delimiter, join } from "node:path";

export const DOCTOR_TIMEOUT_CAP_MS = 30000;
export const REQUIRED_DIRS = ["people", "projects", "teams", "transcripts", "transcripts/processed"];

const executable = async (p) => {
  try {
    await access(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

export async function lookupPath(name, envPath = process.env.PATH ?? "") {
  if (name.includes("/")) return (await executable(name)) ? name : null;
  for (const dir of envPath.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (await executable(candidate)) return candidate;
  }
  return null;
}
