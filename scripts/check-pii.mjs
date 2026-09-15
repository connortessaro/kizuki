#!/usr/bin/env node
// Fails if personal identifiers appear in tracked files.
//
// scripts/export-public.mjs already greps for these, but only inside the copy it
// produces — so the gate could not fail on the repository that is actually
// public. It did not, and a university address sat in two tracked docs.
//
// This runs over `git ls-files`, so it guards the thing people can read.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PATTERNS = [
  { name: "employer address", re: /ctessaro@chewy\.com/i },
  { name: "university address", re: /tessaro\.c@northeastern\.edu/i },
  { name: "personal address", re: /connorex2@gmail\.com/i },
  { name: "employer name", re: /\bchewy\b/i },
];

// This file necessarily contains the patterns it searches for, as does the
// export script whose gate it mirrors.
const SELF = new Set(["scripts/check-pii.mjs", "scripts/export-public.mjs"]);

const TEXT = /\.(md|mjs|js|ts|tsx|jsx|json|ya?ml|toml|txt|css|html|sql|py)$/i;

const files = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split("\n")
  .filter((f) => f && TEXT.test(f) && !SELF.has(f));

const hits = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const [index, line] of text.split("\n").entries()) {
    for (const { name, re } of PATTERNS) {
      if (re.test(line)) hits.push({ file, line: index + 1, name });
    }
  }
}

// Commit author metadata is public too, and no file-level grep can see it.
//
// Only refs that exist on the remote can actually leak. Local-only refs — a
// backup tag kept before a history rewrite, say — are reported separately
// rather than failing the check, so keeping a safety net does not force a
// choice between that and a clean gate.
function refsOnRemote() {
  try {
    const out = execFileSync("git", ["ls-remote", "--heads", "--tags", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const names = out.split("\n").map((l) => l.split("\t")[1]).filter(Boolean);
    return names.filter((r) => !r.endsWith("^{}"));
  } catch {
    return null; // offline or no remote: fall back to scanning everything
  }
}

function authorsFor(revs) {
  if (revs.length === 0) return [];
  return execFileSync("git", ["log", "--format=%ae%x09%an", ...revs], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

const remote = refsOnRemote();
const publicRevs = remote ?? ["--all"];
const authorHits = [...new Set(authorsFor(publicRevs).filter((a) => /chewy|northeastern/i.test(a)))];

const localOnly = remote
  ? [...new Set(
      authorsFor(["--all", ...remote.map((r) => `^${r}`)]).filter((a) =>
        /chewy|northeastern/i.test(a),
      ),
    )]
  : [];

for (const a of localOnly) {
  console.log(`note: a local-only ref carries ${a.split("\t")[1]}; it is not published`);
}

if (hits.length === 0 && authorHits.length === 0) {
  const scope = remote ? `${remote.length} published ref(s)` : "every ref";
  console.log(`no personal identifiers in ${files.length} tracked files or ${scope}`);
  process.exit(0);
}

for (const h of hits) console.error(`${h.file}:${h.line}: ${h.name}`);
for (const a of authorHits) {
  console.error(`a published ref carries ${a.split("\t")[1]} in commit author metadata`);
}
console.error(`\n${hits.length + authorHits.length} problem(s) found`);
process.exit(1);
