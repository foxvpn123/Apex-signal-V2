import "dotenv/config";
import { fetchAvailableModels } from "./src/server/services/apinex.js";

async function run() {
  const models = await fetchAvailableModels();
  const freeModels = Array.from(models).filter(m => m.startsWith("free/"));
  
  let apiKey = process.env.AIHUBMIX_API_KEY;
  let baseUrl = process.env.AIHUBMIX_BASE_URL || "https://aihubmix.com/v1";

  if (apiKey?.startsWith("http") && baseUrl?.startsWith("sk-")) {
    const temp = apiKey;
    apiKey = baseUrl;
    baseUrl = temp;
  } else if (baseUrl?.startsWith("sk-")) {
    apiKey = baseUrl;
    baseUrl = "https://aihubmix.com/v1";
  } else if (apiKey?.startsWith("http") && !baseUrl) {
     baseUrl = apiKey;
     apiKey = undefined;
  }

  const prompt = `Output JSON: { "sentiment": "BULLISH", "severity": "LOW", "catalysts": ["Price is up", "Volume is high"], "risks": ["RSI is overbought"], "confidence": 85 }`;

  const promises = freeModels.map(async (model) => {
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
       return `${model} - ${Date.now() - start}ms - ${res.status}`;
     } catch(e: any) {
       return `${model} - ${Date.now() - start}ms - ERR: ${e.message}`;
     }
  });

  const results = await Promise.all(promises);
  console.log(results.join("\n"));
}
run();
