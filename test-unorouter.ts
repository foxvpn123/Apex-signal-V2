import { config } from "dotenv";
config();

async function run() {
  console.log("Testing UNOROUTER backend connection...");
  const apiKey = process.env.UNOROUTER_API_KEY || "sk-cz7PyJwBz25iNF2xV5cFfKGuqfaOGV6RYB8hNzqwT4mBF0Hz";
  const baseUrl = "https://api.unorouter.com/v1";

  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: { "Authorization": `Bearer ${apiKey}` }
    });
    console.log("GET /models HTTP", res.status);
    if (res.ok) {
      const data = await res.json();
      console.log(`Successfully fetched ${data.data?.length || 0} models.`);
      const models = data.data.map((m: any) => m.id);
      
      const targets = [
        "glm-5.3-think-search:free",
        "nex-n2.5-mini:free",
        "nex-n2.5-pro:free",
        "amponyxl:free",
        "fustercluck:free"
      ];
      
      for (const t of targets) {
        console.log(`- ${t} available:`, models.includes(t));
      }
    } else {
      console.log("Error fetching models:", await res.text());
    }

    console.log("\nTesting chat completion with glm-5.3-think-search:free");
    const chatRes = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "glm-5.3-think-search:free",
        messages: [{ role: "user", content: "Reply exactly: OK" }],
        temperature: 0.2
      })
    });
    
    console.log("POST /chat/completions HTTP", chatRes.status);
    if (chatRes.ok) {
      const data = await chatRes.json();
      console.log("Response:", data.choices?.[0]?.message?.content);
    } else {
      console.log("Error:", await chatRes.text());
    }
  } catch (e: any) {
    console.error("Test failed:", e.message);
  }
}

run();
