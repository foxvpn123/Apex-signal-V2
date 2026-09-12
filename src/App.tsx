/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import Dashboard from "./components/Dashboard";
import ScrollingTicker from "./components/ScrollingTicker";
import { Activity } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchWsStatus } from "./lib/api";
import clsx from "clsx";

export default function App() {
  const [wsStatus, setWsStatus] = useState<any>(null);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const status = await fetchWsStatus();
        setWsStatus(status);
      } catch (e) {
        // ignore
      }
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const binanceStatusColor = 
    wsStatus?.dataHealthy ? "bg-emerald-500" :
    wsStatus?.publicMarketData?.status === "RECONNECTING" ? "bg-amber-500" :
    wsStatus?.publicMarketData?.status === "ROTATING" ? "bg-orange-500" :
    "bg-red-500";
    
  const binanceStatusText = 
    wsStatus?.publicMarketData?.status === "RECONNECTING" ? "RECONNECTING" :
    wsStatus?.publicMarketData?.status === "ROTATING" ? "ROTATING CONNECTION" :
    wsStatus?.dataHealthy ? "BINANCE LIVE" : "OFFLINE";

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200 font-sans selection:bg-indigo-500/30">
      <header className="border-b border-neutral-800 bg-neutral-900/50 p-4 sticky top-0 z-50 backdrop-blur-md">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/10 rounded-lg">
              <Activity className="w-5 h-5 text-indigo-400" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-white">AI TRADING BOT V2</h1>
          </div>
          <div className="flex items-center gap-4 text-xs font-medium">
            <div className="flex items-center gap-2">
              <span className={clsx("w-2 h-2 rounded-full", binanceStatusColor, wsStatus?.dataHealthy && "animate-pulse")}></span>
              <span className="text-neutral-400">{binanceStatusText}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span className="text-neutral-400">AIHUBMIX ACTIVE</span>
            </div>
          </div>
        </div>
      </header>
      
      <ScrollingTicker />

      <main className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
        <Dashboard />
      </main>
    </div>
  );
}
