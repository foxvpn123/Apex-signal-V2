import { globalAiLimiter } from "./RateLimiter.js";

export interface UnoRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const unavailableModels = new Set<string>();
const cooldowns = new Map<string, number>();

let availableModelsCache: Set<string> | null = null;
let availableModelsPromise: Promise<Set<string>> | null = null;

function getCredentials() {
  const apiKey = process.env.UNOROUTER_API_KEY;
  let baseUrl = process.env.UNOROUTER_BASE_URL || "https://api.unorouter.com/v1";
  if (baseUrl.endsWith("/chat/completions")) {
    baseUrl = baseUrl.replace(/\/chat\/completions$/, "");
  }
  return { apiKey, baseUrl };
}

function isMarketAnalysisModel(modelId: string): boolean {
  const audioImageEmbeddingPatterns = [
    "whisper",
    "albedobase",
    "absolutereality",
    "rev-animated",
    "flat-2d-animerge",
    "icbinp",
    "anything-v5",
    "dreamshaper",
    "deliberate",
    "jina-embedding"
  ];
  
  return !audioImageEmbeddingPatterns.some(pattern => modelId.toLowerCase().includes(pattern));
}

export async function fetchAvailableModels(): Promise<Set<string>> {
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
        
        const models = new Set<string>();
        for (const m of data.data) {
          if (isMarketAnalysisModel(m.id)) {
            models.add(m.id);
          }
        }
        availableModelsCache = models;
        return models;
      }
    } catch (e) {
      console.warn("[UNOROUTER] Failed to fetch models", e);
    }
    return new Set<string>();
  })();

  return availableModelsPromise;
}

export async function checkBalance(): Promise<{
  provider: string;
  configured: boolean;
  authenticated: boolean;
  status: string;
}> {
  const { apiKey, baseUrl } = getCredentials();

  if (!apiKey) {
    return {
      provider: "UNOROUTER",
      configured: false,
      authenticated: false,
      status: "MISSING_KEY"
    };
  }

  try {
    const res = await fetch(`${baseUrl}/models`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`
      }
    });
    if (res.ok) {
      return {
        provider: "UNOROUTER",
        configured: true,
        authenticated: true,
        status: "CONNECTED"
      };
    } else if (res.status === 402) {
      return {
        provider: "UNOROUTER",
        configured: true,
        authenticated: false,
        status: "BILLING_REQUIRED"
      };
    } else {
      return {
        provider: "UNOROUTER",
        configured: true,
        authenticated: false,
        status: "AUTH_ERROR"
      };
    }
  } catch (error) {
    return {
      provider: "UNOROUTER",
      configured: true,
      authenticated: false,
      status: "AUTH_ERROR"
    };
  }
}

export async function callModel(modelId: string, messages: UnoRouterMessage[], role?: string): Promise<any> {
  const { apiKey, baseUrl } = getCredentials();
  
  const startTime = Date.now();
  if (role) {
    console.log(`[UNOROUTER]\nROLE=${role}\nMODEL=${modelId}\nREQUEST=START`);
  }

  if (!apiKey) {
    if (role) console.log(`[UNOROUTER]\nROLE=${role}\nMODEL=${modelId}\nREQUEST=FAIL\nHTTP=401\nLATENCY=${Date.now() - startTime}ms`);
    throw new Error("Missing UNOROUTER_API_KEY");
  }

  if (unavailableModels.has(modelId)) {
    return { error: "NOT FOUND", status: "unavailable" };
  }

  const available = await fetchAvailableModels();
  if (available.size > 0 && !available.has(modelId)) {
    console.warn(`[UNOROUTER] Model: ${modelId} is not in the verified startup list or is filtered as non-text.`);
    unavailableModels.add(modelId);
    return { error: "NOT FOUND", status: "unavailable" };
  }

  // Block paid models just in case
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
        temperature: 0.2 // Low temperature for deterministic output
      };

      await globalAiLimiter.acquire();
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000); // 25s timeout

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
           console.log(`[UNOROUTER]\nROLE=${role}\nMODEL=${modelId}\nREQUEST=${res.ok ? "SUCCESS" : "FAIL"}\nHTTP=${res.status}\nLATENCY=${Date.now() - startTime}ms`);
        }

        if (!res.ok) {
          if (res.status === 401) {
            throw new Error("UNOROUTER authentication failed. Check UNOROUTER_API_KEY.");
          }
          if (res.status === 403) {
            throw new Error("UNOROUTER access denied.");
          }
          if (res.status === 429) {
            console.warn(`[UNOROUTER Rate Limit] Model: ${modelId} - Rate limited (429)`);
            let retryAfter = 60;
            const retryAfterHeader = res.headers.get("Retry-After");
            if (retryAfterHeader) {
              retryAfter = parseInt(retryAfterHeader, 10) || 60;
            }
            cooldowns.set(modelId, Date.now() + retryAfter * 1000);
            return {
              error: "RATE LIMITED",
              status: "unavailable"
            };
          }
          if (res.status === 404) {
            console.warn(`[UNOROUTER Fallback] Model: ${modelId} - 404 Not Found`);
            unavailableModels.add(modelId);
            return {
              error: "NOT FOUND",
              status: "unavailable"
            };
          }
          if (res.status === 402) {
            return {
              error: "BILLING_REQUIRED",
              status: "billing_required",
              details: "Billing required at UNOROUTER"
            };
          }
          
          const errorText = await res.text();
          if (res.status >= 500) {
            throw new Error("UNOROUTER service temporarily unavailable.");
          }
          throw new Error(`UNOROUTER error ${res.status}: ${errorText}`);
        }

        const data = (await res.json()) as any;
        const content = data.choices[0].message.content;
        
        // Parse JSON
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
            console.warn(`[UNOROUTER Repair] Model: ${modelId} - Malformed JSON, retrying once.`);
            currentMessages.push({ role: "assistant", content });
            currentMessages.push({ role: "user", content: "Your last response was not valid JSON. Please provide ONLY a valid JSON object without markdown formatting." });
            continue;
          }
          console.warn(`[UNOROUTER Fallback] Model: ${modelId} - Model returned malformed JSON after retry: ${content}`);
          return {
            error: "MALFORMED_JSON",
            status: "unavailable"
          };
        }
      } finally {
        globalAiLimiter.release();
        clearTimeout(timeoutId);
      }

    } catch (error: any) {
      if (error.name === "AbortError") {
        console.warn(`[UNOROUTER Fallback] Model: ${modelId} - TIMEOUT`);
        return {
          error: "TIMEOUT",
          status: "unavailable"
        };
      }
      console.warn(`[UNOROUTER Fallback] Model: ${modelId} - ${error.message}`);
      if (error.message.includes("fetch")) {
        return {
          error: "Unable to reach UNOROUTER.",
          status: "unavailable"
        };
      }
      return {
        error: error.message,
        status: "unavailable"
      };
    }
  }
}
