export function calculateDeterministicTpSl(
  direction: "LONG" | "SHORT",
  currentPrice: number,
  marketData: any,
  marketStructure: any
) {
  const atr = Number(marketData.indicators?.atr || 0);
  const fallbackRisk = atr > 0 ? atr : Math.max(currentPrice * 0.005, 0.00000001);
  const vwap = Number(marketData.indicators?.vwap || currentPrice);
  
  let entry = currentPrice;
  let sl = null;
  let tp1 = null;
  let tp2 = null;
  let tp3 = null;

  if (direction === "LONG") {
    const structLow = marketStructure?.pdl && marketStructure.pdl < currentPrice ? marketStructure.pdl : currentPrice - fallbackRisk * 1.5;
    sl = Math.min(currentPrice - fallbackRisk, structLow);
    
    tp1 = currentPrice + (currentPrice - sl) * 1.5;
    tp2 = currentPrice + (currentPrice - sl) * 2.5;
    tp3 = currentPrice + (currentPrice - sl) * 4.0;
  } else if (direction === "SHORT") {
    const structHigh = marketStructure?.pdh && marketStructure.pdh > currentPrice ? marketStructure.pdh : currentPrice + fallbackRisk * 1.5;
    sl = Math.max(currentPrice + fallbackRisk, structHigh);
    
    tp1 = currentPrice - (sl - currentPrice) * 1.5;
    tp2 = currentPrice - (sl - currentPrice) * 2.5;
    tp3 = currentPrice - (sl - currentPrice) * 4.0;
  }

  return {
    direction,
    entry,
    sl,
    tp1,
    tp2,
    tp3,
    rr: 1.5
  };
}
