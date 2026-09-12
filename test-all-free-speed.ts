import "dotenv/config";
import { fetchAvailableModels } from "./src/server/services/apinex.js";

async function run() {
  const models = await fetchAvailableModels();
  const freeModels = Array.from(models).filter(m => m.toLowerCase().includes("free"));
  console.log(`Testing ${freeModels.length} free models...`);
  
  let apiKey = process.env.AIHUBMIX_API_KEY;
  let baseUrl = process.env.AIHUBMIX_BASE_URL || "https://aihubmix.com/v1";
  if (apiKey?.startsWith("http") && baseUrl?.startsWith("sk-")) {
    const temp = apiKey; apiKey = baseUrl; baseUrl = temp;
  }

  const results = [];

  for (const model of freeModels) {
     const start = Date.now();
     try {
       const controller = new AbortController();
       const timeoutId = setTimeout(() => controller.abort(), 20000);
       const res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify({
              model: model,
              messages: [{role: "user", content: "{\"test\": 123}"}]
          }),
          signal: controller.signal as any
       });
       clearTimeout(timeoutId);
       results.push(`- ${model} Took ${Date.now() - start}ms - Status ${res.status}`);
     } catch(e: any) {
       results.push(`- ${model} Failed ${Date.now() - start}ms ${e.name || e.message}`);
     }
  }

  console.log("\n--- RESULTS ---");
  console.log(results.join("\n"));
}
run().catch(console.error);
