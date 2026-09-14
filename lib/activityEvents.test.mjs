import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVITY_EVENT_VERSION,
  buildActivityEvent,
  commitIdFor,
  validateActivityEvent,
} from "./activityEvents.mjs";

const SHA = "a".repeat(40);

const commit = (overrides = {}) => ({
  repo: "kizuki",
  sha: SHA,
  authoredAt: "2026-07-04T13:32:00.000Z",
  committedAt: "2026-07-04T13:32:00.000Z",
  authorName: "A Worker",
  authorEmail: "a.worker@example.com",
  subject: "feat: add a thing",
  parents: 1,
  onDefaultBranch: true,
  files: [{ path: "lib/vault.mjs", insertions: 3, deletions: 1, binary: false, renamedFrom: null }],
  ...overrides,
});

const broken = (overrides) => ({ ...buildActivityEvent(commit()), ...overrides });

test("commitIdFor is stable and scoped to the repo", () => {
  assert.equal(commitIdFor("kizuki", SHA), commitIdFor("kizuki", SHA));
  assert.notEqual(commitIdFor("kizuki", SHA), commitIdFor("ringi", SHA));
  assert.match(commitIdFor("kizuki", SHA), /^cmt_[0-9a-f]{12}$/);
});

test("buildActivityEvent produces a valid, versioned event", () => {
  const event = buildActivityEvent(commit());
  assert.equal(event.version, ACTIVITY_EVENT_VERSION);
  assert.equal(event.event, "commit.recorded");
  assert.equal(event.commitId, commitIdFor("kizuki", SHA));
  assert.equal(event.isMerge, false);
});

test("buildActivityEvent derives isMerge from the parent count", () => {
  assert.equal(buildActivityEvent(commit({ parents: 2 })).isMerge, true);
  assert.equal(buildActivityEvent(commit({ parents: 0 })).isMerge, false);
});

test("buildActivityEvent defaults onDefaultBranch to false rather than undefined", () => {
  const event = buildActivityEvent(commit({ onDefaultBranch: undefined }));
  assert.equal(event.onDefaultBranch, false);
});

test("validateActivityEvent rejects an identity that does not match repo and sha", () => {
  assert.throws(() => validateActivityEvent(broken({ commitId: "cmt_" + "0".repeat(12) })), /identity mismatch/);
});

test("validateActivityEvent rejects a repo rename that leaves the id stale", () => {
  assert.throws(() => validateActivityEvent(broken({ repo: "ringi" })), /identity mismatch/);
});

test("validateActivityEvent rejects a wrong version", () => {
  assert.throws(() => validateActivityEvent(broken({ version: 2 })), /invalid activity event version/);
});

test("validateActivityEvent rejects an unknown field", () => {
  assert.throws(() => validateActivityEvent(broken({ extra: 1 })), /unknown activity event field/);
});

test("validateActivityEvent rejects an abbreviated sha", () => {
  assert.throws(() => validateActivityEvent(broken({ sha: "abc1234" })), /invalid activity sha/);
});

test("validateActivityEvent rejects a non-ISO timestamp", () => {
  assert.throws(
    () => validateActivityEvent(broken({ authoredAt: "2026-07-04 09:32:00" })),
    /authoredAt must be an ISO timestamp/,
  );
});

test("validateActivityEvent rejects isMerge disagreeing with the parent count", () => {
  assert.throws(() => validateActivityEvent(broken({ isMerge: true })), /isMerge must agree/);
});

test("validateActivityEvent rejects a binary change carrying line counts", () => {
  const files = [{ path: "a.jpg", insertions: 1, deletions: 0, binary: true, renamedFrom: null }];
  assert.throws(() => validateActivityEvent(broken({ files })), /binary change must record null/);
});

test("validateActivityEvent accepts a binary change with null counts", () => {
  const files = [{ path: "a.jpg", insertions: null, deletions: null, binary: true, renamedFrom: null }];
  assert.doesNotThrow(() => validateActivityEvent(broken({ files })));
});

test("validateActivityEvent rejects a negative line count", () => {
  const files = [{ path: "a.mjs", insertions: -1, deletions: 0, binary: false, renamedFrom: null }];
  assert.throws(() => validateActivityEvent(broken({ files })), /insertions must be a non-negative integer/);
});

test("validateActivityEvent rejects a duplicate file path in one commit", () => {
  const file = { path: "a.mjs", insertions: 1, deletions: 0, binary: false, renamedFrom: null };
  assert.throws(() => validateActivityEvent(broken({ files: [file, file] })), /duplicate activity file path/);
});

test("validateActivityEvent accepts a merge commit with no files", () => {
  const event = buildActivityEvent(commit({ parents: 2, files: [] }));
  assert.doesNotThrow(() => validateActivityEvent(event));
});

test("validateActivityEvent accepts an empty subject but rejects an over-long one", () => {
  assert.doesNotThrow(() => validateActivityEvent(broken({ subject: "" })));
  assert.throws(() => validateActivityEvent(broken({ subject: "x".repeat(501) })), /at most 500 characters/);
});

test("validateActivityEvent rejects a path-shaped repo name", () => {
  const event = { ...buildActivityEvent(commit()), repo: "../etc" };
  event.commitId = commitIdFor("../etc", SHA);
  assert.throws(() => validateActivityEvent(event), /invalid activity repo/);
});
