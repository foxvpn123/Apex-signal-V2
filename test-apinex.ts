import "dotenv/config";
import { callModel } from "./src/server/services/apinex.js";

async function run() {
  console.log("Testing callModel...");
  const res = await callModel("free/gemini-3.8-flash", [{ role: "user", content: "Hello" }]);
  console.log(res);
}
run().catch(console.error);
