import "dotenv/config";
import { fetchAvailableModelsOpenRouter, callModelOpenRouter } from "./src/server/services/openrouter.js";

async function run() {
  console.log("Fetching OpenRouter models...");
  const models = await fetchAvailableModelsOpenRouter();
  console.log("Total models:", models.size);
  
  if (models.size > 0) {
    const testModel = "nvidia/nemotron-3-ultra-550b-a55b:free";
    console.log(`\nTesting model ${testModel}...`);
    const res = await callModelOpenRouter(testModel, [
      { role: "user", content: "Reply exactly: TEST_OK" }
    ], "TEST");
    
    console.log("Result:", res);
  }
}
run().catch(console.error);
