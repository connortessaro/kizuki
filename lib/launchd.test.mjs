import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LABEL, plistContent, plistPath, installJob, removeJob } from "./launchd.mjs";

test("plistContent wires kizuki sync --loop on a 30-min interval", () => {
  const xml = plistContent({ kizukiPath: "/repo/kizuki", vaultDir: "/repo" });
  assert.match(xml, /<string>com\.tessaro\.kizuki\.sync<\/string>/);
  assert.match(xml, /<string>\/repo\/kizuki<\/string>/);
  assert.match(xml, /<string>sync<\/string>\s*<string>--loop<\/string>/);
  assert.match(xml, /<integer>1800<\/integer>/);
  assert.match(xml, /<string>\/repo\/state\/sync\.log<\/string>/);
});

test("plistPath points into ~/Library/LaunchAgents", () => {
  assert.match(plistPath(), /Library\/LaunchAgents\/com\.tessaro\.kizuki\.sync\.plist$/);
});

test("installJob writes the plist and loads it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-l-"));
  const calls = [];
  const fakeExec = async (file, args) => calls.push([file, ...args]);
  const path = join(dir, `${LABEL}.plist`);
  await installJob({ kizukiPath: "/repo/kizuki", vaultDir: dir, exec: fakeExec, path, platform: "darwin" });
  assert.match(await readFile(path, "utf8"), /--loop/);
  assert.deepEqual(calls, [["launchctl", "load", path]]);
});

test("installJob creates parent directory for nested plist path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-l-"));
  const calls = [];
  const fakeExec = async (file, args) => calls.push([file, ...args]);
  const path = join(dir, "LaunchAgents", `${LABEL}.plist`);
  await installJob({ kizukiPath: "/repo/kizuki", vaultDir: dir, exec: fakeExec, path, platform: "darwin" });
  assert.match(await readFile(path, "utf8"), /--loop/);
});

test("removeJob unloads and deletes the plist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-l-"));
  const calls = [];
  const fakeExec = async (file, args) => calls.push([file, ...args]);
  const path = join(dir, `${LABEL}.plist`);
  await installJob({ kizukiPath: "/repo/kizuki", vaultDir: dir, exec: fakeExec, path, platform: "darwin" });
  await removeJob({ exec: fakeExec, path, platform: "darwin" });
  assert.deepEqual(calls[1], ["launchctl", "unload", path]);
  await assert.rejects(() => access(path));
});

test("removeJob surfaces launchctl failure", async () => {
  const failExec = async () => {
    throw new Error("Could not find specified service");
  };
  await assert.rejects(
    () => removeJob({ exec: failExec, path: "/nonexistent.plist", platform: "darwin" }),
    /Could not find specified service/,
  );
});

test("installJob and removeJob reject non-darwin platforms", async () => {
  await assert.rejects(
    () => installJob({ kizukiPath: "/repo/kizuki", vaultDir: "/repo", platform: "linux" }),
    /background sync requires macOS launchd/,
  );
  await assert.rejects(
    () => removeJob({ path: "/x.plist", platform: "linux" }),
    /background sync requires macOS launchd/,
  );
});
