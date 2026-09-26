import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** The names of the log files in `data/`. Each is a `.jsonl` file: one event per line. */
export type LogName =
  | "courses"
  | "materials"
  | "passages"
  | "concepts"
  | "links"
  | "sessions"
  | "corrections"
  | "catches";

/** Where every piece of Kizuki's data lives inside one home folder. */
export interface HomePaths {
  /** The home folder itself, as given. */
  home: string;
  /** Copies of the original files you added. */
  files: string;
  /** The log files. They are the truth. */
  data: string;
  /** The search file. Always rebuildable from `files` and `data`. */
  index: string;
  /** The model settings file, `settings.json`. */
  settings: string;
  /** Where the Workflow SDK keeps its runs. */
  workflowData: string;
  /** The lock file that makes log writes happen one at a time. */
  lock: string;
  /** The path of one log file. */
  log: (name: LogName) => string;
}

/**
 * The folder that holds all study data: `KIZUKI_HOME` if set, otherwise `~/.kizuki`.
 * The default is hidden on purpose: on macOS, `~/Kizuki` is the same folder as a
 * `~/kizuki` repo clone, because folder names ignore letter case.
 */
export function kizukiHome(env: Record<string, string | undefined> = process.env): string {
  const set = env.KIZUKI_HOME?.trim();
  if (!set) return join(homedir(), ".kizuki");
  if (set === "~") return homedir();
  if (set.startsWith("~/")) return join(homedir(), set.slice(2));
  return set;
}

/** Lays out the standard paths inside a home folder. */
export function homePaths(home: string): HomePaths {
  const data = join(home, "data");
  return {
    home,
    files: join(home, "files"),
    data,
    index: join(home, "index.sqlite"),
    settings: join(home, "settings.json"),
    workflowData: join(home, "workflow-data"),
    lock: join(data, ".lock"),
    log: (name) => join(data, `${name}.jsonl`),
  };
}

/**
 * The data folder a background job may use: only the one Kizuki is running with. Jobs are
 * started with their folder as input, so this stops a request from outside the app from
 * pointing a job at some other folder on the computer.
 */
export function runHome(home: string, env: Record<string, string | undefined> = process.env): string {
  const own = kizukiHome(env);
  if (resolve(/*turbopackIgnore: true*/ home) !== resolve(/*turbopackIgnore: true*/ own)) throw new Error(`${home} is not the data folder Kizuki is running with (${own}), so this job was refused`);
  return own;
}

/**
 * The path of a material's stored copy in `files/`. The stored name must be the material's
 * own id plus a file ending, as {@link homePaths} files are named, so a changed log line can
 * never make Kizuki read a file outside `files/`.
 */
export function storedFilePath(home: string, material: { materialId: string; storedName: string }): string {
  const { materialId, storedName } = material;
  const ending = storedName.slice(materialId.length);
  if (!storedName.startsWith(materialId) || !/^\.[a-z]+$/.test(ending)) {
    throw new Error(`${storedName} is not a file Kizuki stored for ${materialId}. The log line for this file was changed; add the file again.`);
  }
  return join(homePaths(home).files, storedName);
}
