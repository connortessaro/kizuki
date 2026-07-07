import { readFile, writeFile, mkdir, rename, access } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
import { entityPath, newEntityFile, appendLog, spliceManagedSection, renderAnalysis } from "./vault.mjs";
import { withVaultLock } from "./lock.mjs";

const exists = (p) => access(p).then(() => true, () => false);

async function writePayload(vaultDir, payload, { dryRun, now }) {
  const changes = [];

  for (const entity of payload.entities) {
    const path = entityPath(vaultDir, entity.type, entity.name);
    let content = (await exists(path))
      ? await readFile(path, "utf8")
      : newEntityFile(entity.type, entity.name);

    content = appendLog(content, entity.rawEntries ?? []);
    content = spliceManagedSection(content, renderAnalysis(entity, now));

    changes.push({ path, entity: entity.name });

    if (!dryRun) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, "utf8");
    }
  }

  if (!dryRun) {
    const processedDir = join(vaultDir, "transcripts", "processed");
    for (const t of payload.consumedTranscripts ?? []) {
      const from = join(vaultDir, "transcripts", basename(t));
      if (await exists(from)) {
        await mkdir(processedDir, { recursive: true });
        await rename(from, join(processedDir, basename(t)));
      }
    }
  }

  return changes;
}

export async function applyPayload(vaultDir, payload, { dryRun = false, now = new Date(), tool = "sync", lock = {} } = {}) {
  if (dryRun) return writePayload(vaultDir, payload, { dryRun, now });
  return withVaultLock(vaultDir, () => writePayload(vaultDir, payload, { dryRun, now }), { ...lock, tool, now });
}
