import { RateLimiter } from "./RateLimiter.js";

const DEFAULT_BASE_URL = "https://api.tokenrouter.com/v1";
const DEFAULT_MODEL = "z-ai/glm-5.3-free";

function cleanEnv(value: unknown): string {
  return String(value ?? "")
    .replace(/\r|\n/g, "")
    .trim()
    .replace(/^['"]+|['"]+$/g, "")
    .trim();
}

function maskSecret(secret: string): string {
  if (!secret) return "MISSING";
  if (secret.length <= 8) return "********";
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

/**
 * IMPORTANT:
 * Read environment variables at request time, not module-load time.
 * In this project dotenv is loaded by server.ts while service modules are
 * imported first under ESM. Reading process.env in top-level constants can
 * therefore capture empty values.
 */
export function getTokenRouterConfig() {
  const apiKey = cleanEnv(
    process.env.TOKENROUTER_API_KEY ||
    process.env.TOKEN_ROUTER_API_KEY
  );

  let baseUrl = cleanEnv(
    process.env.TOKENROUTER_BASE_URL || DEFAULT_BASE_URL
  ).replace(/\/+$/, "");
  
  if (baseUrl.endsWith("/chat/completions")) {
    baseUrl = baseUrl.replace(/\/chat\/completions$/, "");
  }

  const model = cleanEnv(
    process.env.TOKENROUTER_FINAL_JUDGE_MODEL || DEFAULT_MODEL
  );

  return {
    apiKey,
    baseUrl,
    model,
    configured: Boolean(apiKey),
    keyLength: apiKey.length,
    keyPreview: maskSecret(apiKey),
  };
}

const limiter = new RateLimiter(5, 60000);

function classifyHttpError(status: number, body: string) {
  const text = body.toLowerCase();

  if (status === 401 || status === 403 ||
      text.includes("invalid api key") ||
      text.includes("invalid token") ||
      text.includes("authentication") ||
      text.includes("unauthorized")) {
    return {
      status: "AUTH_ERROR",
      reason: `TokenRouter authentication rejected the request (HTTP ${status}).`,
    };
  }

  if (status === 402 ||
      text.includes("billing required") ||
      text.includes("insufficient balance") ||
      text.includes("payment required")) {
    return {
      status: "BILLING_REQUIRED",
      reason: "TokenRouter requires billing/provider access for this request.",
    };
  }

  if (status === 404) {
    return {
      status: "MODEL_NOT_FOUND",
      reason: "TokenRouter could not find the configured Final Judge model.",
    };
  }

  if (status === 429) {
    return {
      status: "RATE_LIMITED",
      reason: "TokenRouter rate limited the Final Judge request.",
    };
  }

  return {
    status: "ERROR",
    reason: `TokenRouter returned HTTP ${status}.`,
  };
}

async function tokenRouterRequest(
  path: string,
  init: RequestInit = {},
  timeoutMs = 25000
) {
  const cfg = getTokenRouterConfig();

  if (!cfg.apiKey) {
    return {
      ok: false,
      httpStatus: 401,
      status: "AUTH_ERROR",
      reason: "TOKENROUTER_API_KEY is missing or empty.",
      body: "",
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `${cfg.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${cfg.apiKey}`);
    headers.set("Content-Type", "application/json");

    const res = await fetch(url, {
      ...init,
      headers,
      signal: controller.signal,
    });

    const body = await res.text();

    if (!res.ok) {
      const classified = classifyHttpError(res.status, body);
      return {
        ok: false,
        httpStatus: res.status,
        status: classified.status,
        reason: classified.reason,
        // Safe diagnostic only: never return the API key. TokenRouter's body is useful
        // for distinguishing an invalid key from a disabled/restricted key.
        body: body.slice(0, 1000),
      };
    }

    return {
      ok: true,
      httpStatus: res.status,
      status: "SUCCESS",
      reason: "",
      body,
    };
  } catch (e: any) {
    if (e?.name === "AbortError") {
      return {
        ok: false,
        httpStatus: 408,
        status: "TIMEOUT",
        reason: "FINAL_JUDGE_TIMEOUT",
        body: "",
      };
    }

    return {
      ok: false,
      httpStatus: 0,
      status: "NETWORK_ERROR",
      reason: e?.message || "TokenRouter network request failed.",
      body: "",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchAvailableModelsTokenRouter() {
  const cfg = getTokenRouterConfig();

  if (!cfg.apiKey) {
    return {
      reachable: false,
      configured: false,
      models: [],
      status: "AUTH_ERROR",
      lastError: "TOKENROUTER_API_KEY is missing or empty.",
    };
  }

  const response = await tokenRouterRequest("/models", {}, 10000);

  if (!response.ok) {
    return {
      reachable: false,
      configured: true,
      models: [],
      status: response.status,
      lastError: response.reason,
      httpStatus: response.httpStatus,
    };
  }

  try {
    const data = JSON.parse(response.body);
    const models = Array.isArray(data?.data)
      ? data.data.map((m: any) => m?.id).filter(Boolean)
      : [];

    return {
      reachable: true,
      configured: true,
      models,
      status: "ONLINE",
      lastError: null,
      httpStatus: response.httpStatus,
    };
  } catch {
    return {
      reachable: false,
      configured: true,
      models: [],
      status: "INVALID_RESPONSE",
      lastError: "TokenRouter /models returned invalid JSON.",
      httpStatus: response.httpStatus,
    };
  }
}

export async function verifyTokenRouterModel(): Promise<string> {
  const cfg = getTokenRouterConfig();

  if (!cfg.apiKey) return "AUTH_ERROR";

  const status = await fetchAvailableModelsTokenRouter();

  if (!status.reachable) return status.status || "UNREACHABLE";
  if (!status.models.includes(cfg.model)) return "MODEL_NOT_FOUND";

  return "OK";
}

export async function testTokenRouterConnection() {
  const cfg = getTokenRouterConfig();

  const start = Date.now();
  const response = await tokenRouterRequest(
    "/chat/completions",
    {
      method: "POST",
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: "user", content: "Reply exactly: OK" }],
        temperature: 0,
      }),
    },
    15000
  );

  let responsePreview: string | null = null;

  if (response.ok) {
    try {
      const data = JSON.parse(response.body);
      responsePreview =
        data?.choices?.[0]?.message?.content?.trim() ||
        data?.output?.[0]?.content?.[0]?.text?.trim() ||
        null;
    } catch {
      responsePreview = null;
    }
  }

  return {
    provider: "TOKENROUTER",
    model: cfg.model,
    configured: cfg.configured,
    baseUrl: cfg.baseUrl,
    keyLength: cfg.keyLength,
    keyPreview: cfg.keyPreview,
    status: response.ok ? "SUCCESS" : response.status,
    httpStatus: response.httpStatus,
    latencyMs: Date.now() - start,
    safeError: response.ok ? null : response.reason,
    responsePreview,
    providerErrorBody: response.ok ? null : response.body,
  };
}

export async function callFinalJudgeTokenRouter(prompt: string, context: any) {
  const cfg = getTokenRouterConfig();

  if (!cfg.apiKey) {
    return {
      error: true,
      decision: "ERROR",
      status: "AUTH_ERROR",
      reason: "TOKENROUTER_API_KEY is missing or empty.",
    };
  }

  const start = Date.now();
  try {
    await limiter.acquire();
  } catch {
    return {
      error: true,
      decision: "ERROR",
      status: "RATE_LIMITED",
      reason: "TokenRouter local rate limit exceeded.",
    };
  }

  try {
    const payload = {
      model: cfg.model,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: JSON.stringify(context) },
      ],
      temperature: 0.1,
    };

    const response = await tokenRouterRequest(
      "/chat/completions",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      25000
    );

    if (!response.ok) {
      console.error(
        `[FINAL_JUDGE] FAIL status=${response.status} http=${response.httpStatus} reason=${response.reason}`
      );
      return {
        error: true,
        decision: "ERROR",
        status: response.status,
        reason: response.reason,
        httpStatus: response.httpStatus,
        latencyMs: Date.now() - start,
      };
    }

    let data: any;
    try {
      data = JSON.parse(response.body);
    } catch {
      return {
        error: true,
        decision: "ERROR",
        status: "INVALID_RESPONSE",
        reason: "TokenRouter returned invalid JSON.",
        latencyMs: Date.now() - start,
      };
    }

    const rawContent =
      data?.choices?.[0]?.message?.content ??
      data?.output?.[0]?.content?.[0]?.text ??
      "";

    if (!rawContent || typeof rawContent !== "string") {
      return {
        error: true,
        decision: "ERROR",
        status: "INVALID_RESPONSE",
        reason: "Empty Final Judge response.",
        latencyMs: Date.now() - start,
      };
    }

    try {
      const match = rawContent.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(match ? match[0] : rawContent);

      if (!["LONG", "SHORT", "NO_TRADE"].includes(parsed?.decision)) {
        return {
          error: true,
          decision: "ERROR",
          status: "INVALID_RESPONSE",
          reason: "Final Judge JSON has an invalid decision.",
          rawContent,
          latencyMs: Date.now() - start,
        };
      }

      return {
        error: false,
        status: "SUCCESS",
        latencyMs: Date.now() - start,
        result: parsed,
        rawContent,
      };
    } catch (e: any) {
      return {
        error: true,
        decision: "ERROR",
        status: "INVALID_RESPONSE",
        reason: `Failed to parse Final Judge JSON: ${e?.message || "unknown error"}`,
        rawContent,
        latencyMs: Date.now() - start,
      };
    }
  } finally {
    limiter.release();
  }
}
