import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createKizukiServer, isDirectExecution } from "./server.mjs";

async function connected(vaultDir) {
  const server = createKizukiServer(vaultDir);
  const client = new Client(
    { name: "kizuki-test", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { client, server };
}

test("server exposes insight tools and capture_insight validates strictly", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-mcp-server-"));
  const { client, server } = await connected(vault);
  try {
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name);
    for (const name of [
      "capture_insight",
      "list_insights",
      "read_insight",
      "archive_insight",
    ]) {
      assert.ok(names.includes(name), name + " missing");
    }
    const capture = names.indexOf("capture_insight");
    assert.match(listed.tools[capture].description, /Kizuki this/);
    assert.match(listed.tools[capture].description, /distill/i);
    assert.match(listed.tools[capture].description, /full conversation/i);

    const result = await client.callTool({
      name: "capture_insight",
      arguments: {
        kind: "learning",
        summary: "Per-FC manifests drive lookup.",
        entities: [{ type: "project", name: "staff" }],
        origin: { client: "codex" },
      },
    });
    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /^Captured ins_[0-9a-f]{12}/);

    const invalid = await client.callTool({
      name: "capture_insight",
      arguments: {
        kind: "learning",
        summary: "Per-FC manifests drive lookup.",
        entities: [],
        origin: { client: "codex" },
        fullChat: "must fail",
      },
    });
    assert.equal(invalid.isError, true);
    assert.match(invalid.content[0].text, /unrecognized|unknown|invalid/i);
  } finally {
    await client.close();
    await server.close();
  }
});

test("direct execution recognizes an installed bin symlink", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kizuki-mcp-bin-"));
  const serverPath = join(dirname(fileURLToPath(import.meta.url)), "server.mjs");
  const binPath = join(dir, "kizuki-mcp");
  await symlink(serverPath, binPath);
  assert.equal(isDirectExecution(binPath), true);
  assert.equal(isDirectExecution(fileURLToPath(import.meta.url)), false);
});
