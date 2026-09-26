import { describe, expect, it } from "vitest";
import { proposeLinks, validateLinkReply, wouldCreateLoop } from "./links";
import type { Ask } from "./model";

describe("wouldCreateLoop", () => {
  const links = [
    { conceptId: "b", needsConceptId: "a" },
    { conceptId: "c", needsConceptId: "b" },
  ];

  it("rejects a link back to something that already needs this concept", () => {
    expect(wouldCreateLoop(links, { conceptId: "a", needsConceptId: "c" })).toBe(true);
  });

  it("rejects a concept needing itself", () => {
    expect(wouldCreateLoop(links, { conceptId: "a", needsConceptId: "a" })).toBe(true);
  });

  it("allows a link that keeps the map loop-free", () => {
    expect(wouldCreateLoop(links, { conceptId: "c", needsConceptId: "a" })).toBe(false);
  });
});

describe("validateLinkReply", () => {
  const refs = new Map([["C1", "a"], ["C2", "b"], ["C3", "c"]]);

  it("keeps new, loop-free links between known concepts", () => {
    const out = validateLinkReply({ links: [{ concept: "C2", needs: "C1" }] }, refs, []);
    expect(out).toEqual({ links: [{ conceptId: "b", needsConceptId: "a" }], dropped: 0 });
  });

  it("drops unknown concepts, repeats, links that already exist, and loops", () => {
    const existing = [{ conceptId: "c", needsConceptId: "b" }];
    const out = validateLinkReply(
      {
        links: [
          { concept: "C9", needs: "C1" },
          { concept: "C3", needs: "C2" },
          { concept: "C2", needs: "C1" },
          { concept: "C2", needs: "C1" },
          { concept: "C1", needs: "C3" },
        ],
      },
      refs,
      existing,
    );
    expect(out.links).toEqual([{ conceptId: "b", needsConceptId: "a" }]);
    expect(out.dropped).toBe(4);
  });
});

describe("proposeLinks", () => {
  it("does not ask the model when there are fewer than two concepts", async () => {
    const ask: Ask = async () => {
      throw new Error("should not be called");
    };
    expect(await proposeLinks({ concepts: [{ conceptId: "a", name: "A" }], existing: [], ask })).toEqual({ links: [], dropped: 0 });
  });

  it("lists the concepts as C1, C2, ... and returns only checked links", async () => {
    let seen = "";
    const ask: Ask = async ({ prompt }) => {
      seen = prompt;
      return { links: [{ concept: "C2", needs: "C1" }, { concept: "C1", needs: "C2" }] } as never;
    };
    const out = await proposeLinks({ concepts: [{ conceptId: "a", name: "Atoms" }, { conceptId: "b", name: "Molecules" }], existing: [], ask });
    expect(seen).toContain("C1: Atoms");
    expect(out).toEqual({ links: [{ conceptId: "b", needsConceptId: "a" }], dropped: 1 });
  });
});
