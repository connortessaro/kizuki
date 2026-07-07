import { watch } from "node:fs";
import { join } from "node:path";

export const WATCH_DEBOUNCE_MS = 2000;

export function isTranscriptFile(name) {
  if (!name || name.startsWith(".")) return false;
  if (name === "processed") return false;
  return /\.(txt|md)$/i.test(name);
}

export function createDebouncer(fn, ms = WATCH_DEBOUNCE_MS) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
}

export function watchTranscripts(vaultDir, onSync, { watchFn = watch, debounceMs = WATCH_DEBOUNCE_MS } = {}) {
  const dir = join(vaultDir, "transcripts");
  const debounced = createDebouncer(onSync, debounceMs);
  const w = watchFn(dir, (event, filename) => {
    if (!isTranscriptFile(filename)) return;
    debounced(event, filename);
  });
  return { close: () => w.close() };
}
