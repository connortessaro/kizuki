import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lookupPath } from "./doctor.mjs";

const tmp = () => mkdtemp(join(tmpdir(), "kizuki-doctor-"));

const stubExe = async (dir, name) => {
  const p = join(dir, name);
  await writeFile(p, "#!/bin/sh\n");
  await chmod(p, 0o755);
  return p;
};

test("lookupPath finds an executable on the provided PATH", async () => {
  const dir = await tmp();
  const bin = await stubExe(dir, "fakeagent");
  assert.equal(await lookupPath("fakeagent", dir), bin);
});

test("lookupPath returns null when not found", async () => {
  const dir = await tmp();
  assert.equal(await lookupPath("no-such-bin", dir), null);
});

test("lookupPath ignores non-executable files", async () => {
  const dir = await tmp();
  await writeFile(join(dir, "plainfile"), "data");
  await chmod(join(dir, "plainfile"), 0o644);
  assert.equal(await lookupPath("plainfile", dir), null);
});

test("lookupPath checks slash-containing names directly, not via PATH", async () => {
  const dir = await tmp();
  const bin = await stubExe(dir, "direct");
  assert.equal(await lookupPath(bin, ""), bin);
  assert.equal(await lookupPath(join(dir, "absent"), ""), null);
});

test("lookupPath scans later PATH entries and skips empty segments", async () => {
  const a = await tmp();
  const b = await tmp();
  const bin = await stubExe(b, "second");
  assert.equal(await lookupPath("second", `${a}::${b}`), bin);
});
