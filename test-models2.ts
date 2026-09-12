import { fetchAvailableModels } from "./src/server/services/apinex.js";

async function run() {
  console.log("BASE URL:", process.env.APINEX_BASE_URL);
  const models = await fetchAvailableModels();
  console.log("Models count:", models.size);
  console.log(Array.from(models));
}
run().catch(console.error);
