import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "./proxy";

const request = (path: string, host: string) => new NextRequest(`http://127.0.0.1:3700${path}`, { headers: { host } });
const matched = (path: string) => config.matcher.some((m) => new RegExp(`^${m.source}$`).test(path));

describe("proxy", () => {
  it("lets through requests addressed to this computer", () => {
    for (const host of ["127.0.0.1:3700", "localhost:3700", "[::1]:3700"]) expect(proxy(request("/", host)).status).toBe(200);
  });

  it("refuses requests addressed to any other name, such as a site that points its own address at this computer", () => {
    for (const host of ["evil.example:3700", "localhost.evil.example", "127.0.0.2:3700", "0.0.0.0:3700"]) expect(proxy(request("/", host)).status).toBe(403);
  });

  it("runs on every page, action, file, and background-job route", () => {
    for (const path of ["/", "/courses", "/courses/c1", "/sessions/s1", "/files/mat_1", "/sources/p1", "/settings", "/.well-known/workflow/v1/flow", "/.well-known/workflow/v1/step", "/.well-known/workflow/v1/webhook/t"]) {
      expect(matched(path), path).toBe(true);
    }
  });

  it("skips only built static files", () => {
    for (const path of ["/_next/static/chunks/a.js", "/_next/image", "/favicon.ico"]) expect(matched(path), path).toBe(false);
  });
});
