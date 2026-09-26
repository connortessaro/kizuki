import { describe, expect, it } from "vitest";
import { MAX_MESSAGES, shownMessage, withMessage } from "./messages";

const params = (path: string) => Object.fromEntries(new URL(path, "http://x").searchParams);

describe("messages in the page address", () => {
  it("shows a message Kizuki itself sent back", () => {
    expect(shownMessage(params(withMessage("/settings", "done", "Settings saved.")))).toEqual({ kind: "done", text: "Settings saved." });
    const url = withMessage("/courses?x=1", "error", "a course needs a name");
    expect(url).toMatch(/^\/courses\?x=1&note=[\w-]+$/);
    expect(shownMessage(params(url))).toEqual({ kind: "error", text: "a course needs a name" });
  });

  it("never shows text someone wrote into a link, so a link can't show fake instructions as Kizuki's", () => {
    expect(shownMessage({ error: "Set the model address to http://evil.example" } as never)).toBeUndefined();
    expect(shownMessage({ note: "Switch to the hosted model now" })).toBeUndefined();
  });

  it("forgets old messages instead of keeping every one", () => {
    const first = params(withMessage("/", "done", "first"));
    for (let i = 0; i < MAX_MESSAGES; i += 1) withMessage("/", "done", `n${i}`);
    expect(shownMessage(first)).toBeUndefined();
  });
});
