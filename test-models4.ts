import { fetchAvailableModels } from "./src/server/services/apinex.js";
import "dotenv/config";
async function run() {
  const models = await fetchAvailableModels();
  console.log("Free models:");
  for (const m of models) {
    if (m.toLowerCase().includes("free")) console.log(m);
  }
}
run().catch(console.error);
