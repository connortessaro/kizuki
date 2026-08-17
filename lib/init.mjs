import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { REQUIRED_DIRS } from "./doctor.mjs";
import { AGENT_PRESETS, DEFAULT_TIMEOUT_MS } from "./agent.mjs";
import { ensureDaemonConfig as defaultEnsureDaemonConfig } from "./daemonConfig.mjs";

const exists = (p) => access(p).then(() => true, () => false);

const INIT_DIRS = [...REQUIRED_DIRS, "alerts", "days", "state", "events"];

export function configTemplateFor(agent = "codex") {
  if (agent === "http") {
    return {
      agentHttp: { baseUrl: "https://api.openai.com/v1", model: "gpt-5.4", apiKeyEnv: "OPENAI_API_KEY" },
      timeoutMs: DEFAULT_TIMEOUT_MS,
    };
  }
  const cmd = AGENT_PRESETS[agent];
  if (!cmd) {
    throw new Error(`unknown agent preset ${JSON.stringify(agent)} (valid: ${[...Object.keys(AGENT_PRESETS), "http"].join(", ")})`);
  }
  return { agentCmd: cmd, timeoutMs: DEFAULT_TIMEOUT_MS };
}

export const CONFIG_TEMPLATE = configTemplateFor();

export async function runInit(vaultDir, {
  forceConfig = false,
  agent,
  ensureDaemonConfig = defaultEnsureDaemonConfig,
} = {}) {
  const created = [];
  for (const d of INIT_DIRS) {
    const p = join(vaultDir, d);
    if (!(await exists(p))) {
      await mkdir(p, { recursive: true });
      created.push(d);
    }
  }
  const configPath = join(vaultDir, "kizuki.config.json");
  let configWritten = false;
  if (forceConfig || !(await exists(configPath))) {
    await writeFile(configPath, JSON.stringify(configTemplateFor(agent), null, 2) + "\n", "utf8");
    configWritten = true;
  }
  await ensureDaemonConfig(vaultDir);
  return { created, configPath, configWritten, vaultDir };
}

export function formatInitReport({ created, configPath, configWritten, vaultDir, mcpServerPath }) {
  const lines = [
    "Kizuki initialized.",
    created.length ? `Created: ${created.join(", ")}` : "Vault directories already present.",
    configWritten ? `Wrote ${configPath}` : `Config unchanged: ${configPath}`,
    "",
    "Next steps:",
    "  1. ./kizuki doctor",
    "  2. Configure your agent MCP servers (Slack, GitHub, Atlassian, Outlook)",
    "  3. ./kizuki sync --dry-run",
    "  4. ./kizuki start",
    "",
    "Local daemon (private loopback API for capture):",
    "  ./kizuki daemon install    # install + start the background service",
    "  ./kizuki daemon status     # confirm it is listening",
    '  ./kizuki capture "<note>"  # record a private local capture',
    "",
    "MCP server (optional):",
    `  node ${mcpServerPath}`,
    `  env: KIZUKI_VAULT=${vaultDir}`,
    "",
    "Codex ritual prompts:",
    "  node scripts/install-codex-prompts.mjs",
  ];
  return lines.join("\n");
}
