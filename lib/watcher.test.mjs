import { test } from "node:test";
import assert from "node:assert/strict";
import { isTranscriptFile, createDebouncer } from "./watcher.mjs";

test("isTranscriptFile accepts txt and md, rejects processed", () => {
  assert.equal(isTranscriptFile("meeting.txt"), true);
  assert.equal(isTranscriptFile("notes.md"), true);
  assert.equal(isTranscriptFile("processed"), false);
  assert.equal(isTranscriptFile(".hidden"), false);
});

test("createDebouncer coalesces rapid calls", async () => {
  let n = 0;
  const debounced = createDebouncer(() => { n++; }, 50);
  debounced();
  debounced();
  debounced();
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(n, 1);
});
