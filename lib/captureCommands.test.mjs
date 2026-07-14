import test from "node:test";
import assert from "node:assert/strict";
import { parseCaptureArgs, runCaptureCommand } from "./captureCommands.mjs";

const EVENT = {
  version: 1,
  eventId: "evt_11111111-1111-4111-8111-111111111111",
  type: "capture.recorded",
  at: "2026-07-14T12:00:00.000Z",
  workspaceId: "personal",
  principalId: "local-operator",
  sourceOwnerId: "local-operator",
  visibility: { scope: "private", principalIds: ["local-operator"] },
  packIds: [],
  receipts: [],
  idempotencyKey: "cli-11111111-1111-4111-8111-111111111111",
  aggregate: { type: "capture", id: "cap_22222222-2222-4222-8222-222222222222", version: 1 },
  payload: { kind: "decision", text: "Ship API", entity: { type: "project", name: "kizuki" } },
};

test("parseCaptureArgs defaults kind to note and entity to null", () => {
  assert.deepEqual(parseCaptureArgs(["Just a note"]), { text: "Just a note", kind: "note", entity: null });
});

test("parseCaptureArgs supports --kind, --project, --person, and --team", () => {
  assert.deepEqual(parseCaptureArgs(["Text", "--kind", "decision", "--project", "kizuki"]), {
    text: "Text",
    kind: "decision",
    entity: { type: "project", name: "kizuki" },
  });
  assert.deepEqual(parseCaptureArgs(["Text", "--person", "Ada"]).entity, { type: "person", name: "Ada" });
  assert.deepEqual(parseCaptureArgs(["Text", "--team", "Platform"]).entity, { type: "team", name: "Platform" });
});

test("parseCaptureArgs rejects unknown flags", () => {
  assert.throws(() => parseCaptureArgs(["Text", "--bogus"]), /unknown option for capture: --bogus/);
});

test("parseCaptureArgs rejects missing option values", () => {
  assert.throws(() => parseCaptureArgs(["Text", "--kind"]), /--kind requires a value/);
  assert.throws(() => parseCaptureArgs(["Text", "--project"]), /--project requires a value/);
});

test("parseCaptureArgs rejects conflicting entity scopes", () => {
  assert.throws(
    () => parseCaptureArgs(["Text", "--person", "Ada", "--project", "kizuki"]),
    /only one of --person, --project, or --team/,
  );
});

test("parseCaptureArgs rejects empty text", () => {
  assert.throws(() => parseCaptureArgs(["--kind", "note"]), /capture requires text/);
  assert.throws(() => parseCaptureArgs(["  "]), /capture requires text/);
});

test("parseCaptureArgs rejects an invalid kind", () => {
  assert.throws(() => parseCaptureArgs(["Text", "--kind", "bogus"]), /invalid capture kind/);
});

test("parseCaptureArgs rejects more than one text argument", () => {
  assert.throws(() => parseCaptureArgs(["Text", "Second"]), /capture takes one text argument/);
});

test("capture command sends one capability request", async () => {
  const calls = [];
  const output = await runCaptureCommand("/vault", [
    "Ship API", "--kind", "decision", "--project", "kizuki",
  ], {
    randomUUID: () => "11111111-1111-4111-8111-111111111111",
    makeClient: async () => ({
      capture: async (input, options) => {
        calls.push([input, options]);
        return { disposition: "created", event: EVENT };
      },
    }),
  });
  assert.equal(calls[0][0].entity.name, "kizuki");
  assert.equal(calls[0][1].idempotencyKey, "cli-11111111-1111-4111-8111-111111111111");
  assert.equal(output, `Captured ${EVENT.aggregate.id} [decision]`);
});

test("capture command reports existing dispositions the same way as created ones", async () => {
  const output = await runCaptureCommand("/vault", ["Ship API", "--kind", "decision"], {
    randomUUID: () => "11111111-1111-4111-8111-111111111111",
    makeClient: async () => ({ capture: async () => ({ disposition: "existing", event: EVENT }) }),
  });
  assert.equal(output, `Captured ${EVENT.aggregate.id} [decision]`);
});

test("capture command passes vaultDir to the client factory", async () => {
  const seen = [];
  await runCaptureCommand("/vault", ["Text"], {
    randomUUID: () => "11111111-1111-4111-8111-111111111111",
    makeClient: async (vaultDir) => {
      seen.push(vaultDir);
      return { capture: async () => ({ disposition: "created", event: EVENT }) };
    },
  });
  assert.deepEqual(seen, ["/vault"]);
});
