import { mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { looksLikeFiles, splitPaths } from "./paths";

describe("splitPaths", () => {
  it("reads the forms a terminal pastes when you drop files", () => {
    expect(splitPaths("/a/b.pdf /c/d.md")).toEqual(["/a/b.pdf", "/c/d.md"]);
    expect(splitPaths("/a/my\\ notes.pdf")).toEqual(["/a/my notes.pdf"]);
    expect(splitPaths("'/a/my notes.pdf' \"/b/x y.md\"")).toEqual([
      "/a/my notes.pdf",
      "/b/x y.md",
    ]);
    expect(splitPaths("~/x.pdf")).toEqual([join(homedir(), "x.pdf")]);
    expect(splitPaths("  ")).toEqual([]);
  });
});

describe("looksLikeFiles", () => {
  it("is true only when every path is a file that exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "kizuki-paths-"));
    const file = join(dir, "notes one.md");
    writeFileSync(file, "# Notes\n");
    expect(looksLikeFiles(file.replace(/ /g, "\\ "))).toBe(true);
    expect(
      looksLikeFiles(`${file.replace(/ /g, "\\ ")} ${join(dir, "missing.md")}`),
    ).toBe(false);
    expect(looksLikeFiles(dir)).toBe(false);
    expect(looksLikeFiles("osmosis moves water")).toBe(false);
  });
});
