import "dotenv/config";
async function run() {
  const url = "https://aihubmix.com/v1/chat/completions";
  const apiKey = "sk-apx64a6b19902db099eeb243e1a98c44f0be57cee34763ff5b";
  const start = Date.now();
  console.log("sending request...");
  try {
    const res = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: "free/gemini-3.8-flash",
            messages: [{role: "user", content: "{\"test\": 123}"}],
            response_format: { type: "json_object" }
        })
    });
    console.log(res.status);
    const data = await res.text();
    console.log(data);
  } catch (err) {
    console.error(err);
  }
  console.log("Took ms:", Date.now() - start);
}
run().catch(console.error);
