import { formatDate } from "./format.mjs";

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function weekStart(date) {
  const day = startOfDay(date);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function localIso(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return date.getFullYear() + "-" + month + "-" + day;
}

function inWindow(at, start, end) {
  const time = Date.parse(at);
  return time >= start.getTime() && time < end.getTime();
}

export function computeGateReport({
  signalEvents = [],
  catchEvents = [],
  insightEvents = [],
  now = new Date(),
  weeks = 2,
} = {}) {
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 12) {
    throw new Error("weeks must be an integer between 1 and 12");
  }
  const rows = [];
  for (let index = 0; index < weeks; index++) {
    const start = addDays(weekStart(now), -7 * index);
    const end = addDays(start, 7);
    const userChanges = signalEvents.filter(
      (event) =>
        event.event === "status_changed" && event.actor === "user" && inWindow(event.at, start, end),
    );
    rows.push({
      start: localIso(start),
      inProgress: index === 0,
      fired: signalEvents.filter(
        (event) => event.event === "observed" && inWindow(event.at, start, end),
      ).length,
      acted: userChanges.filter((event) => event.to === "acted").length,
      dismissed: userChanges.filter((event) => event.to === "dismissed").length,
      resolved: userChanges.filter((event) => event.to === "resolved").length,
      catches: catchEvents.filter(
        (event) => event.event === "caught" && inWindow(event.at, start, end),
      ).length,
      insights: insightEvents.filter(
        (event) => event.event === "captured" && inWindow(event.at, start, end),
      ).length,
    });
  }
  const fullWeeks = rows.filter((row) => !row.inProgress);
  const verdict = (criterion, metric) => ({
    criterion,
    met: fullWeeks.filter((row) => row[metric] >= 1).length,
    fullWeeks: fullWeeks.length,
  });
  return {
    generatedAt: localIso(startOfDay(now)),
    weeks: rows,
    verdicts: {
      v1ToV2: verdict(">=1 true catch/week", "catches"),
      v2ToV3: verdict(">=1 acted signal/week", "acted"),
    },
  };
}

function verdictLine(label, verdict) {
  if (!verdict.fullWeeks) return label + ": " + verdict.criterion + " — no full weeks yet";
  const unit = verdict.fullWeeks === 1 ? "full week" : "full weeks";
  return label + ": " + verdict.criterion + " — met " + verdict.met + " of " + verdict.fullWeeks + " " + unit;
}

export function renderGateReport(report) {
  const out = ["Kizuki gate report — " + formatDate(report.generatedAt), ""];
  for (const week of report.weeks) {
    out.push("Week of " + formatDate(week.start) + (week.inProgress ? " (in progress)" : ""));
    out.push(
      "  signals fired: " + week.fired + "  acted: " + week.acted +
        "  dismissed: " + week.dismissed + "  resolved: " + week.resolved,
    );
    out.push("  true catches: " + week.catches + "  insights captured: " + week.insights);
    out.push("");
  }
  out.push(verdictLine("v1->v2", report.verdicts.v1ToV2));
  out.push(verdictLine("v2->v3", report.verdicts.v2ToV3));
  out.push("Notification usefulness (not muted) is operator judgment — not computed.");
  return out.join("\n") + "\n";
}
