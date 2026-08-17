import { mkdir as fsMkdir, writeFile as fsWriteFile, rm as fsRm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { readDaemonConfig as defaultReadDaemonConfig } from "./daemonConfig.mjs";

const execFileAsync = promisify(execFile);

export const LAUNCHD_LABEL = "com.kizuki.daemon";
export const SYSTEMD_SERVICE = "kizuki.service";

export function launchdPlistPath(home = homedir()) {
  return join(home, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
}

export function systemdUnitPath(home = homedir()) {
  return join(home, ".config", "systemd", "user", SYSTEMD_SERVICE);
}

export function launchdPlist({ nodePath, serverPath, vaultDir, label = LAUNCHD_LABEL }) {
  const log = join(vaultDir, "state", "daemon.log");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${serverPath}</string>
    <string>--vault</string>
    <string>${vaultDir}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${log}</string>
  <key>StandardErrorPath</key><string>${log}</string>
</dict>
</plist>
`;
}

export function systemdUnit({ nodePath, serverPath, vaultDir }) {
  return `[Unit]
Description=Kizuki local platform daemon
After=network-online.target

[Service]
ExecStart=${nodePath} ${serverPath} --vault ${vaultDir}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;
}

function assertSupportedPlatform(platform) {
  if (platform !== "darwin" && platform !== "linux") {
    throw new Error(`kizuki daemon requires macOS or Linux (got ${platform})`);
  }
}

export async function installDaemon({
  vaultDir,
  repoDir,
  platform = process.platform,
  home = homedir(),
  nodePath = process.execPath,
  label = LAUNCHD_LABEL,
  mkdir = fsMkdir,
  writeFile = fsWriteFile,
  exec = execFileAsync,
} = {}) {
  assertSupportedPlatform(platform);
  if (typeof vaultDir !== "string" || vaultDir === "") throw new Error("installDaemon requires vaultDir");
  if (typeof repoDir !== "string" || repoDir === "") throw new Error("installDaemon requires repoDir");
  const serverPath = join(repoDir, "server", "cli.mjs");

  if (platform === "darwin") {
    const path = launchdPlistPath(home);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, launchdPlist({ nodePath, serverPath, vaultDir, label }), "utf8");
    await exec("launchctl", ["load", path]);
    return { platform, path };
  }

  const path = systemdUnitPath(home);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, systemdUnit({ nodePath, serverPath, vaultDir }), "utf8");
  await exec("systemctl", ["--user", "daemon-reload"]);
  await exec("systemctl", ["--user", "enable", "--now", SYSTEMD_SERVICE]);
  return { platform, path };
}

export async function uninstallDaemon({
  platform = process.platform,
  home = homedir(),
  rm = fsRm,
  exec = execFileAsync,
} = {}) {
  assertSupportedPlatform(platform);
  if (platform === "darwin") {
    const path = launchdPlistPath(home);
    await exec("launchctl", ["unload", path]);
    await rm(path, { force: true });
    return { platform, path };
  }

  const path = systemdUnitPath(home);
  await exec("systemctl", ["--user", "disable", "--now", SYSTEMD_SERVICE]);
  await rm(path, { force: true });
  return { platform, path };
}

export async function restartDaemon({
  platform = process.platform,
  home = homedir(),
  exec = execFileAsync,
} = {}) {
  assertSupportedPlatform(platform);
  if (platform === "darwin") {
    const path = launchdPlistPath(home);
    await exec("launchctl", ["unload", path]);
    await exec("launchctl", ["load", path]);
    return { platform, path };
  }

  await exec("systemctl", ["--user", "restart", SYSTEMD_SERVICE]);
  return { platform, path: systemdUnitPath(home) };
}

function isConnectionRefused(error) {
  return error?.cause?.code === "ECONNREFUSED" || error?.code === "ECONNREFUSED";
}

export async function daemonStatus({
  vaultDir,
  readDaemonConfig = defaultReadDaemonConfig,
  fetchImpl = fetch,
  timeoutMs = 5000,
} = {}) {
  const config = await readDaemonConfig(vaultDir);
  const url = `http://${config.host}:${config.port}`;

  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`health probe timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  let response;
  try {
    response = await Promise.race([
      fetchImpl(`${url}/v1/health`, {
        headers: { authorization: `Bearer ${config.token}` },
        signal: controller.signal,
      }),
      timeout,
    ]);
  } catch (error) {
    if (controller.signal.aborted) {
      return { running: false, url, detail: `health probe timed out after ${timeoutMs}ms` };
    }
    if (isConnectionRefused(error)) return { running: false, url, detail: "connection refused" };
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`daemon health check failed with status ${response.status}`);
  }
  const body = await response.json();
  return { running: true, url, detail: body?.data?.status ?? "ok" };
}
