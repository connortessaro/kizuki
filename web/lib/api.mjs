import { randomUUID as defaultRandomUUID } from "node:crypto";
import { CAPTURE_KINDS } from "../../lib/platformEvents.mjs";
import { readDaemonConfig } from "../../lib/daemonConfig.mjs";
import { makePlatformApiClient } from "../../lib/platformApiClient.mjs";

export { CAPTURE_KINDS };
export const ENTITY_TYPES = Object.freeze(["person", "project", "team"]);

async function defaultMakeClient(vaultDir) {
  const config = await readDaemonConfig(vaultDir);
  return makePlatformApiClient(config);
}

export function buildCaptureInput({ kind, text, entityType, entityName }) {
  if (!CAPTURE_KINDS.includes(kind)) throw new Error(`invalid capture kind ${JSON.stringify(kind)}`);
  if (typeof text !== "string" || text.trim() === "") throw new Error("capture requires text");
  const type = entityType === undefined || entityType === null || entityType === "" ? null : entityType;
  const name = entityName === undefined || entityName === null ? "" : entityName.trim();
  if (type === null) {
    if (name !== "") throw new Error("capture entity name requires a type");
    return { kind, text: text.trim(), entity: null };
  }
  if (!ENTITY_TYPES.includes(type)) throw new Error(`invalid capture entity type ${JSON.stringify(type)}`);
  if (name === "") throw new Error("capture entity type requires a name");
  return { kind, text: text.trim(), entity: { type, name } };
}

export async function captureFromWeb(vaultDir, input, {
  randomUUID = defaultRandomUUID,
  makeClient = defaultMakeClient,
} = {}) {
  const client = await makeClient(vaultDir);
  const idempotencyKey = `web-${randomUUID()}`;
  return client.capture(input, { idempotencyKey });
}
