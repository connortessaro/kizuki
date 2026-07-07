import { test } from "node:test";
import assert from "node:assert/strict";
import { notifyAlerts, notifySyncFailing } from "./notify.mjs";

test("notifyAlerts calls osascript for warn and critical only", async () => {
  const calls = [];
  await notifyAlerts(
    [
      { severity: "info", kind: "blocker", evidence: "x" },
      { severity: "warn", kind: "mention", evidence: "y" },
      { severity: "critical", kind: "deadline", evidence: "z" },
    ],
    { runOsascript: (s) => calls.push(s), platform: "darwin" },
  );
  assert.equal(calls.length, 2);
  assert.match(calls[0], /y/);
  assert.match(calls[1], /z/);
});

test("notifyAlerts is a no-op off darwin", async () => {
  const calls = [];
  await notifyAlerts(
    [{ severity: "critical", kind: "blocker", evidence: "x" }],
    { runOsascript: (s) => calls.push(s), platform: "linux" },
  );
  assert.equal(calls.length, 0);
});

test("notifySyncFailing sends a fixed message", async () => {
  const calls = [];
  await notifySyncFailing({ runOsascript: (s) => calls.push(s), platform: "darwin" });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /sync failing/i);
});
