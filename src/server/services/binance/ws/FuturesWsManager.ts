import { ConnectionManager } from "./ConnectionManager.js";
import { WebSocket } from "ws";
import crypto from "crypto";

export class FuturesWsManager extends ConnectionManager {
  private requestMap = new Map<string, { resolve: (val: any) => void, reject: (err: any) => void, timeout: NodeJS.Timeout }>();

  constructor() {
    const isTestnet = process.env.BINANCE_ENV === "testnet";
    const url = process.env.BINANCE_WS_API_URL || (isTestnet 
      ? "wss://testnet.binancefuture.com/ws-fapi/v1" 
      : "wss://ws-fapi.binance.com/ws-fapi/v1");
    super(url);
  }

  protected onOpen(ws: WebSocket, isRotation: boolean) {
    console.log("[INFO] Futures WS API connected");
  }

  protected onMessage(data: any, ws: WebSocket) {
    try {
      const parsed = JSON.parse(data.toString());
      if (parsed.id && this.requestMap.has(parsed.id.toString())) {
        const reqId = parsed.id.toString();
        const { resolve, reject, timeout } = this.requestMap.get(reqId)!;
        clearTimeout(timeout);
        this.requestMap.delete(reqId);
        
        if (parsed.status !== 200) {
          reject(parsed.error);
        } else {
          resolve(parsed.result);
        }
      } else {
        // unsolicited or stream message
        this.emit("event", parsed);
      }
    } catch (e) {
        // ignore malformed
    }
  }

  public async sendRequest(method: string, params: any = {}): Promise<any> {
    if (!this.ws || (this.status !== "HEALTHY" && this.status !== "CONNECTED")) {
      throw new Error("WebSocket not ready");
    }

    const id = crypto.randomUUID();
    const payload = { id, method, params };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.requestMap.delete(id);
        reject(new Error("Request timeout"));
      }, 10000);

      this.requestMap.set(id, { resolve, reject, timeout });
      this.ws!.send(JSON.stringify(payload));
    });
  }

  public async sendSignedRequest(method: string, params: any = {}): Promise<any> {
    const isTradingEnabled = process.env.TRADING_ENABLED === "true";
    if (!isTradingEnabled) {
      throw new Error("TRADING_DISABLED");
    }

    const apiKey = process.env.BINANCE_API_KEY;
    const apiSecret = process.env.BINANCE_API_SECRET;
    
    if (!apiKey || !apiSecret) {
      throw new Error("Missing BINANCE_API_KEY or BINANCE_API_SECRET");
    }

    params.apiKey = apiKey;
    params.timestamp = Date.now();
    
    const queryString = Object.keys(params)
      .sort()
      .map(k => `${k}=${params[k]}`)
      .join('&');
      
    params.signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
    
    return this.sendRequest(method, params);
  }
}
