import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildActivityEvent, commitIdFor } from "./activityEvents.mjs";
import {
  activityEventsPath,
  appendActivityEvents,
  planActivityAppend,
  readActivityEvents,
} from "./activityStore.mjs";

const sha = (char) => char.repeat(40);

const event = (repo, char, overrides = {}) =>
  buildActivityEvent({
    repo,
    sha: sha(char),
    authoredAt: "2026-07-04T13:32:00.000Z",
    committedAt: "2026-07-04T13:32:00.000Z",
    authorName: "A Worker",
    authorEmail: "a.worker@example.com",
    subject: "feat: " + char,
    parents: 1,
    onDefaultBranch: true,
    files: [],
    ...overrides,
  });

const vault = () => mkdtemp(join(tmpdir(), "kizuki-activity-store-"));
const noLock = (_vaultDir, fn) => fn();

test("readActivityEvents returns nothing when the ledger does not exist", async () => {
  assert.deepEqual(await readActivityEvents(await vault()), []);
});

test("planActivityAppend keeps new events and drops ones already present", async () => {
  const a = event("kizuki", "a");
  const b = event("kizuki", "b");
  const { append, skipped } = planActivityAppend([a], [a, b]);
  assert.deepEqual(append.map((e) => e.commitId), [b.commitId]);
  assert.equal(skipped, 1);
});

test("planActivityAppend drops a duplicate inside a single batch", () => {
  const a = event("kizuki", "a");
  const { append, skipped } = planActivityAppend([], [a, a]);
  assert.equal(append.length, 1);
  assert.equal(skipped, 1);
});

test("planActivityAppend rejects an invalid candidate rather than writing it", () => {
  const stale = { ...event("kizuki", "a"), sha: "b".repeat(40) };
  assert.throws(() => planActivityAppend([], [stale]), /identity mismatch/);
  assert.throws(() => planActivityAppend([], [{ version: 1 }]), /unknown activity event undefined/);
});

test("appendActivityEvents writes the ledger and reports what it did", async () => {
  const dir = await vault();
  const result = await appendActivityEvents(dir, [event("kizuki", "a"), event("kizuki", "b")], {
    lock: noLock,
  });
  assert.deepEqual(result, { appended: 2, skipped: 0, total: 2 });
  assert.equal((await readActivityEvents(dir)).length, 2);
});

test("appendActivityEvents appends without rewriting earlier lines", async () => {
  const dir = await vault();
  await appendActivityEvents(dir, [event("kizuki", "a")], { lock: noLock });
  const first = await readFile(activityEventsPath(dir), "utf8");
  await appendActivityEvents(dir, [event("kizuki", "b")], { lock: noLock });
  const second = await readFile(activityEventsPath(dir), "utf8");
  assert.ok(second.startsWith(first));
  assert.equal(second.trimEnd().split("\n").length, 2);
});

test("appendActivityEvents is a no-op when every candidate is already recorded", async () => {
  const dir = await vault();
  const events = [event("kizuki", "a")];
  await appendActivityEvents(dir, events, { lock: noLock });
  const before = await readFile(activityEventsPath(dir), "utf8");
  const result = await appendActivityEvents(dir, events, { lock: noLock });
  assert.deepEqual(result, { appended: 0, skipped: 1, total: 1 });
  assert.equal(await readFile(activityEventsPath(dir), "utf8"), before);
});

test("appendActivityEvents writes the ledger owner-readable only", async () => {
  const dir = await vault();
  await appendActivityEvents(dir, [event("kizuki", "a")], { lock: noLock });
  const mode = (await stat(activityEventsPath(dir))).mode & 0o777;
  assert.equal(mode, 0o600);
});

test("appendActivityEvents holds the vault lock for the whole read-then-write", async () => {
  const dir = await vault();
  const order = [];
  const lock = async (_vaultDir, fn) => {
    order.push("acquire");
    const result = await fn();
    order.push("release");
    return result;
  };
  await appendActivityEvents(dir, [event("kizuki", "a")], { lock });
  assert.deepEqual(order, ["acquire", "release"]);
});

test("readActivityEvents names the line when JSON is malformed", async () => {
  const dir = await vault();
  await appendActivityEvents(dir, [event("kizuki", "a")], { lock: noLock });
  const path = activityEventsPath(dir);
  await writeFile(path, (await readFile(path, "utf8")) + "{oops}\n", "utf8");
  await assert.rejects(() => readActivityEvents(dir), /:2: malformed JSON/);
});

test("readActivityEvents names the line when an event fails validation", async () => {
  const dir = await vault();
  const bad = { ...event("kizuki", "a"), version: 9 };
  await writeFile(activityEventsPath(dir).replace(/[^/]+$/, ""), "", "utf8").catch(() => {});
  await appendActivityEvents(dir, [event("kizuki", "b")], { lock: noLock });
  const path = activityEventsPath(dir);
  await writeFile(path, (await readFile(path, "utf8")) + JSON.stringify(bad) + "\n", "utf8");
  await assert.rejects(() => readActivityEvents(dir), /:2: invalid activity event version/);
});

test("readActivityEvents rejects the same commit recorded twice", async () => {
  const dir = await vault();
  const a = event("kizuki", "a");
  await appendActivityEvents(dir, [a], { lock: noLock });
  const path = activityEventsPath(dir);
  await writeFile(path, (await readFile(path, "utf8")) + JSON.stringify(a) + "\n", "utf8");
  await assert.rejects(() => readActivityEvents(dir), /duplicate activity event for cmt_/);
});

test("readActivityEvents rejects a blank line", async () => {
  const dir = await vault();
  await appendActivityEvents(dir, [event("kizuki", "a")], { lock: noLock });
  const path = activityEventsPath(dir);
  await writeFile(path, (await readFile(path, "utf8")) + "\n" + JSON.stringify(event("kizuki", "b")) + "\n", "utf8");
  await assert.rejects(() => readActivityEvents(dir), /blank JSONL line/);
});

test("the same sha in two repos gets two distinct ledger entries", async () => {
  const dir = await vault();
  await appendActivityEvents(dir, [event("kizuki", "a"), event("ringi", "a")], { lock: noLock });
  const events = await readActivityEvents(dir);
  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map((e) => e.commitId),
    [commitIdFor("kizuki", sha("a")), commitIdFor("ringi", sha("a"))],
  );
});
