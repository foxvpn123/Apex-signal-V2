import "dotenv/config";
import { fetchAvailableModels } from "./src/server/services/apinex.js";

async function run() {
  const models = await fetchAvailableModels();
  let apiKey = process.env.AIHUBMIX_API_KEY;
  let baseUrl = process.env.AIHUBMIX_BASE_URL || "https://aihubmix.com/v1";

  if (apiKey?.startsWith("http") && baseUrl?.startsWith("sk-")) {
    const temp = apiKey; apiKey = baseUrl; baseUrl = temp;
  }

  const prompt = `
Symbol: BTCUSDT
Timeframe: 15m
Current Price: 78919.41
Indicators: {"ema20":78549.22,"ema50":78595.20,"ema100":78809.24,"ema200":79253.46,"rsi":59.66,"macd":{"MACD":70.03,"signal":2.96,"histogram":67.06},"atr":240.11,"adx":20.56,"bb":{"middle":78441.49,"upper":78973.99,"lower":77908.99,"pb":0.94},"vwap":78987.65,"volumeSma":250.91,"stochastic":{"k":95.65,"d":84.63},"trend":"NEUTRAL","volatility":"LOW"}
Multi-Timeframe Alignment: {"10m":"NEUTRAL","15m":"NEUTRAL","20m":"NEUTRAL","1H":"NEUTRAL","4H":"NEUTRAL","1D":"BULLISH"}
Output strictly JSON.
  `;

  const freeModels = ["free/deepseek-v4-pro-0813", "free/gemini-3.1-pro", "free/muse-spark-1.3", "free/deepseek-v4-flash-0731", "free/glm-5.3-flash"];

  const results = [];
  for (const model of freeModels) {
     const start = Date.now();
     try {
       const controller = new AbortController();
       const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s max
       const res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify({
              model: model,
              messages: [{role: "user", content: prompt}],
              temperature: 0.2
          }),
          signal: controller.signal as any
       });
       clearTimeout(timeoutId);
       const text = await res.text();
       results.push(`${model} - ${Date.now() - start}ms - ${res.status}`);
     } catch(e: any) {
       results.push(`${model} - ${Date.now() - start}ms - ERR: ${e.message}`);
     }
  }

  console.log(results.join("\n"));
}
run();
