import { globalAiLimiter } from "./RateLimiter.js";

export interface XkiroMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const unavailableModels = new Set<string>();
const cooldowns = new Map<string, number>();

let availableModelsCache: Set<string> | null = null;
let availableModelsPromise: Promise<Set<string>> | null = null;

function getCredentials() {
  const apiKey = process.env.XKIRO_API_KEY;
  let baseUrl = process.env.XKIRO_BASE_URL || "https://api.xkiro.com/v1";
  if (baseUrl.endsWith("/chat/completions")) {
    baseUrl = baseUrl.replace(/\/chat\/completions$/, "");
  }
  return { apiKey, baseUrl };
}

export async function fetchAvailableModelsXkiro(): Promise<Set<string>> {
  if (availableModelsCache) return availableModelsCache;
  if (availableModelsPromise) return availableModelsPromise;
  
  availableModelsPromise = (async () => {
    const { apiKey, baseUrl } = getCredentials();
    
    if (!apiKey) {
      return new Set<string>();
    }

    try {
      const res = await fetch(`${baseUrl}/models`, {
        headers: { "Authorization": `Bearer ${apiKey}` }
      });
      if (res.ok) {
        const data = await res.json();
        const models = new Set<string>(data.data.map((m: any) => m.id));
        availableModelsCache = models;
        return models;
      }
    } catch (e) {
      console.warn("[XKIRO] Failed to fetch models", e);
    }
    return new Set<string>();
  })();

  return availableModelsPromise;
}

export async function callModelXkiro(modelId: string, messages: XkiroMessage[], role?: string): Promise<any> {
  const { apiKey, baseUrl } = getCredentials();
  
  const startTime = Date.now();
  if (role) {
    console.log(`[XKIRO]\nROLE=${role}\nMODEL=${modelId}\nREQUEST=START`);
  }

  if (!apiKey) {
    if (role) console.log(`[XKIRO]\nROLE=${role}\nMODEL=${modelId}\nREQUEST=FAIL\nHTTP=401\nLATENCY=${Date.now() - startTime}ms`);
    return { error: "Missing or invalid XKIRO_API_KEY", status: "unavailable" };
  }

  if (unavailableModels.has(modelId)) {
    return { error: "NOT FOUND", status: "unavailable" };
  }

  const available = await fetchAvailableModelsXkiro();
  if (available.size > 0 && !available.has(modelId)) {
    console.warn(`[XKIRO Fallback] Model: ${modelId} is not in the verified startup list.`);
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
      const requestBody = {
        model: modelId,
        messages: currentMessages,
        temperature: 0.2
      };

      await globalAiLimiter.acquire();
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000); 

      let res;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal as any
        });
        
        if (role) {
           console.log(`[XKIRO]\nROLE=${role}\nMODEL=${modelId}\nREQUEST=${res.ok ? "SUCCESS" : "FAIL"}\nHTTP=${res.status}\nLATENCY=${Date.now() - startTime}ms`);
        }

        if (!res.ok) {
          if (res.status === 401) {
             return { error: "AUTH_ERROR", status: "unavailable" };
          }
          if (res.status === 429) {
            let retryAfter = 60;
            const retryAfterHeader = res.headers.get("Retry-After");
            if (retryAfterHeader) {
              retryAfter = parseInt(retryAfterHeader, 10) || 60;
            }
            cooldowns.set(modelId, Date.now() + retryAfter * 1000);
            return { error: "RATE LIMITED", status: "unavailable" };
          }
          if (res.status === 404) {
            unavailableModels.add(modelId);
            return { error: "NOT FOUND", status: "unavailable" };
          }
          if (res.status === 402) {
            return { error: "BILLING_REQUIRED", status: "billing_required" };
          }
          
          const errorText = await res.text();
          if (errorText.includes("CHECK-IN REQUIRED") || errorText.includes("BILLING_REQUIRED")) {
            return { error: "BILLING_REQUIRED", status: "billing_required" };
          }
          throw new Error(`XKIRO error ${res.status}: ${errorText}`);
        }

        const data = (await res.json()) as any;
        const content = data.choices?.[0]?.message?.content;
        
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
          return { error: "MALFORMED_JSON", status: "unavailable" };
        }
      } finally {
        globalAiLimiter.release();
        clearTimeout(timeoutId);
      }
    } catch (error: any) {
      if (error.name === "AbortError") {
        return { error: "TIMEOUT", status: "unavailable" };
      }
      return { error: error.message, status: "unavailable" };
    }
  }
}
