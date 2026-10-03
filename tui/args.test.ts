import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { homeFor, parseArgs } from "./args";

describe("parseArgs", () => {
  it("reads its options and refuses unknown ones", () => {
    expect(parseArgs([])).toEqual({ help: false, version: false });
    expect(parseArgs(["--home", "/tmp/x", "--help"])).toEqual({
      home: "/tmp/x",
      help: true,
      version: false,
    });
    expect(parseArgs(["-v"]).version).toBe(true);
    expect(() => parseArgs(["--home"])).toThrow(/needs a folder/);
    expect(() => parseArgs(["--port", "3700"])).toThrow(
      /unknown option --port/,
    );
  });
});

describe("homeFor", () => {
  it("uses --home, then KIZUKI_HOME, then ~/.kizuki", () => {
    expect(
      homeFor(
        { home: "~/study", help: false, version: false },
        { KIZUKI_HOME: "/elsewhere" },
      ),
    ).toBe(join(homedir(), "study"));
    expect(
      homeFor({ help: false, version: false }, { KIZUKI_HOME: "/elsewhere" }),
    ).toBe("/elsewhere");
    expect(homeFor({ help: false, version: false }, {})).toBe(
      join(homedir(), ".kizuki"),
    );
  });
});
