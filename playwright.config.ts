import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

// One empty data folder per run, shared with the workers through the environment.
process.env.KIZUKI_E2E_HOME ??= mkdtempSync(join(tmpdir(), "kizuki-e2e-"));
const home = process.env.KIZUKI_E2E_HOME;
const model = "http://127.0.0.1:4872/v1";
writeFileSync(
  join(home, "settings.json"),
  JSON.stringify({ chat: { baseURL: model, model: "fake-chat", reasoning: "none", replyShape: "server" }, embed: { baseURL: model, model: "fake-embed" } }),
);

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://127.0.0.1:4871", trace: "retain-on-failure" },
  webServer: [
    { command: "node e2e/fake-model.mjs", url: `${model}/models`, reuseExistingServer: false },
    {
      command: "npx next start -H 127.0.0.1 -p 4871",
      url: "http://127.0.0.1:4871/courses",
      reuseExistingServer: false,
      env: { KIZUKI_HOME: home, WORKFLOW_TARGET_WORLD: "local", WORKFLOW_LOCAL_DATA_DIR: join(home, "workflow-data"), PORT: "4871" },
    },
  ],
});
