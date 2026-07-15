#!/usr/bin/env node
import { execSync } from "node:child_process";
import { rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const out = process.argv[2] ?? join(homedir(), "src", "kizuki-public");
const repo = new URL("..", import.meta.url).pathname;

const PRIVATE_PATHS = [
  "scripts/export-public.mjs",
  "docs/concierge", "docs/launch",
  "docs/2026-07-07-jarvis-presence-ideation.md",
  "docs/2026-07-14-kizuki-direction-notes.md",
  "docs/BACKLOG.md", "docs/ROADMAP.md", "docs/future-notes.md",
  "docs/vision.md", "docs/PRODUCT.md",
  "docs/superpowers/specs/2026-07-13-kizuki-pricing-waitlist-design.md",
  "docs/superpowers/specs/2026-07-14-kizuki-release-monetization-design.md",
  "docs/superpowers/specs/2026-07-13-kizuki-landing-page-design.md",
  "docs/superpowers/specs/2026-07-10-kizuki-builder-vision-docs-design.md",
  "docs/superpowers/plans/2026-07-13-kizuki-pricing-waitlist.md",
  "docs/superpowers/plans/2026-07-14-kizuki-lane1-oss-release.md",
  "docs/superpowers/plans/2026-07-13-kizuki-landing-page.md",
  "docs/superpowers/plans/2026-07-10-kizuki-builder-vision-docs.md",
];

const DANGLING_REF_FIX = {
  "CLAUDE.md": [[/^Roadmap \(v2–v4\).*\n/m, ""]],
  "AGENTS.md": [[/^Roadmap \(v2–v4\).*\n/m, ""]],
};

rmSync(out, { recursive: true, force: true });
execSync(`mkdir -p '${out}' && git -C '${repo}' archive HEAD | tar -x -C '${out}'`, { shell: "/bin/bash" });
for (const p of PRIVATE_PATHS) rmSync(join(out, p), { recursive: true, force: true });
for (const [file, subs] of Object.entries(DANGLING_REF_FIX)) {
  const path = join(out, file);
  if (!existsSync(path)) continue;
  let text = readFileSync(path, "utf8");
  for (const [re, repl] of subs) text = text.replace(re, repl);
  writeFileSync(path, text);
}
const leaks = execSync(
  `grep -rliE 'chewy|tessaro\\.c@|northeastern|connorex2' '${out}' --exclude-dir=node_modules || true`,
  { shell: "/bin/bash" }
).toString().trim();
if (leaks) { console.error("LEAK CHECK FAILED:\n" + leaks); process.exit(1); }
console.log("export clean:", out);
