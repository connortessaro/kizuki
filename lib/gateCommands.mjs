import { computeGateReport, renderGateReport } from "./gate.mjs";
import { readCatchEvents } from "./catches.mjs";
import { readInsightEvents } from "./insights.mjs";
import { readSignalEvents } from "./signals.mjs";

function parseGateArgs(argv) {
  let weeks = 2;
  let json = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--weeks") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error("--weeks requires a value");
      weeks = Number(value);
      index++;
      continue;
    }
    throw new Error("unknown option for gate: " + arg);
  }
  return { weeks, json };
}

async function readGateReport(vaultDir, { now, weeks }) {
  return computeGateReport({
    signalEvents: await readSignalEvents(vaultDir),
    catchEvents: await readCatchEvents(vaultDir),
    insightEvents: await readInsightEvents(vaultDir),
    now,
    weeks,
  });
}

export async function runGateCommand(vaultDir, argv, { now = new Date() } = {}) {
  const { weeks, json } = parseGateArgs(argv);
  const report = await readGateReport(vaultDir, { now, weeks });
  return json ? JSON.stringify(report, null, 2) : renderGateReport(report);
}

export async function gateWeekLine(vaultDir, now = new Date()) {
  const week = (await readGateReport(vaultDir, { now, weeks: 1 })).weeks[0];
  if (week.catches === 0 && week.acted === 0) {
    return "Gate week so far: no catches recorded — log with 'kizuki catch'.";
  }
  const catches = week.catches + (week.catches === 1 ? " catch" : " catches");
  const acted = week.acted + " acted " + (week.acted === 1 ? "signal" : "signals");
  return "Gate week so far: " + catches + ", " + acted + ".";
}
