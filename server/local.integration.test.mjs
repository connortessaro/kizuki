import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listenApiServer } from "./api.mjs";
import { makePlatformApiClient } from "../lib/platformApiClient.mjs";
import { readPlatformEvents } from "../lib/platformEventStore.mjs";

const VALID_CONFIG = { version: 1, host: "127.0.0.1", port: 4247, token: "x".repeat(40) };

async function makeVault() {
  const vaultDir = await mkdtemp(join(tmpdir(), "kizuki-local-integration-"));
  await mkdir(join(vaultDir, "state"), { recursive: true });
  return vaultDir;
}

test("local API round-trips one private capture", async (t) => {
  const vaultDir = await makeVault();
  const running = await listenApiServer({
    vaultDir,
    host: "127.0.0.1",
    port: 0,
    token: VALID_CONFIG.token,
  });
  t.after(() => running.close());
  const client = makePlatformApiClient({ ...VALID_CONFIG, port: running.port });
  const created = await client.capture({ kind: "note", text: "Round trip." }, {
    idempotencyKey: "integration-1",
  });
  assert.equal(created.event.visibility.scope, "private");
  assert.equal((await readPlatformEvents(vaultDir)).length, 1);
  assert.equal((await client.listCaptures({ limit: 10 })).length, 1);
});
