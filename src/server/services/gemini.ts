import { GoogleGenAI } from "@google/genai";

let aiClient: GoogleGenAI | null = null;

function getAiClient() {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is required");
    }
    aiClient = new GoogleGenAI({ apiKey: key });
  }
  return aiClient;
}

export async function callGeminiFinalJudge(input: any) {
  try {
    const ai = getAiClient();
    const startTime = Date.now();
    
    const prompt = `You are the Final Judge trading engine.
Review the provided market data, AI specialist outputs, TP/SL consensus, and deterministic checks.
You MUST output ONLY strictly valid JSON matching this schema:
{
  "decision": "LONG|SHORT|NO_TRADE",
  "approved": boolean,
  "confidence": number,
  "marketBias": "LONG|SHORT|NEUTRAL",
  "entry": number | null,
  "sl": number | null,
  "tp1": number | null,
  "tp2": number | null,
  "tp3": number | null,
  "rr": number | null,
  "reason": "string",
  "keyEvidence": ["string"],
  "contradictions": ["string"],
  "risks": ["string"],
  "invalidation": "string"
}

Validate numeric prices against the current market price (${input.currentPrice}). Do not invent impossible prices. If you approve a direction, you MUST use the validated consensus TP/SL setup provided in tpSlConsensus.`;

    const response = await ai.models.generateContent({
      model: process.env.FINAL_JUDGE_MODEL || "gemini-2.5-flash",
      contents: [
        { role: "user", parts: [{ text: `${prompt}\n\nINPUT DATA:\n${JSON.stringify(input, null, 2)}` }] }
      ],
      config: {
        responseMimeType: "application/json",
      }
    });
    
    const latencyMs = Date.now() - startTime;
    let resultObj = null;
    
    if (response.text) {
      try {
        resultObj = JSON.parse(response.text);
      } catch (e) {
        return { error: true, status: "MALFORMED_JSON", reason: "Gemini returned invalid JSON", provider: "GEMINI", model: process.env.FINAL_JUDGE_MODEL || "gemini-2.5-flash" };
      }
    } else {
      return { error: true, status: "ERROR", reason: "Empty response from Gemini", provider: "GEMINI", model: process.env.FINAL_JUDGE_MODEL || "gemini-2.5-flash" };
    }
    
    return { error: false, result: resultObj, latencyMs, provider: "GEMINI", model: process.env.FINAL_JUDGE_MODEL || "gemini-2.5-flash", status: "SUCCESS" };
  } catch (e: any) {
    if (e.message?.includes("GEMINI_API_KEY")) {
       return { error: true, status: "BILLING_REQUIRED", reason: e.message, provider: "GEMINI", model: process.env.FINAL_JUDGE_MODEL || "gemini-2.5-flash" };
    }
    return { error: true, status: "ERROR", reason: e.message, provider: "GEMINI", model: process.env.FINAL_JUDGE_MODEL || "gemini-2.5-flash" };
  }
}

export function getFinalJudgeStatus() {
  try {
    getAiClient();
    return {
      provider: "GEMINI",
      model: process.env.FINAL_JUDGE_MODEL || "gemini-2.5-flash",
      configured: true,
      available: true,
      error: null
    };
  } catch (e: any) {
    return {
      provider: "GEMINI",
      model: process.env.FINAL_JUDGE_MODEL || "gemini-2.5-flash",
      configured: false,
      available: false,
      error: e.message
    };
  }
}
