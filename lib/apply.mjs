import { readFile, writeFile, mkdir, rename, access } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
import { entityPath, newEntityFile, appendLog, spliceManagedSection, renderAnalysis } from "./vault.mjs";
import { withVaultLock } from "./lock.mjs";
import { appendAlerts } from "./alerts.mjs";
import {
  planSignalIngestion,
  readSignalEvents,
  writeSignalEventsAtomic,
} from "./signals.mjs";

const exists = (p) => access(p).then(() => true, () => false);

async function writePayload(
  vaultDir,
  payload,
  { dryRun, now, appendAlertsImpl, writeSignalEventsImpl },
) {
  const existingSignalEvents = await readSignalEvents(vaultDir);
  const signalPlan = planSignalIngestion(existingSignalEvents, payload.alerts ?? [], { now });
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
    await appendAlertsImpl(vaultDir, signalPlan.surfaced, { now });
    if (signalPlan.events.length) {
      await writeSignalEventsImpl(vaultDir, [...existingSignalEvents, ...signalPlan.events]);
    }

    const processedDir = join(vaultDir, "transcripts", "processed");
    for (const t of payload.consumedTranscripts ?? []) {
      const from = join(vaultDir, "transcripts", basename(t));
      if (await exists(from)) {
        await mkdir(processedDir, { recursive: true });
        await rename(from, join(processedDir, basename(t)));
      }
    }
  }

  return {
    changes,
    newAlerts: signalPlan.surfaced,
    signalChanges: signalPlan.events,
    warnings: [...(payload.warnings ?? [])],
  };
}

export async function applyPayload(
  vaultDir,
  payload,
  {
    dryRun = false,
    now = new Date(),
    tool = "sync",
    lock = {},
    appendAlertsImpl = appendAlerts,
    writeSignalEventsImpl = writeSignalEventsAtomic,
  } = {},
) {
  const options = { dryRun, now, appendAlertsImpl, writeSignalEventsImpl };
  if (dryRun) return writePayload(vaultDir, payload, options);
  return withVaultLock(vaultDir, () => writePayload(vaultDir, payload, options), {
    ...lock,
    tool,
    now,
  });
}
