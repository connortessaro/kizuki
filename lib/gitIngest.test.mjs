import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatIngestResults,
  ingestRepo,
  parseGitLog,
  parseNumstatPath,
  readRepoCommits,
  resolveDefaultRef,
  runIngestCommand,
} from "./gitIngest.mjs";
import { readActivityEvents } from "./activityStore.mjs";

const REC = String.fromCharCode(0);
const FLD = String.fromCharCode(31);

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);

function header(sha, fields = {}) {
  const {
    authoredAt = "2026-07-04T09:32:00-04:00",
    committedAt = "2026-07-04T09:32:00-04:00",
    name = "A Worker",
    email = "a.worker@example.com",
    parents = SHA_B,
    subject = "feat: add a thing",
  } = fields;
  return [sha, authoredAt, committedAt, name, email, parents, subject].join(FLD);
}

const record = (sha, body, fields) => REC + header(sha, fields) + "\n" + body;

async function vault() {
  return mkdtemp(join(tmpdir(), "kizuki-activity-"));
}

const noLock = (_vaultDir, fn) => fn();

test("parseNumstatPath leaves an unrenamed path alone", () => {
  assert.deepEqual(parseNumstatPath("lib/vault.mjs"), {
    path: "lib/vault.mjs",
    renamedFrom: null,
  });
});

test("parseNumstatPath reads the plain rename form", () => {
  assert.deepEqual(parseNumstatPath("mcp/package-lock.json => package-lock.json"), {
    path: "package-lock.json",
    renamedFrom: "mcp/package-lock.json",
  });
});

test("parseNumstatPath reads the brace rename form", () => {
  assert.deepEqual(parseNumstatPath("docs/{a => b}/plan.md"), {
    path: "docs/b/plan.md",
    renamedFrom: "docs/a/plan.md",
  });
});

test("parseNumstatPath collapses the slash left by an empty brace side", () => {
  assert.deepEqual(parseNumstatPath("web/app/{ => (dashboard)}/alerts/page.tsx"), {
    path: "web/app/(dashboard)/alerts/page.tsx",
    renamedFrom: "web/app/alerts/page.tsx",
  });
});

test("parseNumstatPath keeps a path containing an arrow-like directory name", () => {
  assert.deepEqual(parseNumstatPath("lib/a=>b.mjs"), {
    path: "lib/a=>b.mjs",
    renamedFrom: null,
  });
});

test("parseGitLog reads insertions, deletions and the subject", () => {
  const commits = parseGitLog(record(SHA_A, "12\t3\tlib/vault.mjs\n"), "kizuki");
  assert.equal(commits.length, 1);
  assert.equal(commits[0].sha, SHA_A);
  assert.equal(commits[0].subject, "feat: add a thing");
  assert.deepEqual(commits[0].files, [
    { path: "lib/vault.mjs", insertions: 12, deletions: 3, binary: false, renamedFrom: null },
  ]);
});

test("parseGitLog normalizes timestamps to UTC", () => {
  const commits = parseGitLog(record(SHA_A, "1\t0\ta.mjs\n"), "kizuki");
  assert.equal(commits[0].authoredAt, "2026-07-04T13:32:00.000Z");
});

test("parseGitLog records a binary change as null counts", () => {
  const commits = parseGitLog(record(SHA_A, "-\t-\tbrand/social.jpg\n"), "kizuki");
  assert.deepEqual(commits[0].files[0], {
    path: "brand/social.jpg",
    insertions: null,
    deletions: null,
    binary: true,
    renamedFrom: null,
  });
});

test("parseGitLog treats a merge commit with no numstat as having no files", () => {
  const commits = parseGitLog(record(SHA_A, "", { parents: SHA_B + " " + SHA_C }), "kizuki");
  assert.equal(commits[0].parents, 2);
  assert.deepEqual(commits[0].files, []);
});

test("parseGitLog counts a root commit as having no parents", () => {
  const commits = parseGitLog(record(SHA_A, "1\t0\ta.mjs\n", { parents: "" }), "harbor");
  assert.equal(commits[0].parents, 0);
});

test("parseGitLog keeps a subject containing the field separator's neighbours", () => {
  const commits = parseGitLog(
    record(SHA_A, "1\t0\ta.mjs\n", { subject: "fix: handle a|b and c\tspacing" }),
    "kizuki",
  );
  assert.equal(commits[0].subject, "fix: handle a|b and c\tspacing");
});

test("parseGitLog reads several commits from one stream", () => {
  const stdout = record(SHA_A, "1\t0\ta.mjs\n") + record(SHA_B, "2\t2\tb.mjs\n");
  const commits = parseGitLog(stdout, "kizuki");
  assert.deepEqual(commits.map((c) => c.sha), [SHA_A, SHA_B]);
});

test("parseGitLog substitutes a placeholder for a missing author", () => {
  const commits = parseGitLog(record(SHA_A, "1\t0\ta.mjs\n", { name: "", email: "" }), "kizuki");
  assert.equal(commits[0].authorName, "(unknown)");
  assert.equal(commits[0].authorEmail, "(unknown)");
});

test("parseGitLog keeps only the first entry for a path repeated in one commit", () => {
  const commits = parseGitLog(record(SHA_A, "1\t0\ta.mjs\n5\t5\ta.mjs\n"), "kizuki");
  assert.equal(commits[0].files.length, 1);
  assert.equal(commits[0].files[0].insertions, 1);
});

test("parseGitLog rejects a malformed header", () => {
  assert.throws(
    () => parseGitLog(REC + "not-a-header\n", "kizuki"),
    /malformed git log header in kizuki/,
  );
});

test("parseGitLog rejects a malformed numstat line", () => {
  assert.throws(() => parseGitLog(record(SHA_A, "12\tlib/vault.mjs\n"), "kizuki"), /malformed numstat line/);
});

test("resolveDefaultRef prefers the first ref that resolves", async () => {
  const asked = [];
  const exec = async (_bin, args) => {
    const ref = args.at(-1);
    asked.push(ref);
    if (ref === "refs/remotes/origin/main") return { stdout: SHA_A + "\n" };
    throw new Error("not found");
  };
  assert.equal(await resolveDefaultRef("/repo", exec), "refs/remotes/origin/main");
  assert.equal(asked[0], "refs/remotes/origin/HEAD");
});

test("resolveDefaultRef returns null when no candidate resolves", async () => {
  const exec = async () => {
    throw new Error("not found");
  };
  assert.equal(await resolveDefaultRef("/repo", exec), null);
});

function execFor({ log, defaultRef = "refs/remotes/origin/main", onDefault = [] }) {
  return async (_bin, args) => {
    const sub = args[2];
    if (sub === "rev-parse") {
      if (args.at(-1) === defaultRef) return { stdout: SHA_A + "\n" };
      throw new Error("not found");
    }
    if (sub === "rev-list") return { stdout: onDefault.join("\n") + (onDefault.length ? "\n" : "") };
    return { stdout: log };
  };
}

test("readRepoCommits defaults to every ref so a detached default branch is not missed", async () => {
  const seen = [];
  const exec = async (_bin, args) => {
    if (args[2] === "log") seen.push(args.at(-1));
    return execFor({ log: record(SHA_A, "1\t0\ta.mjs\n"), onDefault: [SHA_A] })(_bin, args);
  };
  await readRepoCommits("/repo", { exec });
  assert.equal(seen[0], "--all");
});

test("readRepoCommits walks only the default ref when asked", async () => {
  const seen = [];
  const exec = async (_bin, args) => {
    if (args[2] === "log") seen.push(args.at(-1));
    return execFor({ log: record(SHA_A, "1\t0\ta.mjs\n"), onDefault: [SHA_A] })(_bin, args);
  };
  await readRepoCommits("/repo", { exec, refScope: "default" });
  assert.equal(seen[0], "refs/remotes/origin/main");
});

test("readRepoCommits marks which commits are on the default branch", async () => {
  const exec = execFor({
    log: record(SHA_A, "1\t0\ta.mjs\n") + record(SHA_B, "1\t0\tb.mjs\n"),
    onDefault: [SHA_A],
  });
  const { commits, defaultRef } = await readRepoCommits("/repo", { exec });
  assert.equal(defaultRef, "refs/remotes/origin/main");
  assert.deepEqual(commits.map((c) => c.onDefaultBranch), [true, false]);
});

test("ingestRepo writes one event per commit and is idempotent on re-run", async () => {
  const dir = await vault();
  const exec = execFor({ log: record(SHA_A, "1\t0\ta.mjs\n"), onDefault: [SHA_A] });
  const first = await ingestRepo("/repos/kizuki", dir, { exec, lock: noLock });
  assert.deepEqual(
    { scanned: first.scanned, appended: first.appended, skipped: first.skipped },
    { scanned: 1, appended: 1, skipped: 0 },
  );

  const second = await ingestRepo("/repos/kizuki", dir, { exec, lock: noLock });
  assert.deepEqual(
    { appended: second.appended, skipped: second.skipped },
    { appended: 0, skipped: 1 },
  );

  const events = await readActivityEvents(dir);
  assert.equal(events.length, 1);
  assert.equal(events[0].repo, "kizuki");
  assert.equal(events[0].onDefaultBranch, true);
});

test("ingestRepo leaves the ledger byte-identical when nothing is new", async () => {
  const dir = await vault();
  const exec = execFor({ log: record(SHA_A, "1\t0\ta.mjs\n"), onDefault: [SHA_A] });
  await ingestRepo("/repos/kizuki", dir, { exec, lock: noLock });
  const before = await readFile(join(dir, "activity", "events.jsonl"), "utf8");
  await ingestRepo("/repos/kizuki", dir, { exec, lock: noLock });
  const after = await readFile(join(dir, "activity", "events.jsonl"), "utf8");
  assert.equal(after, before);
});

test("ingestRepo keeps same-sha commits from different repos apart", async () => {
  const dir = await vault();
  const exec = execFor({ log: record(SHA_A, "1\t0\ta.mjs\n"), onDefault: [SHA_A] });
  await ingestRepo("/repos/kizuki", dir, { exec, lock: noLock });
  await ingestRepo("/repos/ringi", dir, { exec, lock: noLock });
  const events = await readActivityEvents(dir);
  assert.deepEqual(events.map((e) => e.repo), ["kizuki", "ringi"]);
  assert.notEqual(events[0].commitId, events[1].commitId);
});

test("runIngestCommand ingests every path given, including the first", async () => {
  const dir = await vault();
  const exec = execFor({ log: record(SHA_A, "1\t0\ta.mjs\n"), onDefault: [SHA_A] });
  const results = await runIngestCommand(
    ["git", "/repos/kizuki", "/repos/ringi", "/repos/harbor"],
    dir,
    { exec, lock: noLock },
  );
  assert.deepEqual(results.map((r) => r.repo), ["kizuki", "ringi", "harbor"]);
});

test("runIngestCommand does not mistake a --ref-scope value for a repo path", async () => {
  const dir = await vault();
  const exec = execFor({ log: record(SHA_A, "1\t0\ta.mjs\n"), onDefault: [SHA_A] });
  const results = await runIngestCommand(
    ["git", "--ref-scope", "default", "/repos/kizuki"],
    dir,
    { exec, lock: noLock },
  );
  assert.deepEqual(results.map((r) => r.repo), ["kizuki"]);
});

test("runIngestCommand rejects an unknown source and an unknown ref scope", async () => {
  const dir = await vault();
  await assert.rejects(() => runIngestCommand(["svn", "/repos/x"], dir), /usage: kizuki ingest git/);
  await assert.rejects(() => runIngestCommand(["git"], dir), /usage: kizuki ingest git/);
  await assert.rejects(
    () => runIngestCommand(["git", "--ref-scope", "sideways", "/repos/x"], dir),
    /usage: kizuki ingest git/,
  );
});

test("ingesting a repo whose HEAD is an orphan still records the default-branch history", async () => {
  const dir = await vault();
  const exec = execFor({
    log: record(SHA_A, "1\t0\ta.mjs\n", { parents: "" }) + record(SHA_B, "2\t0\tb.mjs\n"),
    onDefault: [SHA_B],
  });
  const result = await ingestRepo("/repos/harbor", dir, { exec, lock: noLock });
  assert.equal(result.scanned, 2);
  assert.equal(result.onDefault, 1);
});

test("formatIngestResults names the default ref and totals the appended rows", () => {
  const text = formatIngestResults([
    { repo: "kizuki", defaultRef: "refs/remotes/origin/main", scanned: 449, onDefault: 228, appended: 449, skipped: 0 },
    { repo: "harbor", defaultRef: null, scanned: 1, onDefault: 0, appended: 1, skipped: 0 },
  ]);
  assert.match(text, /kizuki: scanned 449 \(228 on refs\/remotes\/origin\/main\)/);
  assert.match(text, /harbor: scanned 1 \(0 on no default ref\)/);
  assert.match(text, /total appended 450 across 2 repo\(s\)/);
});

test("ingestRepo surfaces a corrupt ledger rather than appending past it", async () => {
  const dir = await vault();
  const exec = execFor({ log: record(SHA_A, "1\t0\ta.mjs\n"), onDefault: [SHA_A] });
  await ingestRepo("/repos/kizuki", dir, { exec, lock: noLock });
  await writeFile(join(dir, "activity", "events.jsonl"), "{not json}\n", "utf8");
  await assert.rejects(
    () => ingestRepo("/repos/kizuki", dir, { exec, lock: noLock }),
    /malformed JSON/,
  );
});
