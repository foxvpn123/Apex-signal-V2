import fs from 'fs';

const content = `import { getKlines, getServerTime } from "./binance.js";
import { calculateIndicators } from "./indicators.js";
import { callModel, checkBillingStatus } from "./apinex.js";
import { callModelXkiro, fetchAvailableModelsXkiro } from "./xkiro.js";
import { liveDataHub } from "./binance/ws/LiveDataHub.js";

const TIMEFRAMES = ["10m", "15m", "20m", "1H", "4H", "1D"];

export const APINEX_V2_SPECIALISTS = {
  TECHNICAL: "free/gemini-3.8-flash",
  SENTIMENT: "free/gemini-3.1-pro",
  RISK_GUARD: "free/deepseek-v4-pro-0813",
  FORECAST: "free/gpt-5.6-luna",
  SCENARIO: "free/qwen-3.8-max"
};

export const XKIRO_MODELS = [
  "openai/gpt-5.3-codex-spark",
  "mistralai/mistral-large-2512",
  "mistralai/mistral-medium-3.5",
  "mistralai/devstral-medium",
  "minimax/minimax-m3:free",
  "minimax/minimax-m2.7:free",
  "minimax/minimax-m2.7-highspeed:free",
  "deepseek/deepseek-v4-pro",
  "deepseek/deepseek-v3.2",
  "sensenova/sensenova-6.8-flash-lite",
  "qwen/qwen3.8-max:free",
  "qwen/qwen3.7-max:free",
  "qwen/qwen3.7-plus:free",
  "qwen/qwen3.5-omni-flash:free"
];

let serverTimeOffset = 0;
let timeSynced = false;

async function syncTime() {
  try {
    const serverTime = await getServerTime();
    serverTimeOffset = serverTime - Date.now();
    timeSynced = true;
  } catch (e) {
    console.warn("[WARN] Failed to sync server time, using local time");
  }
}

function getNow() {
  return Date.now() + serverTimeOffset;
}

export async function prepareMarketData(symbol: string, targetTimeframe: string) {
  if (!timeSynced) {
    await syncTime();
  }

  const normalizedSymbol = symbol.toUpperCase();
  liveDataHub.subscribeToMarket(normalizedSymbol);

  const wsStatus = liveDataHub.getStatus();
  const priceData = liveDataHub.getPriceData(normalizedSymbol);
  
  let currentPrice = priceData?.price;
  let priceAgeMs = priceData ? getNow() - priceData.timestamp : Infinity;
  
  const wsHealthy = liveDataHub.isHealthy();
  const PRICE_STALE_MS = 30000;
  
  let restFallbackUsed = false;
  
  console.log(\`[DATA] \${normalizedSymbol} selected\`);
  
  const multiTimeframeData: Record<string, any> = {};
  await Promise.all(
    TIMEFRAMES.map(async (tf) => {
      try {
        const klines = await getKlines(normalizedSymbol, tf, 200);
        const indicators = calculateIndicators(klines);
        multiTimeframeData[tf] = {
          klines,
          currentPrice: klines[klines.length - 1]?.close,
          indicators,
        };
      } catch (e: any) {
        console.warn(\`Failed to fetch TF \${tf} for \${normalizedSymbol}: \${e.message}\`);
      }
    })
  );

  const targetData = multiTimeframeData[targetTimeframe];
  if (!targetData || !targetData.klines || targetData.klines.length === 0) {
    throw new Error(\`Insufficient data for target timeframe \${targetTimeframe}\`);
  }

  const latestCandle = targetData.klines[targetData.klines.length - 1];
  
  if (!currentPrice || priceAgeMs > PRICE_STALE_MS) {
    currentPrice = targetData.currentPrice;
    restFallbackUsed = true;
  }

  const now = getNow();
  const candleAgeMs = now - latestCandle.closeTime;
  const isFresh = candleAgeMs < 120000;
  
  if (!isFresh) {
    throw new Error("Market data stale or unavailable. REST fallback failed to provide fresh data.");
  }

  return {
    symbol: normalizedSymbol,
    timeframe: targetTimeframe,
    currentPrice,
    multiTimeframeData,
    targetData,
    debug: {
      wsStatus: wsStatus.status,
      wsHealthy,
      priceAgeMs,
      candleAgeMs,
      restFallbackUsed,
      serverTimeOffset
    }
  };
}

function runMarketThinking(marketData: any) {
  const { currentPrice, targetData } = marketData;
  const ind = targetData.indicators;
  
  let regime = "RANGE";
  if (currentPrice > ind.ema20 && ind.ema20 > ind.ema50) regime = "TRENDING_UP";
  if (currentPrice < ind.ema20 && ind.ema20 < ind.ema50) regime = "TRENDING_DOWN";
  
  const momentum = ind.rsi > 60 ? "STRONG_BULLISH" : ind.rsi < 40 ? "STRONG_BEARISH" : "NEUTRAL";
  const volatility = (ind.atr / currentPrice) * 100 > 2 ? "HIGH" : "LOW";
  
  return { regime, momentum, volatility, vwapState: currentPrice > ind.vwap ? "ABOVE" : "BELOW" };
}

function runStrategies(marketData: any) {
  const { currentPrice, targetData } = marketData;
  const klines = targetData.klines;
  if (!klines || klines.length < 5) return { pdhPdlSweep: "NONE" };
  
  // Find PDH / PDL simple logic (e.g. from last 24 candles)
  let maxH = -Infinity, minL = Infinity;
  for(let i = Math.max(0, klines.length - 24); i < klines.length - 1; i++) {
    if (klines[i].high > maxH) maxH = klines[i].high;
    if (klines[i].low < minL) minL = klines[i].low;
  }
  
  const latest = klines[klines.length - 1];
  let sweep = "NONE";
  if (latest.low < minL && latest.close > minL && currentPrice > targetData.indicators.vwap) sweep = "BULLISH_SWEEP_RECLAIM";
  if (latest.high > maxH && latest.close < maxH && currentPrice < targetData.indicators.vwap) sweep = "BEARISH_SWEEP_REJECT";
  
  return {
    pdh: maxH,
    pdl: minL,
    pdhPdlSweep: sweep
  };
}

const specialistSchema = \`{ "decision": "LONG|SHORT|NO_TRADE", "confidence": 0, "marketRegime": "", "evidence": [], "contradictions": [], "risk": "", "invalidation": "", "setupQuality": 0 }\`;

function getSpecialistPrompt(role: string, context: string) {
  let instructions = "";
  if (role === "TECHNICAL") instructions = "Evaluate price action, trend, EMA/SMA, RSI, MACD, VWAP, support/resistance, market structure.";
  else if (role === "SENTIMENT") instructions = "Analyze market sentiment, bullish/bearish pressure, crowd positioning, and sentiment contradictions.";
  else if (role === "RISK_GUARD") instructions = "Check entry quality, stop placement, volatility, spread, R:R, downside risk, and invalidation.";
  else if (role === "FORECAST") instructions = "Estimate scenarios: bullish continuation, bearish continuation, reversal, range. Do not claim certainty.";
  else if (role === "SCENARIO") instructions = "Construct alternative scenarios and challenge the leading direction.";
  
  return [
    { role: "system", content: \`You are a \${role} model. Output strictly JSON adhering to schema: \${specialistSchema}. \${instructions}\` },
    { role: "user", content: context }
  ] as any;
}

export async function runScan(symbol: string, targetTimeframe: string) {
  // 1. Snapshot Market
  const marketData = await prepareMarketData(symbol, targetTimeframe);
  const { multiTimeframeData, targetData, currentPrice, debug } = marketData;

  // 2. Deterministic Engines
  const marketThinking = runMarketThinking(marketData);
  const strategies = runStrategies(marketData);

  const mtfSummary = TIMEFRAMES.reduce((acc: any, tf) => {
    acc[tf] = multiTimeframeData[tf]?.indicators?.trend || "UNAVAILABLE";
    return acc;
  }, {});

  const baseContext = \`
Symbol: \${symbol}
Timeframe: \${targetTimeframe}
Current Price: \${currentPrice}
Indicators: \${JSON.stringify(targetData.indicators)}
MTF Alignment: \${JSON.stringify(mtfSummary)}
Market Thinking: \${JSON.stringify(marketThinking)}
Strategies: \${JSON.stringify(strategies)}
  \`;

  console.log(\`[SCAN] Snapshot frozen. Initiating models.\`);

  const billingStatus = await checkBillingStatus();
  const isBillingBlocked = !billingStatus.reachable || billingStatus.billingStatus === "BILLING_REQUIRED";

  const apinexTasks = [];
  const xkiroTasks = [];
  
  const roles = ["TECHNICAL", "SENTIMENT", "RISK_GUARD", "FORECAST", "SCENARIO"];

  if (isBillingBlocked) {
    console.log(\`[AI] APINEX Billing access restricted. Skipping APINEX models.\`);
  } else {
    for (const r of roles) {
      const model = (APINEX_V2_SPECIALISTS as any)[r];
      apinexTasks.push(
        callModel(model, getSpecialistPrompt(r, baseContext), r).then(res => ({ provider: "APINEX", role: r, model, res }))
      );
    }
  }

  // Add XKIRO fleet (distributed roles)
  for (let i = 0; i < XKIRO_MODELS.length; i++) {
    const model = XKIRO_MODELS[i];
    const r = roles[i % roles.length];
    xkiroTasks.push(
      callModelXkiro(model, getSpecialistPrompt(r, baseContext), r).then(res => ({ provider: "XKIRO", role: r, model, res }))
    );
  }

  // Wait for all models
  const allRawResults = await Promise.allSettled([...apinexTasks, ...xkiroTasks]);
  
  const modelResults: any = { APINEX: {}, XKIRO: {} };
  let validCount = 0;
  let totalAttempted = 0;

  for (const settled of allRawResults) {
    totalAttempted++;
    if (settled.status === "fulfilled") {
      const { provider, role, model, res } = settled.value;
      if (!modelResults[provider][role]) modelResults[provider][role] = [];
      modelResults[provider][role].push({ model, res });
      
      if (res && !res.error && res.decision) {
        validCount++;
      }
    }
  }

  if (validCount < 2) {
    return {
      symbol, timeframe: targetTimeframe, currentPrice, indicators: targetData.indicators,
      models: modelResults,
      meta: {
        decision: "NO_TRADE", noTradeType: "SYSTEM", reason: "INSUFFICIENT_VALID_MODELS", confidence: 0,
        keyEvidence: ["INSUFFICIENT_VALID_MODELS"], contradictions: [],
        bestSetup: { direction: "NO_TRADE", entry: null, sl: null, tp1: null, tp2: null, rr: null }
      },
      debug
    };
  }

  // 5. Self-Thinking Engine
  const selfThinkingContext = \`
\${baseContext}
Specialist Results: \${JSON.stringify(modelResults)}
\`;

  const metaSchema = \`{ "dominantBias": "LONG|SHORT|NEUTRAL", "marketRegime": "", "longCase": "", "shortCase": "", "keyEvidence": [], "contradictions": [], "riskAssessment": "", "bestSetup": { "direction": "LONG|SHORT|NO_TRADE", "entry": null, "sl": null, "tp1": null, "tp2": null, "tp3": null, "rr": null }, "confidence": 0, "invalidation": "", "decision": "LONG|SHORT|NO_TRADE" }\`;

  const metaPrompt = [
    { role: "system", content: \`You are the Self-Thinking Engine. Reconstruct the market story. Evaluate ALL models and output strict JSON schema: \${metaSchema}.\` },
    { role: "user", content: selfThinkingContext }
  ];

  // Pick a capable model for Self-Thinking
  let selfThinkingOutput = await callModelXkiro("openai/gpt-5.3-codex-spark", metaPrompt, "SELF_THINKING");
  
  if (selfThinkingOutput.error) {
    // Fallback to apinex
    selfThinkingOutput = await callModel(APINEX_V2_SPECIALISTS.TECHNICAL, metaPrompt, "SELF_THINKING");
  }

  if (!selfThinkingOutput || selfThinkingOutput.error) {
    return {
      symbol, timeframe: targetTimeframe, currentPrice, indicators: targetData.indicators,
      models: modelResults,
      meta: { decision: "NO_TRADE", noTradeType: "SYSTEM", reason: "SELF_THINKING_FAILED", bestSetup: { direction: "NO_TRADE" } },
      debug
    };
  }

  // 6. Risk Validation
  let finalMeta = { ...selfThinkingOutput };
  
  if (finalMeta.decision === "LONG" || finalMeta.decision === "SHORT") {
    const e = finalMeta.bestSetup?.entry;
    const sl = finalMeta.bestSetup?.sl;
    const t1 = finalMeta.bestSetup?.tp1;
    
    let valid = true;
    let failReason = "";

    if (!e || !sl || !t1) {
      valid = false; failReason = "Missing numeric fields";
    } else if (finalMeta.decision === "LONG" && (sl >= e || t1 <= e)) {
      valid = false; failReason = "LONG invalid geometry";
    } else if (finalMeta.decision === "SHORT" && (sl <= e || t1 >= e)) {
      valid = false; failReason = "SHORT invalid geometry";
    }
    
    if (!valid) {
      finalMeta.decision = "NO_TRADE";
      finalMeta.noTradeType = "MARKET";
      finalMeta.keyEvidence = [\`Risk validation failed: \${failReason}\`];
      finalMeta.bestSetup = { direction: "NO_TRADE", entry: null, sl: null, tp1: null, tp2: null, rr: null };
    } else {
      const riskVal = Math.abs(e - sl);
      const reward = Math.abs(t1 - e);
      if (riskVal > 0) finalMeta.bestSetup.rr = Number((reward / riskVal).toFixed(2));
    }
  }

  // 7. Final Judge
  const finalJudgeContext = \`
\${selfThinkingContext}
Self-Thinking Output: \${JSON.stringify(finalMeta)}
  \`;
  
  const finalJudgeSchema = \`{ "approved": true|false, "reason": "", "finalDecision": "LONG|SHORT|NO_TRADE" }\`;
  let finalJudgeOutput = await callModelXkiro("openai/gpt-5.3-codex-spark", [
    { role: "system", content: \`You are the Final Judge. Review the evidence and approve or reject the trade. Output schema: \${finalJudgeSchema}\` },
    { role: "user", content: finalJudgeContext }
  ], "FINAL_JUDGE");

  let finalJudgeStatus = "ONLINE";
  let finalJudgeSource = "XKIRO";

  if (finalJudgeOutput.error) {
    finalJudgeOutput = await callModel(APINEX_V2_SPECIALISTS.RISK_GUARD, [
      { role: "system", content: \`You are the Final Judge. Review the evidence and approve or reject the trade. Output schema: \${finalJudgeSchema}\` },
      { role: "user", content: finalJudgeContext }
    ], "FINAL_JUDGE");
    finalJudgeSource = "APINEX";
  }

  if (finalJudgeOutput.error) {
    finalJudgeStatus = "FALLBACK";
    finalJudgeSource = "DETERMINISTIC_FALLBACK";
    // Deterministic fallback: Just accept self-thinking if confidence > 50
    finalJudgeOutput = {
      approved: finalMeta.confidence > 50,
      reason: "Fallback triggered",
      finalDecision: finalMeta.confidence > 50 ? finalMeta.decision : "NO_TRADE"
    };
  }

  if (finalJudgeOutput.finalDecision !== finalMeta.decision) {
    finalMeta.decision = finalJudgeOutput.finalDecision;
    finalMeta.keyEvidence.push(\`Final judge overrode decision: \${finalJudgeOutput.reason}\`);
  }
  
  return {
    symbol,
    timeframe: targetTimeframe,
    currentPrice,
    indicators: targetData.indicators,
    models: modelResults,
    meta: finalMeta,
    finalJudge: {
      status: finalJudgeStatus,
      source: finalJudgeSource,
      output: finalJudgeOutput
    },
    debug,
  };
}
`;
fs.writeFileSync("src/server/services/orchestrator.ts", content);
