import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LABEL, plistContent, plistPath, installJob, removeJob } from "./launchd.mjs";

test("plistContent wires vigil sync --loop on a 30-min interval", () => {
  const xml = plistContent({ vigilPath: "/repo/vigil", vaultDir: "/repo" });
  assert.match(xml, /<string>com\.tessaro\.vigil\.sync<\/string>/);
  assert.match(xml, /<string>\/repo\/vigil<\/string>/);
  assert.match(xml, /<string>sync<\/string>\s*<string>--loop<\/string>/);
  assert.match(xml, /<integer>1800<\/integer>/);
  assert.match(xml, /<string>\/repo\/state\/sync\.log<\/string>/);
});

test("plistPath points into ~/Library/LaunchAgents", () => {
  assert.match(plistPath(), /Library\/LaunchAgents\/com\.tessaro\.vigil\.sync\.plist$/);
});

test("installJob writes the plist and loads it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vigil-l-"));
  const calls = [];
  const fakeExec = async (file, args) => calls.push([file, ...args]);
  const path = join(dir, `${LABEL}.plist`);
  await installJob({ vigilPath: "/repo/vigil", vaultDir: dir, exec: fakeExec, path });
  assert.match(await readFile(path, "utf8"), /--loop/);
  assert.deepEqual(calls, [["launchctl", "load", path]]);
});

test("removeJob unloads and deletes the plist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vigil-l-"));
  const calls = [];
  const fakeExec = async (file, args) => calls.push([file, ...args]);
  const path = join(dir, `${LABEL}.plist`);
  await installJob({ vigilPath: "/repo/vigil", vaultDir: dir, exec: fakeExec, path });
  await removeJob({ exec: fakeExec, path });
  assert.deepEqual(calls[1], ["launchctl", "unload", path]);
  await assert.rejects(() => access(path));
});

test("removeJob surfaces launchctl failure", async () => {
  const failExec = async () => {
    throw new Error("Could not find specified service");
  };
  await assert.rejects(
    () => removeJob({ exec: failExec, path: "/nonexistent.plist" }),
    /Could not find specified service/,
  );
});
