import { randomUUID as defaultRandomUUID } from "node:crypto";
import { CAPTURE_KINDS } from "./platformEvents.mjs";
import { readDaemonConfig } from "./daemonConfig.mjs";
import { makePlatformApiClient } from "./platformApiClient.mjs";

const ENTITY_FLAGS = { "--person": "person", "--project": "project", "--team": "team" };

function requireValue(argv, index, option) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

export function parseCaptureArgs(argv) {
  let text = null;
  let kind = "note";
  let entity = null;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--kind") {
      const value = requireValue(argv, index, arg);
      if (!CAPTURE_KINDS.includes(value)) throw new Error(`invalid capture kind ${JSON.stringify(value)}`);
      kind = value;
      index++;
      continue;
    }
    if (arg in ENTITY_FLAGS) {
      const value = requireValue(argv, index, arg);
      if (entity !== null) throw new Error("capture accepts only one of --person, --project, or --team");
      entity = { type: ENTITY_FLAGS[arg], name: value };
      index++;
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`unknown option for capture: ${arg}`);
    if (text !== null) throw new Error("capture takes one text argument");
    text = arg;
  }
  if (text === null || text.trim() === "") {
    throw new Error('capture requires text — kizuki capture "<text>"');
  }
  return { text, kind, entity };
}

async function defaultMakeClient(vaultDir) {
  const config = await readDaemonConfig(vaultDir);
  return makePlatformApiClient(config);
}

export async function runCaptureCommand(vaultDir, argv, {
  randomUUID = defaultRandomUUID,
  makeClient = defaultMakeClient,
} = {}) {
  const parsed = parseCaptureArgs(argv);
  const client = await makeClient(vaultDir);
  const idempotencyKey = `cli-${randomUUID()}`;
  const result = await client.capture(
    { kind: parsed.kind, text: parsed.text, entity: parsed.entity },
    { idempotencyKey },
  );
  return `Captured ${result.event.aggregate.id} [${result.event.payload.kind}]`;
}
