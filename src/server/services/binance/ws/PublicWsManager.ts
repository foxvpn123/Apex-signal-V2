import { ConnectionManager } from "./ConnectionManager.js";
import { WebSocket } from "ws";

export class PublicWsManager extends ConnectionManager {
  private subscriptions: Set<string> = new Set();
  
  constructor() {
    const isTestnet = process.env.BINANCE_ENV === "testnet";
    const url = isTestnet 
      ? "wss://stream.binancefuture.com/ws" 
      : "wss://fstream.binance.com/ws";
    super(url);
  }

  protected onOpen(ws: WebSocket, isRotation: boolean) {
    console.log("[INFO] Binance public WS connected");
    if (this.subscriptions.size > 0) {
      this.sendSubscribe(ws, Array.from(this.subscriptions));
    }
  }

  protected onMessage(data: any, ws: WebSocket) {
    try {
      const parsed = JSON.parse(data.toString());
      this.emit("event", parsed);
    } catch (e) {
      // ignore
    }
  }

  public subscribe(streams: string[]) {
    const newStreams = streams.filter(s => !this.subscriptions.has(s));
    for (const s of newStreams) this.subscriptions.add(s);
    if (this.ws && this.ws.readyState === WebSocket.OPEN && newStreams.length > 0) {
      this.sendSubscribe(this.ws, newStreams);
    }
  }

  public unsubscribe(streams: string[]) {
    for (const s of streams) this.subscriptions.delete(s);
    if (this.ws && this.ws.readyState === WebSocket.OPEN && streams.length > 0) {
       this.ws.send(JSON.stringify({
         method: "UNSUBSCRIBE",
         params: streams,
         id: Date.now()
       }));
    }
  }

  private sendSubscribe(ws: WebSocket, streams: string[]) {
    ws.send(JSON.stringify({
      method: "SUBSCRIBE",
      params: streams,
      id: Date.now()
    }));
  }
}
