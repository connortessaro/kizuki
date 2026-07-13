import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gateWeekLine, runGateCommand } from "./gateCommands.mjs";
import { runCatchCommand } from "./catchCommands.mjs";

const NOW = new Date(2026, 6, 15, 12);
const IN_WEEK = new Date(2026, 6, 14, 9);

test("gate reads the ledgers and renders the report", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-gatecmd-"));
  await runCatchCommand(vault, ["caught something"], { now: IN_WEEK });
  const text = await runGateCommand(vault, [], { now: NOW });
  assert.match(text, /Kizuki gate report/);
  assert.match(text, /true catches: 1/);
  const parsed = JSON.parse(await runGateCommand(vault, ["--json"], { now: NOW }));
  assert.equal(parsed.weeks.length, 2);
  assert.equal(parsed.weeks[0].catches, 1);
});

test("gate honors --weeks and rejects bad argv", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-gatecmd-"));
  const parsed = JSON.parse(await runGateCommand(vault, ["--weeks", "4", "--json"], { now: NOW }));
  assert.equal(parsed.weeks.length, 4);
  await assert.rejects(runGateCommand(vault, ["--weeks"], { now: NOW }), /--weeks requires a value/);
  await assert.rejects(runGateCommand(vault, ["--weeks", "abc"], { now: NOW }), /between 1 and 12/);
  await assert.rejects(runGateCommand(vault, ["--nope"], { now: NOW }), /unknown option for gate/);
});

test("gateWeekLine summarizes the current week and prompts when empty", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-gatecmd-"));
  assert.equal(
    await gateWeekLine(vault, NOW),
    "Gate week so far: no catches recorded — log with 'kizuki catch'.",
  );
  await runCatchCommand(vault, ["one"], { now: IN_WEEK });
  assert.equal(await gateWeekLine(vault, NOW), "Gate week so far: 1 catch, 0 acted signals.");
});
