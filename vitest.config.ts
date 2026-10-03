import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules/**", "dist/**", "site/**"],
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts", "tui/**/*.ts", "tui/**/*.tsx", "bin/**/*.mjs"],
      exclude: ["**/*.test.ts", "**/*.test.tsx", "lib/test-helpers/**"],
      reporter: ["text-summary", "text", "html"],
      reportsDirectory: "coverage",
      // The floor is today's level, rounded down. Raise it as tests are added; never lower it.
      thresholds: { statements: 88, branches: 79, functions: 88, lines: 92 },
    },
  },
});
