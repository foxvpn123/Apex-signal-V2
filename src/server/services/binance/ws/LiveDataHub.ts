import { PublicWsManager } from "./PublicWsManager.js";
import { EventEmitter } from "events";

export class LiveDataHub extends EventEmitter {
  private publicWs: PublicWsManager;
  private latestPrices = new Map<string, { price: number, timestamp: number }>();
  
  constructor() {
    super();
    this.publicWs = new PublicWsManager();
    
    this.publicWs.on("event", (event: any) => {
      // kline event
      if (event.e === "kline") {
        const symbol = event.s;
        const kline = event.k;
        this.latestPrices.set(symbol.toUpperCase(), { price: parseFloat(kline.c), timestamp: Date.now() });
      }
      // 24hr mini ticker
      if (event.e === "24hrMiniTicker") {
        this.latestPrices.set(event.s.toUpperCase(), { price: parseFloat(event.c), timestamp: Date.now() });
      }
    });

    this.publicWs.on("stale", () => {
      console.log("[WARN] Market data stale");
    });
    
    this.publicWs.connect();
    // Subscribe to at least one active stream so we receive constant messages
    // to keep the stale-data health monitor happy before the user scans.
    this.publicWs.subscribe(["btcusdt@miniTicker"]);
  }
  
  public getPriceData(symbol: string) {
    return this.latestPrices.get(symbol.toUpperCase());
  }
  
  public subscribeToMarket(symbol: string) {
    const s = symbol.toLowerCase();
    this.publicWs.subscribe([`${s}@kline_1m`, `${s}@miniTicker`]);
  }
  
  public getStatus() {
    return {
      status: this.publicWs.status,
      connectionAgeSeconds: Math.floor(this.publicWs.connectionAgeMs / 1000),
      lastMessageAt: new Date(this.publicWs.lastMessageAt).toISOString(),
      lastMessageAgeMs: Date.now() - this.publicWs.lastMessageAt,
      lastPingAt: new Date(this.publicWs.lastPingAt).toISOString()
    };
  }

  public isHealthy() {
    return this.publicWs.status === "HEALTHY" || this.publicWs.status === "CONNECTING";
  }
}

export const liveDataHub = new LiveDataHub();
