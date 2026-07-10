import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createKizukiServer } from "./server.mjs";

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
