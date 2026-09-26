import { describe, expect, it } from "vitest";
import { isLocalHost } from "./hosts";

describe("isLocalHost", () => {
  it("accepts this computer's own addresses", () => {
    expect(isLocalHost("127.0.0.1:3700")).toBe(true);
    expect(isLocalHost("localhost:3700")).toBe(true);
    expect(isLocalHost("[::1]:3700")).toBe(true);
    expect(isLocalHost("localhost")).toBe(true);
  });

  it("rejects any other host name, which is how a website pointed at this computer would arrive", () => {
    expect(isLocalHost("evil.example.com:3700")).toBe(false);
    expect(isLocalHost("127.0.0.1.evil.com")).toBe(false);
    expect(isLocalHost(null)).toBe(false);
  });
});
