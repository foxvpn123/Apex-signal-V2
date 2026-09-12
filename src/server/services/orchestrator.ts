import { getKlines, getServerTime, validateAndNormalizePrices } from "./binance.js";
import { calculateIndicators } from "./indicators.js";
import { callModel, checkBillingStatus } from "./apinex.js";
import { callModelXkiro, fetchAvailableModelsXkiro } from "./xkiro.js";
import { callModel as callModelUno, fetchAvailableModels as fetchAvailableModelsUno } from "./unorouter.js";
import { callModelOpenRouter } from "./openrouter.js";
import { liveDataHub } from "./binance/ws/LiveDataHub.js";
import { calculateTpSlConsensus } from "./tpSlConsensus.js";
import { calculateDeterministicTpSl } from "./deterministicTpSl.js";

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

export const UNOROUTER_MODELS = [
  "glm-5.3-think-search:free",
  "nex-n2.5-mini:free",
  "nex-n2.5-pro:free",
  "amponyxl:free",
  "fustercluck:free"
];

export const OPENROUTER_MODELS = {
  DEEP_REASONING: "nvidia/nemotron-3-ultra-550b-a55b:free",
  FAST_TECHNICAL: "nvidia/nemotron-3.5-lightning:free",
  STRUCTURE: "nvidia/nemotron-3-super-120b-a12b:free",
  FINANCIAL_ANALYSIS: "inclusionai/ling-3.0-flash-fin:free",
  INDEPENDENT_REASONING: "thinkingmachines/inkling:free",
  ADVERSARIAL: "poolside/laguna-s-2.1:free",
  GENERAL_CONFIRMATION: "google/gemma-4-31b-it:free",
  LIGHTWEIGHT_SECOND_OPINION: "liquid/lfm-2.5-2.6b:free"
};

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
  
  console.log(`[DATA] ${normalizedSymbol} selected`);
  
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
        console.warn(`Failed to fetch TF ${tf} for ${normalizedSymbol}: ${e.message}`);
      }
    })
  );

  const targetData = multiTimeframeData[targetTimeframe];
  if (!targetData || !targetData.klines || targetData.klines.length === 0) {
    throw new Error(`Insufficient data for target timeframe ${targetTimeframe}`);
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

const specialistSchema = `{ "decision": "LONG|SHORT|NO_TRADE", "confidence": 0, "entry": null, "sl": null, "tp1": null, "tp2": null, "tp3": null, "rr": null, "setupValid": false, "reason": "", "invalidation": "" }`;

function getSpecialistPrompt(role: string, context: string) {
  let instructions = "";
  if (role === "TECHNICAL") instructions = "Evaluate price action, trend, EMA/SMA, RSI, MACD, VWAP, support/resistance, market structure. Can propose Entry/SL/TP.";
  else if (role === "SENTIMENT") instructions = "Analyze market sentiment, bullish/bearish pressure, crowd positioning, and sentiment contradictions. Primarily direction/context.";
  else if (role === "RISK_GUARD") instructions = "Check entry quality, stop placement, volatility, spread, R:R, downside risk, and invalidation. Validate SL/TP/RR rather than acting as a directional vote.";
  else if (role === "FORECAST") instructions = "Estimate scenarios: bullish continuation, bearish continuation, reversal, range. Can propose directional targets. Do not claim certainty.";
  else if (role === "SCENARIO") instructions = "Construct alternative scenarios and challenge the leading direction. Can propose target scenarios.";
  
  return [
    { role: "system", content: `You are a ${role} model. Output strictly JSON adhering to schema: ${specialistSchema}. ${instructions}\nWhen you determine a valid LONG or SHORT setup, require concrete Entry, SL, TP1, TP2, TP3, and RR based on current price, swing highs/lows, S/R, ATR, VWAP, EMA, PDH/PDL, liquidity, market structure. If you cannot determine a valid setup, set setupValid=false and explain why in reason.` },
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

  const baseContext = `
Symbol: ${symbol}
Timeframe: ${targetTimeframe}
Current Price: ${currentPrice}
Indicators: ${JSON.stringify(targetData.indicators)}
MTF Alignment: ${JSON.stringify(mtfSummary)}
Market Thinking: ${JSON.stringify(marketThinking)}
Strategies: ${JSON.stringify(strategies)}
  `;

  console.log(`[SCAN] Snapshot frozen. Initiating models.`);

  const billingStatus = await checkBillingStatus();
  const isBillingBlocked = !billingStatus.reachable || billingStatus.billingStatus === "BILLING_REQUIRED";

  const apinexTasks = [];
  const xkiroTasks = [];
  const unorouterTasks = [];
  const openrouterTasks = [];
  
  const roles = ["TECHNICAL", "SENTIMENT", "RISK_GUARD", "FORECAST", "SCENARIO"];

  if (isBillingBlocked) {
    console.log(`[AI] APINEX Billing access restricted. Skipping APINEX models.`);
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

  // Add UNOROUTER fleet (distributed roles)
  for (let i = 0; i < UNOROUTER_MODELS.length; i++) {
    const model = UNOROUTER_MODELS[i];
    const r = roles[i % roles.length];
    unorouterTasks.push(
      callModelUno(model, getSpecialistPrompt(r, baseContext), r).then(res => ({ provider: "UNOROUTER", role: r, model, res }))
    );
  }

  // Add OPENROUTER fleet
  for (const [r, model] of Object.entries(OPENROUTER_MODELS)) {
    openrouterTasks.push(
      callModelOpenRouter(model, getSpecialistPrompt(r, baseContext), r).then(res => ({ provider: "OPENROUTER", role: r, model, res }))
    );
  }

  // Wait for all models
  const allRawResults = await Promise.allSettled([...apinexTasks, ...xkiroTasks, ...unorouterTasks, ...openrouterTasks]);
  
  const modelResults: any = { APINEX: {}, XKIRO: {}, UNOROUTER: {}, OPENROUTER: {} };
  let validCount = 0;
  let totalAttempted = 0;

  let longScore = 0;
  let shortScore = 0;
  let neutralScore = 0;
  
  const validEvidence: any[] = [];
  const failedProviders: any[] = [];

  for (const settled of allRawResults) {
    totalAttempted++;
    if (settled.status === "fulfilled") {
      const { provider, role, model, res } = settled.value;
      if (!modelResults[provider][role]) modelResults[provider][role] = [];
      modelResults[provider][role].push({ model, res });
      
      if (res && !res.error && res.decision && !["ERROR", "TIMEOUT", "MODEL_NOT_FOUND", "BILLING_REQUIRED", "INVALID_RESPONSE"].includes(res.decision)) {
        validCount++;
        validEvidence.push({ 
          provider, role, model, 
          decision: res.decision, 
          confidence: res.confidence, 
          setupValid: res.setupValid, 
          entry: res.entry, 
          sl: res.sl, 
          tp1: res.tp1, 
          tp2: res.tp2, 
          tp3: res.tp3, 
          rr: res.rr, 
          reason: res.reason, 
          invalidation: res.invalidation 
        });
        
        const weight = (res.confidence || 50) * (res.setupValid ? 1 : 0.5);
        if (res.decision === "LONG") longScore += weight;
        else if (res.decision === "SHORT") shortScore += weight;
        else neutralScore += weight;
      } else {
        failedProviders.push({ provider, role, model, reason: res?.decision || res?.error || "INVALID_RESPONSE" });
      }
    } else {
       failedProviders.push({ reason: "PROMISE_REJECTED" });
    }
  }

  let dominantBias = "NEUTRAL";
  if (longScore > shortScore * 1.5 && longScore > neutralScore) dominantBias = "LONG";
  else if (shortScore > longScore * 1.5 && shortScore > neutralScore) dominantBias = "SHORT";

  // Do not exit early when model evidence is weak. The Final Judge is still
  // called exactly once so the UI can distinguish SYSTEM NO_TRADE from a
  // missing/unavailable Final Judge.
  if (validCount < 2) {
    console.warn(`[SCAN] Only ${validCount} valid model result(s); continuing to Self-Thinking and Final Judge.`);
  }

  // 5. Self-Thinking Engine
  const selfThinkingContext = `
${baseContext}

VALID AI EVIDENCE:
${JSON.stringify(validEvidence)}

FAILED PROVIDERS (Ignore these, they are NOT NO_TRADE votes):
${JSON.stringify(failedProviders)}

DETERMINISTIC CONSENSUS:
Long Score: ${longScore.toFixed(2)}
Short Score: ${shortScore.toFixed(2)}
Neutral Score: ${neutralScore.toFixed(2)}
Calculated Dominant Bias: ${dominantBias}

CRITICAL RULES:
1. SEPARATE BIAS FROM TRADEABILITY. A bearish/downtrending market MUST NOT automatically produce NO_TRADE.
2. If Dominant Bias is SHORT, you MUST create a SHORT candidate before deciding NO_TRADE.
3. Validate candidate Tradeability (Current price vs VWAP, LATE_SHORT_ENTRY, POOR_RR, PRICE_NEAR_SUPPORT, MTF_CONFLICT).
4. If entry location is poor, set Tradeability=INVALID and decision=NO_TRADE, with noTradeReason (e.g. LATE_SHORT_ENTRY).
`;

  const metaSchema = `{ "dominantBias": "LONG|SHORT|NEUTRAL", "candidateDirection": "LONG|SHORT|NONE", "tradeability": "VALID|INVALID", "marketRegime": "", "keyEvidence": [], "contradictions": [], "riskAssessment": "", "bestSetup": { "direction": "LONG|SHORT|NO_TRADE", "entry": null, "sl": null, "tp1": null, "tp2": null, "tp3": null, "rr": null }, "confidence": 0, "invalidation": "", "decision": "LONG|SHORT|NO_TRADE", "noTradeReason": "" }`;

  const metaPrompt = [
    { role: "system", content: `You are the Self-Thinking Engine. Reconstruct the market story. Separate bias from tradeability. Output strict JSON schema: ${metaSchema}.` },
    { role: "user", content: selfThinkingContext }
  ] as any;

  // Pick a capable model for Self-Thinking
  let selfThinkingOutput = await callModelXkiro("openai/gpt-5.3-codex-spark", metaPrompt, "SELF_THINKING");
  
  if (selfThinkingOutput.error) {
    // Fallback to apinex
    selfThinkingOutput = await callModel(APINEX_V2_SPECIALISTS.TECHNICAL, metaPrompt, "SELF_THINKING");
  }

  if (!selfThinkingOutput || selfThinkingOutput.error) {
    const candidateDirection = dominantBias === "LONG" || dominantBias === "SHORT"
      ? dominantBias
      : "NO_TRADE";

    const atr = Number(targetData.indicators?.atr || 0);
    const fallbackRisk = atr > 0 ? atr : Math.max(currentPrice * 0.005, 0.00000001);
    const entry = currentPrice;
    const sl = candidateDirection === "LONG" ? entry - fallbackRisk : candidateDirection === "SHORT" ? entry + fallbackRisk : null;
    const tp1 = candidateDirection === "LONG" ? entry + fallbackRisk * 2 : candidateDirection === "SHORT" ? entry - fallbackRisk * 2 : null;

    selfThinkingOutput = {
      decision: candidateDirection,
      approved: false,
      confidence: Math.round(Math.min(100, Math.max(0, validCount > 0 ? (Math.max(longScore, shortScore) / Math.max(1, longScore + shortScore + neutralScore)) * 100 : 0))),
      dominantBias,
      candidateDirection,
      tradeability: candidateDirection === "NO_TRADE" ? "INVALID" : "VALID",
      marketRegime: marketThinking.regime,
      keyEvidence: validEvidence.slice(0, 8).map(v => `${v.provider}/${v.model}: ${v.decision}`),
      contradictions: [],
      riskAssessment: "SELF_THINKING_MODEL_UNAVAILABLE; deterministic fallback used.",
      invalidation: candidateDirection === "LONG" ? `Below ${sl}` : candidateDirection === "SHORT" ? `Above ${sl}` : "Insufficient evidence",
      bestSetup: {
        direction: candidateDirection,
        entry,
        sl,
        tp1,
        tp2: null,
        tp3: null,
        rr: candidateDirection === "NO_TRADE" ? null : 2
      },
      noTradeReason: candidateDirection === "NO_TRADE" ? "INSUFFICIENT_DIRECTIONAL_EVIDENCE" : "",
      systemFallback: true
    };
  }

  // 6. Risk Validation & Binance Normalization
  let finalMeta = { ...selfThinkingOutput };
  
  if (finalMeta.decision === "LONG" || finalMeta.decision === "SHORT") {
    let e = finalMeta.bestSetup?.entry;
    let sl = finalMeta.bestSetup?.sl;
    let t1 = finalMeta.bestSetup?.tp1;
    
    // Binance Normalization
    try {
       const normalized = await validateAndNormalizePrices(symbol, { entry: e, sl: sl, tp: t1 });
       if (normalized.entry) e = normalized.entry;
       if (normalized.sl) sl = normalized.sl;
       if (normalized.tp) t1 = normalized.tp;
       finalMeta.bestSetup.entry = e;
       finalMeta.bestSetup.sl = sl;
       finalMeta.bestSetup.tp1 = t1;
    } catch (normErr: any) {
       console.warn(`[BINANCE] Normalization failed for ${symbol}: ${normErr.message}`);
    }

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
      finalMeta.tradeability = "INVALID";
      (finalMeta as any).noTradeType = "MARKET";
      finalMeta.noTradeReason = `Risk validation failed: ${failReason}`;
      finalMeta.keyEvidence.push(finalMeta.noTradeReason);
      finalMeta.bestSetup = { direction: "NO_TRADE", entry: null, sl: null, tp1: null, tp2: null, rr: null };
    } else {
      const riskVal = Math.abs(e - sl);
      const reward = Math.abs(t1 - e);
      if (riskVal > 0) finalMeta.bestSetup.rr = Number((reward / riskVal).toFixed(2));
    }
  } else if (finalMeta.decision === "NO_TRADE") {
      (finalMeta as any).noTradeType = "MARKET";
      if (!finalMeta.noTradeReason) finalMeta.noTradeReason = "UNDEFINED_REASON";
  }

  // Compute TP/SL Consensus
  let deterministicCandidates: any[] = [];
  
  const targetDirection = finalMeta.dominantBias === "LONG" || finalMeta.dominantBias === "SHORT" 
    ? finalMeta.dominantBias 
    : "NONE";

  if (targetDirection !== "NONE") {
    const fallbackCandidate = calculateDeterministicTpSl(targetDirection as "LONG" | "SHORT", currentPrice, targetData, strategies);
    deterministicCandidates.push(fallbackCandidate);
  }

  if (finalMeta.bestSetup && (finalMeta.bestSetup.direction === "LONG" || finalMeta.bestSetup.direction === "SHORT")) {
     deterministicCandidates.push({
       direction: finalMeta.bestSetup.direction,
       entry: finalMeta.bestSetup.entry,
       sl: finalMeta.bestSetup.sl,
       tp1: finalMeta.bestSetup.tp1,
       tp2: finalMeta.bestSetup.tp2,
       tp3: finalMeta.bestSetup.tp3,
       rr: finalMeta.bestSetup.rr
     });
  }

  const tpSlConsensusOutput = calculateTpSlConsensus(
    currentPrice,
    validEvidence,
    deterministicCandidates,
    Number(process.env.MIN_RR || "1.5")
  );

  const numAiProposals = tpSlConsensusOutput.sourceCount - deterministicCandidates.length;
  console.log(`[TP_SL] AI_PROPOSALS_RECEIVED=${validEvidence.length}`);
  console.log(`[TP_SL] AI_VALID_PROPOSALS=${numAiProposals}`);
  if (numAiProposals === 0 && tpSlConsensusOutput.entry) {
    console.log(`[TP_SL] USING_DETERMINISTIC_FALLBACK=true`);
  }
  console.log(`[TP_SL] DETERMINISTIC_FALLBACK=${deterministicCandidates.length > 0}`);
  if (tpSlConsensusOutput.entry) {
    console.log(`[TP_SL] CONSENSUS_ENTRY=${tpSlConsensusOutput.entry}`);
    console.log(`[TP_SL] CONSENSUS_SL=${tpSlConsensusOutput.sl}`);
    console.log(`[TP_SL] CONSENSUS_TP1=${tpSlConsensusOutput.tp1}`);
    console.log(`[TP_SL] CONSENSUS_TP2=${tpSlConsensusOutput.tp2}`);
    console.log(`[TP_SL] CONSENSUS_TP3=${tpSlConsensusOutput.tp3}`);
    console.log(`[TP_SL] CONSENSUS_RR=${tpSlConsensusOutput.rr}`);
  }
  console.log(`[TP_SL] FINAL_VALIDATION=${tpSlConsensusOutput.entry ? "PASS" : "FAIL"}`);

  // 7. Final Judge
  const finalJudgeContext = {
    analysisId: Date.now().toString(),
    symbol,
    marketType: "FUTURES",
    timeframe: targetTimeframe,
    currentPrice,
    latestClosedCandle: targetData.klines[targetData.klines.length - 1],
    marketSnapshot: marketThinking,
    indicators: targetData.indicators,
    marketStructure: strategies,
    supportResistance: { pdh: strategies.pdh, pdl: strategies.pdl },
    liquidity: strategies.pdhPdlSweep,
    marketRegime: marketThinking.regime,
    MTF: mtfSummary,
    validEvidence,
    tpSlConsensus: tpSlConsensusOutput,
    failedProviders: failedProviders.length > 0 ? failedProviders.map(p => ({ provider: p.provider, model: p.model, role: p.role, reason: p.reason })) : [],
    scores: { longScore, shortScore, neutralScore, dominantBias },
    selfThinkingResult: finalMeta
  };

  let finalJudgeStatus = "QUEUED";
  let finalJudgeSource = "GEMINI";
  let finalJudgeOutput: any = { error: true, status: "NOT_RUN" };
  
  const { callGeminiFinalJudge } = await import("./gemini.js");
  
  finalJudgeStatus = "RUNNING";
  console.log(`[FINAL_JUDGE] START symbol=${symbol} model=gemini-2.5-flash`);
  const geminiResponse = await callGeminiFinalJudge(finalJudgeContext);
  
  if (!geminiResponse.error && geminiResponse.result) {
    finalJudgeStatus = "ONLINE";
    finalJudgeOutput = geminiResponse.result;
    console.log(`[FINAL_JUDGE] SUCCESS symbol=${symbol} latencyMs=${geminiResponse.latencyMs ?? -1} decision=${finalJudgeOutput.decision}`);
    
    // Normalize prices if approved and entry exists
    if ((finalJudgeOutput.decision === "LONG" || finalJudgeOutput.decision === "SHORT") && finalJudgeOutput.approved) {
      if (finalJudgeOutput.entry && finalJudgeOutput.sl && finalJudgeOutput.tp1) {
        let e = finalJudgeOutput.entry;
        let sl = finalJudgeOutput.sl;
        let t1 = finalJudgeOutput.tp1;
        
        try {
           const normalized = await validateAndNormalizePrices(symbol, { entry: e, sl: sl, tp: t1 });
           if (normalized.entry) e = normalized.entry;
           if (normalized.sl) sl = normalized.sl;
           if (normalized.tp) t1 = normalized.tp;
           finalJudgeOutput.entry = e;
           finalJudgeOutput.sl = sl;
           finalJudgeOutput.tp1 = t1;
        } catch (normErr: any) {
           console.warn(`[BINANCE] Final Judge Normalization failed for ${symbol}: ${normErr.message}`);
        }
        
        // Re-validate geometry after normalization
        let valid = true;
        if (finalJudgeOutput.decision === "LONG" && (sl >= e || t1 <= e)) valid = false;
        if (finalJudgeOutput.decision === "SHORT" && (sl <= e || t1 >= e)) valid = false;
        
        if (!valid) {
          finalJudgeOutput.decision = "NO_TRADE";
          finalJudgeOutput.approved = false;
          finalJudgeOutput.reason = "Invalid price geometry after normalization";
        }
      } else {
        finalJudgeOutput.decision = "NO_TRADE";
        finalJudgeOutput.approved = false;
        finalJudgeOutput.reason = "Missing entry/sl/tp";
      }
    }
  } else {
    finalJudgeStatus = geminiResponse.status || "ERROR";
    finalJudgeOutput.reason = geminiResponse.reason || "Gemini evaluation failed";
    finalJudgeOutput.httpStatus = 500;
  }

  // Final Judge fallback:
  if (finalJudgeOutput.error || finalJudgeStatus === "ERROR") {
    finalJudgeStatus = "FALLBACK_DETERMINISTIC";
    finalJudgeSource = "DETERMINISTIC_FALLBACK";
    
    // Use TP/SL consensus if available
    const direction = finalMeta.dominantBias === "LONG" || finalMeta.dominantBias === "SHORT"
      ? finalMeta.dominantBias
      : "NO_TRADE";
      
    let setup = direction === finalMeta.decision ? finalMeta.bestSetup : null;
    if (tpSlConsensusOutput && tpSlConsensusOutput.direction === direction && tpSlConsensusOutput.entry) {
        setup = {
            entry: tpSlConsensusOutput.entry,
            sl: tpSlConsensusOutput.sl,
            tp1: tpSlConsensusOutput.tp1,
            tp2: tpSlConsensusOutput.tp2,
            tp3: tpSlConsensusOutput.tp3,
            rr: tpSlConsensusOutput.rr
        };
    }
    
    const confidence = Number(finalMeta.confidence || 0);
    finalJudgeOutput = {
      decision: direction,
      approved: direction !== "NO_TRADE" && confidence >= 55 && !!setup?.entry && !!setup?.sl && !!setup?.tp1,
      confidence,
      marketBias: finalMeta.dominantBias,
      entry: setup?.entry ?? null,
      sl: setup?.sl ?? null,
      tp1: setup?.tp1 ?? null,
      tp2: setup?.tp2 ?? null,
      tp3: setup?.tp3 ?? null,
      rr: setup?.rr ?? null,
      reason: `Gemini unavailable (${geminiResponse.status || "ERROR"}); deterministic consensus fallback used.`,
      keyEvidence: finalMeta.keyEvidence || [],
      contradictions: finalMeta.contradictions || [],
      risks: ["Gemini Final Judge Unavailable"],
      invalidation: finalMeta.invalidation || "",
      _fallbackFrom: "GEMINI"
    };
  }

  // Apply final decision
  let tradeability = finalMeta.tradeability;
  if (finalJudgeOutput.decision === "LONG" || finalJudgeOutput.decision === "SHORT") {
    if (finalJudgeOutput.approved) {
      tradeability = "VALID";
    } else {
      tradeability = "INVALID";
    }
  } else {
    tradeability = "INVALID";
  }
  
  return {
    symbol,
    timeframe: targetTimeframe,
    currentPrice,
    decision: finalJudgeOutput.decision,
    marketBias: finalJudgeOutput.marketBias || finalMeta.dominantBias,
    candidateDirection: finalMeta.dominantBias === "LONG" || finalMeta.dominantBias === "SHORT" ? finalMeta.dominantBias : "NONE",
    entry: finalJudgeOutput.entry ?? null,
    sl: finalJudgeOutput.sl ?? null,
    tp1: finalJudgeOutput.tp1 ?? null,
    tp2: finalJudgeOutput.tp2 ?? null,
    tp3: finalJudgeOutput.tp3 ?? null,
    rr: finalJudgeOutput.rr ?? null,
    confidence: finalJudgeOutput.confidence || 0,
    tpSlConsensus: {
      strength: tpSlConsensusOutput.consensusStrength || 0,
      supportingModels: tpSlConsensusOutput.supportingModels || 0,
      sourceCount: tpSlConsensusOutput.sourceCount || 0,
      validProposals: tpSlConsensusOutput.validProposals || []
    },
    finalJudge: {
      provider: "GEMINI",
      model: "gemini-2.5-flash",
      source: finalJudgeSource,
      status: finalJudgeOutput.error ? "ERROR" : "SUCCESS",
    },
    tradeability,
    reason: finalJudgeOutput.reason || "",
    risks: finalJudgeOutput.risks || [],
    invalidation: finalJudgeOutput.invalidation || "",
    indicators: targetData.indicators,
    models: modelResults,
    debug,
  };
}
