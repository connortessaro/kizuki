#!/usr/bin/env node
import { isAbsolute } from "node:path";
import { readDaemonConfig } from "../lib/daemonConfig.mjs";
import { listenApiServer } from "./api.mjs";

function parseArgs(argv) {
  if (argv.length !== 2 || argv[0] !== "--vault") {
    throw new Error("usage: server/cli.mjs --vault <absolute path>");
  }
  const vaultDir = argv[1];
  if (!isAbsolute(vaultDir)) {
    throw new Error("--vault must be an absolute path");
  }
  return { vaultDir };
}

async function main() {
  const { vaultDir } = parseArgs(process.argv.slice(2));
  const config = await readDaemonConfig(vaultDir);
  const running = await listenApiServer({ vaultDir, host: config.host, port: config.port, token: config.token });
  console.log(`kizuki daemon listening on ${running.url}`);

  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    await running.close();
    process.exit(0);
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
