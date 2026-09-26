import { appendFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendLog, readLog } from "./log";
import { homePaths } from "./paths";
import { tempHome } from "./test-helpers/home";

let home: string;
let cleanup: () => void;
beforeEach(() => ({ home, cleanup } = tempHome()));
afterEach(() => cleanup());

const created = (courseId: string) => ({ type: "course.created" as const, at: "2026-09-24T10:00:00.000Z", courseId, name: `Course ${courseId}` });

describe("log file privacy", () => {
  it("creates the data folder and logs readable only by your user account", async () => {
    await appendLog(home, "courses", [created("c1")]);
    expect(statSync(homePaths(home).data).mode & 0o077).toBe(0);
    expect(statSync(homePaths(home).log("courses")).mode & 0o077).toBe(0);
  });
});

describe("a log with a half-written last line", () => {
  it("says the line was cut off by a stop and how to fix it", async () => {
    mkdirSync(homePaths(home).data, { recursive: true });
    appendFileSync(homePaths(home).log("courses"), `${JSON.stringify(created("c1"))}\n{"type":"course.cre`);
    await expect(readLog(home, "courses")).rejects.toThrow(/courses\.jsonl:2: .*half-written.*delete that last line/);
  });

  it("never joins a new event onto it, so only the cut-off line is lost", async () => {
    mkdirSync(homePaths(home).data, { recursive: true });
    appendFileSync(homePaths(home).log("courses"), `${JSON.stringify(created("c1"))}\n{"type":"course.cre`);
    await appendLog(home, "courses", [created("c2")]);
    const lines = readFileSync(homePaths(home).log("courses"), "utf8").split("\n");
    expect(lines[2]).toBe(JSON.stringify(created("c2")));
  });
});

describe("readLog", () => {
  it("returns no events when the log file does not exist yet", async () => {
    expect(await readLog(home, "courses")).toEqual([]);
  });

  it("names the file and line of a line that is not valid JSON", async () => {
    mkdirSync(homePaths(home).data, { recursive: true });
    appendFileSync(homePaths(home).log("courses"), `${JSON.stringify(created("c1"))}\n{not json\n`);
    await expect(readLog(home, "courses")).rejects.toThrow(/courses\.jsonl:2: /);
  });

  it("names the file and line of an event that does not match the schema", async () => {
    mkdirSync(homePaths(home).data, { recursive: true });
    appendFileSync(homePaths(home).log("courses"), `${JSON.stringify({ type: "course.created", at: "yesterday" })}\n`);
    await expect(readLog(home, "courses")).rejects.toThrow(/courses\.jsonl:1: /);
  });

  it("skips empty lines", async () => {
    mkdirSync(homePaths(home).data, { recursive: true });
    appendFileSync(homePaths(home).log("courses"), `\n${JSON.stringify(created("c1"))}\n\n`);
    expect(await readLog(home, "courses")).toHaveLength(1);
  });
});

describe("appendLog", () => {
  it("adds events as new lines and reads them back in order", async () => {
    await appendLog(home, "courses", [created("c1")]);
    await appendLog(home, "courses", [created("c2"), created("c3")]);
    const events = await readLog(home, "courses");
    expect(events.map((e) => e.type === "course.created" && e.courseId)).toEqual(["c1", "c2", "c3"]);
    expect(readFileSync(homePaths(home).log("courses"), "utf8").split("\n")).toHaveLength(4);
  });

  it("refuses an event that does not match the schema and writes nothing", async () => {
    await expect(appendLog(home, "courses", [created("c1"), { type: "course.created" } as never])).rejects.toThrow();
    expect(await readLog(home, "courses")).toEqual([]);
  });

  it("keeps every line whole when many writers append at once", async () => {
    await Promise.all(Array.from({ length: 25 }, (_, i) => appendLog(home, "courses", [created(`c${i}`)])));
    expect(await readLog(home, "courses")).toHaveLength(25);
  });
});
