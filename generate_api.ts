import fs from 'fs';

const content = `import { Router } from "express";
import { getMarkets, getKlines } from "./services/binance.js";
import { runScan, APINEX_V2_SPECIALISTS, XKIRO_MODELS } from "./services/orchestrator.js";
import { getWsStatus, initializeWebSocketInfrastructure } from "./services/binance/ws/index.js";
import { checkBalance, checkBillingStatus } from "./services/apinex.js";

// Initialize WebSocket managers on server start
initializeWebSocketInfrastructure();

export const router = Router();

router.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
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

router.get("/v2/diagnostics", (req, res) => {
  // Return basic diagnostics for now
  res.json({
    status: "ONLINE",
    providers: ["APINEX", "XKIRO"],
    apinexModels: Object.values(APINEX_V2_SPECIALISTS),
    xkiroModels: XKIRO_MODELS,
    binanceWs: getWsStatus()
  });
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
      } else {
         return res.status(400).json({ error: "Unknown provider" });
      }

      if (!apiKey) {
        status = "AUTH_ERROR";
        safeError = "Missing API Key";
        httpStatus = 401;
      } else {
        const fetchRes = await fetch(\`\${baseUrl}/chat/completions\`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": \`Bearer \${apiKey}\`
          },
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
`;
fs.writeFileSync("src/server/api.ts", content);
