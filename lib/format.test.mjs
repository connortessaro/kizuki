import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDate, formatDateTime } from "./format.mjs";

test("formatDate renders month-day-year", () => {
  assert.equal(formatDate("2026-07-04"), "July 4, 2026");
  assert.equal(formatDate("2026-12-25"), "December 25, 2026");
  assert.equal(formatDate("2026-01-09"), "January 9, 2026");
});

test("formatDate accepts a full ISO timestamp, uses the date prefix", () => {
  assert.equal(formatDate("2026-07-04T09:32:00.000Z"), "July 4, 2026");
});

test("formatDate throws on non-ISO input", () => {
  assert.throws(() => formatDate("07/04/2026"), /invalid ISO date/);
  assert.throws(() => formatDate(""), /invalid ISO date/);
  assert.throws(() => formatDate("2026-13-01"), /invalid ISO date/);
});

test("formatDateTime renders local components 12-hour", () => {
  assert.equal(formatDateTime(new Date(2026, 6, 4, 9, 32)), "July 4, 2026, 9:32 AM");
  assert.equal(formatDateTime(new Date(2026, 6, 4, 15, 5)), "July 4, 2026, 3:05 PM");
});

test("formatDateTime midnight and noon edges", () => {
  assert.equal(formatDateTime(new Date(2026, 0, 1, 0, 5)), "January 1, 2026, 12:05 AM");
  assert.equal(formatDateTime(new Date(2026, 6, 4, 12, 0)), "July 4, 2026, 12:00 PM");
  assert.equal(formatDateTime(new Date(2026, 6, 4, 23, 59)), "July 4, 2026, 11:59 PM");
});
