import { WebSocket } from "ws";
import { EventEmitter } from "events";

const MAX_CONNECTION_AGE_MS = 23 * 60 * 60 * 1000; // 23 hours
const STALE_TIMEOUT_MS = 30000; // 30 seconds

export type ConnectionStatus = "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "HEALTHY" | "DEGRADED" | "ROTATING" | "RECONNECTING" | "FAILED" | "STOPPED";

export abstract class ConnectionManager extends EventEmitter {
  public status: ConnectionStatus = "DISCONNECTED";
  protected ws: WebSocket | null = null;
  protected oldWs: WebSocket | null = null;
  
  protected url: string;
  public connectionAgeMs: number = 0;
  public lastMessageAt: number = 0;
  public lastPingAt: number = 0;
  public lastPongAt: number = 0;
  
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private rotationTimer: NodeJS.Timeout | null = null;
  private healthTimer: NodeJS.Timeout | null = null;
  private connectedAt: number = 0;

  constructor(url: string) {
    super();
    this.url = url;
  }

  public connect(isRotation = false) {
    if (this.status === "STOPPED") return;
    if (this.status === "CONNECTING" || this.status === "RECONNECTING") return;
    
    if (isRotation) {
      this.status = "ROTATING";
    } else {
      this.status = this.reconnectAttempts > 0 ? "RECONNECTING" : "CONNECTING";
    }

    const newWs = new WebSocket(this.url);

    newWs.on("open", () => {
      this.connectedAt = Date.now();
      this.reconnectAttempts = 0;
      this.lastMessageAt = Date.now();
      
      this.onOpen(newWs, isRotation);
      
      if (isRotation && this.ws) {
        // Dual connection handover
        this.oldWs = this.ws;
        this.ws = newWs;
        // drain and close old ws shortly after
        setTimeout(() => {
          if (this.oldWs) {
             this.oldWs.close();
             this.oldWs = null;
          }
        }, 5000);
      } else {
        this.ws = newWs;
      }
      
      this.status = "HEALTHY";
      this.startHealthMonitor();
      this.startRotationTimer();
    });

    newWs.on("message", (data) => {
      this.lastMessageAt = Date.now();
      this.onMessage(data, newWs);
    });

    newWs.on("ping", (payload) => {
      this.lastPingAt = Date.now();
      // ws library automatically sends pong
    });
    
    newWs.on("pong", () => {
      this.lastPongAt = Date.now();
    });

    newWs.on("close", () => {
      if (this.ws === newWs) {
         this.ws = null;
         this.handleDisconnect("WebSocket closed natively");
      }
    });

    newWs.on("error", (err) => {
      console.warn(`[WS Error] ${this.url}: ${err.message}`);
      if (this.ws === newWs) {
        this.handleDisconnect("WebSocket error");
      }
    });
  }

  private startRotationTimer() {
    if (this.rotationTimer) clearTimeout(this.rotationTimer);
    this.rotationTimer = setTimeout(() => {
      console.log(`[INFO] Scheduled 23h rotation started for ${this.url}`);
      this.rotateConnection();
    }, MAX_CONNECTION_AGE_MS);
  }

  private rotateConnection() {
    this.connect(true);
  }

  private startHealthMonitor() {
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = setInterval(() => {
      const now = Date.now();
      this.connectionAgeMs = now - this.connectedAt;
      
      if (now - this.lastMessageAt > STALE_TIMEOUT_MS) {
        this.status = "DEGRADED";
        this.emit("stale");
      } else if (this.status === "DEGRADED") {
        this.status = "HEALTHY";
      }
    }, 5000);
  }

  private handleDisconnect(reason: string) {
    console.log(`[WARN] WS Disconnected: ${reason}. Reconnecting...`);
    this.cleanup();
    
    if (this.status === "STOPPED") return;
    
    this.status = "DISCONNECTED";
    this.reconnect();
  }

  private reconnect() {
    if (this.reconnectTimer) return;
    
    let backoff = Math.pow(2, this.reconnectAttempts) * 1000;
    if (backoff > 60000) backoff = 60000;
    backoff += Math.random() * 1000; // Add jitter
    
    console.log(`[INFO] Reconnecting in ${Math.round(backoff)}ms`);
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectAttempts++;
      this.connect();
    }, backoff);
  }

  public shutdown() {
    this.status = "STOPPED";
    this.cleanup();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.oldWs) {
      this.oldWs.close();
      this.oldWs = null;
    }
  }

  private cleanup() {
    if (this.rotationTimer) clearTimeout(this.rotationTimer);
    if (this.healthTimer) clearInterval(this.healthTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
  }

  protected abstract onOpen(ws: WebSocket, isRotation: boolean): void;
  protected abstract onMessage(data: any, ws: WebSocket): void;
}
