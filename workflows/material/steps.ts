import { FatalError } from "workflow";
import { failMaterial, indexMaterial, markReviewed, proposeForMaterial, proposeLinksForMaterial, readMaterial } from "../../lib/materialFlow";
import { makeAsk, makeEmbedder } from "../../lib/model";
import { readSettings } from "../../lib/settings";
import { ownHome } from "../home";

/** Reads the file's text. A file with no readable text fails at once instead of being retried. */
export async function readStep(home: string, materialId: string): Promise<void> {
  "use step";
  home = ownHome(home);
  try {
    await readMaterial(home, materialId);
  } catch (error) {
    throw new FatalError((error as Error).message);
  }
}

/** Adds the file's passages to the search file. */
export async function indexStep(home: string, materialId: string): Promise<void> {
  "use step";
  home = ownHome(home);
  const settings = await readSettings(home);
  await indexMaterial(home, materialId, makeEmbedder(settings.embed), settings.embed.model);
}

/** Asks the model for concepts and saves the checked ones as proposed. */
export async function proposeStep(home: string, materialId: string): Promise<void> {
  "use step";
  home = ownHome(home);
  const settings = await readSettings(home);
  await proposeForMaterial(home, materialId, makeAsk(settings.chat));
}

/** Records that you finished reviewing the concepts. */
export async function reviewedStep(home: string, materialId: string): Promise<void> {
  "use step";
  home = ownHome(home);
  await markReviewed(home, materialId);
}

/** Asks the model for prerequisite links and saves the checked ones as proposed. */
export async function linksStep(home: string, materialId: string): Promise<void> {
  "use step";
  home = ownHome(home);
  const settings = await readSettings(home);
  await proposeLinksForMaterial(home, materialId, makeAsk(settings.chat));
}

/** Records that processing failed, so the course page can show the error. */
export async function failStep(home: string, materialId: string, message: string): Promise<void> {
  "use step";
  home = ownHome(home);
  await failMaterial(home, materialId, message);
}
