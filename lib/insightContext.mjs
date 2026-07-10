import { assertName, assertType } from "./query.mjs";
import { readInsightEvents, reduceInsightEvents } from "./insights.mjs";

function sortNewest(states) {
  return states.sort((left, right) =>
    Date.parse(right.capturedAt) - Date.parse(left.capturedAt) ||
    left.insightId.localeCompare(right.insightId));
}

function activeStates(events) {
  return sortNewest(
    [...reduceInsightEvents(events).values()].filter((state) => state.status === "active"),
  );
}

export async function activeInsightsForScope(vaultDir, scope) {
  if (!scope || typeof scope !== "object") throw new Error("insight scope is required");
  if (scope.kind !== "all") {
    assertType(scope.kind);
    assertName(scope.name);
  }
  const states = activeStates(await readInsightEvents(vaultDir));
  if (scope.kind === "all") return states;
  return states.filter((state) =>
    state.entities.some((entity) => entity.type === scope.kind && entity.name === scope.name));
}

export function formatInsightContext(states) {
  if (!Array.isArray(states)) throw new Error("insight context states must be an array");
  if (!states.length) return "";
  return [
    "## Captured insights",
    "",
    "```json",
    JSON.stringify(states, null, 2),
    "```",
  ].join("\n");
}

export async function searchActiveInsights(vaultDir, query) {
  if (typeof query !== "string" || query.trim() === "") {
    throw new Error("query is required");
  }
  const needle = query.toLowerCase();
  return activeStates(await readInsightEvents(vaultDir)).filter((state) =>
    state.summary.toLowerCase().includes(needle) ||
    (state.context ?? "").toLowerCase().includes(needle));
}
