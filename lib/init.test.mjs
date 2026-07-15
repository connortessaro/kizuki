import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit, formatInitReport, CONFIG_TEMPLATE, configTemplateFor } from "./init.mjs";

const makeVault = () => mkdtemp(join(tmpdir(), "kizuki-init-"));
const isDirectory = async (p) => (await stat(p)).isDirectory();

test("runInit creates vault dirs and config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-init-"));
  try {
    const r = await runInit(dir);
    assert.ok(r.created.includes("people"));
    assert.ok(r.created.includes("alerts"));
    assert.ok(r.created.includes("signals"));
    assert.ok(r.created.includes("insights"));
    assert.ok(r.created.includes("events"));
    assert.ok((await stat(join(dir, "signals"))).isDirectory());
    assert.ok((await stat(join(dir, "insights"))).isDirectory());
    assert.equal(r.configWritten, true);
    const config = JSON.parse(await readFile(r.configPath, "utf8"));
    assert.deepEqual(config.agentCmd, CONFIG_TEMPLATE.agentCmd);
    assert.ok((await stat(join(dir, "state", "daemon.json"))).isFile());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("init creates event storage and daemon config", async () => {
  const vaultDir = await makeVault();
  try {
    const result = await runInit(vaultDir, {
      ensureDaemonConfig: async () => ({ host: "127.0.0.1", port: 4247, token: "x".repeat(32) }),
    });
    assert.ok(result.created.includes("events"));
    assert.ok(await isDirectory(join(vaultDir, "events")));
  } finally {
    await rm(vaultDir, { recursive: true, force: true });
  }
});

test("runInit ensures daemon config via the injected dependency", async () => {
  const vaultDir = await makeVault();
  try {
    let calledWith;
    await runInit(vaultDir, {
      ensureDaemonConfig: async (dir) => {
        calledWith = dir;
        return { host: "127.0.0.1", port: 4247, token: "x".repeat(32) };
      },
    });
    assert.equal(calledWith, vaultDir);
  } finally {
    await rm(vaultDir, { recursive: true, force: true });
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
  assert.match(text, /kizuki daemon install/);
  assert.match(text, /kizuki daemon status/);
  assert.match(text, /kizuki capture/);
});
