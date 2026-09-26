import { z } from "zod";
import type { LogName } from "./paths";

const at = z.iso.datetime({ offset: true });
const id = z.string().min(1).max(120);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** The file formats Kizuki can read in v1. */
export const FORMATS = ["pdf", "pptx", "docx", "xlsx", "csv", "md", "txt"] as const;
/** One of {@link FORMATS}. */
export type Format = (typeof FORMATS)[number];

/** Where a passage sits in its original file. Only the fields that apply to the format are set. */
export const locationSchema = z.object({
  page: z.number().int().positive().optional(),
  slide: z.number().int().positive().optional(),
  notes: z.boolean().optional(),
  sheet: z.string().optional(),
  cells: z.string().optional(),
  heading: z.string().optional(),
  paragraph: z.number().int().nonnegative().optional(),
});
/** Where a passage sits in its original file. */
export type Location = z.infer<typeof locationSchema>;

/** A heading in the material. Sections form the skeleton of the concept map. */
export const sectionSchema = z.object({
  sectionId: id,
  title: z.string(),
  level: z.number().int().min(1).max(6),
  ordinal: z.number().int().nonnegative(),
  /** True when the title is a real heading of the material, not a page number or a file name. */
  heading: z.boolean().optional(),
});
/** A heading in the material. */
export type Section = z.infer<typeof sectionSchema>;

/** A short piece of text from the material, with where it came from. Quotes are checked against these. */
export const passageSchema = z.object({
  passageId: id,
  materialId: id,
  sectionId: id,
  ordinal: z.number().int().nonnegative(),
  text: z.string().min(1),
  location: locationSchema,
});
/** A short piece of text from the material. */
export type Passage = z.infer<typeof passageSchema>;

/** A quote from the material, tied to the passage it was found in. */
export const quoteSchema = z.object({ passageId: id, text: z.string().min(1) });
/** A quote from the material. */
export type Quote = z.infer<typeof quoteSchema>;

/** Events in `courses.jsonl`. */
export const courseEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("course.created"), at, courseId: id, name: z.string().min(1).max(200) }),
  z.object({ type: z.literal("course.examDateSet"), at, courseId: id, examDate: date.nullable() }),
]);
/** An event in `courses.jsonl`. */
export type CourseEvent = z.infer<typeof courseEventSchema>;

/** Events in `materials.jsonl`: a file's progress from upload to proposed concepts. */
export const materialEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("material.added"),
    at,
    materialId: id,
    courseId: id,
    fileName: z.string().min(1),
    storedName: z.string().min(1),
    format: z.enum(FORMATS),
    bytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  z.object({ type: z.literal("material.started"), at, materialId: id, runId: z.string() }),
  z.object({
    type: z.literal("material.extracted"),
    at,
    materialId: id,
    sections: z.array(sectionSchema),
    passageCount: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("material.indexed"), at, materialId: id, passageCount: z.number().int().nonnegative() }),
  z.object({
    type: z.literal("material.conceptsProposed"),
    at,
    materialId: id,
    proposed: z.number().int().nonnegative(),
    dropped: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("material.reviewed"), at, materialId: id }),
  z.object({ type: z.literal("material.linksProposed"), at, materialId: id, proposed: z.number().int().nonnegative(), dropped: z.number().int().nonnegative() }),
  z.object({ type: z.literal("material.failed"), at, materialId: id, error: z.string() }),
]);
/** An event in `materials.jsonl`. */
export type MaterialEvent = z.infer<typeof materialEventSchema>;

/** Events in `passages.jsonl`: every passage of one file, written once after extraction. */
export const passageEventSchema = z.object({
  type: z.literal("passages.extracted"),
  at,
  materialId: id,
  passages: z.array(passageSchema),
});
/** An event in `passages.jsonl`. */
export type PassageEvent = z.infer<typeof passageEventSchema>;

/** Events in `concepts.jsonl`. Concepts are proposed by the model and only used once you confirm them. */
export const conceptEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("concept.proposed"),
    at,
    conceptId: id,
    courseId: id,
    materialId: id,
    sectionId: id,
    name: z.string().min(1).max(120),
    quotes: z.array(quoteSchema).min(1),
  }),
  z.object({ type: z.literal("concept.confirmed"), at, conceptId: id }),
  z.object({ type: z.literal("concept.renamed"), at, conceptId: id, name: z.string().min(1).max(120) }),
  z.object({ type: z.literal("concept.dropped"), at, conceptId: id }),
  z.object({ type: z.literal("concept.merged"), at, conceptId: id, intoConceptId: id }),
]);
/** An event in `concepts.jsonl`. */
export type ConceptEvent = z.infer<typeof conceptEventSchema>;

/** Events in `links.jsonl`. A link says "this concept needs that concept first". */
export const linkEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("link.proposed"), at, linkId: id, courseId: id, conceptId: id, needsConceptId: id }),
  z.object({ type: z.literal("link.confirmed"), at, linkId: id }),
  z.object({ type: z.literal("link.dropped"), at, linkId: id }),
]);
/** An event in `links.jsonl`. */
export type LinkEvent = z.infer<typeof linkEventSchema>;

/** The three kinds of teach-back question. */
export const QUESTION_KINDS = ["contradiction", "gap", "unclear"] as const;

/** A teach-back question after it passed the quote check. */
export const questionSchema = z.object({
  questionId: id,
  kind: z.enum(QUESTION_KINDS),
  text: z.string().min(1),
  /** Set for contradiction and gap questions. */
  quote: quoteSchema.optional(),
  /** Set for unclear questions: words taken from your own explanation. */
  term: z.string().optional(),
});
/** A teach-back question. */
export type Question = z.infer<typeof questionSchema>;

/**
 * Your answer to one question. For contradictions you also say which is right: the material
 * (a miss), your explanation because the material is wrong (a correction), or neither because
 * Kizuki misread what you wrote (no miss, no correction).
 */
export const answerSchema = z.object({
  questionId: id,
  text: z.string(),
  verdict: z.enum(["material-right", "material-wrong", "misread"]).optional(),
  correction: z.string().optional(),
});
/** Your answer to one question. */
export type Answer = z.infer<typeof answerSchema>;

/** Something you may have missed, proposed at the end of a session. Always a quote, never the model's own words. */
export const missSchema = z.object({ missId: id, quote: quoteSchema });
/** Something you may have missed. */
export type Miss = z.infer<typeof missSchema>;

/** Events in `sessions.jsonl`: one teach-back session from start to end. */
export const sessionEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("session.started"), at, sessionId: id, conceptId: id, explanation: z.string().min(1) }),
  z.object({ type: z.literal("session.running"), at, sessionId: id, runId: z.string() }),
  z.object({
    type: z.literal("session.questions"),
    at,
    sessionId: id,
    round: z.number().int().min(1),
    questions: z.array(questionSchema),
    dropped: z.number().int().nonnegative(),
    notInMaterial: z.boolean(),
  }),
  z.object({ type: z.literal("session.answered"), at, sessionId: id, round: z.number().int().min(1), answers: z.array(answerSchema), finish: z.boolean() }),
  z.object({ type: z.literal("session.missesProposed"), at, sessionId: id, misses: z.array(missSchema), dropped: z.number().int().nonnegative() }),
  z.object({
    type: z.literal("session.ended"),
    at,
    sessionId: id,
    confirmedMissIds: z.array(id),
    rejectedMissIds: z.array(id),
    clean: z.boolean(),
  }),
  z.object({ type: z.literal("session.failed"), at, sessionId: id, error: z.string() }),
]);
/** An event in `sessions.jsonl`. */
export type SessionEvent = z.infer<typeof sessionEventSchema>;

/** Events in `corrections.jsonl`: your corrections to the material, and your answers to "what does this mean?". */
export const correctionEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("correction.added"),
    at,
    correctionId: id,
    passageId: id,
    quote: z.string().min(1),
    correction: z.string().min(1),
    note: z.string(),
    sessionId: id.optional(),
  }),
  z.object({ type: z.literal("clarification.asked"), at, clarificationId: id, passageId: id, quote: z.string().min(1), question: z.string().min(1) }),
  z.object({ type: z.literal("clarification.answered"), at, clarificationId: id, answer: z.string().min(1) }),
]);
/** An event in `corrections.jsonl`. */
export type CorrectionEvent = z.infer<typeof correctionEventSchema>;

/** Events in `catches.jsonl`: things you would have gotten wrong on an exam. */
export const catchEventSchema = z.object({
  type: z.literal("catch.recorded"),
  at,
  catchId: id,
  sessionId: id,
  conceptId: id,
  note: z.string(),
});
/** An event in `catches.jsonl`. */
export type CatchEvent = z.infer<typeof catchEventSchema>;

/** The schema for each log file. */
export const LOG_SCHEMAS = {
  courses: courseEventSchema,
  materials: materialEventSchema,
  passages: passageEventSchema,
  concepts: conceptEventSchema,
  links: linkEventSchema,
  sessions: sessionEventSchema,
  corrections: correctionEventSchema,
  catches: catchEventSchema,
} satisfies Record<LogName, z.ZodType>;

/** The event type stored in each log file. */
export interface LogEvents {
  /** An event in `courses.jsonl`. */
  courses: CourseEvent;
  /** An event in `materials.jsonl`. */
  materials: MaterialEvent;
  /** An event in `passages.jsonl`. */
  passages: PassageEvent;
  /** An event in `concepts.jsonl`. */
  concepts: ConceptEvent;
  /** An event in `links.jsonl`. */
  links: LinkEvent;
  /** An event in `sessions.jsonl`. */
  sessions: SessionEvent;
  /** An event in `corrections.jsonl`. */
  corrections: CorrectionEvent;
  /** An event in `catches.jsonl`. */
  catches: CatchEvent;
}
