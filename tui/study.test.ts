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
