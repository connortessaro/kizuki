import { createHook } from "workflow";
import { materialReviewToken } from "../../lib/tokens";
import { failStep, indexStep, linksStep, proposeStep, readStep, reviewedStep } from "./steps";

/**
 * Processes one added file: read its text, add it to search, propose concepts, then pause
 * until you finish reviewing them, and finally propose prerequisite links. If another run
 * is already waiting for this file's review, this one stops quietly.
 */
export async function processMaterial(home: string, materialId: string): Promise<void> {
  "use workflow";
  try {
    await readStep(home, materialId);
    await indexStep(home, materialId);
    const review = createHook<{ reviewed: true }>({ token: materialReviewToken(materialId) });
    if (await review.getConflict()) return;
    await proposeStep(home, materialId);
    await review;
    await reviewedStep(home, materialId);
    await linksStep(home, materialId);
  } catch (error) {
    await failStep(home, materialId, error instanceof Error ? error.message : String(error));
  }
}
