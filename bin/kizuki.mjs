#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkModels, DEFAULT_MODELS, openCommand, packageDir, parseArgs, readSettingsFile, resolveHome, restoreLinks, waitForServer } from "./cli.mjs";

const HELP = `Kizuki: a study tool that runs on your computer.

Usage: kizuki [--port 3700] [--home ~/.kizuki] [--no-open]

  --port     the port for the dashboard (default 3700)
  --home     the folder for your data (default ~/.kizuki, or KIZUKI_HOME)
  --no-open  do not open the browser

Kizuki needs Ollama with two models:
  ollama pull ${DEFAULT_MODELS.chat.model}
  ollama pull ${DEFAULT_MODELS.embed.model}`;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`kizuki: ${error.message}`);
    process.exit(2);
  }
  if (args.help) {
    console.log(HELP);
    return;
  }

  const home = resolveHome(args.home);
  mkdirSync(home, { recursive: true });
  const settings = readSettingsFile(join(home, "settings.json"));

  console.log(`Kizuki data folder: ${home}`);
  const problems = await checkModels(settings);
  if (problems.length) {
    console.log("\nKizuki can't use its models yet:");
    for (const p of problems) console.log(`  - ${p}`);
    console.log("The dashboard will start anyway and show the same message until this is fixed.\n");
  } else {
    console.log(`Models ready: ${settings.chat.model} and ${settings.embed.model}`);
  }

  const require = createRequire(import.meta.url);
  const nextBin = require.resolve("next/dist/bin/next");
  if (!existsSync(join(root, ".next", "BUILD_ID"))) {
    console.log("Building Kizuki for the first time. This takes a minute…");
    const built = spawnSync(process.execPath, [nextBin, "build"], { cwd: root, stdio: "inherit" });
    if (built.status !== 0) process.exit(built.status ?? 1);
  }

  restoreLinks(root, (pkg) => packageDir(pkg, root));

  const env = { ...process.env, KIZUKI_HOME: home, WORKFLOW_TARGET_WORLD: "local", WORKFLOW_LOCAL_DATA_DIR: join(home, "workflow-data"), PORT: String(args.port) };
  const server = spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", String(args.port)], { cwd: root, env, stdio: ["ignore", "inherit", "inherit"] });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
  server.on("exit", (code) => process.exit(code ?? 0));

  const url = `http://127.0.0.1:${args.port}`;
  if (!(await waitForServer(url))) {
    console.error(`\nKizuki started but ${url} has not answered after a minute. Check the messages above, or try another port with --port.`);
  } else {
    console.log(`\nKizuki is running at ${url}  (press Ctrl+C to stop)`);
  }
  if (args.open) {
    const [cmd, cmdArgs] = openCommand(url);
    spawn(cmd, cmdArgs, { stdio: "ignore", detached: true }).unref();
  }
}

main().catch((error) => {
  console.error(`kizuki: ${error.message}`);
  process.exit(1);
});
