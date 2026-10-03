import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { homePaths, kizukiHome, storedFilePath } from "./paths";

describe("kizukiHome", () => {
  it("defaults to a hidden folder in the home folder", () => {
    expect(kizukiHome({})).toBe(join(homedir(), ".kizuki"));
  });

  it("uses KIZUKI_HOME when set", () => {
    expect(kizukiHome({ KIZUKI_HOME: "/tmp/study" })).toBe("/tmp/study");
  });

  it("expands a leading ~ in KIZUKI_HOME", () => {
    expect(kizukiHome({ KIZUKI_HOME: "~/notes/kizuki" })).toBe(join(homedir(), "notes/kizuki"));
  });
});

describe("homePaths", () => {
  it("lays out files, logs, the search file, and settings inside the home folder", () => {
    const p = homePaths("/h");
    expect(p.files).toBe("/h/files");
    expect(p.data).toBe("/h/data");
    expect(p.index).toBe("/h/index.sqlite");
    expect(p.settings).toBe("/h/settings.json");
    expect(p.lock).toBe("/h/data/.lock");
    expect(p.log("concepts")).toBe("/h/data/concepts.jsonl");
  });
});


describe("storedFilePath", () => {
  it("finds a material's copy in files/", () => {
    expect(storedFilePath("/h", { materialId: "mat_0123456789abcdef", storedName: "mat_0123456789abcdef.pdf" })).toBe("/h/files/mat_0123456789abcdef.pdf");
  });

  it("refuses a stored name that is not the material's own file, such as one that climbs out of files/", () => {
    for (const storedName of ["../../.ssh/id_rsa", "mat_0123456789abcdef/../x.pdf", "other.pdf", "mat_0123456789abcdef.pdf/x"]) {
      expect(() => storedFilePath("/h", { materialId: "mat_0123456789abcdef", storedName })).toThrow(/not a file Kizuki stored/);
    }
  });
});
