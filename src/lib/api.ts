export async function fetchApinExStatus() {
  const res = await fetch("/api/v2/apinex/billing-status");
  if (!res.ok) throw new Error("Failed to load apinex status");
  return res.json();
}

export async function fetchMarkets() {
  const res = await fetch("/api/markets");
  if (!res.ok) throw new Error("Failed to load markets");
  return res.json();
}

export async function fetchWsStatus() {
  const res = await fetch("/api/binance/ws-status");
  if (!res.ok) throw new Error("Failed to load ws status");
  return res.json();
}

export async function fetchOpenRouterStatus() {
  const res = await fetch("/api/openrouter/status");
  if (!res.ok) throw new Error("Failed to load openrouter status");
  return res.json();
}

export async function runScan(symbol: string, timeframe: string) {
  const res = await fetch("/api/scan", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ symbol, timeframe }),
  });
  
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Scan failed");
  return data;
}
