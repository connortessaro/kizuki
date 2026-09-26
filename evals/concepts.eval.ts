import { evalite } from "evalite";
import { proposeConcepts } from "../lib/concepts";
import { extract, toRecords } from "../lib/extract/index";
import { appearsIn, materialText, recordingAsk } from "./harness";
import { CONCEPT_KEYS, type ConceptKey } from "./keys";

interface Output {
  names: string[];
  quotes: string[];
  dropped: number;
  fileText: string;
  ms: number;
  /** Set when the step failed, for example when the model's reply could not be read. */
  error?: string;
}

evalite<ConceptKey, Output>("Concept proposals", {
  data: CONCEPT_KEYS.map((k) => ({ input: k })),
  task: async (key) => {
    const fileText = await materialText(key.file);
    const { sections, passages } = toRecords("eval", await extract("md", new TextEncoder().encode(fileText), key.file));
    const { ask } = recordingAsk();
    const started = Date.now();
    let out;
    try {
      out = await proposeConcepts({ sections, passages, existingNames: new Set(), ask });
    } catch (error) {
      return { names: [], quotes: [], dropped: 0, fileText, ms: Date.now() - started, error: (error as Error).message };
    }
    return {
      names: out.concepts.map((c) => c.name),
      quotes: out.concepts.flatMap((c) => c.quotes.map((q) => q.text)),
      dropped: out.dropped,
        fileText,
      ms: Date.now() - started,
    };
  },
  scorers: [
    {
      name: "No made-up quotes shown",
      description: "Every quote on a proposed concept is in the file. Must be 1.",
      scorer: ({ output }) => (output.quotes.every((q) => appearsIn(q, output.fileText)) ? 1 : 0),
    },
    {
      name: "Key concepts found",
      description: "Share of the hand-made concept list that some proposal matches by name.",
      scorer: ({ input, output }) =>
        input.concepts.filter((aliases) => output.names.some((n) => aliases.some((a) => n.toLowerCase().includes(a)))).length / input.concepts.length,
    },
    {
      name: "Proposals that match the key",
      description: "Share of proposals that match a concept on the hand-made list. Low means many extra, too-small concepts to drop.",
      scorer: ({ input, output }) =>
        output.names.length === 0 ? 0 : output.names.filter((n) => input.concepts.some((aliases) => aliases.some((a) => n.toLowerCase().includes(a)))).length / output.names.length,
    },
    {
      name: "Model answers kept by the checks",
      description: "Share of the model's proposed concepts that passed Kizuki's checks.",
      scorer: ({ output }) => (output.error ? 0 : output.names.length + output.dropped === 0 ? 1 : output.names.length / (output.names.length + output.dropped)),
    },
  ],
  columns: ({ input, output }) => [
    { label: "File", value: input.file },
    { label: "Proposed", value: output.error ? `failed: ${output.error}` : output.names.join(", ") },
    { label: "Dropped", value: output.dropped },
    { label: "Seconds", value: (output.ms / 1000).toFixed(1) },
  ],
});
