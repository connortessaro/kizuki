import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  addCorrection,
  addMaterial,
  answerClarification,
  confirmConcept,
  confirmLink,
  createCourse,
  dropConcept,
  dropLink,
  mergeConcept,
  recordCatch,
  renameConcept,
  setExamDate,
  startRetry,
  startSession,
} from "../lib/commands";
import type { Answer, Passage } from "../lib/events";
import { MAX_ROUNDS, MAX_TRIES } from "../lib/limits";
import {
  checkModels,
  makeAsk,
  makeEmbedder,
  sendsMaterialOut,
  type Env,
} from "../lib/model";
import { storedFilePath } from "../lib/paths";
import { rebuildIndex } from "../lib/rebuild";
import {
  answerRound,
  continueSession,
  finishMaterialReview,
  processMaterial,
  resumeUnfinished,
  type Models,
} from "../lib/run";
import { localDate } from "../lib/schedule";
import { endSession, failSession } from "../lib/sessionFlow";
import {
  PRESETS,
  readSettings,
  writeSettings,
  type Settings,
} from "../lib/settings";
import { describeLocation } from "../lib/sources";
import {
  loadPassages,
  loadState,
  resolveConceptId,
  type ConceptState,
  type SessionState,
  type State,
} from "../lib/state";
import { reviewPlans, todayView, weakPrerequisites } from "../lib/views";
import { looksLikeFiles, splitPaths } from "./paths";

/** The kind of a line in the conversation, which sets its color. */
export type LineKind =
  | "info"
  | "error"
  | "you"
  | "kizuki"
  | "source"
  | "heading"
  | "hint"
  | "done";

/** One line of the conversation. */
export interface Line {
  /** A number that only grows, used as the line's key. */
  id: number;
  /** What kind of line it is. */
  kind: LineKind;
  /** The words shown. */
  text: string;
  /** For a source line: the file to open and the page, if any. */
  file?: { path: string; page?: number };
}

/** One choice in a pick list. */
export interface PanelItem {
  /** What choosing it returns. */
  id: string;
  /** The words shown. */
  label: string;
  /** Smaller words shown after the label, such as where a quote comes from. */
  detail?: string;
  /** Whether it starts ticked. Only used when more than one can be picked. */
  checked: boolean;
}

/** A pick list shown above the input while Kizuki waits for a choice. */
export interface Panel {
  /** The question above the list. */
  title: string;
  /** The choices. */
  items: PanelItem[];
  /** True when you tick any number of items; false when you pick one. */
  multi: boolean;
}

/** What the top line shows. */
export interface Status {
  /** The current course's name, if any. */
  course?: string;
  /** How many concepts are due today in the current course. */
  due: number;
  /** The answer model's name. */
  model: string;
  /** What Kizuki is doing in the background, if anything. */
  busy?: string;
}

/** Everything the screen shows. */
export interface View {
  /** The conversation so far. */
  lines: Line[];
  /** The pick list, while Kizuki waits for a choice. */
  panel?: Panel;
  /** The words before the input box. */
  prompt: string;
  /** The top line. */
  status: Status;
}

/** What the study controller needs from outside. Tests pass their own. */
export interface StudyOptions {
  /** The home folder. */
  home: string;
  /** Environment variables, for API keys. */
  env?: Env;
  /** Overrides the models made from settings. Tests pass fake ones. */
  models?: Models;
  /** Today's date as `YYYY-MM-DD`. Defaults to the computer's date. */
  today?: () => string;
  /** Asks the model servers which models they have. Defaults to the real check. */
  checkModels?: typeof checkModels;
  /** Opens a file in its usual app. */
  openFile?: (path: string) => void;
  /** Called when you quit. */
  onQuit?: () => void;
}

class Stopped extends Error {
  constructor() {
    super("Stopped.");
  }
}

const COMMAND_PROMPT = ">";

const HELP = [
  "/course [name]        switch course, or make a new one",
  "/add <files>          add files to the course (or drop them onto this window)",
  "/review               confirm the concepts and links Kizuki proposed",
  "/teach [concept]      teach a concept back from memory; with no name, the first one due",
  "/due                  what is due, coming up, and waiting",
  "/concepts             the course's confirmed concepts",
  "/rename <a> = <b>     rename a concept",
  "/merge <a> into <b>   merge one concept into another",
  "/drop <concept>       drop a concept",
  "/exam <YYYY-MM-DD>    set the exam date (or /exam none)",
  "/open <n>             open source [n] at its page",
  "/correct <n>          the material in source [n] is wrong: record your version",
  "/catch <note>         record something you would have gotten wrong on an exam",
  "/history              the last 8 weeks",
  "/model [preset]       show or change models: ollama, mlx, gateway",
  "/model answer <name>  use another answer model; /model search <name> for meaning search",
  "/rebuild              rebuild the search file",
  "/quit                 leave Kizuki (Ctrl+C twice also works)",
];

/**
 * The study loop behind the terminal app, with no screen code: it turns what you type into
 * calls to `lib/` and keeps the conversation, the pick list, and the top line. The screen
 * reads {@link Study.view} and calls {@link Study.submit}, {@link Study.pick}, and
 * {@link Study.cancel}.
 */
export class Study {
  private readonly home: string;
  private readonly env: Env;
  private readonly options: StudyOptions;
  private lines: Line[] = [];
  private nextId = 1;
  private panel?: Panel;
  private prompt = COMMAND_PROMPT;
  private status: Status = { due: 0, model: "" };
  private courseId?: string;
  private sources: string[] = [];
  private lastEnded?: string;
  private waitingText?: {
    resolve: (text: string) => void;
    reject: (error: Error) => void;
  };
  private waitingPick?: {
    resolve: (ids: string[]) => void;
    reject: (error: Error) => void;
  };
  private flow?: Promise<void>;
  private queue: string[] = [];
  private processing?: Promise<void>;
  private listeners = new Set<() => void>();
  private snapshot?: View;

  constructor(options: StudyOptions) {
    this.options = options;
    this.home = options.home;
    this.env = options.env ?? process.env;
  }

  /** Calls `listener` whenever the view changes. Returns a function that stops it. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** What the screen shows now. */
  view(): View {
    // The same object until something changes, as React's useSyncExternalStore needs.
    if (!this.snapshot) {
      this.snapshot = {
        lines: this.lines,
        panel: this.panel,
        prompt: this.prompt,
        status: this.status,
      };
    }
    return this.snapshot;
  }

  /** Resolves when the current flow and the file queue are both done. For tests. */
  async idle(): Promise<void> {
    for (;;) {
      const waitingForYou = Boolean(this.waitingText || this.waitingPick);
      if ((!this.flow || waitingForYou) && !this.processing) return;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  }

  /** Starts Kizuki: checks the models, picks a course, finishes work left from last time, and says what is due. */
  async start(): Promise<void> {
    const settings = await this.settingsOrDefault();
    this.status = { ...this.status, model: settings.chat.model };
    const check = await (this.options.checkModels ?? checkModels)(
      settings,
      this.env,
    );
    for (const p of check.problems) this.say("error", p);
    const state = await loadState(this.home);
    this.courseId = latestCourse(state);
    if (!this.courseId) {
      this.say(
        "info",
        "Welcome to Kizuki. Make a course first: /course <name>, for example /course Biology 101.",
      );
    }
    await this.refreshStatus();
    if (check.ok) await this.resume();
    if (this.courseId) await this.sayDue();
    this.say("hint", "Type /help for commands.");
  }

  /** Handles a line you typed. */
  async submit(raw: string): Promise<void> {
    const text = raw.trim();
    if (this.waitingText && !text.startsWith("/")) {
      const waiting = this.waitingText;
      this.waitingText = undefined;
      this.prompt = COMMAND_PROMPT;
      if (text) this.say("you", text);
      waiting.resolve(text);
      return this.changed();
    }
    if (!text) return;
    this.say("you", text);
    if (text.startsWith("/") && !looksLikeFiles(text))
      return this.command(text);
    if (looksLikeFiles(text))
      return this.startFlow(() => this.add(splitPaths(text)));
    if (this.waitingPick)
      return this.say(
        "hint",
        "Pick from the list: arrow keys and Enter, or Esc to stop.",
      );
    this.say("hint", "Type /teach to start, or /help.");
  }

  /** Answers the pick list with the ids you picked. */
  pick(ids: string[]): void {
    const waiting = this.waitingPick;
    if (!waiting) return;
    this.waitingPick = undefined;
    this.panel = undefined;
    waiting.resolve(ids);
    this.changed();
  }

  /** Stops what Kizuki is waiting for (Esc). Nothing more is saved from that step. */
  cancel(): void {
    const waiting = this.waitingPick ?? this.waitingText;
    if (!waiting) return;
    this.waitingPick = undefined;
    this.waitingText = undefined;
    this.panel = undefined;
    this.prompt = COMMAND_PROMPT;
    waiting.reject(new Stopped());
    this.changed();
  }

  private changed(): void {
    this.snapshot = undefined;
    for (const l of this.listeners) l();
  }

  private say(kind: LineKind, text: string, file?: Line["file"]): void {
    this.lines = [...this.lines, { id: this.nextId++, kind, text, file }];
    this.changed();
  }

  private ask(prompt: string): Promise<string> {
    this.prompt = prompt;
    this.changed();
    return new Promise(
      (resolve, reject) => (this.waitingText = { resolve, reject }),
    );
  }

  private choose(panel: Panel): Promise<string[]> {
    this.panel = panel;
    this.changed();
    return new Promise(
      (resolve, reject) => (this.waitingPick = { resolve, reject }),
    );
  }

  private async yesNo(
    title: string,
    yes: string,
    no: string,
  ): Promise<boolean> {
    const [picked] = await this.choose({
      title,
      multi: false,
      items: [
        { id: "yes", label: yes, checked: false },
        { id: "no", label: no, checked: false },
      ],
    });
    return picked === "yes";
  }

  private async busy<T>(what: string, work: () => Promise<T>): Promise<T> {
    this.status = { ...this.status, busy: what };
    this.changed();
    try {
      return await work();
    } finally {
      this.status = { ...this.status, busy: undefined };
      this.changed();
    }
  }

  private startFlow(work: () => Promise<void>): void {
    if (this.flow) {
      this.say(
        "hint",
        "Finish what Kizuki is asking first, or press Esc to stop it.",
      );
      return;
    }
    const run = async () => {
      try {
        await work();
      } catch (error) {
        if (error instanceof Stopped) this.say("hint", "Stopped.");
        else this.say("error", (error as Error).message);
      }
      this.prompt = COMMAND_PROMPT;
      await this.refreshStatus();
    };
    // Cleared in .finally, which always runs after the assignment, even if the work ends at once.
    this.flow = run().finally(() => (this.flow = undefined));
  }

  private async command(text: string): Promise<void> {
    const [name = "", ...rest] = text.slice(1).split(/\s+/);
    const arg = rest.join(" ").trim();
    switch (name.toLowerCase()) {
      case "help":
        for (const line of HELP) this.say("info", line);
        return;
      case "quit":
      case "exit":
        this.options.onQuit?.();
        return;
      case "open":
        return this.open(arg);
      case "course":
        return this.startFlow(() => this.course(arg));
      case "add":
        return this.startFlow(() => this.add(splitPaths(arg)));
      case "review":
        return this.startFlow(() => this.review());
      case "teach":
        return this.startFlow(() => this.teach(arg));
      case "due":
        return this.startFlow(() => this.sayDue());
      case "concepts":
        return this.startFlow(() => this.concepts());
      case "rename":
        return this.startFlow(() => this.rename(arg));
      case "merge":
        return this.startFlow(() => this.merge(arg));
      case "drop":
        return this.startFlow(() => this.drop(arg));
      case "exam":
        return this.startFlow(() => this.exam(arg));
      case "correct":
        return this.startFlow(() => this.correct(arg));
      case "catch":
        return this.startFlow(() => this.catchNote(arg));
      case "history":
        return this.startFlow(() => this.history());
      case "model":
        return this.startFlow(() => this.model(arg));
      case "rebuild":
        return this.startFlow(() => this.rebuild());
      default:
        this.say("error", `There is no /${name}. Type /help for commands.`);
    }
  }

  private async settingsOrDefault(): Promise<Settings> {
    try {
      return await readSettings(this.home);
    } catch (error) {
      this.say("error", (error as Error).message);
      return PRESETS.ollama;
    }
  }

  private async models(): Promise<Models> {
    if (this.options.models) return this.options.models;
    const settings = await readSettings(this.home);
    return {
      ask: makeAsk(settings.chat, this.env),
      embed: makeEmbedder(settings.embed, this.env),
      embedModel: settings.embed.model,
    };
  }

  private today(): string {
    return this.options.today?.() ?? localDate(new Date().toISOString());
  }

  private async refreshStatus(): Promise<void> {
    const state = await loadState(this.home);
    const course = this.courseId ? state.courses.get(this.courseId) : undefined;
    const due = course
      ? todayView(state, this.today()).due.filter(
          (d) => d.courseId === course.courseId,
        ).length
      : 0;
    this.status = { ...this.status, course: course?.name, due };
    this.changed();
  }

  private async mustCourse(): Promise<{ state: State; courseId: string }> {
    const state = await loadState(this.home);
    if (!this.courseId || !state.courses.has(this.courseId))
      throw new Error("Make a course first: /course <name>.");
    return { state, courseId: this.courseId };
  }

  // Files ------------------------------------------------------------------

  private async resume(): Promise<void> {
    const { materials, sessions } = await this.busy(
      "Finishing work from last time",
      async () => resumeUnfinished(this.home, await this.models()),
    );
    if (materials.length > 0) {
      const state = await loadState(this.home);
      for (const id of materials) this.reportFile(state, id);
    }
    if (sessions.length > 0)
      this.say(
        "info",
        `${sessions.length === 1 ? "A session is" : `${sessions.length} sessions are`} still open. /teach <concept> picks it up where you left off.`,
      );
  }

  private async add(paths: string[]): Promise<void> {
    if (paths.length === 0)
      throw new Error(
        "Name the files to add, for example: /add ~/Downloads/lecture1.pdf",
      );
    const { courseId } = await this.mustCourse();
    for (const path of paths) {
      try {
        const bytes = new Uint8Array(await readFile(path));
        const materialId = await addMaterial(this.home, {
          courseId,
          fileName: basename(path),
          bytes,
        });
        this.say("info", `Added ${basename(path)}. Kizuki is reading it.`);
        this.queue.push(materialId);
      } catch (error) {
        const e = error as NodeJS.ErrnoException;
        this.say(
          "error",
          `${basename(path)}: ${e.code === "ENOENT" ? "no such file" : e.message}`,
        );
      }
    }
    this.processQueue();
  }

  private processQueue(): void {
    if (this.processing || this.queue.length === 0) return;
    const run = async () => {
      for (let id = this.queue.shift(); id; id = this.queue.shift()) {
        const state = await loadState(this.home);
        const name = state.materials.get(id)?.fileName ?? "file";
        await this.busy(`Reading ${name}`, async () =>
          processMaterial(this.home, id, await this.models()),
        );
        this.reportFile(await loadState(this.home), id);
      }
      await this.refreshStatus();
    };
    // Cleared in .finally, which always runs after the assignment, even if the run ends at once.
    this.processing = run()
      .catch((error: Error) => this.say("error", error.message))
      .finally(() => (this.processing = undefined));
  }

  private reportFile(state: State, materialId: string): void {
    const m = state.materials.get(materialId);
    if (!m) return;
    if (m.status === "failed") {
      this.say(
        "error",
        `${m.fileName} failed: ${m.error}. Add it again to try again.`,
      );
      return;
    }
    if (m.status === "review") {
      const dropped =
        m.dropped > 0
          ? ` (${m.dropped} of the model's proposals failed the checks and were left out)`
          : "";
      this.say(
        "done",
        `${m.fileName}: ${m.passageCount} passages, ${m.proposed} concepts proposed${dropped}. Type /review to confirm them.`,
      );
      return;
    }
    if (m.status === "done") this.say("done", `${m.fileName} is ready.`);
  }

  // Courses ----------------------------------------------------------------

  private async course(name: string): Promise<void> {
    const state = await loadState(this.home);
    const courses = [...state.courses.values()];
    if (!name) {
      if (courses.length === 0)
        return this.say("info", "No courses yet. Make one: /course <name>.");
      for (const c of courses)
        this.say(
          "info",
          `${c.courseId === this.courseId ? "❯" : " "} ${c.name}${c.examDate ? ` · exam ${c.examDate}` : ""}`,
        );
      return;
    }
    const found = courses.find(
      (c) => c.name.toLowerCase() === name.toLowerCase(),
    );
    this.courseId = found?.courseId ?? (await createCourse(this.home, name));
    this.say(
      "done",
      found
        ? `Switched to ${found.name}.`
        : `Made the course ${name}. Add files with /add, or drop them here.`,
    );
  }

  private async exam(arg: string): Promise<void> {
    const { courseId } = await this.mustCourse();
    const date = arg.toLowerCase() === "none" ? null : arg;
    if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw new Error(
        "Write the date as YYYY-MM-DD, for example /exam 2026-12-15, or /exam none.",
      );
    await setExamDate(this.home, courseId, date);
    this.say(
      "done",
      date
        ? `Exam set for ${date}. Reviews that would fall after it move to before it.`
        : "Exam date cleared.",
    );
  }

  // Review -----------------------------------------------------------------

  private async review(): Promise<void> {
    const { state, courseId } = await this.mustCourse();
    const passages = await loadPassages(this.home);
    let didSomething = false;

    const proposed = [...state.concepts.values()].filter(
      (c) => c.courseId === courseId && c.status === "proposed",
    );
    if (proposed.length > 0) {
      didSomething = true;
      const kept = await this.choose({
        title:
          "Proposed concepts. Space ticks or unticks, Enter confirms the ticked ones and drops the rest.",
        multi: true,
        items: proposed.map((c) => ({
          id: c.conceptId,
          label: c.name,
          detail: this.whereFrom(state, passages, c),
          checked: true,
        })),
      });
      for (const c of proposed) {
        if (kept.includes(c.conceptId))
          await confirmConcept(this.home, c.conceptId);
        else await dropConcept(this.home, c.conceptId);
      }
      this.say(
        "done",
        `Confirmed ${kept.length}, dropped ${proposed.length - kept.length}.`,
      );
    }

    const reviewing = [
      ...(await loadState(this.home)).materials.values(),
    ].filter((m) => m.courseId === courseId && m.status === "review");
    for (const m of reviewing)
      await this.busy(`Suggesting links for ${m.fileName}`, async () =>
        finishMaterialReview(this.home, m.materialId, await this.models()),
      );
    const after = await loadState(this.home);
    for (const m of reviewing) {
      const failed = after.materials.get(m.materialId);
      if (failed?.status === "failed")
        this.say("error", `Links for ${m.fileName} failed: ${failed.error}`);
    }

    const links = [...after.links.values()].filter(
      (l) => l.courseId === courseId && l.status === "proposed",
    );
    if (links.length > 0) {
      didSomething = true;
      const name = (id: string) =>
        after.concepts.get(resolveConceptId(after, id))?.name ?? id;
      const kept = await this.choose({
        title:
          "Proposed order: learn the second before the first. Enter confirms the ticked ones.",
        multi: true,
        items: links.map((l) => ({
          id: l.linkId,
          label: `${name(l.conceptId)} needs ${name(l.needsConceptId)} first`,
          checked: true,
        })),
      });
      let confirmed = 0;
      for (const l of links) {
        if (!kept.includes(l.linkId)) {
          await dropLink(this.home, l.linkId);
          continue;
        }
        try {
          await confirmLink(this.home, l.linkId);
          confirmed += 1;
        } catch (error) {
          this.say("error", (error as Error).message);
        }
      }
      this.say("done", `Confirmed ${confirmed} links.`);
    }

    const open = [...after.clarifications.values()].filter(
      (c) =>
        !c.answer &&
        after.materials.get(passages.get(c.passageId)?.materialId ?? "")
          ?.courseId === courseId,
    );
    for (const c of open) {
      didSomething = true;
      this.say("kizuki", c.question);
      this.sayQuote(after, passages, c.passageId, c.quote);
      const answer = await this.ask("What does it mean? (Enter skips)");
      if (answer)
        await answerClarification(this.home, c.clarificationId, answer);
    }

    if (!didSomething)
      this.say(
        "info",
        reviewing.length > 0
          ? "Nothing else to review."
          : "Nothing is waiting for review.",
      );
  }

  private whereFrom(
    state: State,
    passages: Map<string, Passage>,
    c: ConceptState,
  ): string | undefined {
    const p = c.quotes[0] ? passages.get(c.quotes[0].passageId) : undefined;
    return p
      ? describeLocation(
          p.location,
          state.materials.get(p.materialId)?.fileName ?? "",
        )
      : undefined;
  }

  // Concepts ---------------------------------------------------------------

  private findConcept(
    state: State,
    courseId: string,
    name: string,
  ): ConceptState {
    const confirmed = [...state.concepts.values()].filter(
      (c) => c.courseId === courseId && c.status === "confirmed",
    );
    const lower = name.toLowerCase();
    const exact = confirmed.find((c) => c.name.toLowerCase() === lower);
    if (exact) return exact;
    const partial = confirmed.filter((c) =>
      c.name.toLowerCase().includes(lower),
    );
    if (partial.length === 1) return partial[0]!;
    if (partial.length > 1)
      throw new Error(
        `"${name}" matches ${partial.map((c) => c.name).join(", ")}. Type more of the name.`,
      );
    throw new Error(
      `No confirmed concept called "${name}". /concepts lists them.`,
    );
  }

  private async concepts(): Promise<void> {
    const { state, courseId } = await this.mustCourse();
    const plans = reviewPlans(state, this.today());
    const list = [...state.concepts.values()].filter(
      (c) => c.courseId === courseId && c.status === "confirmed",
    );
    if (list.length === 0)
      return this.say(
        "info",
        "No confirmed concepts yet. Add files, then /review.",
      );
    for (const c of list) {
      const plan = plans.get(c.conceptId);
      const when = !plan
        ? ""
        : plan.status === "blocked"
          ? "waiting on what it needs"
          : plan.status === "due"
            ? "due now"
            : `next ${plan.due}`;
      this.say("info", `${c.name} · ${when}`);
    }
  }

  private async rename(arg: string): Promise<void> {
    const [from, to] = arg.split("=").map((s) => s.trim());
    if (!from || !to)
      throw new Error("Write it as /rename old name = new name.");
    const { state, courseId } = await this.mustCourse();
    const c = this.findConcept(state, courseId, from);
    await renameConcept(this.home, c.conceptId, to);
    this.say("done", `Renamed ${c.name} to ${to}.`);
  }

  private async merge(arg: string): Promise<void> {
    const [from, into] = arg.split(/\s+into\s+/i).map((s) => s.trim());
    if (!from || !into)
      throw new Error("Write it as /merge concept into other concept.");
    const { state, courseId } = await this.mustCourse();
    const a = this.findConcept(state, courseId, from);
    const b = this.findConcept(state, courseId, into);
    await mergeConcept(this.home, a.conceptId, b.conceptId);
    this.say("done", `Merged ${a.name} into ${b.name}.`);
  }

  private async drop(arg: string): Promise<void> {
    if (!arg) throw new Error("Name the concept to drop: /drop <concept>.");
    const { state, courseId } = await this.mustCourse();
    const c = this.findConcept(state, courseId, arg);
    if (
      !(await this.yesNo(
        `Drop ${c.name}? It stops coming back for review.`,
        "Drop it",
        "Keep it",
      ))
    )
      return;
    await dropConcept(this.home, c.conceptId);
    this.say("done", `Dropped ${c.name}.`);
  }

  // Due and history --------------------------------------------------------

  private async sayDue(): Promise<void> {
    const { state, courseId } = await this.mustCourse();
    const view = todayView(state, this.today());
    const due = view.due.filter((d) => d.courseId === courseId);
    const upcoming = view.upcoming.filter((d) => d.courseId === courseId);
    const course = state.courses.get(courseId)!;
    const blocked = view.blocked.filter((b) => b.courseName === course.name);
    if (due.length + upcoming.length + blocked.length === 0)
      return this.say(
        "info",
        "Nothing to review yet. Add files with /add, then /review.",
      );
    this.say(
      "heading",
      due.length > 0
        ? `Due now: ${due.map((d) => d.name).join(", ")}`
        : "Nothing is due today.",
    );
    if (upcoming.length > 0)
      this.say(
        "info",
        `Coming up: ${upcoming
          .slice(0, 8)
          .map((d) => `${d.name} (${d.due})`)
          .join(", ")}`,
      );
    for (const b of blocked)
      this.say(
        "info",
        `Waiting: ${b.name} needs ${b.waitingOn.join(", ")} first`,
      );
    if (due.length > 0) this.say("hint", "/teach starts the first one.");
  }

  private async history(): Promise<void> {
    const { state, courseId } = await this.mustCourse();
    const today = this.today();
    const from = new Date(`${today}T00:00:00Z`);
    from.setUTCDate(from.getUTCDate() - 56);
    const sessions = [...state.sessions.values()]
      .filter(
        (s) =>
          s.ended &&
          state.concepts.get(resolveConceptId(state, s.conceptId))?.courseId ===
            courseId &&
          s.ended.at >= from.toISOString(),
      )
      .sort((a, b) => b.ended!.at.localeCompare(a.ended!.at));
    if (sessions.length === 0)
      return this.say("info", "No sessions in the last 8 weeks.");
    const clean = sessions.filter((s) => s.ended!.clean).length;
    const catches = state.catches.filter((c) =>
      sessions.some((s) => s.sessionId === c.sessionId),
    ).length;
    this.say(
      "heading",
      `Last 8 weeks: ${sessions.length} sessions, ${clean} clean, ${catches} catches.`,
    );
    for (const s of sessions.slice(0, 10)) {
      const name =
        state.concepts.get(resolveConceptId(state, s.conceptId))?.name ?? "";
      const misses = s.ended!.confirmedMissIds.length;
      this.say(
        "info",
        `${s.ended!.at.slice(0, 10)} ${name} · ${s.ended!.clean ? "clean" : `${misses} missed`}${s.retryOf ? " · another try" : ""}`,
      );
    }
  }

  // Teach-back -------------------------------------------------------------

  private async teach(arg: string): Promise<void> {
    const { state, courseId } = await this.mustCourse();
    let concept: ConceptState;
    if (arg) concept = this.findConcept(state, courseId, arg);
    else {
      const first = todayView(state, this.today()).due.find(
        (d) => d.courseId === courseId,
      );
      if (!first)
        throw new Error(
          "Nothing is due. Pick a concept: /teach <concept>. /concepts lists them.",
        );
      concept = state.concepts.get(first.conceptId)!;
    }
    const open = [...state.sessions.values()].find(
      (s) =>
        resolveConceptId(state, s.conceptId) === concept.conceptId &&
        (s.status === "thinking" ||
          s.status === "answering" ||
          s.status === "reviewing"),
    );
    if (open) {
      const pickUp = await this.yesNo(
        `${concept.name} has a session still open.`,
        "Pick it up where I left off",
        "Stop it and start over",
      );
      if (pickUp) return this.runSession(open.sessionId, concept);
      await failSession(this.home, open.sessionId, "You stopped this session.");
    }
    this.say("heading", `Teach: ${concept.name}`);
    this.say(
      "info",
      "Explain it from memory, in your own words. The material stays hidden until you finish.",
    );
    const explanation = await this.ask("Your explanation");
    const sessionId = await startSession(
      this.home,
      concept.conceptId,
      explanation,
    );
    await this.runSession(sessionId, concept);
  }

  private async runSession(
    sessionId: string,
    concept: ConceptState,
  ): Promise<void> {
    for (;;) {
      await this.busy("Kizuki is thinking", async () =>
        continueSession(this.home, sessionId, await this.models()),
      );
      const state = await loadState(this.home);
      const passages = await loadPassages(this.home);
      const s = state.sessions.get(sessionId)!;
      if (s.status === "failed")
        throw new Error(
          `This session stopped: ${s.error} Start a new one with /teach.`,
        );
      if (s.status === "answering") {
        await this.answerRound(state, passages, s);
        continue;
      }
      if (s.status === "reviewing") {
        this.sayRoundEnd(s);
        const misses = s.misses ?? [];
        let confirmed: string[] = [];
        if (misses.length > 0) {
          confirmed = await this.choose({
            title:
              "Points from the material your explanation barely used. Tick the ones you missed, then Enter.",
            multi: true,
            items: misses.map((m) => ({
              id: m.missId,
              label: `“${m.quote.text}”`,
              detail: this.label(state, passages, m.quote.passageId),
              checked: false,
            })),
          });
        }
        await endSession(this.home, sessionId, confirmed);
        continue;
      }
      if (s.status === "ended") return this.sessionResult(sessionId, concept);
    }
  }

  private async answerRound(
    state: State,
    passages: Map<string, Passage>,
    s: SessionState,
  ): Promise<void> {
    const round = s.rounds[s.rounds.length - 1]!;
    this.say("heading", `Round ${round.round} of up to ${MAX_ROUNDS}`);
    if (round.dropped > 0)
      this.say(
        "hint",
        `${round.dropped} of the model's questions failed the quote check and were left out.`,
      );
    const answers: Answer[] = [];
    for (const q of round.questions) {
      this.say("kizuki", q.text);
      if (q.quote) this.sayQuote(state, passages, q.quote.passageId);
      let verdict: Answer["verdict"];
      let correction: string | undefined;
      if (q.kind === "contradiction") {
        const [picked] = await this.choose({
          title: "Which is right?",
          multi: false,
          items: [
            {
              id: "material-right",
              label: "The material is right (I got it wrong)",
              checked: false,
            },
            {
              id: "material-wrong",
              label: "The material is wrong",
              checked: false,
            },
            {
              id: "misread",
              label: "Kizuki misread what I wrote",
              checked: false,
            },
          ],
        });
        verdict = picked as Answer["verdict"];
        if (verdict === "material-wrong") {
          while (!correction)
            correction =
              (await this.ask("The correct version, which wins from now on")) ||
              undefined;
        }
      }
      const text = await this.ask("Your answer (Enter skips)");
      answers.push({ questionId: q.questionId, text, verdict, correction });
    }
    let finish = round.round >= MAX_ROUNDS;
    if (!finish)
      finish = !(await this.yesNo(
        "Send your answers.",
        "Send and keep going",
        "Send and finish",
      ));
    await this.busy("Kizuki is thinking", async () =>
      answerRound(
        this.home,
        s.sessionId,
        round.round,
        { answers, finish },
        await this.models(),
      ),
    );
  }

  private sayRoundEnd(s: SessionState): void {
    const last = s.rounds[s.rounds.length - 1];
    if (!last || last.questions.length > 0) return;
    if (last.notInMaterial)
      this.say(
        "kizuki",
        "Not in your material: nothing in it matches what you wrote.",
      );
    else
      this.say(
        "kizuki",
        "Kizuki has no more questions it can back with your material.",
      );
  }

  private async sessionResult(
    sessionId: string,
    concept: ConceptState,
  ): Promise<void> {
    const state = await loadState(this.home);
    const passages = await loadPassages(this.home);
    const s = state.sessions.get(sessionId)!;
    this.lastEnded = sessionId;
    const conceptId = resolveConceptId(state, concept.conceptId);
    const plan = reviewPlans(state, this.today()).get(conceptId);
    const missed = s.ended!.confirmedMissIds.length;
    if (s.ended!.clean)
      this.say(
        "done",
        s.retryOf
          ? "Clean this time."
          : `Clean. ${concept.name} comes back ${plan ? `on ${plan.due}` : "later"}.`,
      );
    else
      this.say(
        "done",
        `You missed ${missed === 0 ? "a point" : `${missed} point${missed === 1 ? "" : "s"}`}. ${concept.name} comes back ${plan ? `on ${plan.due}` : "soon"}.`,
      );
    const weak = weakPrerequisites(state, conceptId);
    if (!s.ended!.clean && weak.length > 0)
      this.say(
        "info",
        `Not solid yet, and ${concept.name} needs them: ${weak.map((w) => w.name).join(", ")}.`,
      );

    const used = new Set<string>();
    for (const r of s.rounds)
      for (const q of r.questions) if (q.quote) used.add(q.quote.passageId);
    for (const m of s.misses ?? []) used.add(m.quote.passageId);
    for (const q of concept.quotes) used.add(q.passageId);
    if (used.size > 0) {
      this.say("heading", "Now read the material:");
      for (const id of used)
        this.sayQuote(state, passages, id, passages.get(id)?.text);
    }
    this.say(
      "hint",
      "/catch <note> records something you would have gotten wrong on an exam. /correct <n> if a source is wrong.",
    );

    if (s.ended!.clean) return;
    const first = s.retryOf ?? s.sessionId;
    const tries = [...state.sessions.values()].filter(
      (x) => x.sessionId === first || x.retryOf === first,
    ).length;
    if (tries >= MAX_TRIES) return;
    if (
      !(await this.yesNo(
        "Explain it again now, from memory?",
        "Try again",
        "Not now",
      ))
    )
      return;
    const explanation = await this.ask("Your explanation");
    const next = await startRetry(this.home, sessionId, explanation);
    await this.runSession(next, concept);
  }

  private label(
    state: State,
    passages: Map<string, Passage>,
    passageId: string,
  ): string {
    const p = passages.get(passageId);
    return p
      ? describeLocation(
          p.location,
          state.materials.get(p.materialId)?.fileName ?? "your material",
        )
      : "your material";
  }

  private sayQuote(
    state: State,
    passages: Map<string, Passage>,
    passageId: string,
    text?: string,
  ): void {
    const p = passages.get(passageId);
    const m = p ? state.materials.get(p.materialId) : undefined;
    let n = this.sources.indexOf(passageId) + 1;
    if (n === 0) n = this.sources.push(passageId);
    const where = this.label(state, passages, passageId);
    const file = m
      ? { path: storedFilePath(this.home, m), page: p?.location.page }
      : undefined;
    this.say(
      "source",
      text ? `[${n}] ${where}: “${text}”` : `[${n}] ${where}`,
      file,
    );
    if (!text) return;
    // Your corrections win over the material, so show them wherever the passage is shown in full.
    for (const c of state.corrections.filter((x) => x.passageId === passageId)) {
      this.say("done", `Your correction: “${c.quote}” is “${c.correction}”${c.note ? ` (${c.note})` : ""}`);
    }
  }

  private async open(arg: string): Promise<void> {
    const n = Number(arg);
    const passageId = this.sources[n - 1];
    if (!passageId)
      return this.say(
        "error",
        `There is no source [${arg}]. Sources are numbered as they appear.`,
      );
    const state = await loadState(this.home);
    const p = (await loadPassages(this.home)).get(passageId);
    const m = p ? state.materials.get(p.materialId) : undefined;
    if (!m)
      return this.say("error", "That file is no longer in your material.");
    const path = storedFilePath(this.home, m);
    if (!this.options.openFile) return this.say("info", path);
    this.options.openFile(path);
    this.say(
      "info",
      `Opened ${m.fileName}${p?.location.page ? `. Go to page ${p.location.page}` : ""}.`,
    );
  }

  private async correct(arg: string): Promise<void> {
    const passageId = this.sources[Number(arg) - 1];
    if (!passageId) throw new Error("Name a source by its number: /correct 2.");
    const state = await loadState(this.home);
    const passages = await loadPassages(this.home);
    this.sayQuote(state, passages, passageId, passages.get(passageId)?.text);
    const quote = await this.ask(
      "Copy the wrong words exactly as the material has them",
    );
    const correction = await this.ask("Your version, which wins from now on");
    const note = await this.ask(
      "Where it comes from, such as a lecture date (Enter skips)",
    );
    await addCorrection(this.home, { passageId, quote, correction, note });
    this.say("done", "Correction saved. Your version wins from now on.");
  }

  private async catchNote(note: string): Promise<void> {
    if (!this.lastEnded)
      throw new Error(
        "Finish a session first. A catch belongs to the session that caught it.",
      );
    await recordCatch(this.home, this.lastEnded, note);
    this.say("done", "Catch recorded.");
  }

  // Models -----------------------------------------------------------------

  private async model(arg: string): Promise<void> {
    const before = await readSettings(this.home);
    const [first = "", ...rest] = arg.split(/\s+/).filter(Boolean);
    const value = rest.join(" ");
    let after: Settings | undefined;
    if (!first) {
      this.say(
        "info",
        `Answer model: ${before.chat.model} at ${before.chat.baseURL}`,
      );
      this.say(
        "info",
        `Meaning search: ${before.embed.model} at ${before.embed.baseURL}`,
      );
      this.say(
        "hint",
        "/model ollama, /model mlx, or /model gateway switch all at once.",
      );
      return;
    }
    if (first === "ollama" || first === "mlx" || first === "gateway")
      after = { ...PRESETS[first], sendOutAllowed: before.sendOutAllowed };
    else if (first === "answer" && value)
      after = { ...before, chat: { ...before.chat, model: value } };
    else if (first === "search" && value)
      after = { ...before, embed: { ...before.embed, model: value } };
    else
      throw new Error(
        "Use /model, /model ollama|mlx|gateway, /model answer <name>, or /model search <name>.",
      );

    if (sendsMaterialOut(after) && !after.sendOutAllowed) {
      const ok = await this.yesNo(
        "These models run off your computer. Kizuki will send them your material, your explanations, and your answers. Send them?",
        "Yes, send my material",
        "No, keep everything here",
      );
      if (!ok) return this.say("info", "Nothing changed.");
      after = { ...after, sendOutAllowed: true };
    }
    await writeSettings(this.home, after);
    this.status = { ...this.status, model: after.chat.model };
    this.say(
      "done",
      `Answer model: ${after.chat.model}. Meaning search: ${after.embed.model}.`,
    );
    if (
      after.embed.model !== before.embed.model ||
      after.embed.baseURL !== before.embed.baseURL
    ) {
      this.say(
        "info",
        "Meaning search uses another model now, so the search file is out of date. Run /rebuild.",
      );
    }
    const check = await (this.options.checkModels ?? checkModels)(
      after,
      this.env,
    );
    for (const p of check.problems) this.say("error", p);
  }

  private async rebuild(): Promise<void> {
    const models = await this.models();
    const count = await this.busy("Rebuilding the search file", () =>
      rebuildIndex(this.home, models.embed, models.embedModel),
    );
    this.say("done", `Rebuilt the search file: ${count} passages.`);
  }
}

function latestCourse(state: State): string | undefined {
  let best: { id: string; at: string } | undefined;
  const bump = (id: string, at: string) => {
    if (!best || at > best.at) best = { id, at };
  };
  for (const c of state.courses.values()) bump(c.courseId, c.createdAt);
  for (const m of state.materials.values()) bump(m.courseId, m.updatedAt);
  for (const s of state.sessions.values()) {
    const c = state.concepts.get(resolveConceptId(state, s.conceptId));
    if (c) bump(c.courseId, s.updatedAt);
  }
  return best?.id;
}
