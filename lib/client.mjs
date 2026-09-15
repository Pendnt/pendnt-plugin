import { API_KEY, BASE_URL } from "./config.mjs";

class ApiError extends Error {
  constructor(status, body, message) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function call(method, path, body, { timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    if (!res.ok) {
      throw new ApiError(res.status, json, json?.message || `${method} ${path} failed: HTTP ${res.status}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

/** POST /v1/requests — see /app/README.md's API reference. `body.wait_s` is clamped to 0-25 server-side. */
export function createRequest(body, opts) {
  return call("POST", "/v1/requests", body, opts);
}

/** GET /v1/requests/:id?wait_s=N — `waitS` is clamped to 0-25 server-side. */
export function getRequest(id, waitS, opts) {
  return call("GET", `/v1/requests/${encodeURIComponent(id)}?wait_s=${encodeURIComponent(String(waitS))}`, undefined, opts);
}

/** POST /v1/notify — fire-and-forget. */
export function notify(message, level = "info", opts) {
  return call("POST", "/v1/notify", { message, level }, opts);
}
