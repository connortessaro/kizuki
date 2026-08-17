import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, utimes, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readShift,
  startShift,
  endShift,
  readLastStop,
  recordStop,
  renderBrief,
  renderDaySummary,
  writeDaySummary,
  buildDaySummaryPrompt,
} from "./shift.mjs";
import { runCatchCommand } from "./catchCommands.mjs";

test("shift flag lifecycle", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-s-"));
  assert.equal(await readShift(dir), null);
  await startShift(dir, new Date("2026-07-06T09:00:00Z"));
  assert.deepEqual(await readShift(dir), { started: "2026-07-06T09:00:00.000Z" });
  await endShift(dir);
  assert.equal(await readShift(dir), null);
  await endShift(dir); // idempotent — no throw
});

test("last-stop record lifecycle", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-s-"));
  assert.equal(await readLastStop(dir), null);
  await recordStop(dir, new Date("2026-07-06T17:00:00Z"));
  assert.deepEqual(await readLastStop(dir), { stopped: "2026-07-06T17:00:00.000Z" });
});

const ENTITY = `---
type: person
name: maya
---

# maya

## Log

<!-- KIZUKI:ANALYSIS:START -->
**Status:** busy
**Follow-ups:**
- chase creds
<!-- KIZUKI:ANALYSIS:END -->
`;

async function seedEntity(dir, rel, content, mtime) {
  await mkdir(join(dir, rel, ".."), { recursive: true });
  await writeFile(join(dir, rel), content, "utf8");
  if (mtime) await utimes(join(dir, rel), mtime, mtime);
}

test("renderBrief without baseline lists all entities and follow-ups", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-b-"));
  await seedEntity(dir, "people/maya.md", ENTITY);
  const brief = await renderBrief(dir, new Date("2026-07-06T09:00:00Z"));
  assert.match(brief, /# Kizuki brief — July 6, 2026/);
  assert.match(brief, /## Changed since last shift/);
  assert.match(brief, /## Alerts today/);
  assert.match(brief, /\(none\)/);
  assert.match(brief, /- person\/maya/);
  assert.match(brief, /## Priority actions/);
  assert.match(brief, /- person\/maya: \[follow-up\] chase creds/);
});

test("renderBrief with baseline only lists entities modified after last stop", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-b-"));
  await seedEntity(dir, "people/old.md", ENTITY.replaceAll("maya", "old"), new Date("2026-07-01T00:00:00Z"));
  await seedEntity(dir, "people/fresh.md", ENTITY.replaceAll("maya", "fresh"), new Date("2026-07-06T08:00:00Z"));
  await recordStop(dir, new Date("2026-07-05T17:00:00Z"));
  const brief = await renderBrief(dir, new Date("2026-07-06T09:00:00Z"));
  const [changedSection] = brief.split("## Priority actions");
  assert.doesNotMatch(changedSection, /- person\/old/);
  assert.match(brief, /- person\/fresh/);
});

const LOGGED = `---
type: project
name: checkout
---

# checkout

## Log

- **transcript** 2026-07-06T09:32:00: scope cut announced
- **transcript** 2026-07-01T09:00:00: old entry

<!-- KIZUKI:ANALYSIS:START -->
**Status:** at risk
**Follow-ups:**
- tell mobile
<!-- KIZUKI:ANALYSIS:END -->
`;

test("renderBrief shows today's alerts and caps priority actions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-b-"));
  await mkdir(join(dir, "alerts"), { recursive: true });
  await writeFile(
    join(dir, "alerts", "2026-07-06.md"),
    "- **[warn] contradiction** project/staff: UAT dates disagree\n",
    "utf8",
  );
  const manyFollowups = `---
type: person
name: p
---
# p
## Log
<!-- KIZUKI:ANALYSIS:START -->
**Follow-ups:**
- one
- two
- three
- four
**Recommended actions:**
- act-a
- act-b
<!-- KIZUKI:ANALYSIS:END -->
`;
  await seedEntity(dir, "people/p.md", manyFollowups);
  const brief = await renderBrief(dir, new Date("2026-07-06T09:00:00Z"));
  assert.match(brief, /\[warn\] contradiction/);
  assert.match(brief, /more in vault/);
  assert.doesNotMatch(brief, /\[follow-up\] four/);
});

test("renderBrief caps today's alerts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-b-"));
  await mkdir(join(dir, "alerts"), { recursive: true });
  await writeFile(
    join(dir, "alerts", "2026-07-06.md"),
    [
      "- **[warn] blocker** project/one: one",
      "- **[warn] blocker** project/two: two",
      "- **[warn] blocker** project/three: three",
      "- **[warn] blocker** project/four: four",
      "- **[warn] blocker** project/five: five",
      "- **[warn] blocker** project/six: six",
      "",
    ].join("\n"),
    "utf8",
  );

  const brief = await renderBrief(dir, new Date("2026-07-06T09:00:00Z"));

  assert.match(brief, /project\/one: one/);
  assert.match(brief, /project\/five: five/);
  assert.doesNotMatch(brief, /project\/six: six/);
  assert.match(brief, /1 more alert today/);
});

test("renderDaySummary includes only that day's log lines plus open follow-ups", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-d-"));
  await seedEntity(dir, "projects/checkout.md", LOGGED);
  const md = await renderDaySummary(dir, "2026-07-06");
  assert.match(md, /# July 6, 2026 — day summary/);
  assert.match(md, /### project\/checkout/);
  assert.match(md, /scope cut announced/);
  assert.doesNotMatch(md, /old entry/);
  assert.match(md, /## Open follow-ups/);
  assert.match(md, /- project\/checkout: tell mobile/);
});

test("writeDaySummary writes days/YYYY-MM-DD.md and returns the path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-d-"));
  await seedEntity(dir, "projects/checkout.md", LOGGED);
  const path = await writeDaySummary(dir, new Date("2026-07-06T17:00:00Z"));
  assert.equal(path, join(dir, "days", "2026-07-06.md"));
  assert.match(await readFile(path, "utf8"), /day summary/);
});

test("writeDaySummary without runAgent is facts-only (unchanged output)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-d-"));
  await seedEntity(dir, "projects/checkout.md", LOGGED);
  const now = new Date("2026-07-06T17:00:00Z");
  const path = await writeDaySummary(dir, now);
  const expected = await renderDaySummary(dir, "2026-07-06");
  assert.equal(await readFile(path, "utf8"), expected);
});

test("writeDaySummary prepends prose Summary when runAgent returns text", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-d-"));
  await seedEntity(dir, "projects/checkout.md", LOGGED);
  let seenPrompt = "";
  const runAgent = async (p) => {
    seenPrompt = p;
    return "Checkout scope shifted.\n\nTomorrow: chase mobile, confirm creds.";
  };
  const now = new Date("2026-07-06T17:00:00Z");
  const path = await writeDaySummary(dir, { now, runAgent });
  const md = await readFile(path, "utf8");
  assert.match(md, /## Summary\n\nCheckout scope shifted\./);
  assert.match(md, /Tomorrow: chase mobile/);
  const summaryIdx = md.indexOf("## Summary");
  const activityIdx = md.indexOf("## Activity");
  assert.ok(summaryIdx >= 0 && summaryIdx < activityIdx, "prose above facts");
  assert.match(seenPrompt, /scope cut announced/);
});

test("writeDaySummary falls back to facts-only and warns when runAgent throws", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-d-"));
  await seedEntity(dir, "projects/checkout.md", LOGGED);
  const now = new Date("2026-07-06T17:00:00Z");
  const runAgent = async () => {
    throw new Error("boom");
  };
  const errs = [];
  const orig = console.error;
  console.error = (m) => errs.push(m);
  let md;
  try {
    const path = await writeDaySummary(dir, { now, runAgent });
    md = await readFile(path, "utf8");
  } finally {
    console.error = orig;
  }
  assert.doesNotMatch(md, /## Summary/);
  assert.equal(md, await renderDaySummary(dir, "2026-07-06"));
  assert.ok(errs.some((m) => /prose generation failed.*boom/.test(m)), "warned");
});

test("writeDaySummary skips agent on a day with no logged activity", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-d-"));
  await seedEntity(dir, "projects/checkout.md", LOGGED);
  const now = new Date("2026-07-08T17:00:00Z"); // no LOGGED lines for the 8th
  let called = false;
  const runAgent = async () => {
    called = true;
    return "should not run";
  };
  const path = await writeDaySummary(dir, { now, runAgent });
  const md = await readFile(path, "utf8");
  assert.equal(called, false);
  assert.doesNotMatch(md, /## Summary/);
});

test("buildDaySummaryPrompt embeds the facts and requests prose only", () => {
  const facts = "# July 6, 2026 — day summary\n## Activity\n### project/checkout\n- **X**";
  const prompt = buildDaySummaryPrompt(facts);
  assert.match(prompt, /project\/checkout/);
  assert.match(prompt, /Tomorrow:/);
  assert.match(prompt, /prose/i);
});

test("brief ends with the gate week line", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-shift-gate-"));
  const empty = await renderBrief(vault, new Date(2026, 6, 15, 12));
  assert.match(empty, /Gate week so far: no catches recorded — log with 'kizuki catch'\.\n$/);
  await runCatchCommand(vault, ["caught one"], { now: new Date(2026, 6, 14, 9) });
  const brief = await renderBrief(vault, new Date(2026, 6, 15, 12));
  assert.match(brief, /Gate week so far: 1 catch, 0 acted signals\.\n$/);
});

test("day summary includes a Gate section", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-shift-gate-"));
  await runCatchCommand(vault, ["caught one"], { now: new Date(2026, 6, 14, 9) });
  const facts = await renderDaySummary(vault, "2026-07-14");
  assert.match(facts, /## Gate\nGate week so far: 1 catch, 0 acted signals\./);
});
