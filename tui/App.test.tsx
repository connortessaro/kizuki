import { render } from "ink-testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tempHome } from "../lib/test-helpers/home";
import { App, terminalLink } from "./App";
import { Study } from "./study";

let home: string;
let cleanup: () => void;
beforeEach(() => ({ home, cleanup } = tempHome()));
afterEach(() => cleanup());

const tick = () => new Promise((resolve) => setTimeout(resolve, 30));

function app() {
  const study = new Study({
    home,
    env: {},
    models: {
      ask: async () => ({}) as never,
      embed: async (t) => t.map(() => [1]),
      embedModel: "fake",
    },
    checkModels: async () => ({ ok: true, problems: [] }),
  });
  return { study, screen: render(<App study={study} />) };
}

describe("App", () => {
  it("shows the conversation, the top line, and what you type", async () => {
    const { study, screen } = app();
    await study.start();
    await tick();
    expect(screen.lastFrame()).toContain("Make a course first");
    expect(screen.lastFrame()).toContain("kizuki · no course · 0 due");
    screen.stdin.write("/te");
    await tick();
    expect(screen.lastFrame()).toContain("/teach");
    screen.unmount();
  });

  it("sends a line on Enter and shows the reply", async () => {
    const { study, screen } = app();
    await study.start();
    screen.stdin.write("/course Biology");
    await tick();
    screen.stdin.write("\r");
    await tick();
    await study.idle();
    await tick();
    expect(screen.lastFrame()).toContain("Made the course Biology");
    expect(screen.lastFrame()).toContain("kizuki · Biology · 0 due");
    screen.unmount();
  });

  it("moves through a pick list with the arrow keys and picks with Enter", async () => {
    const { study, screen } = app();
    await study.start();
    await study.submit("/model gateway");
    await tick();
    expect(screen.lastFrame()).toContain("Yes, send my material");
    screen.stdin.write("\u001b[B"); // down arrow
    await tick();
    screen.stdin.write("\r");
    await tick();
    await study.idle();
    await tick();
    expect(screen.lastFrame()).toContain("Nothing changed.");
    screen.unmount();
  });
});

describe("quitting", () => {
  it("clears the input on the first Ctrl+C and says to press it again to quit", async () => {
    const { study, screen } = app();
    await study.start();
    screen.stdin.write("half a thought");
    await tick();
    screen.stdin.write("\u0003");
    await tick();
    expect(screen.lastFrame()).toContain("Press Ctrl+C again to quit.");
    expect(screen.lastFrame()).not.toContain("half a thought");
    screen.unmount();
  });
});

describe("terminalLink", () => {
  it("wraps text in a link to the file, at the page when there is one", () => {
    expect(terminalLink("p. 4", { path: "/tmp/a b.pdf", page: 4 })).toBe(
      "\u001b]8;;file:///tmp/a%20b.pdf#page=4\u0007p. 4\u001b]8;;\u0007",
    );
  });
});
