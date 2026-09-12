import { fetchAvailableModels } from "./src/server/services/apinex.js";

async function run() {
  const url = "https://aihubmix.com/v1/models";
  const res = await fetch(url);
  const data = await res.json();
  console.log(data.data.length);
}
run().catch(console.error);
