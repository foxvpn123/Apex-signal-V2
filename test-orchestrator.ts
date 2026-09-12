import "dotenv/config";
import { runScan } from "./src/server/services/orchestrator.js";

async function run() {
  console.log("Testing full scan pipeline...");
  const start = Date.now();
  try {
    const res = await runScan("BTCUSDT", "15m");
    console.log(JSON.stringify(res, null, 2));
  } catch (err) {
    console.error("Scan error:", err);
  }
  console.log("Took ms:", Date.now() - start);
}
run().catch(console.error);
