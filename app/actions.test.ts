import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addMaterial, confirmConcept, createCourse, startSession } from "@/lib/commands";
import { appendLog, readLog } from "@/lib/log";
import { shownMessage } from "@/lib/messages";
import { readSettings } from "@/lib/settings";
import { loadState } from "@/lib/state";
import { tempHome } from "@/lib/test-helpers/home";

// The Workflow SDK and Next's redirect are replaced, so each action runs as plain code.
const workflow = vi.hoisted(() => ({ start: vi.fn(async () => ({ runId: "wrun_test" })), resumeHook: vi.fn(async () => undefined) }));
vi.mock("workflow/api", () => workflow);
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("redirect"), { to });
  },
}));
vi.mock("@/workflows/material", () => ({ processMaterial: () => undefined }));
vi.mock("@/workflows/session", () => ({ teachSession: () => undefined }));

const actions = await import("./actions");

/** Runs an action and returns where it sends you, with its message if any. */
async function run(action: Promise<unknown>): Promise<{ path: string; error?: string; done?: string }> {
  const to = await action.then(
    () => {
      throw new Error("the action did not redirect");
    },
    (e: { to?: string }) => {
      if (!e.to) throw e;
      return e.to;
    },
  );
  const url = new URL(to, "http://x");
  const message = shownMessage({ note: url.searchParams.get("note") ?? undefined });
  return { path: url.pathname, ...(message ? { [message.kind]: message.text } : {}) };
}

const form = (fields: Record<string, string | File | (string | File)[]>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  return fd;
};

let home: string;
let cleanup: () => void;
const before = process.env.KIZUKI_HOME;
beforeEach(() => {
  ({ home, cleanup } = tempHome());
  process.env.KIZUKI_HOME = home;
  workflow.start.mockClear();
  workflow.resumeHook.mockClear();
});
afterEach(() => {
  process.env.KIZUKI_HOME = before;
  cleanup();
});

const MATERIAL = "# Heart\n\nThe human heart has four chambers.\n";
const at = () => new Date().toISOString();

/** A course with one read file, one confirmed concept, and a session with one contradiction question. */
async function sessionWithContradiction() {
  const courseId = await createCourse(home, "Biology");
  const materialId = await addMaterial(home, { courseId, fileName: "heart.md", bytes: new TextEncoder().encode(MATERIAL) });
  const passage = { passageId: "psg_1", materialId, sectionId: "sec_1", ordinal: 0, text: "The human heart has four chambers.", location: {} };
  await appendLog(home, "passages", [{ type: "passages.extracted", at: at(), materialId, passages: [passage] }]);
  await appendLog(home, "concepts", [{ type: "concept.proposed", at: at(), conceptId: "con_1", courseId, materialId, sectionId: "sec_1", name: "Heart", quotes: [{ passageId: "psg_1", text: passage.text }] }]);
  await confirmConcept(home, "con_1");
  const sessionId = await startSession(home, "con_1", "The heart has three chambers.");
  const question = { questionId: "q_1", kind: "contradiction" as const, text: "x", quote: { passageId: "psg_1", text: passage.text } };
  await appendLog(home, "sessions", [{ type: "session.questions", at: at(), sessionId, round: 1, questions: [question], dropped: 0, notInMaterial: false }]);
  return { courseId, sessionId, passage };
}

describe("course and file actions", () => {
  it("creates a course and opens it", async () => {
    const to = await run(actions.createCourseAction(form({ name: "Biology" })));
    const [course] = (await loadState(home)).courses.values();
    expect(to.path).toBe(`/courses/${course!.courseId}`);
  });

  it("goes back with a plain message when something is wrong", async () => {
    await createCourse(home, "Biology");
    expect(await run(actions.createCourseAction(form({ name: "biology" })))).toMatchObject({ path: "/courses", error: "you already have a course called biology" });
  });

  it("adds uploaded files and starts processing each one", async () => {
    const courseId = await createCourse(home, "Biology");
    const to = await run(actions.uploadAction(courseId, form({ files: new File([MATERIAL], "heart.md") })));
    expect(to).toEqual({ path: `/courses/${courseId}` });
    expect(workflow.start).toHaveBeenCalledTimes(1);
    const [material] = (await loadState(home)).materials.values();
    expect(material).toMatchObject({ fileName: "heart.md", runId: "wrun_test" });
  });

  it("reports files it can't read, and still adds the rest", async () => {
    const courseId = await createCourse(home, "Biology");
    const to = await run(actions.uploadAction(courseId, form({ files: [new File(["x"], "photo.png"), new File([MATERIAL], "heart.md")] })));
    expect(to.error).toMatch(/^photo\.png: Kizuki can't read \.png files yet/);
    expect((await loadState(home)).materials.size).toBe(1);
  });
});

describe("addCorrectionAction", () => {
  it("saves a correction only when the wrong text is really in the passage", async () => {
    const { passage } = await sessionWithContradiction();
    expect((await run(actions.addCorrectionAction(passage.passageId, form({ quote: "five chambers", correction: "x", note: "" })))).error).toMatch(/copy the wrong text exactly/);
    const ok = await run(actions.addCorrectionAction(passage.passageId, form({ quote: "four chambers", correction: "three chambers", note: "typo" })));
    expect(ok.done).toMatch(/Your version wins/);
    expect((await loadState(home)).corrections).toMatchObject([{ quote: "four chambers", correction: "three chambers" }]);
  });
});

describe("answerRoundAction", () => {
  it("asks you to say whether the material or you are right on a contradiction", async () => {
    const { sessionId } = await sessionWithContradiction();
    const to = await run(actions.answerRoundAction(sessionId, 1, form({ "answer:q_1": "hm" })));
    expect(to.error).toMatch(/say whether the material or your explanation is right/);
    expect(workflow.resumeHook).not.toHaveBeenCalled();
  });

  it("accepts \"Kizuki misread me\" as the answer to a contradiction", async () => {
    const { sessionId } = await sessionWithContradiction();
    workflow.resumeHook.mockImplementationOnce(async () => {
      await appendLog(home, "sessions", [{ type: "session.answered", at: at(), sessionId, round: 1, answers: [], finish: true }]);
    });
    await run(actions.answerRoundAction(sessionId, 1, form({ "verdict:q_1": "misread", finish: "yes" })));
    expect(workflow.resumeHook).toHaveBeenCalledWith(`session:${sessionId}:round:1`, expect.objectContaining({ answers: [expect.objectContaining({ verdict: "misread" })] }));
  });

  it("asks for the correct version when you say the material is wrong", async () => {
    const { sessionId } = await sessionWithContradiction();
    const to = await run(actions.answerRoundAction(sessionId, 1, form({ "verdict:q_1": "material-wrong" })));
    expect(to.error).toMatch(/write the correct version/);
  });

  it("sends your answers to the waiting session", async () => {
    const { sessionId } = await sessionWithContradiction();
    workflow.resumeHook.mockImplementationOnce(async () => {
      await appendLog(home, "sessions", [{ type: "session.answered", at: at(), sessionId, round: 1, answers: [], finish: true }]);
    });
    await run(actions.answerRoundAction(sessionId, 1, form({ "verdict:q_1": "material-right", "answer:q_1": "I was wrong", finish: "yes" })));
    expect(workflow.resumeHook).toHaveBeenCalledWith(`session:${sessionId}:round:1`, {
      answers: [{ questionId: "q_1", text: "I was wrong", verdict: "material-right", correction: undefined }],
      finish: true,
    });
  });
});

describe("settings actions", () => {
  it("refuses an API key typed where the name of its environment variable belongs", async () => {
    const to = await run(
      actions.saveSettingsAction(
        form({ chatBaseURL: "https://api.example.com/v1", chatModel: "m", chatApiKeyEnv: "sk-secret-123", embedBaseURL: "http://localhost:11434/v1", embedModel: "nomic-embed-text", sendOut: "yes" }),
      ),
    );
    expect(to.error).toMatch(/never the key itself/);
    expect(JSON.stringify(await readSettings(home))).not.toContain("sk-secret");
  });

  it("switches to the hosted model only after you say you understand your material will leave this computer", async () => {
    expect((await run(actions.presetAction("hosted", form({})))).error).toMatch(/send your material off this computer/);
    expect((await readSettings(home)).chat.baseURL).toMatch(/localhost/);
    await run(actions.presetAction("hosted", form({ sendOut: "yes" })));
    expect((await readSettings(home)).chat.baseURL).toBe("https://api.openai.com/v1");
  });

  it("asks the same before saving an address that is not on this computer", async () => {
    const fields = { chatBaseURL: "https://api.example.com/v1", chatModel: "m", embedBaseURL: "http://localhost:11434/v1", embedModel: "nomic-embed-text" };
    expect((await run(actions.saveSettingsAction(form(fields)))).error).toMatch(/send your material off this computer/);
    await run(actions.saveSettingsAction(form({ ...fields, sendOut: "yes" })));
    expect((await readSettings(home)).chat.baseURL).toBe("https://api.example.com/v1");
  });

  it("switches to a ready-made setting", async () => {
    await run(actions.presetAction("mlx", form({})));
    expect((await readSettings(home)).chat.replyShape).toBe("prompt");
  });
});

describe("recordCatchAction", () => {
  it("records a catch only after the session has ended", async () => {
    const { sessionId } = await sessionWithContradiction();
    expect((await run(actions.recordCatchAction(sessionId, form({ note: "chambers" })))).error).toMatch(/after the session has ended/);
    expect(await readLog(home, "catches")).toEqual([]);
  });
});
