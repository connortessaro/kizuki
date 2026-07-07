#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { cp, mkdir, readdir } from "node:fs/promises";
import { homedir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(repoRoot, "codex", "prompts");
const dest = join(homedir(), ".codex", "prompts");

const files = await readdir(src);
await mkdir(dest, { recursive: true });
for (const f of files) {
  if (!f.endsWith(".md")) continue;
  await cp(join(src, f), join(dest, f), { force: true });
  console.log(`installed ${f} -> ${join(dest, f)}`);
}
console.log("\nUse in Codex: /prompts:kizuki-start (name matches filename without .md)");
