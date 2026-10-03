import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Ask } from "../lib/model";
import type { Models } from "../lib/run";
import type { Embedder } from "../lib/search";
import { readSettings } from "../lib/settings";
import { loadState } from "../lib/state";
import { tempHome } from "../lib/test-helpers/home";
import { Study } from "./study";

const MATERIAL = `# Photosynthesis

Photosynthesis converts light energy into chemical energy. It happens in the chloroplast.

# Respiration

Cellular respiration releases energy from glucose in the mitochondria.
`;

const fakeEmbed: Embedder = async (texts) =>
  texts.map((t) =>
    ["light", "glucose", "chloroplast", "mitochondria"].map((w) =>
      t.toLowerCase().includes(w) ? 1 : 0.01,
    ),
  );

function fakeAsk(kind: "contradiction" | "gap" | "none"): Ask {
  return async ({ system, prompt }) => {
    if (system.includes("concept map"))
      return { concepts: [], unclear: [] } as never;
    if (system.includes("order the concepts"))
      return { links: [{ concept: "C2", needs: "C1" }] } as never;
    if (system.includes("curious student")) {
      if (kind === "none") return { questions: [] } as never;
      const label =
        /\[(S\d+)\] It happens in the chloroplast\./.exec(prompt)?.[1] ?? "S1";
      return { questions: [{ kind, sentence: label, term: "" }] } as never;
    }
    return { missed: [] } as never;
  };
}

let home: string;
let cleanup: () => void;
let files: string;
let opened: string[];
let quit: boolean;

beforeEach(() => {
  ({ home, cleanup } = tempHome());
  files = mkdtempSync(join(tmpdir(), "kizuki-files-"));
  writeFileSync(join(files, "bio notes.md"), MATERIAL);
  opened = [];
  quit = false;
});
afterEach(() => cleanup());

function study(
  kind: "contradiction" | "gap" | "none" = "contradiction",
  problems: string[] = [],
): Study {
  const models: Models = {
    ask: fakeAsk(kind),
    embed: fakeEmbed,
    embedModel: "fake",
  };
  return new Study({
    home,
    env: {},
    models,
    today: () => new Date().toISOString().slice(0, 10),
    checkModels: async () => ({ ok: problems.length === 0, problems }),
    openFile: (path) => opened.push(path),
    onQuit: () => (quit = true),
  });
}

async function type(s: Study, text: string): Promise<void> {
  await s.submit(text);
  await s.idle();
}

async function pick(s: Study, ids?: string[]): Promise<void> {
  const panel = s.view().panel!;
  expect(panel).toBeDefined();
  s.pick(ids ?? panel.items.filter((i) => i.checked).map((i) => i.id));
  await s.idle();
}

function said(s: Study): string {
  return s
    .view()
    .lines.map((l) => l.text)
    .join("\n");
}

async function courseWithConcepts(s: Study): Promise<void> {
  await s.start();
  await type(s, "/course Biology");
  await type(s, join(files, "bio notes.md").replace(/ /g, "\\ "));
  expect(said(s)).toContain("2 concepts proposed");
  await type(s, "/review");
  await pick(s); // both concepts, ticked
  await pick(s); // the link
}

describe("starting", () => {
  it("asks you to make a course when there is none, and shows model problems without stopping", async () => {
    const s = study("contradiction", [
      "Nothing is answering at http://localhost:11434/v1. Start Ollama with: ollama serve",
    ]);
    await s.start();
    expect(said(s)).toContain("ollama serve");
    expect(said(s)).toContain("Make a course first");
  });

  it("explains a command it does not know, and quits on /quit", async () => {
    const s = study();
    await s.start();
    await type(s, "/teachh");
    expect(said(s)).toContain("There is no /teachh");
    await type(s, "/quit");
    expect(quit).toBe(true);
  });
});

describe("adding and reviewing material", () => {
  it("adds a dropped file, proposes concepts, and confirms what you keep and the links", async () => {
    const s = study();
    await courseWithConcepts(s);
    const state = await loadState(home);
    expect([...state.concepts.values()].map((c) => c.status)).toEqual([
      "confirmed",
      "confirmed",
    ]);
    expect([...state.links.values()].map((l) => l.status)).toEqual([
      "confirmed",
    ]);
    expect([...state.materials.values()][0]!.status).toBe("done");
  });

  it("drops the concepts you untick", async () => {
    const s = study();
    await s.start();
    await type(s, "/course Biology");
    await type(s, `/add ${join(files, "bio notes.md").replace(/ /g, "\\ ")}`);
    await type(s, "/review");
    const [first] = s.view().panel!.items;
    await pick(s, [first!.id]);
    const statuses = [...(await loadState(home)).concepts.values()].map(
      (c) => c.status,
    );
    expect(statuses).toEqual(["confirmed", "dropped"]);
  });

  it("says so when a file is missing, and saves nothing when you press Esc", async () => {
    const s = study();
    await s.start();
    await type(s, "/course Biology");
    await type(s, `/add ${join(files, "nope.md")}`);
    expect(said(s)).toContain("nope.md: no such file");
    await type(s, `/add ${join(files, "bio notes.md").replace(/ /g, "\\ ")}`);
    await type(s, "/review");
    s.cancel();
    await s.idle();
    expect(said(s)).toContain("Stopped.");
    expect(
      [...(await loadState(home)).concepts.values()].map((c) => c.status),
    ).toEqual(["proposed", "proposed"]);
  });
});

describe("teaching back", () => {
  it("shows no material before your first explanation, then asks, checks, and ends with the passages", async () => {
    const s = study();
    await courseWithConcepts(s);
    const before = s.view().lines.length;
    await type(s, "/teach photosynthesis");
    const shown = s.view().lines.slice(before);
    expect(shown.some((l) => l.kind === "source")).toBe(false);
    expect(shown.map((l) => l.text).join("\n")).not.toContain("chloroplast");
    expect(s.view().prompt).toBe("Your explanation");

    await type(s, "Photosynthesis makes chemical energy from light.");
    expect(said(s)).toContain("How does that fit");
    await pick(s, ["material-right"]);
    await type(s, "I left out where it happens.");
    await pick(s, ["no"]); // send and finish
    await pick(s, []); // no misses ticked
    expect(said(s)).toContain("Now read the material:");
    const ended = [...(await loadState(home)).sessions.values()][0]!;
    expect(ended.ended?.clean).toBe(false);
  });

  it("asks for your version when the material is wrong and saves it as a correction", async () => {
    const s = study();
    await courseWithConcepts(s);
    await type(s, "/teach photosynthesis");
    await type(s, "Photosynthesis makes chemical energy from light.");
    await pick(s, ["material-wrong"]);
    expect(s.view().prompt).toContain("correct version");
    await type(s, "It happens in the chloroplast's stroma.");
    await type(s, "");
    await pick(s, ["no"]);
    // The corrected sentence is never proposed as a miss, so no list appears.
    expect(s.view().panel).toBeUndefined();
    expect((await loadState(home)).corrections[0]?.correction).toBe(
      "It happens in the chloroplast's stroma.",
    );
    expect(said(s)).toContain("Your correction: “It happens in the chloroplast.” is “It happens in the chloroplast's stroma.”");
  });

  it("offers another try after misses, and stops offering after three tries", async () => {
    const s = study("gap");
    await courseWithConcepts(s);
    await type(s, "/teach photosynthesis");
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await type(s, "Photosynthesis makes chemical energy from light.");
      await type(s, "");
      await pick(s, ["no"]);
      const misses = s.view().panel!.items;
      await pick(s, [misses[0]!.id]);
      if (attempt < 3) {
        expect(s.view().panel?.title).toContain("again");
        await pick(s, ["yes"]);
      }
    }
    expect(s.view().panel).toBeUndefined();
    const sessions = [...(await loadState(home)).sessions.values()];
    expect(sessions.map((x) => Boolean(x.retryOf))).toEqual([
      false,
      true,
      true,
    ]);
  });

  it("says when nothing is due and when a concept name matches nothing", async () => {
    const s = study("none");
    await s.start();
    await type(s, "/course Biology");
    await type(s, "/teach");
    expect(said(s)).toContain("Nothing is due");
    await type(s, "/teach osmosis");
    expect(said(s)).toContain('No confirmed concept called "osmosis"');
  });
});

describe("sources, catches, and corrections", () => {
  it("opens a numbered source and records a catch for the last session", async () => {
    const s = study("gap");
    await courseWithConcepts(s);
    await type(s, "/teach photosynthesis");
    await type(s, "Photosynthesis makes chemical energy from light.");
    await type(s, "");
    await pick(s, ["no"]);
    await pick(s, []);
    if (s.view().panel) await pick(s, ["no"]);
    await type(s, "/open 1");
    expect(opened).toHaveLength(1);
    await type(s, "/catch would have said nucleus");
    expect((await loadState(home)).catches[0]?.note).toBe(
      "would have said nucleus",
    );
    await type(s, "/open 99");
    expect(said(s)).toContain("There is no source [99]");
  });

  it("refuses a correction whose wrong words are not in the passage", async () => {
    const s = study("gap");
    await courseWithConcepts(s);
    await type(s, "/teach photosynthesis");
    await type(s, "Photosynthesis makes chemical energy from light.");
    await type(s, "");
    await pick(s, ["no"]);
    await pick(s, []);
    if (s.view().panel) await pick(s, ["no"]);
    await type(s, "/correct 1");
    await type(s, "It happens in the nucleus.");
    await type(s, "x");
    await type(s, "");
    expect(said(s)).toContain("copy the wrong text exactly");
    expect((await loadState(home)).corrections).toEqual([]);
  });
});

describe("models", () => {
  it("asks before switching to AI Gateway, and changes nothing if you say no", async () => {
    const s = study();
    await s.start();
    await type(s, "/model gateway");
    expect(s.view().panel?.title).toContain("send them your material");
    await pick(s, ["no"]);
    expect((await readSettings(home)).chat.provider).toBe("openai-compatible");
    await type(s, "/model gateway");
    await pick(s, ["yes"]);
    const settings = await readSettings(home);
    expect([settings.chat.provider, settings.sendOutAllowed]).toEqual([
      "gateway",
      true,
    ]);
    expect(said(s)).toContain("Run /rebuild");
  });
});

describe("courses and concepts", () => {
  it("lists courses, switches by name, and refuses a bad exam date", async () => {
    const s = study();
    await s.start();
    await type(s, "/course");
    expect(said(s)).toContain("No courses yet");
    await type(s, "/course Biology");
    await type(s, "/course Chemistry");
    await type(s, "/course biology");
    expect(said(s)).toContain("Switched to Biology.");
    await type(s, "/course");
    expect(said(s)).toContain("❯ Biology");
    await type(s, "/exam next week");
    expect(said(s)).toContain("YYYY-MM-DD");
    await type(s, "/exam 2099-12-15");
    await type(s, "/course");
    expect(said(s)).toContain("Biology · exam 2099-12-15");
    await type(s, "/exam none");
    expect(said(s)).toContain("Exam date cleared.");
  });

  it("renames, merges, and drops concepts by name, and asks before dropping", async () => {
    const s = study();
    await courseWithConcepts(s);
    await type(s, "/concepts");
    expect(said(s)).toMatch(/Photosynthesis · (due now|next )/);
    await type(s, "/rename photo = Light reactions");
    expect(said(s)).toContain("Renamed Photosynthesis to Light reactions.");
    await type(s, "/rename nothing here");
    expect(said(s)).toContain("Write it as /rename old name = new name.");
    await type(s, "/drop respiration");
    await pick(s, ["no"]);
    expect(said(s)).toContain("Nothing changed.");
    await type(s, "/merge respiration into light");
    expect(said(s)).toContain("would make a loop");
    await type(s, "/links");
    await pick(s, []);
    expect(said(s)).toContain("Removed 1 link.");
    await type(s, "/links");
    expect(said(s)).toContain("No confirmed links.");
    await type(s, "/merge respiration into light");
    expect(said(s)).toContain("Merged Respiration into Light reactions.");
    await type(s, "/drop light");
    await pick(s, ["yes"]);
    const statuses = [...(await loadState(home)).concepts.values()].map((c) => c.status);
    expect(statuses).toEqual(["dropped", "merged"]);
    await type(s, "/concepts");
    expect(said(s)).toContain("No confirmed concepts yet");
  });

  it("asks you to type more of a name that matches several concepts", async () => {
    const s = study();
    await courseWithConcepts(s);
    await type(s, "/drop s");
    expect(said(s)).toContain('"s" matches Photosynthesis, Respiration');
  });

  it("shows what is due, coming up, and waiting", async () => {
    const s = study();
    await courseWithConcepts(s);
    await type(s, "/due");
    expect(said(s)).toContain("Due now: Photosynthesis");
    expect(said(s)).toContain("Waiting: Respiration needs Photosynthesis first");
  });
});

describe("history and models", () => {
  it("summarizes the last 8 weeks", async () => {
    const s = study("gap");
    await courseWithConcepts(s);
    await type(s, "/history");
    expect(said(s)).toContain("No sessions in the last 8 weeks.");
    await type(s, "/teach");
    await type(s, "Photosynthesis makes chemical energy from light.");
    await type(s, "");
    await pick(s, ["no"]);
    await pick(s, []);
    await type(s, "/history");
    expect(said(s)).toMatch(/Last 8 weeks: 1 sessions, 1 clean, 0 catches/);
  });

  it("shows the models, changes one by name, and rebuilds the search file", async () => {
    const s = study();
    await courseWithConcepts(s);
    await type(s, "/model");
    expect(said(s)).toContain("Answer model: qwen3.5:2b at http://localhost:11434/v1");
    await type(s, "/model answer qwen3.5:9b");
    expect((await readSettings(home)).chat.model).toBe("qwen3.5:9b");
    await type(s, "/model search other-embed");
    expect(said(s)).toContain("Run /rebuild");
    await type(s, "/model sideways");
    expect(said(s)).toContain("Use /model, /model ollama|mlx|gateway");
    await type(s, "/rebuild");
    expect(said(s)).toContain("Rebuilt the search file: 2 passages.");
  });
});

describe("the conversation", () => {
  it("prints help, hints at plain text, and refuses a second command while one waits", async () => {
    const s = study();
    await courseWithConcepts(s);
    await type(s, "/help");
    expect(said(s)).toContain("/teach [concept]");
    await type(s, "hello there");
    expect(said(s)).toContain("Type /teach to start, or /help.");
    await type(s, "/drop photosynthesis");
    await type(s, "words while a list waits");
    expect(said(s)).toContain("Pick from the list");
    await type(s, "/due");
    expect(said(s)).toContain("Finish what Kizuki is asking first");
    s.cancel();
    await s.idle();
  });

  it("asks you to make a course before adding files, and needs a path", async () => {
    const s = study();
    await s.start();
    await type(s, "/add");
    expect(said(s)).toContain("Name the files to add");
    await type(s, `/add ${join(files, "bio notes.md").replace(/ /g, "\\ ")}`);
    expect(said(s)).toContain("Make a course first: /course <name>.");
  });

  it("asks what a sentence means during review and saves your answer", async () => {
    const s = new Study({
      home,
      env: {},
      models: {
        ask: async ({ system, prompt }) => {
          if (system.includes("concept map")) {
            const label = /\[(S\d+)\] It happens/.exec(prompt)?.[1];
            return { concepts: [], unclear: label ? [{ sentence: label }] : [] } as never;
          }
          return fakeAsk("gap")({ system, prompt } as never);
        },
        embed: fakeEmbed,
        embedModel: "fake",
      },
      checkModels: async () => ({ ok: true, problems: [] }),
    });
    await s.start();
    await type(s, "/course Biology");
    await type(s, join(files, "bio notes.md").replace(/ /g, "\\ "));
    await type(s, "/review");
    await pick(s);
    if (s.view().panel) await pick(s);
    expect(s.view().prompt).toContain("What does it mean?");
    await type(s, "Where it takes place in the cell.");
    const [clarification] = (await loadState(home)).clarifications.values();
    expect(clarification?.answer).toBe("Where it takes place in the cell.");
    await type(s, "/review");
    expect(said(s)).toContain("Nothing is waiting for review.");
  });
});

describe("after a restart", () => {
  it("finishes a file added before Kizuki closed, and offers to pick up an open session", async () => {
    const first = study();
    await courseWithConcepts(first);
    await type(first, "/teach photosynthesis");
    await type(first, "Photosynthesis makes chemical energy from light.");
    first.cancel();
    await first.idle();

    const second = study();
    await second.start();
    expect(said(second)).toContain("A session is still open.");
    await type(second, "/teach photosynthesis");
    expect(second.view().panel?.title).toContain("still open");
    await pick(second, ["yes"]);
    expect(said(second)).toContain("How does that fit");
    second.cancel();
    await second.idle();

    const third = study();
    await third.start();
    await type(third, "/teach photosynthesis");
    await pick(third, ["no"]);
    expect(third.view().prompt).toBe("Your explanation");
    const stopped = [...(await loadState(home)).sessions.values()][0]!;
    expect(stopped.error).toBe("You stopped this session.");
  });

  it("reports a file whose processing failed", async () => {
    const s = new Study({
      home,
      env: {},
      models: { ask: fakeAsk("gap"), embed: async () => { throw new Error("the meaning model is down"); }, embedModel: "fake" },
      checkModels: async () => ({ ok: true, problems: [] }),
    });
    await s.start();
    await type(s, "/course Biology");
    await type(s, join(files, "bio notes.md").replace(/ /g, "\\ "));
    expect(said(s)).toContain("bio notes.md failed: the meaning model is down. Add the same file again to try again.");
  });

  it("tries a failed file again when you add the same file, instead of adding it twice", async () => {
    const broken = new Study({
      home,
      env: {},
      models: { ask: fakeAsk("gap"), embed: async () => { throw new Error("the meaning model is down"); }, embedModel: "fake" },
      checkModels: async () => ({ ok: true, problems: [] }),
    });
    await broken.start();
    await type(broken, "/course Biology");
    await type(broken, join(files, "bio notes.md").replace(/ /g, "\\ "));
    const s = study();
    await s.start();
    await type(s, join(files, "bio notes.md").replace(/ /g, "\\ "));
    expect(said(s)).toContain("Trying bio notes.md again.");
    const materials = [...(await loadState(home)).materials.values()];
    expect(materials.map((m) => m.status)).toEqual(["review"]);
  });
});

describe("catches after a restart", () => {
  it("records a catch for the course's most recent session", async () => {
    const first = study("gap");
    await courseWithConcepts(first);
    await type(first, "/teach");
    await type(first, "Photosynthesis makes chemical energy from light.");
    await type(first, "");
    await pick(first, ["no"]);
    await pick(first, []);
    const second = study("gap");
    await second.start();
    await type(second, "/catch mixed up the two stages");
    expect((await loadState(home)).catches[0]?.note).toBe("mixed up the two stages");
  });

  it("says to finish a session when there is none", async () => {
    const s = study();
    await s.start();
    await type(s, "/course Biology");
    await type(s, "/catch nothing yet");
    expect(said(s)).toContain("Finish a session first.");
  });
});
