import { 
  EMA, 
  RSI, 
  MACD, 
  ATR, 
  BollingerBands, 
  VWAP, 
  Stochastic, 
  ADX, 
  SMA 
} from "technicalindicators";
import { Kline } from "./binance.js";

export interface IndicatorsData {
  ema20: number | null;
  ema50: number | null;
  ema100: number | null;
  ema200: number | null;
  rsi: number | null;
  macd: any | null;
  atr: number | null;
  adx: number | null;
  bb: any | null;
  vwap: number | null;
  volumeSma: number | null;
  stochastic: any | null;
  trend: "BULLISH" | "BEARISH" | "NEUTRAL";
  volatility: "LOW" | "NORMAL" | "HIGH";
}

export function calculateIndicators(klines: Kline[]): IndicatorsData {
  const close = klines.map((k) => k.close);
  const high = klines.map((k) => k.high);
  const low = klines.map((k) => k.low);
  const volume = klines.map((k) => k.volume);
  const vwapInputs = klines.map(k => ({ close: k.close, high: k.high, low: k.low, volume: k.volume }));

  const getLast = (arr: any[]) => arr.length > 0 ? arr[arr.length - 1] : null;

  const ema20 = getLast(EMA.calculate({ period: 20, values: close }));
  const ema50 = getLast(EMA.calculate({ period: 50, values: close }));
  const ema100 = getLast(EMA.calculate({ period: 100, values: close }));
  const ema200 = getLast(EMA.calculate({ period: 200, values: close }));
  
  const rsi = getLast(RSI.calculate({ period: 14, values: close }));
  
  const macd = getLast(MACD.calculate({
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
    values: close
  }));

  const atr = getLast(ATR.calculate({ period: 14, high, low, close }));
  const adxResult = getLast(ADX.calculate({ period: 14, high, low, close }));
  const adx = adxResult?.adx || null;

  const bb = getLast(BollingerBands.calculate({ period: 20, stdDev: 2, values: close }));
  
  // technicalindicators vwap calculate takes an object array {high, low, close, volume}
  const vwap = getLast(VWAP.calculate({
    high, low, close, volume
  }));

  const volumeSma = getLast(SMA.calculate({ period: 20, values: volume }));

  const stochastic = getLast(Stochastic.calculate({
    high, low, close, period: 14, signalPeriod: 3
  }));

  const currentPrice = close[close.length - 1];

  let trend: "BULLISH" | "BEARISH" | "NEUTRAL" = "NEUTRAL";
  if (ema20 && ema50 && ema200) {
    if (currentPrice > ema20 && ema20 > ema50 && ema50 > ema200) trend = "BULLISH";
    else if (currentPrice < ema20 && ema20 < ema50 && ema50 < ema200) trend = "BEARISH";
  }

  let volatility: "LOW" | "NORMAL" | "HIGH" = "NORMAL";
  if (atr && bb) {
    const bbWidth = (bb.upper - bb.lower) / currentPrice;
    if (bbWidth > 0.1) volatility = "HIGH";
    else if (bbWidth < 0.02) volatility = "LOW";
  }

  return {
    ema20, ema50, ema100, ema200,
    rsi, macd, atr, adx, bb, vwap, volumeSma, stochastic,
    trend, volatility
  };
}
