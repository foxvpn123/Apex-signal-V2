import { FuturesWsManager } from "./FuturesWsManager.js";
import { liveDataHub } from "./LiveDataHub.js";

export const futuresWsManager = new FuturesWsManager();

export function initializeWebSocketInfrastructure() {
  futuresWsManager.connect();
}

export function getWsStatus() {
  return {
    publicMarketData: liveDataHub.getStatus(),
    futuresWebSocketApi: {
      status: futuresWsManager.status,
      connectionAgeSeconds: Math.floor(futuresWsManager.connectionAgeMs / 1000)
    },
    dataHealthy: liveDataHub.isHealthy()
  };
}
