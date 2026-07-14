function assertConfig(config) {
  if (!config || typeof config !== "object") throw new Error("platform API client requires a config object");
  if (typeof config.host !== "string" || config.host === "") {
    throw new Error("platform API client requires a host");
  }
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65_535) {
    throw new Error("platform API client requires a port from 1024 to 65535");
  }
  if (typeof config.token !== "string" || config.token.length < 32) {
    throw new Error("platform API client requires a token of at least 32 characters");
  }
}

export function makePlatformApiClient(config, { fetchImpl = fetch } = {}) {
  assertConfig(config);
  const baseUrl = `http://${config.host}:${config.port}`;

  async function request(path, init = {}) {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${config.token}`,
        ...init.headers,
      },
    });
    let body;
    try {
      body = await response.json();
    } catch {
      throw new Error(`platform API returned a non-JSON response (status ${response.status})`);
    }
    if (!response.ok) {
      const apiError = body?.error ?? {};
      const error = new Error(apiError.message ?? `platform API request failed with status ${response.status}`);
      error.code = apiError.code ?? "unknown_error";
      error.status = response.status;
      throw error;
    }
    return body.data;
  }

  return {
    health: () => request("/v1/health"),
    async capture(input, { idempotencyKey } = {}) {
      if (typeof idempotencyKey !== "string" || idempotencyKey.trim() === "") {
        throw new Error("platform API capture requires an idempotencyKey");
      }
      return request("/v1/captures", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify(input),
      });
    },
    listCaptures({ limit } = {}) {
      const query = limit === undefined ? "" : `?limit=${encodeURIComponent(limit)}`;
      return request(`/v1/captures${query}`);
    },
  };
}
