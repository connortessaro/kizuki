import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatAlertLine } from "./alerts.mjs";
import { alertTrends } from "./trends.mjs";

const FIXED = new Date("2026-07-07T15:00:00Z");
const sample = {
  severity: "warn",
  kind: "blocker",
  type: "project",
  name: "staff",
  evidence: "UAT date mismatch",
};

async function writeAlert(dir, date, alert) {
  await mkdir(join(dir, "alerts"), { recursive: true });
  await writeFile(join(dir, "alerts", `${date}.md`), `${formatAlertLine(alert)}\n`, "utf8");
}

test("alertTrends finds recurring alerts across days", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-trends-"));
  try {
    await writeAlert(dir, "2026-07-05", sample);
    await writeAlert(dir, "2026-07-06", sample);
    await writeAlert(dir, "2026-07-07", sample);
    const trends = await alertTrends(dir, { days: 7, now: FIXED });
    assert.equal(trends.length, 1);
    assert.equal(trends[0].name, "staff");
    assert.equal(trends[0].days.length, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("alertTrends ignores one-day alerts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-trends-"));
  try {
    await writeAlert(dir, "2026-07-07", sample);
    const trends = await alertTrends(dir, { days: 7, now: FIXED });
    assert.equal(trends.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
