#!/usr/bin/env node
// Starts the terminal app. The app itself is built into dist/ by `pnpm build`.
import { existsSync } from "node:fs";

const entry = new URL("../dist/kizuki.mjs", import.meta.url);
if (!existsSync(entry)) {
  console.error("kizuki: the app is not built yet. In the repository, run: pnpm build");
  process.exit(1);
}
await import(entry.href);
