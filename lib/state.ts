import type {
  Answer,
  CatchEvent,
  ConceptEvent,
  CorrectionEvent,
  CourseEvent,
  Format,
  LinkEvent,
  MaterialEvent,
  Miss,
  Passage,
  Question,
  Quote,
  Section,
  SessionEvent,
} from "./events";
import { readLog } from "./log";

/** All log files except passages, which are loaded separately because they are large. */
export interface Logs {
  /** The events in `courses.jsonl`, in the order they were written. */
  courses: CourseEvent[];
  /** The events in `materials.jsonl`, in the order they were written. */
  materials: MaterialEvent[];
  /** The events in `concepts.jsonl`, in the order they were written. */
  concepts: ConceptEvent[];
  /** The events in `links.jsonl`, in the order they were written. */
  links: LinkEvent[];
  /** The events in `sessions.jsonl`, in the order they were written. */
  sessions: SessionEvent[];
  /** The events in `corrections.jsonl`, in the order they were written. */
  corrections: CorrectionEvent[];
  /** The events in `catches.jsonl`, in the order they were written. */
  catches: CatchEvent[];
}

/** A course as it stands now. */
export interface CourseState {
  /** The course's id: `course_` and 16 hex characters. */
  courseId: string;
  /** The course's name as you typed it, trimmed, with runs of spaces made single. */
  name: string;
  /** The exam date as `YYYY-MM-DD`, or `null` if none is set. */
  examDate: string | null;
  /** When the course was created, as an ISO time string. */
  createdAt: string;
}

/** Where a material is in its processing. */
export type MaterialStatus = "waiting" | "reading" | "indexing" | "proposing" | "review" | "linking" | "done" | "failed";

/** A material (one added file) as it stands now. */
export interface MaterialState {
  /** The material's id: `mat_` and 16 hex characters. */
  materialId: string;
  /** The course the file was added to. */
  courseId: string;
  /** The file's name when you added it. */
  fileName: string;
  /** The name of Kizuki's copy in `files/`: the material id plus the file's ending in lower case, such as `mat_0123456789abcdef.pdf`. */
  storedName: string;
  /** The file's format, worked out from its ending. */
  format: Format;
  /** The file's size in bytes. */
  bytes: number;
  /** The SHA-256 fingerprint of the file's bytes, as 64 lower-case hex characters. Used to refuse the same file twice in one course. */
  sha256: string;
  /** When the file was added, as an ISO time string. */
  addedAt: string;
  /** Where the material is in its processing. */
  status: MaterialStatus;
  /** The id of the workflow run that last started processing it. `undefined` until processing starts. */
  runId?: string;
  /** The headings read from the file. Empty until the file has been read. */
  sections: Section[];
  /** How many passages were read from the file. 0 until the file has been read. */
  passageCount: number;
  /** How many concepts were proposed for the material. 0 until concepts are proposed. */
  proposed: number;
  /** How many of the model's concept proposals failed the checks and were dropped. */
  dropped: number;
  /** How many prerequisite links between the course's confirmed concepts were proposed in the material's last step. 0 until then. */
  linksProposed: number;
  /** Why processing failed. `undefined` unless the last attempt failed; cleared when processing starts again. */
  error?: string;
  /** When the last event for this material was recorded. */
  updatedAt: string;
}

/** A concept as it stands now. */
export interface ConceptState {
  /** The concept's id: `con_` and 16 hex characters. */
  conceptId: string;
  /** The course the concept belongs to. */
  courseId: string;
  /** The material the concept was proposed from. */
  materialId: string;
  /** The section of that material the concept belongs to. */
  sectionId: string;
  /** The concept's current name, after any renames. */
  name: string;
  /** The sentences from the material that back the concept. Gains the quotes of concepts merged into it. */
  quotes: Quote[];
  /** `proposed` until you confirm, drop, or merge it. Only confirmed concepts are taught and reviewed. */
  status: "proposed" | "confirmed" | "dropped" | "merged";
  /** The id of the concept this one was merged into. Set only when `status` is `merged`. */
  mergedInto?: string;
  /** When the concept was proposed, as an ISO time string. */
  proposedAt: string;
  /** When you confirmed the concept, as an ISO time string. `undefined` if you never did. */
  confirmedAt?: string;
}

/** A prerequisite link as it stands now: `conceptId` needs `needsConceptId` first. */
export interface LinkState {
  /** The link's id: `link_` and 16 hex characters. */
  linkId: string;
  /** The course both concepts belong to. */
  courseId: string;
  /** The concept that needs the other first. May point at a concept that was merged since. */
  conceptId: string;
  /** The concept to understand first. May point at a concept that was merged since. */
  needsConceptId: string;
  /** `proposed` until you confirm or drop it. Only confirmed links affect the review order. */
  status: "proposed" | "confirmed" | "dropped";
}

/** One round of a teach-back session: the questions and your answers. */
export interface RoundState {
  /** The round's number, starting at 1. */
  round: number;
  /** The questions that passed the checks. May be empty. */
  questions: Question[];
  /** How many of the model's questions failed the checks and were dropped. */
  dropped: number;
  /** True when nothing in the material matched what you wrote and no question was left, so the round says "not in your material". */
  notInMaterial: boolean;
  /** Your answers. `undefined` until you send them. */
  answers?: Answer[];
  /** True if you chose to finish after this round. `undefined` until you send your answers. */
  finish?: boolean;
}

/**
 * Where a session is: waiting for the model (`thinking`), waiting for your answers
 * (`answering`), waiting for you to confirm what you missed (`reviewing`), `ended`, or `failed`.
 */
export type SessionStatus = "thinking" | "answering" | "reviewing" | "ended" | "failed";

/** A teach-back session as it stands now. */
export interface SessionState {
  /** The session's id: `ses_` and 16 hex characters. */
  sessionId: string;
  /** The concept being taught, as it was when the session started. It may have been merged since. */
  conceptId: string;
  /** Your explanation, trimmed. */
  explanation: string;
  /** When the session started, as an ISO time string. */
  startedAt: string;
  /** The id of the workflow run that runs the session. `undefined` until it starts. */
  runId?: string;
  /** The rounds of questions so far, in order. */
  rounds: RoundState[];
  /** What you may have missed, proposed at the end. `undefined` until proposed. */
  misses?: Miss[];
  /** How many of the model's proposed misses failed the checks and were dropped. */
  missesDropped: number;
  /**
   * Set when the session ends: when (ISO time), which misses you confirmed and which you
   * rejected, and whether it was clean (no confirmed misses and no "the material is right" answer).
   */
  ended?: { at: string; confirmedMissIds: string[]; rejectedMissIds: string[]; clean: boolean };
  /** Why the session failed. `undefined` unless it failed. */
  error?: string;
  /** Where the session is, worked out from the fields above. */
  status: SessionStatus;
  /** When the last event for this session was recorded. */
  updatedAt: string;
}

/** A correction you made to the material. */
export interface CorrectionState {
  /** The correction's id: `cor_` and 16 hex characters. */
  correctionId: string;
  /** The passage that holds the wrong text. */
  passageId: string;
  /** The wrong text from the material, trimmed. */
  quote: string;
  /** Your version, trimmed. It wins over the material from then on. */
  correction: string;
  /** Your note about it, trimmed. May be empty. In a session it is your answer to the question. */
  note: string;
  /** The session the correction came from. `undefined` if you made it outside a session. */
  sessionId?: string;
  /** When the correction was recorded, as an ISO time string. */
  at: string;
}

/** A "what does this mean?" question Kizuki asked about a passage, and your answer if given. */
export interface ClarificationState {
  /** The question's id: `clar_` and 16 hex characters. */
  clarificationId: string;
  /** The passage the sentence comes from. */
  passageId: string;
  /** The sentence from the material that Kizuki is not sure how to read. */
  quote: string;
  /** The question shown to you. */
  question: string;
  /** When the question was asked, as an ISO time string. */
  askedAt: string;
  /** Your answer, trimmed. `undefined` until you answer; a later answer replaces an earlier one. */
  answer?: string;
}

/** Everything Kizuki knows, rebuilt from the logs. */
export interface State {
  /** Every course, by course id. */
  courses: Map<string, CourseState>;
  /** Every material, by material id. */
  materials: Map<string, MaterialState>;
  /** Every concept in any status, by concept id. */
  concepts: Map<string, ConceptState>;
  /** Every prerequisite link in any status, by link id. */
  links: Map<string, LinkState>;
  /** Every session, by session id. */
  sessions: Map<string, SessionState>;
  /** Every correction, in the order it was recorded. */
  corrections: CorrectionState[];
  /** Every "what does this mean?" question, by id. */
  clarifications: Map<string, ClarificationState>;
  /** Every catch, as recorded in `catches.jsonl`. */
  catches: CatchEvent[];
}

const MATERIAL_STATUS: Partial<Record<MaterialEvent["type"], MaterialStatus>> = {
  "material.added": "waiting",
  "material.started": "reading",
  "material.extracted": "indexing",
  "material.indexed": "proposing",
  "material.conceptsProposed": "review",
  "material.reviewed": "linking",
  "material.linksProposed": "done",
  "material.failed": "failed",
};

function sessionStatus(s: SessionState): SessionStatus {
  if (s.error) return "failed";
  if (s.ended) return "ended";
  if (s.misses) return "reviewing";
  const last = s.rounds[s.rounds.length - 1];
  if (last && last.questions.length > 0 && !last.answers) return "answering";
  return "thinking";
}

/** Rebuilds the current state from log events. Pure: the same logs always give the same state. */
export function reduceState(logs: Logs): State {
  const state: State = {
    courses: new Map(),
    materials: new Map(),
    concepts: new Map(),
    links: new Map(),
    sessions: new Map(),
    corrections: [],
    clarifications: new Map(),
    catches: [...logs.catches],
  };

  for (const e of logs.courses) {
    if (e.type === "course.created") state.courses.set(e.courseId, { courseId: e.courseId, name: e.name, examDate: null, createdAt: e.at });
    else {
      const course = state.courses.get(e.courseId);
      if (course) course.examDate = e.examDate;
    }
  }

  for (const e of logs.materials) {
    if (e.type === "material.added") {
      state.materials.set(e.materialId, {
        materialId: e.materialId,
        courseId: e.courseId,
        fileName: e.fileName,
        storedName: e.storedName,
        format: e.format,
        bytes: e.bytes,
        sha256: e.sha256,
        addedAt: e.at,
        status: "waiting",
        sections: [],
        passageCount: 0,
        proposed: 0,
        dropped: 0,
        linksProposed: 0,
        updatedAt: e.at,
      });
      continue;
    }
    const m = state.materials.get(e.materialId);
    if (!m) continue;
    m.updatedAt = e.at;
    if (e.type === "material.started") {
      m.runId = e.runId;
      if (m.status === "waiting" || m.status === "failed") {
        m.status = "reading";
        m.error = undefined;
      }
      continue;
    }
    m.status = MATERIAL_STATUS[e.type] ?? m.status;
    if (e.type === "material.extracted") {
      m.sections = e.sections;
      m.passageCount = e.passageCount;
    } else if (e.type === "material.conceptsProposed") {
      m.proposed = e.proposed;
      m.dropped = e.dropped;
    } else if (e.type === "material.linksProposed") m.linksProposed = e.proposed;
    else if (e.type === "material.failed") m.error = e.error;
  }

  for (const e of logs.concepts) {
    if (e.type === "concept.proposed") {
      state.concepts.set(e.conceptId, {
        conceptId: e.conceptId,
        courseId: e.courseId,
        materialId: e.materialId,
        sectionId: e.sectionId,
        name: e.name,
        quotes: [...e.quotes],
        status: "proposed",
        proposedAt: e.at,
      });
      continue;
    }
    const c = state.concepts.get(e.conceptId);
    if (!c) continue;
    if (e.type === "concept.confirmed") {
      c.status = "confirmed";
      c.confirmedAt = e.at;
    } else if (e.type === "concept.renamed") c.name = e.name;
    else if (e.type === "concept.dropped") c.status = "dropped";
    else if (e.type === "concept.merged") {
      c.status = "merged";
      c.mergedInto = e.intoConceptId;
      const target = state.concepts.get(e.intoConceptId);
      if (target) {
        for (const q of c.quotes) {
          if (!target.quotes.some((t) => t.passageId === q.passageId && t.text === q.text)) target.quotes.push(q);
        }
      }
    }
  }

  for (const e of logs.links) {
    if (e.type === "link.proposed") {
      state.links.set(e.linkId, { linkId: e.linkId, courseId: e.courseId, conceptId: e.conceptId, needsConceptId: e.needsConceptId, status: "proposed" });
      continue;
    }
    const link = state.links.get(e.linkId);
    if (link) link.status = e.type === "link.confirmed" ? "confirmed" : "dropped";
  }

  for (const e of logs.sessions) {
    if (e.type === "session.started") {
      state.sessions.set(e.sessionId, {
        sessionId: e.sessionId,
        conceptId: e.conceptId,
        explanation: e.explanation,
        startedAt: e.at,
        rounds: [],
        missesDropped: 0,
        status: "thinking",
        updatedAt: e.at,
      });
      continue;
    }
    const s = state.sessions.get(e.sessionId);
    if (!s) continue;
    s.updatedAt = e.at;
    if (e.type === "session.running") s.runId = e.runId;
    else if (e.type === "session.questions") s.rounds.push({ round: e.round, questions: e.questions, dropped: e.dropped, notInMaterial: e.notInMaterial });
    else if (e.type === "session.answered") {
      const round = s.rounds.find((r) => r.round === e.round);
      if (round) {
        round.answers = e.answers;
        round.finish = e.finish;
      }
    } else if (e.type === "session.missesProposed") {
      s.misses = e.misses;
      s.missesDropped = e.dropped;
    } else if (e.type === "session.ended") {
      s.ended = { at: e.at, confirmedMissIds: e.confirmedMissIds, rejectedMissIds: e.rejectedMissIds, clean: e.clean };
    } else if (e.type === "session.failed") s.error = e.error;
  }
  for (const s of state.sessions.values()) s.status = sessionStatus(s);

  for (const e of logs.corrections) {
    if (e.type === "correction.added") {
      state.corrections.push({
        correctionId: e.correctionId,
        passageId: e.passageId,
        quote: e.quote,
        correction: e.correction,
        note: e.note,
        sessionId: e.sessionId,
        at: e.at,
      });
    } else if (e.type === "clarification.asked") {
      state.clarifications.set(e.clarificationId, { clarificationId: e.clarificationId, passageId: e.passageId, quote: e.quote, question: e.question, askedAt: e.at });
    } else {
      const c = state.clarifications.get(e.clarificationId);
      if (c) c.answer = e.answer;
    }
  }

  return state;
}

/** Follows merges to the concept that a concept id now points to. */
export function resolveConceptId(state: State, conceptId: string): string {
  let id = conceptId;
  const seen = new Set<string>();
  for (;;) {
    const c = state.concepts.get(id);
    if (!c || c.status !== "merged" || !c.mergedInto || seen.has(id)) return id;
    seen.add(id);
    id = c.mergedInto;
  }
}

/** Reads every log file (except passages) and rebuilds the current state. */
export async function loadState(home: string): Promise<State> {
  const [courses, materials, concepts, links, sessions, corrections, catches] = await Promise.all([
    readLog(home, "courses"),
    readLog(home, "materials"),
    readLog(home, "concepts"),
    readLog(home, "links"),
    readLog(home, "sessions"),
    readLog(home, "corrections"),
    readLog(home, "catches"),
  ]);
  return reduceState({ courses, materials, concepts, links, sessions, corrections, catches });
}

/** Every passage, by id, read from `passages.jsonl`. */
export async function loadPassages(home: string): Promise<Map<string, Passage>> {
  const map = new Map<string, Passage>();
  for (const e of await readLog(home, "passages")) for (const p of e.passages) map.set(p.passageId, p);
  return map;
}
