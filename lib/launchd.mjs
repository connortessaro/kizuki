import { writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const LABEL = "com.tessaro.vigil.sync";
const execFileAsync = promisify(execFile);

export function plistPath(label = LABEL) {
  return join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
}

export function plistContent({ vigilPath, vaultDir, label = LABEL, intervalSec = 1800 }) {
  const log = join(vaultDir, "state", "sync.log");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${vigilPath}</string>
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

function assertDarwin(what) {
  if (process.platform !== "darwin") {
    throw new Error(`${what}: background sync requires macOS launchd`);
  }
}

export async function installJob({
  vigilPath,
  vaultDir,
  label = LABEL,
  intervalSec = 1800,
  exec = execFileAsync,
  path = plistPath(label),
}) {
  assertDarwin("vigil start");
  await mkdir(join(vaultDir, "state"), { recursive: true });
  await writeFile(path, plistContent({ vigilPath, vaultDir, label, intervalSec }), "utf8");
  await exec("launchctl", ["load", path]);
  return path;
}

export async function removeJob({ label = LABEL, exec = execFileAsync, path = plistPath(label) }) {
  assertDarwin("vigil stop");
  await exec("launchctl", ["unload", path]);
  await rm(path, { force: true });
}
