#!/usr/bin/env node
// A stand-in for Ollama in the end-to-end tests: it speaks the same OpenAI-style format and
// answers each kind of request like a very obedient small model, so every run is the same.
import { createServer } from "node:http";

const port = Number(process.env.FAKE_MODEL_PORT ?? 4872);
const WORDS = ["heart", "chamber", "blood", "lung", "oxygen", "cell", "mitochondria", "enzyme"];

/** The label of the first sentence in the prompt that contains `text`. */
function labelOf(prompt, text) {
  return new RegExp(`\\[(S\\d+)\\][^\\n]*${text}`).exec(prompt)?.[1] ?? "S1";
}

function reply(system, prompt) {
  if (system.includes("concept map")) return { concepts: [], unclear: [] };
  if (system.includes("order the concepts")) return { links: [{ concept: "C2", needs: "C1" }] };
  if (system.includes("curious student")) return { questions: [{ kind: "contradiction", sentence: labelOf(prompt, "four chambers"), term: "three" }] };
  // What you missed: point at the sentence you corrected, which Kizuki must leave out.
  return { missed: [{ sentence: labelOf(prompt, "four chambers") }] };
}

function send(res, body) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    if (req.url.endsWith("/models")) return send(res, { object: "list", data: [{ id: "fake-chat" }, { id: "fake-embed" }] });
    const body = raw ? JSON.parse(raw) : {};
    if (req.url.endsWith("/embeddings")) {
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      const data = inputs.map((t, index) => ({ object: "embedding", index, embedding: WORDS.map((w) => (String(t).toLowerCase().includes(w) ? 1 : 0.01)) }));
      return send(res, { object: "list", data, model: body.model, usage: { prompt_tokens: 1, total_tokens: 1 } });
    }
    if (req.url.endsWith("/chat/completions")) {
      const system = body.messages.find((m) => m.role === "system")?.content ?? "";
      const prompt = body.messages.filter((m) => m.role === "user").map((m) => (typeof m.content === "string" ? m.content : m.content.map((p) => p.text).join(""))).join("\n");
      const content = JSON.stringify(reply(system, prompt));
      return send(res, {
        id: "fake",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: body.model,
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    }
    res.writeHead(404).end();
  });
}).listen(port, "127.0.0.1", () => console.log(`fake model on http://127.0.0.1:${port}/v1`));
