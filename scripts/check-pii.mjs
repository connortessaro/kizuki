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
const authors = execFileSync("git", ["log", "--all", "--format=%ae%x09%an"], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);
const authorHits = [...new Set(authors.filter((a) => /chewy|northeastern/i.test(a)))];

if (hits.length === 0 && authorHits.length === 0) {
  console.log(`no personal identifiers in ${files.length} tracked files or any commit author`);
  process.exit(0);
}

for (const h of hits) console.error(`${h.file}:${h.line}: ${h.name}`);
for (const a of authorHits) {
  console.error(`commit author metadata still carries: ${a.split("\t")[1]}`);
}
console.error(`\n${hits.length + authorHits.length} problem(s) found`);
process.exit(1);
