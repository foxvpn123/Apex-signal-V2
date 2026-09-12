import React, { useEffect, useState } from "react";
import clsx from "clsx";

const TOP_ASSETS = ["btcusdt", "ethusdt", "solusdt", "bnbusdt", "xrpusdt"];

export default function ScrollingTicker() {
  const [prices, setPrices] = useState<Record<string, { price: number; change: number }>>({});

  useEffect(() => {
    const streams = TOP_ASSETS.map((asset) => `${asset}@ticker`).join("/");
    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${streams}`);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data && data.s && data.c && data.p) {
          setPrices((prev) => ({
            ...prev,
            [data.s]: {
              price: parseFloat(data.c),
              change: parseFloat(data.P), // Percentage change
            },
          }));
        }
      } catch (e) {
        console.error("Ticker parsing error", e);
      }
    };

    return () => {
      ws.close();
    };
  }, []);

  return (
    <div className="bg-neutral-900 border-b border-neutral-800 overflow-hidden py-2 whitespace-nowrap flex text-sm">
      <div className="animate-ticker inline-block">
        {TOP_ASSETS.map((asset) => {
          const symbol = asset.toUpperCase();
          const data = prices[symbol];
          if (!data) return <span key={symbol} className="mx-6 text-neutral-500 font-medium">{symbol} Loading...</span>;

          const isUp = data.change >= 0;
          return (
            <span key={symbol} className="mx-6 font-medium">
              <span className="text-neutral-400 mr-2">{symbol}</span>
              <span className="text-white mr-2">{data.price.toFixed(symbol === "XRPUSDT" ? 4 : 2)}</span>
              <span className={clsx(isUp ? "text-emerald-500" : "text-red-500")}>
                {isUp ? "+" : ""}{data.change.toFixed(2)}%
              </span>
            </span>
          );
        })}
      </div>
      {/* Duplicate for seamless loop */}
      <div className="animate-ticker inline-block" aria-hidden="true">
        {TOP_ASSETS.map((asset) => {
          const symbol = asset.toUpperCase();
          const data = prices[symbol];
          if (!data) return <span key={symbol} className="mx-6 text-neutral-500 font-medium">{symbol} Loading...</span>;

          const isUp = data.change >= 0;
          return (
            <span key={symbol} className="mx-6 font-medium">
              <span className="text-neutral-400 mr-2">{symbol}</span>
              <span className="text-white mr-2">{data.price.toFixed(symbol === "XRPUSDT" ? 4 : 2)}</span>
              <span className={clsx(isUp ? "text-emerald-500" : "text-red-500")}>
                {isUp ? "+" : ""}{data.change.toFixed(2)}%
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
