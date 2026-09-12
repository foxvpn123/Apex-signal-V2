import { callModel } from "./src/server/services/apinex.js";
import { config } from "dotenv";
config();

async function run() {
  const res = await callModel("free/gpt-5.6-luna", [{role: "user", content: "hello"}]);
  console.log(res);
}
run();
