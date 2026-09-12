import { globalAiLimiter } from "./RateLimiter.js";

export interface APInexMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const unavailableModels = new Set<string>();
const cooldowns = new Map<string, number>();

let availableModelsCache: Set<string> | null = null;
let availableModelsPromise: Promise<Set<string>> | null = null;

function getCredentials() {
  let apiKey = process.env.APINEX_API_KEY || process.env.AIHUBMIX_API_KEY;
  let baseUrl = process.env.APINEX_BASE_URL || process.env.AIHUBMIX_BASE_URL || "https://api.apinex.bond/v1";

  // Recover if user accidentally swapped the API key and Base URL in their secrets
  if (apiKey?.startsWith("http") && baseUrl?.startsWith("sk-")) {
    const temp = apiKey;
    apiKey = baseUrl;
    baseUrl = temp;
  } else if (baseUrl?.startsWith("sk-")) {
    apiKey = baseUrl;
    baseUrl = "https://api.apinex.bond/v1";
  } else if (apiKey?.startsWith("http") && !baseUrl) {
     baseUrl = apiKey;
     apiKey = undefined;
  }
  
  if (baseUrl?.endsWith("/chat/completions")) {
    baseUrl = baseUrl.replace(/\/chat\/completions$/, "");
  }

  return { apiKey, baseUrl };
}

export async function fetchAvailableModels(): Promise<Set<string>> {
  if (availableModelsCache) return availableModelsCache;
  if (availableModelsPromise) return availableModelsPromise;
  
  availableModelsPromise = (async () => {
    const { apiKey, baseUrl } = getCredentials();
    
    if (!apiKey || apiKey === "your_aihubmix_api_key_here") {
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
      console.warn("[AI] Failed to fetch models", e);
    }
    return new Set<string>();
  })();

  return availableModelsPromise;
}

export async function checkBillingStatus(): Promise<any> {
  const { apiKey, baseUrl } = getCredentials();

  if (!apiKey || apiKey === "your_aihubmix_api_key_here") {
    return {
      provider: "APINEX",
      configured: false,
      reachable: false,
      balanceUsd: null,
      billingStatus: "MISSING_KEY",
      spendLimitStatus: "UNKNOWN",
      lastError: "No API key configured"
    };
  }

  try {
    const res = await fetch(`${baseUrl}/balance`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`
      }
    });

    if (res.ok) {
      const data = await res.json();
      return {
        provider: "APINEX",
        configured: true,
        reachable: true,
        balanceUsd: data.balance_usd ?? data.balance ?? null,
        billingStatus: data.billing_status ?? data.status ?? "CONNECTED",
        spendLimitStatus: data.spend_limit ?? data.limit ?? "UNKNOWN",
        lastError: null,
        _raw: data // Keep this server-side only in actual use, but omit from API response
      };
    } else {
      const errorText = await res.text();
      let classification = "UNKNOWN_402";
      if (res.status === 402) {
        if (errorText.includes("INSUFFICIENT_BALANCE") || errorText.includes("balance")) classification = "INSUFFICIENT_BALANCE";
        else if (errorText.includes("SPEND_LIMIT_REACHED") || errorText.includes("limit")) classification = "SPEND_LIMIT_REACHED";
        else if (errorText.includes("BILLING_REQUIRED")) classification = "BILLING_REQUIRED";
        else if (errorText.includes("ACCOUNT_ACCESS_RESTRICTED") || errorText.includes("restricted")) classification = "ACCOUNT_ACCESS_RESTRICTED";
      }

      return {
        provider: "APINEX",
        configured: true,
        reachable: true,
        balanceUsd: null,
        billingStatus: res.status === 402 ? classification : `HTTP_${res.status}`,
        spendLimitStatus: "UNKNOWN",
        lastError: errorText
      };
    }
  } catch (error: any) {
    return {
      provider: "APINEX",
      configured: true,
      reachable: false,
      balanceUsd: null,
      billingStatus: "AUTH_ERROR",
      spendLimitStatus: "UNKNOWN",
      lastError: error.message
    };
  }
}

export async function checkBalance(): Promise<{
  provider: string;
  configured: boolean;
  authenticated: boolean;
  status: string;
}> {
  const { apiKey, baseUrl } = getCredentials();

  if (!apiKey || apiKey === "your_aihubmix_api_key_here") {
    return {
      provider: "APInex",
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
        provider: "APInex",
        configured: true,
        authenticated: true,
        status: "CONNECTED"
      };
    } else if (res.status === 402) {
      return {
        provider: "APInex",
        configured: true,
        authenticated: false,
        status: "BILLING_REQUIRED"
      };
    } else {
      return {
        provider: "APInex",
        configured: true,
        authenticated: false,
        status: "AUTH_ERROR"
      };
    }
  } catch (error) {
    return {
      provider: "APInex",
      configured: true,
      authenticated: false,
      status: "AUTH_ERROR"
    };
  }
}

export async function callModel(modelId: string, messages: APInexMessage[], role?: string): Promise<any> {
  const { apiKey, baseUrl } = getCredentials();
  
  const startTime = Date.now();
  if (role) {
    console.log(`[APINEX]\nROLE=${role}\nMODEL=${modelId}\nREQUEST=START`);
  }

  if (!apiKey || apiKey === "your_aihubmix_api_key_here") {
    if (role) console.log(`[APINEX]\nROLE=${role}\nMODEL=${modelId}\nREQUEST=FAIL\nHTTP=401\nLATENCY=${Date.now() - startTime}ms`);
    throw new Error("Missing or invalid AIHUBMIX_API_KEY");
  }

  if (unavailableModels.has(modelId)) {
    return { error: "NOT FOUND", status: "unavailable" };
  }

  const available = await fetchAvailableModels();
  if (available.size > 0 && !available.has(modelId)) {
    console.warn(`[AI Fallback] Model: ${modelId} is not in the verified startup list.`);
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
           console.log(`[APINEX]\nROLE=${role}\nMODEL=${modelId}\nREQUEST=${res.ok ? "SUCCESS" : "FAIL"}\nHTTP=${res.status}\nLATENCY=${Date.now() - startTime}ms`);
        }

        if (!res.ok) {
          if (res.status === 401) {
            throw new Error("AI provider authentication failed. Check AIHUBMIX_API_KEY.");
          }
          if (res.status === 403) {
            throw new Error("APInex access denied.");
          }
          if (res.status === 429) {
            console.warn(`[AI Rate Limit] Model: ${modelId} - Rate limited (429)`);
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
            console.warn(`[AI Fallback] Model: ${modelId} - 404 Not Found`);
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
              details: "Billing required at APInex"
            };
          }
          
          const errorText = await res.text();
          if (errorText.includes("CHECK-IN REQUIRED") || errorText.includes("BILLING_REQUIRED")) {
            return {
              error: "BILLING_REQUIRED",
              status: "billing_required",
              details: "Billing required at APInex"
            };
          }
          if (res.status >= 500) {
            throw new Error("APInex service temporarily unavailable.");
          }
          throw new Error(`APInex error ${res.status}: ${errorText}`);
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
          
          // Find the first { or [ and last } or ]
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
            console.warn(`[AI Repair] Model: ${modelId} - Malformed JSON, retrying once.`);
            currentMessages.push({ role: "assistant", content });
            currentMessages.push({ role: "user", content: "Your last response was not valid JSON. Please provide ONLY a valid JSON object without markdown formatting." });
            continue;
          }
          console.warn(`[AI Fallback] Model: ${modelId} - Model returned malformed JSON after retry: ${content}`);
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
        console.warn(`[AI Fallback] Model: ${modelId} - TIMEOUT`);
        return {
          error: "TIMEOUT",
          status: "unavailable"
        };
      }
      console.warn(`[AI Fallback] Model: ${modelId} - ${error.message}`);
      if (error.message.includes("fetch")) {
        return {
          error: "Unable to reach APInex.",
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
