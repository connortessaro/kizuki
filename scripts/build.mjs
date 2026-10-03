// Bundles the terminal app into dist/kizuki.mjs. Packages stay outside the bundle: npm
// installs them next to it, and native ones (better-sqlite3, sqlite-vec) can't be bundled.
import { build } from "esbuild";

await build({
  entryPoints: ["tui/start.ts"],
  outfile: "dist/kizuki.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  jsx: "automatic",
  logLevel: "warning",
});
