import { test } from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withVaultLock, LOCK_WAIT_MS, LOCK_POLL_MS } from "./lock.mjs";

const tmp = () => mkdtemp(join(tmpdir(), "kizuki-lock-"));
const lockFile = (dir) => join(dir, "state", "vault.lock");
const exists = (p) => access(p).then(() => true, () => false);
const FIXED = new Date("2026-07-07T09:00:00Z");

const plantLock = async (dir, meta) => {
  await mkdir(join(dir, "state"), { recursive: true });
  await writeFile(lockFile(dir), JSON.stringify(meta));
};

test("exports the default wait and poll intervals", () => {
  assert.equal(LOCK_WAIT_MS, 30000);
  assert.equal(LOCK_POLL_MS, 500);
});

test("holds metadata during fn, returns fn result, removes lock after", async () => {
  const dir = await tmp();
  let during;
  const result = await withVaultLock(dir, async () => {
    during = JSON.parse(await readFile(lockFile(dir), "utf8"));
    return "done";
  }, { tool: "sync", now: FIXED });
  assert.equal(result, "done");
  assert.deepEqual(during, { pid: process.pid, tool: "sync", startedAt: "2026-07-07T09:00:00.000Z" });
  assert.equal(await exists(lockFile(dir)), false);
});

test("second acquire against a live holder waits then throws holder info", async () => {
  const dir = await tmp();
  await plantLock(dir, { pid: 4242, tool: "mcp", startedAt: "2026-07-07T08:00:00.000Z" });
  await assert.rejects(
    withVaultLock(dir, async () => {}, { waitMs: 20, pollMs: 5, pidAlive: () => true }),
    /vault locked by mcp \(pid 4242\) since 2026-07-07T08:00:00\.000Z/
  );
  assert.equal(JSON.parse(await readFile(lockFile(dir), "utf8")).pid, 4242);
});

test("steals a lock whose holder pid is dead", async () => {
  const dir = await tmp();
  await plantLock(dir, { pid: 4242, tool: "sync", startedAt: "x" });
  let ran = false;
  await withVaultLock(dir, async () => { ran = true; }, { pidAlive: () => false });
  assert.equal(ran, true);
  assert.equal(await exists(lockFile(dir)), false);
});

test("treats an unparsable lock file as stale", async () => {
  const dir = await tmp();
  await mkdir(join(dir, "state"), { recursive: true });
  await writeFile(lockFile(dir), "{ not json");
  let ran = false;
  await withVaultLock(dir, async () => { ran = true; }, { pidAlive: () => true });
  assert.equal(ran, true);
});

test("treats a lock file without a numeric pid as stale", async () => {
  const dir = await tmp();
  await plantLock(dir, { pid: "4242", tool: "mcp", startedAt: "x" });
  let ran = false;
  await withVaultLock(dir, async () => { ran = true; }, { pidAlive: () => true });
  assert.equal(ran, true);
});

test("releases the lock when fn throws and propagates the error", async () => {
  const dir = await tmp();
  await assert.rejects(withVaultLock(dir, async () => { throw new Error("boom"); }), /boom/);
  assert.equal(await exists(lockFile(dir)), false);
});

test("release leaves a lock owned by another pid untouched", async () => {
  const dir = await tmp();
  await withVaultLock(dir, async () => {
    await writeFile(lockFile(dir), JSON.stringify({ pid: 999999999, tool: "mcp", startedAt: "x" }));
  });
  assert.equal(JSON.parse(await readFile(lockFile(dir), "utf8")).pid, 999999999);
});

test("does not steal a stale lock that a fresh holder overwrote mid-steal", async () => {
  const dir = await tmp();
  await plantLock(dir, { pid: 4242, tool: "sync", startedAt: "x" });
  const pidAlive = (pid) => {
    if (pid === 4242) {
      writeFileSync(lockFile(dir), JSON.stringify({ pid: 5555, tool: "mcp", startedAt: "2026-07-07T08:30:00.000Z" }));
      return false;
    }
    return true;
  };
  let ran = false;
  await assert.rejects(
    withVaultLock(dir, async () => { ran = true; }, { waitMs: 20, pollMs: 5, pidAlive }),
    /vault locked by mcp \(pid 5555\) since 2026-07-07T08:30:00\.000Z/
  );
  assert.equal(ran, false);
  assert.equal(JSON.parse(await readFile(lockFile(dir), "utf8")).pid, 5555);
});

test("gives up at the deadline when a churner keeps rewriting a dead lock", async () => {
  const dir = await tmp();
  await plantLock(dir, { pid: 4242, tool: "sync", startedAt: "x" });
  let n = 0;
  const pidAlive = () => {
    n += 1;
    writeFileSync(lockFile(dir), JSON.stringify({ pid: 4242, tool: "sync", startedAt: "dead-" + n }));
    return false;
  };
  await assert.rejects(
    withVaultLock(dir, async () => {}, { waitMs: 20, pollMs: 5, pidAlive }),
    /vault lock could not be acquired within 20ms/
  );
});

test("waiting acquire succeeds when the holder releases mid-wait", async () => {
  const dir = await tmp();
  await plantLock(dir, { pid: 4242, tool: "sync", startedAt: "x" });
  setTimeout(() => { unlink(lockFile(dir)); }, 15);
  let ran = false;
  await withVaultLock(dir, async () => { ran = true; }, { waitMs: 2000, pollMs: 5, pidAlive: () => true });
  assert.equal(ran, true);
});
