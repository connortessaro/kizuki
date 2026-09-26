import { rename, rm } from "node:fs/promises";
import { readLog } from "./log";
import { homePaths } from "./paths";
import { indexPassages, openIndex, type Embedder } from "./search";
import { loadState } from "./state";

async function removeIndex(path: string): Promise<void> {
  for (const suffix of ["", "-wal", "-shm"]) await rm(`${path}${suffix}`, { force: true });
}

/**
 * Builds the search file again from the logs, with the given meaning model. Use it after
 * changing the meaning model, or if the search file is damaged. The new file is built next to
 * the old one and only replaces it once it is complete, so a model that fails (say, a typo in
 * its name) leaves the old search file working. Returns the number of passages indexed.
 */
export async function rebuildIndex(home: string, embed: Embedder, embedModel: string): Promise<number> {
  const paths = homePaths(home);
  const building = `${paths.index}.rebuild`;
  await removeIndex(building);
  const state = await loadState(home);
  const db = openIndex(building);
  let count = 0;
  try {
    for (const event of await readLog(home, "passages")) {
      const material = state.materials.get(event.materialId);
      if (!material) continue;
      await indexPassages(
        db,
        event.passages.map((p) => ({ passageId: p.passageId, materialId: p.materialId, courseId: material.courseId, text: p.text })),
        embed,
        embedModel,
      );
      count += event.passages.length;
    }
    db.pragma("wal_checkpoint(TRUNCATE)");
  } catch (error) {
    db.close();
    await removeIndex(building);
    throw error;
  }
  db.close();
  await removeIndex(paths.index);
  await rename(building, paths.index);
  await rm(`${building}-wal`, { force: true });
  await rm(`${building}-shm`, { force: true });
  return count;
}
