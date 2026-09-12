import "dotenv/config";

async function run() {
  const url = "https://api.apinex.bond/v1/chat/completions";
  const apiKey = "sk-apx64a6b19902db099eeb243e1a98c44f0be57cee34763ff5b";
  
  const models = ["free/deepseek-v4-flash-0731"];
  
  for (const model of models) {
    console.log(`Testing ${model} WITHOUT response_format...`);
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);
      const res = await fetch(url, {
          method: "POST",
          headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify({
              model: model,
              messages: [{role: "user", content: "{\"test\": 123}"}]
          }),
          signal: controller.signal as any
      });
      clearTimeout(timeoutId);
      console.log(res.status);
      const data = await res.text();
      console.log(`- Took ${Date.now() - start}ms`, data);
    } catch (err: any) {
      console.log(`- Failed ${Date.now() - start}ms`, err.message);
    }
  }
}
run().catch(console.error);
