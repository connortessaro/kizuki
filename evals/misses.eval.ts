import { evalite } from "evalite";
import { startSession } from "../lib/commands";
import { makeEmbedder } from "../lib/model";
import { proposeMisses } from "../lib/sessionFlow";
import { loadState } from "../lib/state";
import { appearsIn, confirmedConcept, evalCourse, evalSettings, materialText, recordingAsk } from "./harness";
import { MISS_CASES, type MissCase } from "./keys";

interface Output {
  misses: string[];
  raw: unknown[];
  fileText: string;
  ms: number;
  /** Set when the step failed, for example when the model's reply could not be read. */
  error?: string;
}

evalite<MissCase, Output>("What you missed", {
  data: MISS_CASES.map((c) => ({ input: c })),
  task: async (c) => {
    const course = await evalCourse();
    const conceptId = await confirmedConcept(course, c.file, c.concept, c.conceptQuotes);
    const sessionId = await startSession(course.home, conceptId, c.explanation);
    const { ask, replies } = recordingAsk();
    const started = Date.now();
    const fileText = [await materialText("photosynthesis.md"), await materialText("cells.md")].join("\n");
    try {
      await proposeMisses(course.home, sessionId, { ask, embed: makeEmbedder(evalSettings().embed) });
    } catch (error) {
      return { misses: [], raw: replies, fileText, ms: Date.now() - started, error: (error as Error).message };
    }
    const session = (await loadState(course.home)).sessions.get(sessionId)!;
    return { misses: (session.misses ?? []).map((m) => m.quote.text), raw: replies, fileText, ms: Date.now() - started };
  },
  scorers: [
    {
      name: "No made-up quotes shown",
      description: "Every proposed miss is a real quote from the material. Must be 1.",
      scorer: ({ output }) => (output.misses.every((m) => appearsIn(m, output.fileText)) ? 1 : 0),
    },
    {
      name: "Found the left-out point",
      description: "One of the proposed misses contains the point the explanation left out.",
      scorer: ({ input, output }) => (output.misses.some((m) => m.toLowerCase().includes(input.missing.toLowerCase())) ? 1 : 0),
    },
  ],
  columns: ({ input, output }) => [
    { label: "Case", value: input.name },
    { label: "Misses", value: output.misses.join("\n") || "(none)" },
    { label: "Model reply", value: output.error ? `failed: ${output.error}` : JSON.stringify(output.raw) },
    { label: "Seconds", value: (output.ms / 1000).toFixed(1) },
  ],
});
