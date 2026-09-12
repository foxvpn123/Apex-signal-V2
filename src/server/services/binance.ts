import { z } from "zod";

const BINANCE_BASE_URL = "https://api.binance.com/api/v3";

export interface Kline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

export async function getServerTime(): Promise<number> {
  const response = await fetch(`${BINANCE_BASE_URL}/time`);
  if (!response.ok) throw new Error("Failed to fetch server time");
  const data = await response.json();
  return data.serverTime;
}

export async function getMarkets() {
  const response = await fetch(`${BINANCE_BASE_URL}/exchangeInfo`);
  if (!response.ok) throw new Error("Failed to fetch markets from Binance");
  const data = await response.json();

  const isFutures = process.env.MARKET_TYPE === "futures";
  
  // 1. SUPPORTED QUOTE ASSETS & 7. DEFAULT QUOTE
  const defaultQuotesEnv = process.env.DEFAULT_QUOTES;
  const defaultQuote = process.env.DEFAULT_QUOTE;
  
  let supportedQuotes = ["USDT", "USD"];
  
  if (defaultQuotesEnv) {
    supportedQuotes = defaultQuotesEnv.split(",").map(s => s.trim());
  } else if (defaultQuote && !supportedQuotes.includes(defaultQuote)) {
    supportedQuotes.push(defaultQuote);
  }

  // Filter for active spot pairs
  const symbols = data.symbols
    .filter((s: any) => s.status === "TRADING" && supportedQuotes.includes(s.quoteAsset))
    .map((s: any) => {
      const priceFilter = s.filters.find((f: any) => f.filterType === "PRICE_FILTER");
      const lotSizeFilter = s.filters.find((f: any) => f.filterType === "LOT_SIZE");
      const minNotionalFilter = s.filters.find((f: any) => f.filterType === "NOTIONAL" || f.filterType === "MIN_NOTIONAL");

      return {
        symbol: s.symbol,
        baseAsset: s.baseAsset,
        quoteAsset: s.quoteAsset,
        status: s.status,
        tickSize: priceFilter ? parseFloat(priceFilter.tickSize) : 0,
        stepSize: lotSizeFilter ? parseFloat(lotSizeFilter.stepSize) : 0,
        minQty: lotSizeFilter ? parseFloat(lotSizeFilter.minQty) : 0,
        maxQty: lotSizeFilter ? parseFloat(lotSizeFilter.maxQty) : 0,
        minNotional: minNotionalFilter ? parseFloat(minNotionalFilter.minNotional) : 0,
        pricePrecision: s.baseAssetPrecision,
        quantityPrecision: s.quotePrecision
      };
    });

  return {
    quotes: supportedQuotes,
    markets: symbols
  };
}

// Global cache for symbol rules
let symbolRulesCache: Record<string, any> = {};

export async function getSymbolRules(symbol: string) {
  if (symbolRulesCache[symbol]) return symbolRulesCache[symbol];

  const response = await fetch(`${BINANCE_BASE_URL}/exchangeInfo?symbol=${symbol}`);
  if (!response.ok) throw new Error("Failed to fetch exchangeInfo for symbol");
  const data = await response.json();

  const s = data.symbols[0];
  const priceFilter = s.filters.find((f: any) => f.filterType === "PRICE_FILTER");
  const lotSizeFilter = s.filters.find((f: any) => f.filterType === "LOT_SIZE");
  const minNotionalFilter = s.filters.find((f: any) => f.filterType === "NOTIONAL" || f.filterType === "MIN_NOTIONAL");

  const rules = {
    symbol: s.symbol,
    status: s.status,
    tickSize: priceFilter ? parseFloat(priceFilter.tickSize) : 0,
    stepSize: lotSizeFilter ? parseFloat(lotSizeFilter.stepSize) : 0,
    minQty: lotSizeFilter ? parseFloat(lotSizeFilter.minQty) : 0,
    maxQty: lotSizeFilter ? parseFloat(lotSizeFilter.maxQty) : 0,
    minNotional: minNotionalFilter ? parseFloat(minNotionalFilter.minNotional) : 0,
    pricePrecision: s.baseAssetPrecision,
    quantityPrecision: s.quotePrecision
  };

  symbolRulesCache[symbol] = rules;
  return rules;
}

export async function validateAndNormalizePrices(symbol: string, prices: { entry?: number, sl?: number, tp?: number }) {
  const rules = await getSymbolRules(symbol);
  
  const norm = (price?: number) => {
    if (!price) return null;
    if (!rules.tickSize) return price;
    
    // Normalize to tick size
    const inv = 1.0 / rules.tickSize;
    return Math.round(price * inv) / inv;
  };

  return {
    entry: norm(prices.entry),
    sl: norm(prices.sl),
    tp: norm(prices.tp),
  };
}

export async function getBinanceAccountInfo() {
  const apiKey = process.env.BINANCE_API_KEY;
  const apiSecret = process.env.BINANCE_API_SECRET;
  
  if (!apiKey || !apiSecret) {
    return { enabled: false, error: "Binance credentials not configured" };
  }
  
  try {
    const crypto = await import('crypto');
    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}`;
    const signature = crypto
      .createHmac('sha256', apiSecret)
      .update(queryString)
      .digest('hex');

    const res = await fetch(`${BINANCE_BASE_URL}/account?${queryString}&signature=${signature}`, {
      headers: {
        'X-MBX-APIKEY': apiKey
      }
    });

    if (!res.ok) {
      throw new Error(`Binance account info failed: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    return {
      enabled: true,
      accountType: data.accountType,
      canTrade: data.canTrade,
      balances: data.balances.filter((b: any) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
    };
  } catch (e: any) {
    return { enabled: true, error: e.message };
  }
}


export async function getKlines(symbol: string, interval: string, limit: number = 300): Promise<Kline[]> {
  // We need to synthesize 10m and 20m from 5m.
  let fetchInterval = interval.toLowerCase();
  let multiplier = 1;
  
  if (fetchInterval === "10m") {
    fetchInterval = "5m";
    multiplier = 2;
  } else if (fetchInterval === "20m") {
    fetchInterval = "5m";
    multiplier = 4;
  }

  const fetchLimit = limit * multiplier;
  const url = `${BINANCE_BASE_URL}/klines?symbol=${symbol}&interval=${fetchInterval}&limit=${fetchLimit}`;
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Binance klines fetch failed for ${symbol} @ ${interval}`);
  }
  
  const rawData = await response.json();
  const baseKlines: Kline[] = rawData.map((d: any) => ({
    openTime: d[0],
    open: parseFloat(d[1]),
    high: parseFloat(d[2]),
    low: parseFloat(d[3]),
    close: parseFloat(d[4]),
    volume: parseFloat(d[5]),
    closeTime: d[6],
  }));

  if (multiplier === 1) return baseKlines;

  // Synthesize higher timeframes
  const synthesized: Kline[] = [];
  for (let i = 0; i <= baseKlines.length - multiplier; i += multiplier) {
    const chunk = baseKlines.slice(i, i + multiplier);
    const synthKline: Kline = {
      openTime: chunk[0].openTime,
      open: chunk[0].open,
      high: Math.max(...chunk.map((k) => k.high)),
      low: Math.min(...chunk.map((k) => k.low)),
      close: chunk[chunk.length - 1].close,
      volume: chunk.reduce((sum, k) => sum + k.volume, 0),
      closeTime: chunk[chunk.length - 1].closeTime,
    };
    synthesized.push(synthKline);
  }

  return synthesized.slice(-limit);
}
