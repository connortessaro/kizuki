import { existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withLock } from "./lock";
import { tempHome } from "./test-helpers/home";

let home: string;
let cleanup: () => void;
let lockPath: string;

beforeEach(() => {
  ({ home, cleanup } = tempHome());
  mkdirSync(join(home, "data"));
  lockPath = join(home, "data", ".lock");
});
afterEach(() => cleanup());

describe("withLock", () => {
  it("runs the function, returns its value, and removes the lock file", async () => {
    const value = await withLock(lockPath, async () => {
      expect(existsSync(lockPath)).toBe(true);
      return 42;
    });
    expect(value).toBe(42);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("removes the lock file when the function throws", async () => {
    await expect(withLock(lockPath, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(existsSync(lockPath)).toBe(false);
  });

  it("makes a second caller wait until the first is done", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = withLock(lockPath, async () => { order.push("first-start"); await gate; order.push("first-end"); });
    await new Promise((r) => setTimeout(r, 20));
    const second = withLock(lockPath, async () => { order.push("second"); });
    await new Promise((r) => setTimeout(r, 60));
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second"]);
  });

  it("takes over a lock left behind by a process that no longer exists", async () => {
    writeFileSync(lockPath, JSON.stringify({ pid: 999999, at: new Date().toISOString() }));
    await expect(withLock(lockPath, async () => "ok")).resolves.toBe("ok");
  });

  it("gives up after the timeout and names the process holding the lock", async () => {
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    await expect(withLock(lockPath, async () => "never", { timeoutMs: 150 })).rejects.toThrow(`held by process ${process.pid}`);
  });
});

describe("withLock after a crash", () => {
  it("takes over an empty lock file left by a process that stopped before writing its number", async () => {
    writeFileSync(lockPath, "");
    const past = new Date(Date.now() - 60_000);
    utimesSync(lockPath, past, past);
    await expect(withLock(lockPath, async () => "ran", { timeoutMs: 500 })).resolves.toBe("ran");
  });

  it("says how to fix a lock it has to give up on", async () => {
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, at: "2026-09-24T10:00:00.000Z" }));
    await expect(withLock(lockPath, async () => "never", { timeoutMs: 100 })).rejects.toThrow(/If no other Kizuki is running, delete .*\.lock and try again/);
  });
});

describe("withLock with many writers after a crash", () => {
  it("lets only one writer in at a time, even when they all find the same stale lock", async () => {
    for (let round = 0; round < 40; round += 1) {
      writeFileSync(lockPath, JSON.stringify({ pid: 999_999_999, at: "2026-09-24T10:00:00.000Z" }));
      let inside = 0;
      let most = 0;
      await Promise.all(
        [...Array(30)].map(() =>
          withLock(lockPath, async () => {
            inside += 1;
            most = Math.max(most, inside);
            await new Promise((r) => setTimeout(r, 1));
            inside -= 1;
          }, { retryMs: 1 }),
        ),
      );
      expect(most).toBe(1);
    }
  }, 30_000);
});
