import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRunAgentHttp } from "./agentHttp.mjs";

const HTTP = { baseUrl: "https://api.example.com/v1", model: "test-model", apiKeyEnv: "KIZUKI_TEST_KEY" };

function fakeFetch(handler) {
  return async (url, init) => handler(url, init);
}

test("posts a chat completion and returns the content", async () => {
  process.env.KIZUKI_TEST_KEY = "sk-test";
  let seen;
  const run = makeRunAgentHttp(HTTP, 5000, {
    fetchImpl: fakeFetch(async (url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify({ choices: [{ message: { content: "payload here" } }] }), { status: 200 });
    }),
  });
  assert.equal(await run("do the thing"), "payload here");
  assert.equal(seen.url, "https://api.example.com/v1/chat/completions");
  assert.equal(seen.init.headers.authorization, "Bearer sk-test");
  const body = JSON.parse(seen.init.body);
  assert.equal(body.model, "test-model");
  assert.deepEqual(body.messages, [{ role: "user", content: "do the thing" }]);
});

test("fails loudly on missing key, non-2xx, non-JSON, and empty content", async () => {
  delete process.env.KIZUKI_TEST_KEY;
  await assert.rejects(makeRunAgentHttp(HTTP, 5000, { fetchImpl: fakeFetch(async () => new Response("{}")) })("x"),
    /KIZUKI_TEST_KEY is not set/);

  process.env.KIZUKI_TEST_KEY = "sk-test";
  await assert.rejects(makeRunAgentHttp(HTTP, 5000, { fetchImpl: fakeFetch(async () => new Response("nope", { status: 401 })) })("x"),
    /agentHttp: 401/);
  await assert.rejects(makeRunAgentHttp(HTTP, 5000, { fetchImpl: fakeFetch(async () => new Response("not json", { status: 200 })) })("x"),
    /non-JSON response/);
  await assert.rejects(makeRunAgentHttp(HTTP, 5000, { fetchImpl: fakeFetch(async () => new Response(JSON.stringify({ choices: [] }), { status: 200 })) })("x"),
    /empty completion content/);
});

test("aborts on timeout", async () => {
  process.env.KIZUKI_TEST_KEY = "sk-test";
  const run = makeRunAgentHttp(HTTP, 20, {
    fetchImpl: (url, init) => new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => {
        const e = new Error("aborted"); e.name = "AbortError"; reject(e);
      });
    }),
  });
  await assert.rejects(run("x"), /timed out after 20ms/);
});
