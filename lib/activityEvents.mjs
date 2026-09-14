import { createHash } from "node:crypto";

export const ACTIVITY_EVENT_VERSION = 1;
export const ACTIVITY_EVENT_NAME = "commit.recorded";

export const MAX_SUBJECT = 500;
export const MAX_FILES = 5000;
export const MAX_PATH = 1024;

const COMMIT_ID_RE = /^cmt_[0-9a-f]{12}$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const EVENT_FIELDS = new Set([
  "version",
  "event",
  "commitId",
  "repo",
  "sha",
  "authoredAt",
  "committedAt",
  "authorName",
  "authorEmail",
  "subject",
  "parents",
  "isMerge",
  "onDefaultBranch",
  "files",
]);
const FILE_FIELDS = new Set(["path", "insertions", "deletions", "binary", "renamedFrom"]);

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(label + " must be an object");
  }
}

function assertKnownFields(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error("unknown " + label + " field " + JSON.stringify(key));
  }
}

function assertIso(value, label) {
  if (typeof value !== "string" || !ISO_RE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(label + " must be an ISO timestamp");
  }
}

function assertString(value, label, max) {
  if (typeof value !== "string" || value === "") {
    throw new Error(label + " must be a non-empty string");
  }
  if (value.length > max) throw new Error(label + " must be at most " + max + " characters");
}

function assertCount(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(label + " must be a non-negative integer");
  }
}

export function commitIdFor(repo, sha) {
  return "cmt_" + createHash("sha256").update(repo + "|" + sha).digest("hex").slice(0, 12);
}

function validateFile(file, label) {
  assertObject(file, label);
  assertKnownFields(file, FILE_FIELDS, label);
  assertString(file.path, label + " path", MAX_PATH);
  if (typeof file.binary !== "boolean") throw new Error(label + " binary must be a boolean");
  if (file.binary) {
    if (file.insertions !== null || file.deletions !== null) {
      throw new Error(label + " binary change must record null insertions and deletions");
    }
  } else {
    assertCount(file.insertions, label + " insertions");
    assertCount(file.deletions, label + " deletions");
  }
  if (file.renamedFrom !== null) assertString(file.renamedFrom, label + " renamedFrom", MAX_PATH);
  return file;
}

export function validateActivityEvent(event) {
  assertObject(event, "activity event");
  assertKnownFields(event, EVENT_FIELDS, "activity event");
  if (event.version !== ACTIVITY_EVENT_VERSION) {
    throw new Error("invalid activity event version " + JSON.stringify(event.version));
  }
  if (event.event !== ACTIVITY_EVENT_NAME) {
    throw new Error("unknown activity event " + JSON.stringify(event.event));
  }
  if (typeof event.repo !== "string" || !REPO_RE.test(event.repo)) {
    throw new Error("invalid activity repo " + JSON.stringify(event.repo));
  }
  if (typeof event.sha !== "string" || !SHA_RE.test(event.sha)) {
    throw new Error("invalid activity sha " + JSON.stringify(event.sha));
  }
  if (typeof event.commitId !== "string" || !COMMIT_ID_RE.test(event.commitId)) {
    throw new Error("invalid activity commit ID " + JSON.stringify(event.commitId));
  }
  if (event.commitId !== commitIdFor(event.repo, event.sha)) {
    throw new Error("activity identity mismatch for " + event.commitId);
  }
  assertIso(event.authoredAt, "activity authoredAt");
  assertIso(event.committedAt, "activity committedAt");
  assertString(event.authorName, "activity authorName", 200);
  assertString(event.authorEmail, "activity authorEmail", 320);
  if (typeof event.subject !== "string") throw new Error("activity subject must be a string");
  if (event.subject.length > MAX_SUBJECT) {
    throw new Error("activity subject must be at most " + MAX_SUBJECT + " characters");
  }
  assertCount(event.parents, "activity parents");
  if (typeof event.isMerge !== "boolean") throw new Error("activity isMerge must be a boolean");
  if (typeof event.onDefaultBranch !== "boolean") {
    throw new Error("activity onDefaultBranch must be a boolean");
  }
  if (event.isMerge !== event.parents > 1) {
    throw new Error("activity isMerge must agree with parent count for " + event.commitId);
  }
  if (!Array.isArray(event.files)) throw new Error("activity files must be an array");
  if (event.files.length > MAX_FILES) {
    throw new Error("activity files must be at most " + MAX_FILES + " entries");
  }
  const seen = new Set();
  for (const [index, file] of event.files.entries()) {
    validateFile(file, "activity file " + index);
    if (seen.has(file.path)) {
      throw new Error("duplicate activity file path " + JSON.stringify(file.path));
    }
    seen.add(file.path);
  }
  return event;
}

export function buildActivityEvent(commit) {
  const event = {
    version: ACTIVITY_EVENT_VERSION,
    event: ACTIVITY_EVENT_NAME,
    commitId: commitIdFor(commit.repo, commit.sha),
    repo: commit.repo,
    sha: commit.sha,
    authoredAt: commit.authoredAt,
    committedAt: commit.committedAt,
    authorName: commit.authorName,
    authorEmail: commit.authorEmail,
    subject: commit.subject,
    parents: commit.parents,
    isMerge: commit.parents > 1,
    onDefaultBranch: commit.onDefaultBranch === true,
    files: commit.files,
  };
  return validateActivityEvent(event);
}
