import "dotenv/config";
import { callModel } from "./src/server/services/apinex.js";

async function run() {
  console.log("Testing 5 parallel calls...");
  const models = [
    "free/gemini-3.1-pro",
    "free/muse-spark-1.3",
    "free/deepseek-v4-pro-0813",
    "free/gpt-5.6-luna",
    "free/qwen-3.8-max"
  ];
  
  const promises = models.map(m => callModel(m, [{ role: "system", content: "You are a JSON assistant. Output strictly JSON." }, { role: "user", content: "Say hello in JSON." }]));
  const results = await Promise.all(promises);
  console.log(results);
}

run().catch(console.error);
