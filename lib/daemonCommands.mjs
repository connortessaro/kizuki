import {
  ensureDaemonConfig as defaultEnsureDaemonConfig,
  readDaemonConfig as defaultReadDaemonConfig,
} from "./daemonConfig.mjs";
import {
  installDaemon as defaultInstallDaemon,
  uninstallDaemon as defaultUninstallDaemon,
  restartDaemon as defaultRestartDaemon,
  daemonStatus as defaultDaemonStatus,
} from "./daemonService.mjs";
import { listenApiServer as defaultListenApiServer } from "../server/api.mjs";

const DAEMON_COMMANDS = new Set(["install", "uninstall", "restart", "status", "run"]);

function formatStatus(status) {
  if (status.running) return `Kizuki daemon running at ${status.url}`;
  return `Kizuki daemon not running (${status.detail}) — expected at ${status.url}`;
}

export async function runDaemonCommand(vaultDir, repoDir, argv, {
  ensureDaemonConfig = defaultEnsureDaemonConfig,
  readDaemonConfig = defaultReadDaemonConfig,
  install = defaultInstallDaemon,
  uninstall = defaultUninstallDaemon,
  restart = defaultRestartDaemon,
  status = defaultDaemonStatus,
  listen = defaultListenApiServer,
  proc = process,
} = {}) {
  const [subcommand, ...rest] = argv;
  if (!DAEMON_COMMANDS.has(subcommand)) {
    throw new Error(`unknown daemon command: ${subcommand ?? ""}`);
  }
  if (rest.length) throw new Error(`unknown option for daemon ${subcommand}: ${rest[0]}`);

  if (subcommand === "install") {
    await ensureDaemonConfig(vaultDir);
    const result = await install({ vaultDir, repoDir });
    return `Kizuki daemon installed (${result.platform}) at ${result.path}`;
  }

  if (subcommand === "uninstall") {
    const result = await uninstall();
    return `Kizuki daemon uninstalled (${result.platform})`;
  }

  if (subcommand === "restart") {
    const result = await restart();
    return `Kizuki daemon restarted (${result.platform})`;
  }

  if (subcommand === "status") {
    const result = await status({ vaultDir });
    return formatStatus(result);
  }

  const config = await readDaemonConfig(vaultDir);
  const running = await listen({ vaultDir, host: config.host, port: config.port, token: config.token });
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await running.close();
    proc.exit(0);
  };
  proc.on("SIGINT", shutdown);
  proc.on("SIGTERM", shutdown);
  return `Kizuki daemon listening on ${running.url}`;
}
