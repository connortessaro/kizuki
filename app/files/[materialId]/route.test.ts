import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addMaterial, createCourse } from "@/lib/commands";
import { appendLog } from "@/lib/log";
import { tempHome } from "@/lib/test-helpers/home";
import { GET } from "./route";

let home: string;
let cleanup: () => void;
const before = process.env.KIZUKI_HOME;
beforeEach(() => {
  ({ home, cleanup } = tempHome());
  process.env.KIZUKI_HOME = home;
});
afterEach(() => {
  process.env.KIZUKI_HOME = before;
  cleanup();
});

const get = (materialId: string) => GET(new Request(`http://127.0.0.1/files/${materialId}`), { params: Promise.resolve({ materialId }) });

describe("GET /files/[materialId]", () => {
  it("serves the original file with its type and name", async () => {
    const courseId = await createCourse(home, "Biology");
    const materialId = await addMaterial(home, { courseId, fileName: "notes day 1.md", bytes: new TextEncoder().encode("# Heart") });
    const res = await get(materialId);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe("inline; filename*=UTF-8''notes%20day%201.md");
    expect(await res.text()).toBe("# Heart");
  });

  it("offers slides, documents, and workbooks as downloads", async () => {
    const courseId = await createCourse(home, "Biology");
    const materialId = await addMaterial(home, { courseId, fileName: "deck.pptx", bytes: new Uint8Array([1, 2]) });
    expect((await get(materialId)).headers.get("content-disposition")).toMatch(/^attachment;/);
  });

  it("answers 404 for a file Kizuki does not know", async () => {
    expect((await get("mat_nope")).status).toBe(404);
  });

  it("never reads outside files/, even if a log line was changed", async () => {
    const courseId = await createCourse(home, "Biology");
    await appendLog(home, "materials", [
      { type: "material.added", at: new Date().toISOString(), materialId: "mat_0123456789abcdef", courseId, fileName: "x.md", storedName: "../settings.json", format: "md", bytes: 1, sha256: "0".repeat(64) },
    ]);
    await expect(get("mat_0123456789abcdef")).rejects.toThrow(/not a file Kizuki stored/);
  });
});
