import "dotenv/config";
import { fetchAvailableModels } from "./src/server/services/apinex.js";

async function run() {
  const models = await fetchAvailableModels();
  console.log("Models count:", models.size);
  console.log("Has gemini-3.8-flash-free?", models.has("gemini-3.8-flash-free"));
  
  if (!models.has("gemini-3.8-flash-free")) {
      console.log(Array.from(models).slice(0, 10));
  }
}
run().catch(console.error);
