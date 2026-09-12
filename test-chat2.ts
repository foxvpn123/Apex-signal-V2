import "dotenv/config";
async function run() {
  console.log("AIHUBMIX_API_KEY:", !!process.env.AIHUBMIX_API_KEY);
  const url = "https://aihubmix.com/v1/chat/completions";
  const res = await fetch(url, {
      method: "POST",
      headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.AIHUBMIX_API_KEY}`
      },
      body: JSON.stringify({
          model: "gemini-3.8-flash-free",
          messages: [{role: "user", content: "hi"}]
      })
  });
  console.log(res.status);
  const data = await res.text();
  console.log(data);
}
run().catch(console.error);
