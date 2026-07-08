import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export default {
  outputFileTracingRoot: repoRoot,
  outputFileTracingIncludes: {
    "/**": ["./demo-vault/**/*"],
  },
  turbopack: { root: repoRoot },
};
