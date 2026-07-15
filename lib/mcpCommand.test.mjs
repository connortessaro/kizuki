import { test } from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

test("kizuki mcp answers an MCP initialize over stdio", async () => {
  const child = spawn(process.execPath, [join(repo, "kizuki"), "mcp"], {
    env: { ...process.env, KIZUKI_VAULT: repo },
  });
  const init = {
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } },
  };
  child.stdin.write(JSON.stringify(init) + "\n");
  const line = await new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("timeout: " + buf)), 15000);
    child.stdout.on("data", (d) => {
      buf += d;
      const nl = buf.indexOf("\n");
      if (nl !== -1) { clearTimeout(timer); resolve(buf.slice(0, nl)); }
    });
  }).finally(() => child.kill());
  const msg = JSON.parse(line);
  assert.equal(msg.id, 1);
  assert.ok(msg.result.serverInfo.name.length > 0);
});
