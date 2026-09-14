#!/usr/bin/env node
// Measures the two obvious ways to read commit history out of a repo.
//
// The naive shape is one `git show` per commit, which is what you write first
// because it mirrors how you think about the problem: for each commit, get its
// files. The shipped shape is a single `git log --numstat` per repo, parsed as
// a stream of records.
//
// Run: node scripts/benchmark-ingest.mjs [repo-path...] [--runs n]

import { execFile } from "node:child_process";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";
import { parseGitLog } from "../lib/gitIngest.mjs";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 1 << 28;
const FORMAT = "%x00%H%x1f%aI%x1f%cI%x1f%an%x1f%ae%x1f%P%x1f%s";

async function shas(dir) {
  const { stdout } = await execFileAsync("git", ["-C", dir, "rev-list", "--all"], {
    maxBuffer: MAX_BUFFER,
    encoding: "utf8",
  });
  return stdout.split("\n").filter(Boolean);
}

// One subprocess per commit.
async function perCommit(dir) {
  const list = await shas(dir);
  let files = 0;
  for (const sha of list) {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", dir, "show", "--numstat", "--format=" + FORMAT, sha],
      { maxBuffer: MAX_BUFFER, encoding: "utf8" },
    );
    files += parseGitLog(stdout, "bench").reduce((sum, c) => sum + c.files.length, 0);
  }
  return { commits: list.length, files, spawns: list.length + 1 };
}

// One subprocess for the whole repo.
async function batched(dir) {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", dir, "log", "--all", "--numstat", "--format=" + FORMAT],
    { maxBuffer: MAX_BUFFER, encoding: "utf8" },
  );
  const commits = parseGitLog(stdout, "bench");
  return {
    commits: commits.length,
    files: commits.reduce((sum, c) => sum + c.files.length, 0),
    spawns: 1,
  };
}

async function time(fn, dir) {
  const started = process.hrtime.bigint();
  const result = await fn(dir);
  return { ...result, ms: Number(process.hrtime.bigint() - started) / 1e6 };
}

const args = process.argv.slice(2);
const runsAt = args.indexOf("--runs");
const runs = runsAt === -1 ? 3 : Number.parseInt(args[runsAt + 1], 10);
const paths = args.filter((a, i) => !a.startsWith("--") && i !== runsAt + 1);
if (paths.length === 0) {
  console.error("usage: node scripts/benchmark-ingest.mjs <repo-path>... [--runs n]");
  process.exit(1);
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

console.log(`runs per strategy: ${runs}\n`);
console.log(
  ["repo", "commits", "files", "per-commit ms", "batched ms", "speedup", "spawns saved"]
    .map((h, i) => (i === 0 ? h.padEnd(24) : h.padStart(14)))
    .join(""),
);

let totalNaive = 0;
let totalBatched = 0;
for (const path of paths) {
  const dir = resolve(path);
  const naiveRuns = [];
  const batchRuns = [];
  let shape = null;
  for (let i = 0; i < runs; i++) {
    const n = await time(perCommit, dir);
    const b = await time(batched, dir);
    naiveRuns.push(n.ms);
    batchRuns.push(b.ms);
    shape = { naive: n, batch: b };
  }
  if (shape.naive.commits !== shape.batch.commits) {
    throw new Error(
      `strategies disagree for ${basename(dir)}: ${shape.naive.commits} vs ${shape.batch.commits} commits`,
    );
  }
  const n = median(naiveRuns);
  const b = median(batchRuns);
  totalNaive += n;
  totalBatched += b;
  console.log(
    basename(dir).padEnd(24) +
      String(shape.batch.commits).padStart(14) +
      String(shape.batch.files).padStart(14) +
      n.toFixed(0).padStart(14) +
      b.toFixed(0).padStart(14) +
      (n / b).toFixed(1).concat("x").padStart(14) +
      String(shape.naive.spawns - shape.batch.spawns).padStart(14),
  );
}

console.log(
  "\n" +
    "TOTAL".padEnd(24) +
    "".padStart(28) +
    totalNaive.toFixed(0).padStart(14) +
    totalBatched.toFixed(0).padStart(14) +
    (totalNaive / totalBatched).toFixed(1).concat("x").padStart(14),
);
