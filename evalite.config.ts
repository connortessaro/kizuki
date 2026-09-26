import { defineConfig } from "evalite/config";

export default defineConfig({
  testTimeout: 600_000,
  maxConcurrency: 1,
});
