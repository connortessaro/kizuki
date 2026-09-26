import { FatalError } from "workflow";
import { afterEach, describe, expect, it } from "vitest";
import { ownHome } from "./home";
import { readStep } from "./material/steps";
import { roundStep } from "./session/steps";

const before = process.env.KIZUKI_HOME;
afterEach(() => {
  process.env.KIZUKI_HOME = before;
});

describe("ownHome", () => {
  it("returns the data folder Kizuki runs with", () => {
    process.env.KIZUKI_HOME = "/tmp/kizuki-own";
    expect(ownHome("/tmp/kizuki-own")).toBe("/tmp/kizuki-own");
  });

  it("stops the run at once, without retries, for any other folder", () => {
    process.env.KIZUKI_HOME = "/tmp/kizuki-own";
    expect(() => ownHome("/Users/someone/Downloads/evil")).toThrow(FatalError);
  });
});

describe("workflow steps", () => {
  it("refuse a run started with another data folder before reading anything", async () => {
    process.env.KIZUKI_HOME = "/tmp/kizuki-own";
    await expect(readStep("/Users/someone/Downloads/evil", "mat_x")).rejects.toBeInstanceOf(FatalError);
    await expect(roundStep("/Users/someone/Downloads/evil", "ses_x", 1)).rejects.toBeInstanceOf(FatalError);
  });
});
