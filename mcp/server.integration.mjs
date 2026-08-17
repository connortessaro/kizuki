import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, symlink, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

test("server exposes capture_context with write annotations and a strict schema", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-mcp-capture-"));
  const { client, server } = await connected(vault);
  try {
    const listed = await client.listTools();
    const tool = listed.tools.find((entry) => entry.name === "capture_context");
    assert.ok(tool, "capture_context missing");
    assert.equal(tool.annotations.readOnlyHint, false);
    assert.equal(tool.annotations.destructiveHint, false);
    assert.equal(tool.annotations.idempotentHint, true);
    assert.equal(tool.annotations.openWorldHint, false);

    const invalid = await client.callTool({
      name: "capture_context",
      arguments: { kind: "question", text: "Who owns it?", fullChat: "must fail" },
    });
    assert.equal(invalid.isError, true);
    assert.match(invalid.content[0].text, /unrecognized|unknown|invalid/i);

    const badKind = await client.callTool({
      name: "capture_context",
      arguments: { kind: "bogus", text: "A thought" },
    });
    assert.equal(badKind.isError, true);

    const missing = await client.callTool({
      name: "capture_context",
      arguments: { kind: "note", text: "A thought" },
    });
    assert.equal(missing.isError, true);
    assert.match(missing.content[0].text, /daemon config/i);
  } finally {
    await client.close();
    await server.close();
  }
});

test("server reports the root package.json version in the handshake", async () => {
  const vault = await mkdtemp(join(tmpdir(), "kizuki-mcp-version-"));
  const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  const { version } = JSON.parse(await readFile(pkgPath, "utf8"));
  const server = createKizukiServer(vault);
  const client = new Client({ name: "kizuki-test", version }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    assert.equal(client.getServerVersion().version, version);
    assert.notEqual(version, "1.0.0");
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
