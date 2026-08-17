import { writeFile, rm, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const LABEL = "com.tessaro.kizuki.sync";
const execFileAsync = promisify(execFile);

export function plistPath(label = LABEL) {
  return join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
}

export function plistContent({ kizukiPath, vaultDir, label = LABEL, intervalSec = 1800 }) {
  const log = join(vaultDir, "state", "sync.log");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${kizukiPath}</string>
    <string>sync</string>
    <string>--loop</string>
  </array>
  <key>WorkingDirectory</key><string>${vaultDir}</string>
  <key>StartInterval</key><integer>${intervalSec}</integer>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>${log}</string>
  <key>StandardErrorPath</key><string>${log}</string>
</dict>
</plist>
`;
}

function assertDarwin(what, platform) {
  if (platform !== "darwin") {
    throw new Error(`${what}: background sync requires macOS launchd`);
  }
}

export async function installJob({
  kizukiPath,
  vaultDir,
  label = LABEL,
  intervalSec = 1800,
  exec = execFileAsync,
  path = plistPath(label),
  platform = process.platform,
}) {
  assertDarwin("kizuki start", platform);
  await mkdir(join(vaultDir, "state"), { recursive: true });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, plistContent({ kizukiPath, vaultDir, label, intervalSec }), "utf8");
  await exec("launchctl", ["load", path]);
  return path;
}

export async function removeJob({
  label = LABEL,
  exec = execFileAsync,
  path = plistPath(label),
  platform = process.platform,
}) {
  assertDarwin("kizuki stop", platform);
  await exec("launchctl", ["unload", path]);
  await rm(path, { force: true });
}
