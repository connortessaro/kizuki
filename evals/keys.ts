/**
 * Answer keys for the model tests, written by hand. The model under test never writes or
 * edits these, so the tests can catch the model's own mistakes.
 */

/** A material file and the concepts a careful student would list for it. */
export interface ConceptKey {
  file: string;
  /** Each concept is a list of acceptable names; a proposal matches if its name contains any of them. */
  concepts: string[][];
}

/** Concepts expected in each material file. */
export const CONCEPT_KEYS: ConceptKey[] = [
  {
    file: "photosynthesis.md",
    concepts: [["photosynthesis"], ["light-dependent", "light dependent", "light reactions"], ["calvin"], ["respiration"]],
  },
  {
    file: "cells.md",
    concepts: [["membrane", "bilayer"], ["osmosis"], ["active transport"], ["sodium-potassium", "sodium potassium", "pump"]],
  },
];

/** A teach-back case: an explanation of a concept and what a good question round should catch. */
export interface TeachCase {
  name: string;
  file: string;
  concept: string;
  /** Exact quotes from the file that the concept is confirmed with. */
  conceptQuotes: string[];
  explanation: string;
  /**
   * For explanations with a planted mistake: words that must appear in the quote of a
   * contradiction or gap question for the mistake to count as caught.
   */
  mustQuote?: string;
}

/** Teach-back cases: correct, planted mistakes, vague wording, and claims beyond the material. */
export const TEACH_CASES: TeachCase[] = [
  {
    name: "planted: wrong place",
    file: "photosynthesis.md",
    concept: "Photosynthesis",
    conceptQuotes: ["Photosynthesis converts light energy into chemical energy stored in glucose.", "In plants it happens in the chloroplast."],
    explanation: "Photosynthesis is how plants make food from sunlight. It happens in the mitochondria, where light is turned into chemical energy.",
    mustQuote: "chloroplast",
  },
  {
    name: "planted: wrong by-product",
    file: "photosynthesis.md",
    concept: "Light-dependent reactions",
    conceptQuotes: ["The light-dependent reactions take place in the thylakoid membranes.", "They split water and release oxygen as a by-product."],
    explanation: "The light-dependent reactions happen in the thylakoid membranes. They split water and release carbon dioxide.",
    mustQuote: "oxygen",
  },
  {
    name: "planted: wrong direction",
    file: "cells.md",
    concept: "Osmosis",
    conceptQuotes: [
      "Osmosis is the diffusion of water across a selectively permeable membrane.",
      "Water moves from the side with lower solute concentration to the side with higher solute concentration.",
    ],
    explanation: "Osmosis is water diffusing across a membrane. Water moves toward the side with lower solute concentration.",
    mustQuote: "higher solute concentration",
  },
  {
    name: "planted: wrong numbers",
    file: "cells.md",
    concept: "Sodium-potassium pump",
    conceptQuotes: ["The sodium-potassium pump moves three sodium ions out of the cell and two potassium ions into the cell for each ATP used."],
    explanation: "The sodium-potassium pump uses ATP to move two sodium ions out of the cell and three potassium ions in.",
    mustQuote: "three sodium ions",
  },
  {
    name: "correct and complete",
    file: "photosynthesis.md",
    concept: "Calvin cycle",
    conceptQuotes: ["The Calvin cycle takes place in the stroma.", "It uses ATP and NADPH from the light-dependent reactions to fix carbon dioxide into sugar."],
    explanation: "The Calvin cycle happens in the stroma. It uses the ATP and NADPH made by the light-dependent reactions to fix carbon dioxide into sugar.",
  },
  {
    name: "vague wording",
    file: "cells.md",
    concept: "Active transport",
    conceptQuotes: ["Active transport moves substances against their concentration gradient.", "It requires energy, usually from ATP."],
    explanation: "Active transport is when the cell pushes stuff the hard way, using some kind of power.",
  },
  {
    name: "beyond the material",
    file: "photosynthesis.md",
    concept: "Photosynthesis",
    conceptQuotes: ["Photosynthesis converts light energy into chemical energy stored in glucose.", "In plants it happens in the chloroplast."],
    explanation: "Photosynthesis turns light into chemical energy in the chloroplast. C4 plants use PEP carboxylase to concentrate carbon dioxide, and CAM plants open their stomata at night.",
  },
];

/** Explanations about something the course does not cover. Search must find nothing, so Kizuki says "not in your material". */
export const OFF_TOPIC = [
  "Plate tectonics moves the continents slowly over millions of years.",
  "The French Revolution began in 1789 with the storming of the Bastille.",
  "A for loop repeats a block of code a fixed number of times.",
];

/** Explanations about something the course does cover. Search must find at least one passage. */
export const ON_TOPIC = ["Plants make sugar from light in their chloroplasts.", "Water crosses a membrane toward the saltier side."];

/** A case where a key point is left out; the proposed misses should include it. */
export interface MissCase {
  name: string;
  file: string;
  concept: string;
  conceptQuotes: string[];
  explanation: string;
  /** Words from the point that was left out. */
  missing: string;
}

/** Explanations with a key point left out. */
export const MISS_CASES: MissCase[] = [
  {
    name: "left out the energy source",
    file: "cells.md",
    concept: "Active transport",
    conceptQuotes: ["Active transport moves substances against their concentration gradient.", "It requires energy, usually from ATP."],
    explanation: "Active transport moves substances against their concentration gradient.",
    missing: "ATP",
  },
  {
    name: "left out where it happens",
    file: "photosynthesis.md",
    concept: "Calvin cycle",
    conceptQuotes: ["The Calvin cycle takes place in the stroma.", "It uses ATP and NADPH from the light-dependent reactions to fix carbon dioxide into sugar."],
    explanation: "The Calvin cycle uses ATP and NADPH to fix carbon dioxide into sugar.",
    missing: "stroma",
  },
];
