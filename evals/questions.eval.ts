import { evalite } from "evalite";
import { startSession } from "../lib/commands";
import { makeEmbedder } from "../lib/model";
import { runRound } from "../lib/sessionFlow";
import { loadState } from "../lib/state";
import { appearsIn, confirmedConcept, evalCourse, evalSettings, materialText, recordingAsk } from "./harness";
import { TEACH_CASES, type TeachCase } from "./keys";

interface Output {
  questions: { kind: string; text: string; quote?: string }[];
  dropped: number;
  raw: unknown[];
  fileText: string;
  ms: number;
  /** Set when the step failed, for example when the model's reply could not be read. */
  error?: string;
}

async function oneRound(c: TeachCase): Promise<Output> {
  const fileText = [await materialText("photosynthesis.md"), await materialText("cells.md")].join("\n");
  try {
    return await runOneRound(c, fileText);
  } catch (error) {
    return { questions: [], dropped: 0, raw: [], fileText, ms: 0, error: (error as Error).message };
  }
}

async function runOneRound(c: TeachCase, fileText: string): Promise<Output> {
  const course = await evalCourse();
  const conceptId = await confirmedConcept(course, c.file, c.concept, c.conceptQuotes);
  const sessionId = await startSession(course.home, conceptId, c.explanation);
  const { ask, replies } = recordingAsk();
  const started = Date.now();
  await runRound(course.home, sessionId, 1, { ask, embed: makeEmbedder(evalSettings().embed) });
  const round = (await loadState(course.home)).sessions.get(sessionId)!.rounds[0]!;
  return {
    questions: round.questions.map((q) => ({ kind: q.kind, text: q.text, quote: q.quote?.text })),
    dropped: round.dropped,
    raw: replies,
    fileText,
    ms: Date.now() - started,
  };
}

evalite<TeachCase, Output>("Teach-back questions", {
  data: TEACH_CASES.map((c) => ({ input: c })),
  task: oneRound,
  trialCount: 3,
  scorers: [
    {
      name: "No made-up quotes shown",
      description: "Every quote shown to you is in the material. Must be 1: anything less is a failure.",
      scorer: ({ output }) => (output.questions.every((q) => !q.quote || appearsIn(q.quote, output.fileText)) ? 1 : 0),
    },
    {
      name: "Model answers kept by the checks",
      description: "Share of the model's questions that passed Kizuki's checks. Low means the model often points at sentences that do not exist or words you did not write.",
      scorer: ({ output }) =>
        output.error ? 0 : output.questions.length + output.dropped === 0 ? 1 : output.questions.length / (output.questions.length + output.dropped),
    },
  ],
  columns: ({ input, output }) => [
    { label: "Case", value: input.name },
    { label: "Questions", value: output.questions.map((q) => `[${q.kind}] ${q.text}`).join("\n") || "(none)" },
    { label: "Dropped", value: output.dropped },
    { label: "Model reply", value: output.error ? `failed: ${output.error}` : JSON.stringify(output.raw) },
    { label: "Seconds", value: (output.ms / 1000).toFixed(1) },
  ],
});

evalite<TeachCase, Output>("Planted mistakes", {
  data: TEACH_CASES.filter((c) => c.mustQuote).map((c) => ({ input: c })),
  task: oneRound,
  trialCount: 3,
  scorers: [
    {
      name: "Caught the planted mistake",
      description: "A contradiction or gap question quotes the part of the material the explanation got wrong.",
      scorer: ({ input, output }) =>
        output.questions.some((q) => (q.kind === "contradiction" || q.kind === "gap") && q.quote?.toLowerCase().includes(input.mustQuote!.toLowerCase())) ? 1 : 0,
    },
  ],
  columns: ({ input, output }) => [
    { label: "Case", value: input.name },
    { label: "Questions", value: output.questions.map((q) => `[${q.kind}] ${q.text}`).join("\n") || "(none)" },
    { label: "Dropped", value: output.dropped },
    { label: "Model reply", value: output.error ? `failed: ${output.error}` : JSON.stringify(output.raw) },
    { label: "Seconds", value: (output.ms / 1000).toFixed(1) },
  ],
});
