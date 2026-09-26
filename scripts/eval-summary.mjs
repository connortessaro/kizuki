#!/usr/bin/env node
// Prints the average of each check in an Evalite results file, plus any case that scored
// below 1 on a check. Usage: node scripts/eval-summary.mjs evals/last-run.json

import { readFileSync } from "node:fs";

const path = process.argv[2] ?? "evals/last-run.json";
const { evals } = JSON.parse(readFileSync(path, "utf8"));

for (const e of evals) {
  const byScorer = new Map();
  for (const r of e.results) {
    for (const s of r.scores) {
      const list = byScorer.get(s.name) ?? [];
      list.push({ score: s.score ?? 0, columns: r.renderedColumns });
      byScorer.set(s.name, list);
    }
  }
  console.log(`\n${e.name} (${e.results.length} cases)`);
  for (const [name, list] of byScorer) {
    const avg = list.reduce((n, x) => n + x.score, 0) / list.length;
    console.log(`  ${(avg * 100).toFixed(0).padStart(3)}%  ${name}`);
    for (const x of list.filter((x) => x.score < 1)) {
      const first = x.columns?.[0];
      console.log(`         below 1 (${x.score.toFixed(2)}): ${first ? `${first.value}` : ""}`);
    }
  }
}
