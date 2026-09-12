import "dotenv/config";
import { callModel } from "./src/server/services/apinex.js";

async function run() {
  const models = [
    "free/deepseek-v4-flash-0731",
    "free/gemini-3.1-pro",
    "free/muse-spark-1.3",
    "free/qwen-3.8-max"
  ];
  for (const model of models) {
     console.log(`Testing ${model}...`);
     const start = Date.now();
     try {
       const res = await callModel(model, [{ role: "user", content: "Say hello" }]);
       console.log(`- Took ${Date.now() - start}ms`, res);
     } catch(e) {
       console.log(`- Failed ${Date.now() - start}ms`, e);
     }
  }
}
run().catch(console.error);
