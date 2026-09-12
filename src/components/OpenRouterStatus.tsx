import React, { useEffect, useState } from "react";
import { fetchOpenRouterStatus } from "../lib/api";
import { Server, Activity, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import clsx from "clsx";

export default function OpenRouterStatus() {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchOpenRouterStatus()
      .then(res => {
        setStatus(res);
        setLoading(false);
      })
      .catch(err => {
        setStatus({ health: "ERROR", error: err.message, latencyMs: 0, availableModelCount: 0 });
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 flex items-center gap-3">
        <Server className="w-5 h-5 text-neutral-600 animate-pulse" />
        <div>
          <h3 className="text-sm font-semibold text-neutral-400">OpenRouter Status</h3>
          <p className="text-xs text-neutral-500">Checking connection...</p>
        </div>
      </div>
    );
  }

  const isOnline = status?.health === "ONLINE";

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
      <div className="p-4 border-b border-neutral-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Server className={clsx("w-5 h-5", isOnline ? "text-indigo-400" : "text-amber-400")} />
          <h3 className="text-sm font-semibold text-neutral-300">OpenRouter Status</h3>
        </div>
        <div className={clsx(
          "px-2 py-1 rounded text-[10px] font-bold tracking-wider",
          isOnline ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30" : "bg-red-500/10 text-red-400 border border-red-500/30"
        )}>
          {status?.health || "UNKNOWN"}
        </div>
      </div>
      
      <div className="p-4 grid grid-cols-2 gap-4">
        <div>
          <div className="text-xs text-neutral-500 flex items-center gap-1.5 mb-1">
            <Activity className="w-3.5 h-3.5" /> Latency
          </div>
          <div className="font-mono text-sm text-neutral-300">
            {status?.latencyMs ? `${status.latencyMs} ms` : "N/A"}
          </div>
        </div>
        <div>
          <div className="text-xs text-neutral-500 flex items-center gap-1.5 mb-1">
            <CheckCircle className="w-3.5 h-3.5" /> Models Available
          </div>
          <div className="font-mono text-sm text-neutral-300">
            {status?.availableModelCount ?? "N/A"}
          </div>
        </div>
      </div>
      
      {status?.error && (
        <div className="px-4 pb-4">
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-3 rounded-lg flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="break-words">{status.error}</span>
          </div>
        </div>
      )}
    </div>
  );
}
