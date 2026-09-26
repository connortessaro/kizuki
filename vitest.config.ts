import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: {
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**", "e2e/**"],
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts", "workflows/**/*.ts", "bin/**/*.mjs", "proxy.ts", "app/**/*.ts"],
      exclude: ["**/*.test.ts", "lib/test-helpers/**"],
      reporter: ["text-summary", "text", "html"],
      reportsDirectory: "coverage",
      // The floor is today's level, rounded down. Raise it as tests are added; never lower it.
      thresholds: { statements: 82, branches: 75, functions: 80, lines: 86 },
    },
  },
});
