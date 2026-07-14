import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit, formatInitReport, CONFIG_TEMPLATE, configTemplateFor } from "./init.mjs";

test("runInit creates vault dirs and config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-init-"));
  try {
    const r = await runInit(dir);
    assert.ok(r.created.includes("people"));
    assert.ok(r.created.includes("alerts"));
    assert.ok(r.created.includes("signals"));
    assert.ok(r.created.includes("insights"));
    assert.ok((await stat(join(dir, "signals"))).isDirectory());
    assert.ok((await stat(join(dir, "insights"))).isDirectory());
    assert.equal(r.configWritten, true);
    const config = JSON.parse(await readFile(r.configPath, "utf8"));
    assert.deepEqual(config.agentCmd, CONFIG_TEMPLATE.agentCmd);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runInit skips existing config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-init-"));
  try {
    await runInit(dir);
    const second = await runInit(dir);
    assert.equal(second.configWritten, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("configTemplateFor maps presets and http", () => {
  assert.deepEqual(configTemplateFor("gemini").agentCmd, ["gemini", "-p"]);
  assert.deepEqual(configTemplateFor().agentCmd, ["codex", "exec"]);
  const http = configTemplateFor("http");
  assert.equal(http.agentCmd, undefined);
  assert.equal(typeof http.agentHttp.baseUrl, "string");
  assert.equal(http.agentHttp.apiKeyEnv, "OPENAI_API_KEY");
  assert.throws(() => configTemplateFor("vim"), /unknown agent preset "vim" \(valid: codex, claude, gemini, opencode, http\)/);
});

test("runInit honors the agent option", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-init-"));
  await runInit(vault, { agent: "claude" });
  const config = JSON.parse(await readFile(join(vault, "kizuki.config.json"), "utf8"));
  assert.deepEqual(config.agentCmd, ["claude", "-p"]);
});

test("formatInitReport includes next steps", () => {
  const text = formatInitReport({
    created: ["alerts"],
    configPath: "/v/kizuki.config.json",
    configWritten: true,
    vaultDir: "/v",
    mcpServerPath: "/v/mcp/server.mjs",
  });
  assert.match(text, /doctor/);
  assert.match(text, /install-codex-prompts/);
});
