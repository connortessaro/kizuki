import { DEFAULT_TIMEOUT_MS } from "./agent.mjs";

export function makeRunAgentHttp({ baseUrl, model, apiKeyEnv }, timeoutMs = DEFAULT_TIMEOUT_MS, { fetchImpl = fetch } = {}) {
  return async (prompt) => {
    const apiKey = process.env[apiKeyEnv];
    if (!apiKey) throw new Error(`agentHttp: environment variable ${apiKeyEnv} is not set`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error.name === "AbortError") throw new Error(`agent timed out after ${timeoutMs}ms`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
    const body = await response.text();
    if (!response.ok) throw new Error(`agentHttp: ${response.status} ${body.slice(0, 200)}`);
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      throw new Error(`agentHttp: non-JSON response: ${body.slice(0, 200)}`);
    }
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content === "") throw new Error("agentHttp: empty completion content");
    return content;
  };
}
