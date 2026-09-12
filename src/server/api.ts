import { Router } from "express";
import { getMarkets, getKlines } from "./services/binance.js";
import { runScan, APINEX_V2_SPECIALISTS, XKIRO_MODELS, UNOROUTER_MODELS, OPENROUTER_MODELS } from "./services/orchestrator.js";
import { getWsStatus, initializeWebSocketInfrastructure } from "./services/binance/ws/index.js";
import { checkBalance, checkBillingStatus } from "./services/apinex.js";
import { checkOpenRouterStatus } from "./services/openrouter.js";
import { getBinanceAccountInfo } from "./services/binance.js";

// Initialize WebSocket managers on server start
initializeWebSocketInfrastructure();

export const router = Router();

router.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

router.get("/openrouter/status", async (req, res) => {
  try {
    const status = await checkOpenRouterStatus();
    res.json(status);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/v2/apinex/billing-status", async (req, res) => {
  try {
    const status = await checkBillingStatus();
    res.json({
      provider: status.provider,
      configured: status.configured,
      reachable: status.reachable,
      balanceUsd: status.balanceUsd,
      billingStatus: status.billingStatus,
      spendLimitStatus: status.spendLimitStatus,
      lastError: status.lastError
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/apinex/status", async (req, res) => {
  try {
    const status = await checkBalance();
    res.json(status);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/binance/ws-status", (req, res) => {
  res.json(getWsStatus());
});

router.get("/markets", async (req, res) => {
  try {
    const markets = await getMarkets();
    res.json(markets);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/scan", async (req, res) => {
  try {
    const { symbol, timeframe } = req.body;
    if (!symbol || !timeframe) {
      return res.status(400).json({ error: "Missing symbol or timeframe" });
    }
    
    if (!process.env.APINEX_API_KEY && !process.env.AIHUBMIX_API_KEY) {
      return res.status(500).json({ 
        error: "APINEX_API_KEY / AIHUBMIX_API_KEY is not configured on the server."
      });
    }

    const result = await runScan(symbol, timeframe);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/v2/diagnostics", async (req, res) => {
  const { fetchAvailableModelsTokenRouter, getTokenRouterConfig } = await import("./services/tokenrouter.js");
  const [trStatus, trConfig] = await Promise.all([
    fetchAvailableModelsTokenRouter(),
    Promise.resolve(getTokenRouterConfig())
  ]);
  
  const binanceAccount = await getBinanceAccountInfo();
  res.json({
    status: "ONLINE",
    providers: ["APINEX", "XKIRO", "UNOROUTER", "OPENROUTER", "TOKENROUTER"],
    apinexModels: Object.values(APINEX_V2_SPECIALISTS),
    xkiroModels: XKIRO_MODELS,
    unorouterModels: UNOROUTER_MODELS,
    openrouterModels: Object.values(OPENROUTER_MODELS),
    binanceWs: getWsStatus(),
    binanceAccount: {
      enabled: binanceAccount.enabled,
      error: binanceAccount.error
    },
    finalJudge: {
      provider: "TOKENROUTER",
      model: "z-ai/glm-5.3-free",
      configured: trConfig.configured,
      reachable: trStatus.reachable,
      status: trStatus.reachable ? "ONLINE" : "ERROR",
      lastLatencyMs: 0,
      lastError: null
    }
  });
});


router.get("/v2/final-judge-status", async (req, res) => {
  const { getFinalJudgeStatus } = await import("./services/gemini.js");
  const status = getFinalJudgeStatus();
  res.json(status);
});

router.post("/v2/test-final-judge", async (req, res) => {
  try {
    const { callGeminiFinalJudge } = await import("./services/gemini.js");
    const result = await callGeminiFinalJudge({ currentPrice: 100, test: true });
    res.status(result.error ? 502 : 200).json(result);
  } catch (error: any) {
    res.status(500).json({
      provider: "GEMINI",
      status: "ERROR",
      safeError: error?.message || "Final Judge test failed"
    });
  }
});

router.post("/v2/test-model", async (req, res) => {
  try {
    let { provider, model } = req.body;
    if (!provider || !model) {
      return res.status(400).json({ error: "Missing provider or model" });
    }
    provider = provider.toUpperCase();
    
    const start = Date.now();
    let status = "QUEUED";
    let httpStatus = 200;
    let safeError = null;
    let responsePreview = null;

    try {
      let apiKey = "";
      let baseUrl = "";
      
      if (provider === "APINEX") {
        apiKey = process.env.APINEX_API_KEY || process.env.AIHUBMIX_API_KEY || "";
        baseUrl = process.env.APINEX_BASE_URL || process.env.AIHUBMIX_BASE_URL || "https://api.apinex.bond/v1";
      } else if (provider === "XKIRO") {
        apiKey = process.env.XKIRO_API_KEY || "";
        baseUrl = process.env.XKIRO_BASE_URL || "https://api.xkiro.com/v1";
      } else if (provider === "UNOROUTER") {
        apiKey = process.env.UNOROUTER_API_KEY || "";
        baseUrl = process.env.UNOROUTER_BASE_URL || "https://api.unorouter.com/v1";
      } else if (provider === "OPENROUTER") {
        apiKey = process.env.OPENROUTER_API_KEY || "";
        baseUrl = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
      } else {
         return res.status(400).json({ error: "Unknown provider" });
      }

      if (baseUrl.endsWith("/chat/completions")) {
        baseUrl = baseUrl.replace(/\/chat\/completions$/, "");
      }

      if (!apiKey) {
        status = "AUTH_ERROR";
        safeError = "Missing API Key";
        httpStatus = 401;
      } else {
        const headers: any = {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        };
        if (provider === "OPENROUTER") {
          headers["HTTP-Referer"] = process.env.APP_URL || "http://localhost:3000";
          headers["X-OpenRouter-Title"] = "APEXSIGNAL AI";
        }
        const fetchRes = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: "Reply exactly: OK" }],
            temperature: 0.2
          })
        });

        httpStatus = fetchRes.status;
        
        if (!fetchRes.ok) {
          const errorText = await fetchRes.text();
          if (httpStatus === 402 || errorText.includes("CHECK-IN REQUIRED") || errorText.includes("BILLING_REQUIRED")) {
            status = "BILLING_REQUIRED";
            safeError = "BILLING_REQUIRED";
          } else if (httpStatus === 401) {
             status = "AUTH_ERROR";
             safeError = "AUTH_ERROR";
          } else if (httpStatus === 404) {
             status = "MODEL_NOT_FOUND";
             safeError = "MODEL_NOT_FOUND";
          } else {
            status = "ERROR";
            safeError = errorText;
          }
        } else {
          const data = await fetchRes.json();
          responsePreview = data.choices?.[0]?.message?.content?.trim();
          status = "COMPLETED";
        }
      }
    } catch (e: any) {
      status = "ERROR";
      safeError = e.message;
      httpStatus = 500;
    }
    const latencyMs = Date.now() - start;

    res.json({
      provider,
      model,
      status,
      httpStatus,
      latencyMs,
      safeError,
      responsePreview
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
