import { globalAiLimiter } from "./RateLimiter.js";

export interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const unavailableModels = new Set<string>();
const cooldowns = new Map<string, number>();

let availableModelsCache: Set<string> | null = null;
let availableModelsPromise: Promise<Set<string>> | null = null;

function getCredentials() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  let baseUrl = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
  if (baseUrl.endsWith("/chat/completions")) {
    baseUrl = baseUrl.replace(/\/chat\/completions$/, "");
  }
  return { apiKey, baseUrl };
}

export async function checkOpenRouterStatus() {
  const { apiKey, baseUrl } = getCredentials();
  const start = Date.now();
  
  if (!apiKey) {
    return { health: "OFFLINE", latencyMs: 0, availableModelCount: 0, error: "Missing API Key" };
  }

  try {
    const res = await fetch(`${baseUrl}/models`, {
       headers: {
         "Authorization": `Bearer ${apiKey}`,
         "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
         "X-OpenRouter-Title": "APEXSIGNAL AI"
       }
    });
    const latencyMs = Date.now() - start;
    if (res.ok) {
      const data = await res.json();
      return { 
        health: "ONLINE", 
        latencyMs, 
        availableModelCount: data.data?.length || 0 
      };
    } else {
      return { health: "ERROR", latencyMs, availableModelCount: 0, error: `HTTP ${res.status}` };
    }
  } catch (error: any) {
    return { health: "OFFLINE", latencyMs: Date.now() - start, availableModelCount: 0, error: error.message };
  }
}

export async function fetchAvailableModelsOpenRouter(): Promise<Set<string>> {
  if (availableModelsCache) return availableModelsCache;
  if (availableModelsPromise) return availableModelsPromise;
  
  availableModelsPromise = (async () => {
    const { apiKey, baseUrl } = getCredentials();
    
    if (!apiKey) {
      return new Set<string>();
    }

    try {
      const res = await fetch(`${baseUrl}/models`, {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
          "X-OpenRouter-Title": "APEXSIGNAL AI"
        }
      });
      if (res.ok) {
        const data = await res.json();
        // OpenRouter models array is in data.data
        // We also want to check for structured output and text output
        const models = new Set<string>();
        for (const m of data.data) {
          models.add(m.id);
        }
        availableModelsCache = models;
        return models;
      }
    } catch (e) {
      console.warn("[OPENROUTER] Failed to fetch models", e);
    }
    return new Set<string>();
  })();

  return availableModelsPromise;
}

export async function callModelOpenRouter(modelId: string, messages: OpenRouterMessage[], role?: string): Promise<any> {
  const { apiKey, baseUrl } = getCredentials();
  
  const startTime = Date.now();
  if (role) {
    console.log(`[OPENROUTER]\nROLE=${role}\nMODEL=${modelId}\nREQUEST=START`);
  }

  if (!apiKey) {
    if (role) console.log(`[OPENROUTER]\nROLE=${role}\nMODEL=${modelId}\nREQUEST=FAIL\nHTTP=401\nLATENCY=${Date.now() - startTime}ms`);
    return { error: "Missing or invalid OPENROUTER_API_KEY", status: "unavailable" };
  }

  if (unavailableModels.has(modelId)) {
    return { error: "NOT FOUND", status: "unavailable" };
  }

  const available = await fetchAvailableModelsOpenRouter();
  if (available.size > 0 && !available.has(modelId)) {
    console.warn(`[OPENROUTER Fallback] Model: ${modelId} is not in the verified startup list.`);
    unavailableModels.add(modelId);
    return { error: "NOT FOUND", status: "unavailable" };
  }

  if (modelId.startsWith("claude/") || modelId.startsWith("gpt-4") || modelId.startsWith("o1") || modelId.startsWith("o3") || modelId.startsWith("grok") || modelId === "deepseek-chat") {
    return { error: "BLOCKED PAID MODEL", status: "unavailable" };
  }

  const cooldownUntil = cooldowns.get(modelId);
  if (cooldownUntil && Date.now() < cooldownUntil) {
    return { error: "RATE LIMITED", status: "unavailable" };
  }

  const url = `${baseUrl}/chat/completions`;
  let currentMessages = [...messages];
  let attempt = 0;

  while (attempt < 2) {
    attempt++;
    try {
      const requestBody: any = {
        model: modelId,
        messages: currentMessages,
        temperature: 0.2,
      };

      // Try structured JSON if not free tier specific models that fail with it, 
      // but OpenRouter generally supports response_format
      requestBody.response_format = { type: "json_object" };

      await globalAiLimiter.acquire();
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000); 

      let res;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
            "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
            "X-OpenRouter-Title": "APEXSIGNAL AI"
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal as any
        });
        
        if (role) {
           console.log(`[OPENROUTER]\nROLE=${role}\nMODEL=${modelId}\nREQUEST=${res.ok ? "SUCCESS" : "FAIL"}\nHTTP=${res.status}\nLATENCY=${Date.now() - startTime}ms`);
        }

        if (!res.ok) {
          if (res.status === 401) {
             return { error: "AUTH_ERROR", status: "unavailable" };
          }
          if (res.status === 403) {
             return { error: "ACCESS_DENIED", status: "unavailable" };
          }
          if (res.status === 429) {
            let retryAfter = 60;
            const retryAfterHeader = res.headers.get("Retry-After");
            if (retryAfterHeader) {
              retryAfter = parseInt(retryAfterHeader, 10) || 60;
            }
            cooldowns.set(modelId, Date.now() + retryAfter * 1000);
            return { error: "RATE_LIMITED", status: "unavailable" };
          }
          if (res.status === 404) {
            unavailableModels.add(modelId);
            return { error: "MODEL_NOT_FOUND", status: "unavailable" };
          }
          if (res.status === 402) {
            return { error: "BILLING_REQUIRED", status: "billing_required" };
          }
          if (res.status >= 500) {
             return { error: "SERVER_ERROR", status: "unavailable" };
          }
          
          const errorText = await res.text();
          throw new Error(`OPENROUTER error ${res.status}: ${errorText}`);
        }

        const data = (await res.json()) as any;
        const content = data.choices?.[0]?.message?.content;
        
        if (!content) {
          throw new Error("Empty response");
        }
        
        try {
          let cleaned = content;
          const match = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
          if (match) {
            cleaned = match[1].trim();
          } else {
            cleaned = content.replace(/^```json\n?/, '').replace(/```\n?$/, '').trim();
          }
          const firstBrace = cleaned.indexOf('{');
          const firstBracket = cleaned.indexOf('[');
          const firstValidChar = (firstBrace !== -1 && firstBracket !== -1) ? Math.min(firstBrace, firstBracket) : Math.max(firstBrace, firstBracket);
          const lastBrace = cleaned.lastIndexOf('}');
          const lastBracket = cleaned.lastIndexOf(']');
          const lastValidChar = Math.max(lastBrace, lastBracket);
          
          if (firstValidChar !== -1 && lastValidChar !== -1 && lastValidChar >= firstValidChar) {
            cleaned = cleaned.substring(firstValidChar, lastValidChar + 1);
          }
          return JSON.parse(cleaned);
        } catch (e) {
          if (attempt === 1) {
            currentMessages.push({ role: "assistant", content });
            currentMessages.push({ role: "user", content: "Your last response was not valid JSON. Please provide ONLY a valid JSON object without markdown formatting." });
            continue;
          }
          return { error: "INVALID_RESPONSE", status: "unavailable" };
        }
      } finally {
        globalAiLimiter.release();
        clearTimeout(timeoutId);
      }
    } catch (error: any) {
      if (error.name === "AbortError") {
        return { error: "TIMEOUT", status: "unavailable" };
      }
      return { error: error.message || "SERVER_ERROR", status: "unavailable" };
    }
  }
}


export async function callOpenRouterFinalJudge(prompt: string, context: any) {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const baseUrl = (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/+$/, "");
  const model = (process.env.OPENROUTER_FINAL_JUDGE_MODEL || "google/gemma-4-31b-it:free").trim();
  if (!apiKey) {
    return { error: true, status: "AUTH_ERROR", reason: "OPENROUTER_API_KEY is missing or empty." };
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
        "X-OpenRouter-Title": "APEXSIGNAL FINAL JUDGE"
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: JSON.stringify(context) }
        ],
        temperature: 0.1
      }),
      signal: controller.signal
    });
    const body = await res.text();
    if (!res.ok) {
      return { error: true, status: res.status === 401 ? "AUTH_ERROR" : res.status === 402 ? "BILLING_REQUIRED" : res.status === 429 ? "RATE_LIMITED" : `HTTP_${res.status}`, reason: `OpenRouter Final Judge HTTP ${res.status}`, httpStatus: res.status, body: body.slice(0, 1000) };
    }
    let data:any;
    try { data = JSON.parse(body); } catch { return { error: true, status: "INVALID_RESPONSE", reason: "OpenRouter returned invalid JSON." }; }
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) return { error: true, status: "INVALID_RESPONSE", reason: "OpenRouter Final Judge returned an empty response." };
    const match = content.match(/\{[\s\S]*\}/);
    let parsed:any;
    try { parsed = JSON.parse(match ? match[0] : content); } catch { return { error: true, status: "INVALID_RESPONSE", reason: "OpenRouter Final Judge JSON parse failed.", rawContent: content.slice(0,2000) }; }
    if (!["LONG","SHORT","NO_TRADE"].includes(parsed?.decision)) return { error: true, status: "INVALID_RESPONSE", reason: "OpenRouter Final Judge returned invalid decision.", rawContent: content.slice(0,2000) };
    return { error: false, status: "SUCCESS", provider: "OPENROUTER", model, result: parsed };
  } catch (e:any) {
    return { error: true, status: e?.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR", reason: e?.message || "OpenRouter Final Judge request failed." };
  } finally {
    clearTimeout(timeoutId);
  }
}
