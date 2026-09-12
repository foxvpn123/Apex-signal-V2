import React, { useState, useEffect } from "react";
import { fetchMarkets, runScan, fetchApinExStatus } from "../lib/api";
import { Search, Loader2, Play, AlertTriangle, CheckCircle, XCircle, TrendingUp, TrendingDown, Minus, Activity, ShieldCheck, ShieldAlert, ChevronDown, ChevronUp, Settings, Bell } from "lucide-react";
import clsx from "clsx";
import OpenRouterStatus from "./OpenRouterStatus";
import ModelConfidenceChart from "./ModelConfidenceChart";
import NotificationConfigModal from "./NotificationConfigModal";

const TIMEFRAMES = ["10m", "15m", "20m", "1H", "4H", "1D"];

export default function Dashboard() {
  const [markets, setMarkets] = useState<any[]>([]);
  const [availableQuotes, setAvailableQuotes] = useState<string[]>(["USDT", "USD"]);
  const [quoteFilter, setQuoteFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [timeframe, setTimeframe] = useState("1H");
  const [isScanning, setIsScanning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<{ time: string, msg: string, type: "INFO" | "SUCCESS" | "WARNING" | "ERROR" }[]>([]);
  const [apinexStatus, setApinExStatus] = useState<any>(null);
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);

  // Expandable sections state
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    TPSL: true,
    APINEX: false,
    XKIRO: false,
    UNOROUTER: false,
    OPENROUTER: false,
    DIAGNOSTICS: false
  });

  const toggleExpand = (section: string) => {
    setExpanded(prev => ({ ...prev, [section]: !prev[section] }));
  };

  useEffect(() => {
    fetchMarkets()
      .then(res => {
        if (res.markets) {
           setMarkets(res.markets);
           if (res.quotes) setAvailableQuotes(res.quotes);
        } else {
           setMarkets(res);
        }
      })
      .catch(err => {
        addLog("Failed to load markets: " + err.message, "ERROR");
        setMarkets([
          { symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT" }, 
          { symbol: "BTCUSD", baseAsset: "BTC", quoteAsset: "USD" },
          { symbol: "ETHUSDT", baseAsset: "ETH", quoteAsset: "USDT" }
        ]);
        setAvailableQuotes(["USDT", "USD"]);
      });
      
    fetchApinExStatus().then(setApinExStatus).catch(err => console.error("Failed", err));
  }, []);

  const filteredMarkets = markets.filter(m => {
    if (quoteFilter !== "ALL" && m.quoteAsset !== quoteFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!m.symbol?.toLowerCase().includes(q) && 
          !m.baseAsset?.toLowerCase().includes(q) && 
          !m.quoteAsset?.toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  });

  const addLog = (msg: string, type: "INFO" | "SUCCESS" | "WARNING" | "ERROR" = "INFO") => {
    setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), msg, type }]);
  };

  const handleScan = async () => {
    setIsScanning(true);
    setResult(null);
    setError(null);
    setLogs([]);
    
    addLog(`Initiated scan for ${symbol} @ ${timeframe}`, "INFO");

    try {
      const statusRes = await fetchApinExStatus();
      setApinExStatus(statusRes);
      
      const data = await runScan(symbol, timeframe);
      addLog("Analysis pipeline completed", "SUCCESS");
      setResult(data);
    } catch (err: any) {
      addLog("Scan failed: " + err.message, "ERROR");
      setError(err.message);
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Sidebar Controls */}
      <div className="lg:col-span-3 space-y-6">
        <div className="bg-neutral-900 border border-neutral-800 p-5 rounded-xl">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider">Market Selection</h2>
            <button 
              onClick={() => setIsConfigModalOpen(true)}
              className="text-neutral-500 hover:text-indigo-400 transition-colors p-1"
              title="Notification Settings"
            >
              <Bell className="w-4 h-4" />
            </button>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-neutral-500 mb-1">Symbol</label>
              
              <div className="flex gap-2 mb-3">
                {["ALL", ...availableQuotes].map(q => (
                  <button 
                    key={q} 
                    onClick={() => setQuoteFilter(q)} 
                    className={clsx("text-xs py-1 px-3 rounded-md border font-medium transition-colors", 
                      quoteFilter === q ? "bg-neutral-800 text-white border-neutral-700" : "bg-neutral-950 text-neutral-500 border-neutral-800 hover:text-neutral-300")}
                  >
                    {q}
                  </button>
                ))}
              </div>

              <div className="relative mb-3">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-neutral-500" />
                <input 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search coins..."
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg py-2 pl-9 pr-3 text-sm focus:ring-1 focus:ring-indigo-500 outline-none text-white placeholder-neutral-600"
                />
              </div>

              <div className="relative border border-neutral-800 rounded-lg bg-neutral-950 h-48 overflow-y-auto">
                {filteredMarkets.length === 0 ? (
                  <div className="p-4 text-center text-xs text-neutral-600">No markets found</div>
                ) : (
                  <div className="p-1 space-y-1">
                    {filteredMarkets.slice(0, 200).map(m => (
                      <button
                        key={m.symbol}
                        onClick={() => {
                          setSymbol(m.symbol);
                          setResult(null); // Clear previous result when switching
                        }}
                        className={clsx(
                          "w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors text-left",
                          symbol === m.symbol 
                            ? "bg-indigo-500/20 text-indigo-300" 
                            : "text-neutral-400 hover:bg-neutral-900"
                        )}
                      >
                        <span className="font-medium">{m.symbol}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs text-neutral-500 mb-1">Timeframe</label>
              <div className="grid grid-cols-3 gap-2">
                {TIMEFRAMES.map(tf => (
                  <button
                    key={tf}
                    onClick={() => setTimeframe(tf)}
                    className={clsx(
                      "py-1.5 text-xs font-medium rounded-md border transition-colors",
                      timeframe === tf 
                        ? "bg-indigo-500/20 border-indigo-500/50 text-indigo-300" 
                        : "bg-neutral-950 border-neutral-800 text-neutral-400 hover:bg-neutral-800"
                    )}
                  >
                    {tf}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleScan}
              disabled={isScanning}
              className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {isScanning ? "SCANNING..." : "SCAN MARKET"}
            </button>
          </div>
        </div>

        {/* Live Logs */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 h-64 flex flex-col">
          <h2 className="text-xs font-semibold text-neutral-400 mb-2 uppercase tracking-wider">AI Log</h2>
          <div className="flex-1 overflow-y-auto space-y-1.5 font-mono text-[10px]">
            {logs.map((log, i) => (
              <div key={i} className="flex gap-2 items-start">
                <span className="text-neutral-600 shrink-0">{log.time}</span>
                <span className={clsx(
                  "font-medium",
                  log.type === "INFO" && "text-blue-400",
                  log.type === "SUCCESS" && "text-emerald-400",
                  log.type === "WARNING" && "text-amber-400",
                  log.type === "ERROR" && "text-red-400",
                )}>{log.type}</span>
                <span className="text-neutral-300 break-words">{log.msg}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="lg:col-span-9 space-y-6">
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium text-sm">Scan Error</h3>
              <p className="text-xs opacity-80 mt-1">{error}</p>
            </div>
          </div>
        )}

        {result && !error ? (
          <div className="space-y-6">
            {/* Final Signal Card */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
              <div className="p-6 border-b border-neutral-800 flex items-center justify-between bg-neutral-900/50">
                <div>
                  <h2 className="text-3xl font-bold tracking-tight text-white">{result.symbol}</h2>
                  <div className="flex items-center gap-3 mt-2 text-sm">
                    <span className="text-neutral-400">Timeframe: <strong className="text-white">{result.timeframe}</strong></span>
                    <span className="text-neutral-600">•</span>
                    <span className="text-neutral-400">Current Price: <strong className="text-white">${result.currentPrice}</strong></span>
                  </div>
                </div>
                
                <div className={clsx(
                  "px-6 py-3 rounded-xl border flex items-center gap-3 shadow-lg",
                  result.decision === "LONG" && "bg-emerald-500/10 border-emerald-500/30 text-emerald-400",
                  result.decision === "SHORT" && "bg-red-500/10 border-red-500/30 text-red-400",
                  result.decision === "NO_TRADE" && "bg-neutral-800 border-neutral-700 text-neutral-300",
                )}>
                  {result.decision === "LONG" && <TrendingUp className="w-6 h-6" />}
                  {result.decision === "SHORT" && <TrendingDown className="w-6 h-6" />}
                  {result.decision === "NO_TRADE" && <Minus className="w-6 h-6" />}
                  <span className="text-2xl font-black tracking-widest">{result.decision}</span>
                </div>
              </div>

              <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4 border-b border-neutral-800 bg-neutral-950/30 text-sm">
                <div className="flex flex-col">
                  <span className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider mb-1">Market Bias</span>
                  <span className={clsx("font-bold", result.marketBias === "LONG" ? "text-emerald-400" : result.marketBias === "SHORT" ? "text-red-400" : "text-neutral-300")}>{result.marketBias || "UNKNOWN"}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider mb-1">Candidate Direction</span>
                  <span className="font-bold text-neutral-300">{result.candidateDirection || "NONE"}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider mb-1">Tradeability</span>
                  <span className={clsx("font-bold", result.tradeability === "VALID" ? "text-emerald-400" : result.tradeability === "INVALID" ? "text-red-400" : "text-neutral-300")}>{result.tradeability || "UNKNOWN"}</span>
                </div>
              </div>

              {result.decision === "NO_TRADE" && result.reason && (
                <div className="p-4 border-b border-neutral-800 bg-amber-500/5 flex items-start gap-3">
                   <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                   <div>
                     <h4 className="text-sm font-semibold text-amber-500 uppercase tracking-wider">No Trade Reason</h4>
                     <p className="text-xs text-amber-400/80 mt-1 font-mono">{result.reason}</p>
                   </div>
                </div>
              )}

              <div className="p-6 grid grid-cols-2 md:grid-cols-4 gap-6">
                <div>
                  <div className="text-xs text-neutral-500 mb-1">Entry Price</div>
                  <div className="text-lg font-mono font-medium text-white">{result.entry || 'N/A'}</div>
                </div>
                <div>
                  <div className="text-xs text-neutral-500 mb-1">Stop Loss</div>
                  <div className="text-lg font-mono font-medium text-red-400">{result.sl || 'N/A'}</div>
                </div>
                <div>
                  <div className="text-xs text-neutral-500 mb-1">Risk / Reward</div>
                  <div className="text-lg font-mono font-medium text-white">{result.rr || 'N/A'}</div>
                </div>
                <div>
                  <div className="text-xs text-neutral-500 mb-1">Confidence</div>
                  <div className="text-lg font-mono font-medium text-indigo-400">{result.confidence || 0}%</div>
                </div>
              </div>
              
              <div className="p-6 pt-0 grid grid-cols-1 md:grid-cols-3 gap-6 border-b border-neutral-800">
                {[result.tp1, result.tp2, result.tp3].map((tp: any, i: number) => tp ? (
                   <div key={i} className="bg-neutral-950 p-3 rounded-lg border border-neutral-800">
                     <div className="text-xs text-neutral-500 mb-1">Target {i + 1}</div>
                     <div className="text-emerald-400 font-mono font-medium">{tp}</div>
                   </div>
                ) : null)}
              </div>

              <div className="p-6 text-sm text-neutral-300 border-b border-neutral-800">
                <h4 className="font-semibold text-white mb-2 text-xs uppercase tracking-wider text-neutral-500">Decision Evidence & Risks</h4>
                <ul className="space-y-2">
                  {result.reason && (
                    <li className="flex gap-2 text-white font-medium">
                      <CheckCircle className="w-4 h-4 text-indigo-400 shrink-0" /> {result.reason}
                    </li>
                  )}
                  {result.risks?.map((risk: string, i: number) => (
                    <li key={i} className="flex gap-2"><AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" /> {risk}</li>
                  ))}
                  {result.invalidation && (
                    <li className="flex gap-2"><XCircle className="w-4 h-4 text-red-500 shrink-0" /> Invalidation: {result.invalidation}</li>
                  )}
                </ul>
              </div>

              <div className="p-6 bg-neutral-900/50">
                 <ModelConfidenceChart scanResult={result} />
              </div>
            </div>

            {/* Expandable Sections */}
            
            {/* TP/SL Consensus */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
              <button 
                onClick={() => toggleExpand("TPSL")}
                className="w-full flex items-center justify-between p-4 hover:bg-neutral-800 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-semibold text-neutral-300 uppercase tracking-wider">TP/SL Consensus</h3>
                  <span className="text-xs text-neutral-500 bg-neutral-950 px-2 py-0.5 rounded border border-neutral-800">
                    Strength: {result.tpSlConsensus?.strength || result.tpSlConsensus?.consensusStrength || 0}%
                  </span>
                </div>
                {expanded.TPSL ? <ChevronUp className="w-4 h-4 text-neutral-500" /> : <ChevronDown className="w-4 h-4 text-neutral-500" />}
              </button>
              
              {expanded.TPSL && (
                <div className="p-4 border-t border-neutral-800 bg-neutral-950/50">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs font-mono mb-4 border-b border-neutral-800 pb-4">
                    <div>
                       <div className="text-neutral-500 mb-1">Supporting Models</div>
                       <div className="text-neutral-300">{result.tpSlConsensus?.supportingModels} / {result.tpSlConsensus?.sourceCount}</div>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs font-mono whitespace-nowrap">
                      <thead className="text-neutral-500 border-b border-neutral-800">
                        <tr>
                          <th className="py-2 pr-4 font-normal">Source</th>
                          <th className="py-2 pr-4 font-normal">Dir</th>
                          <th className="py-2 pr-4 font-normal">Entry</th>
                          <th className="py-2 pr-4 font-normal">SL</th>
                          <th className="py-2 pr-4 font-normal">TP1</th>
                          <th className="py-2 pr-4 font-normal">TP2</th>
                          <th className="py-2 pr-4 font-normal">TP3</th>
                          <th className="py-2 pr-4 font-normal">Conf</th>
                        </tr>
                      </thead>
                      <tbody className="text-neutral-300">
                        {result.tpSlConsensus?.validProposals?.map((p: any, idx: number) => (
                          <tr key={idx} className="border-b border-neutral-800/50">
                            <td className="py-2 pr-4 opacity-80">{p.source}</td>
                            <td className={clsx("py-2 pr-4", p.direction === "LONG" ? "text-emerald-400" : "text-red-400")}>{p.direction}</td>
                            <td className="py-2 pr-4">{p.entry}</td>
                            <td className="py-2 pr-4 text-red-400/80">{p.sl}</td>
                            <td className="py-2 pr-4 text-emerald-400/80">{p.tp1}</td>
                            <td className="py-2 pr-4 text-emerald-400/80">{p.tp2 || '-'}</td>
                            <td className="py-2 pr-4 text-emerald-400/80">{p.tp3 || '-'}</td>
                            <td className="py-2 pr-4 text-indigo-400">{p.confidence}%</td>
                          </tr>
                        ))}
                        {(!result.tpSlConsensus?.validProposals || result.tpSlConsensus.validProposals.length === 0) && (
                          <tr><td colSpan={8} className="py-4 text-center text-neutral-500">No valid TP/SL proposals available.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* APINEX Models */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
              <button 
                onClick={() => toggleExpand("APINEX")}
                className="w-full flex items-center justify-between p-4 hover:bg-neutral-800 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-semibold text-neutral-300 uppercase tracking-wider">APINEX Specialists</h3>
                  <span className="text-xs text-neutral-500 bg-neutral-950 px-2 py-0.5 rounded border border-neutral-800">
                    {Object.keys(result.models?.APINEX || {}).length} roles
                  </span>
                </div>
                {expanded.APINEX ? <ChevronUp className="w-4 h-4 text-neutral-500" /> : <ChevronDown className="w-4 h-4 text-neutral-500" />}
              </button>
              
              {expanded.APINEX && (
                <div className="p-4 border-t border-neutral-800 bg-neutral-950/50 grid grid-cols-1 gap-2">
                  {Object.entries(result.models?.APINEX || {}).map(([role, items]: any) => 
                    items.map((item: any, idx: number) => (
                      <ModelRow key={`${role}-${idx}`} name={role} modelId={item.model} data={item.res} />
                    ))
                  )}
                </div>
              )}
            </div>

            {/* XKIRO Models */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
              <button 
                onClick={() => toggleExpand("XKIRO")}
                className="w-full flex items-center justify-between p-4 hover:bg-neutral-800 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-semibold text-neutral-300 uppercase tracking-wider">XKIRO Fleet</h3>
                  <span className="text-xs text-neutral-500 bg-neutral-950 px-2 py-0.5 rounded border border-neutral-800">
                    {Object.values(result.models?.XKIRO || {}).flat().length} models
                  </span>
                </div>
                {expanded.XKIRO ? <ChevronUp className="w-4 h-4 text-neutral-500" /> : <ChevronDown className="w-4 h-4 text-neutral-500" />}
              </button>
              
              {expanded.XKIRO && (
                <div className="p-4 border-t border-neutral-800 bg-neutral-950/50 grid grid-cols-1 md:grid-cols-2 gap-2">
                  {Object.entries(result.models?.XKIRO || {}).map(([role, items]: any) => 
                    items.map((item: any, idx: number) => (
                      <ModelRow key={`${role}-${idx}`} name={role} modelId={item.model} data={item.res} />
                    ))
                  )}
                </div>
              )}
            </div>

            {/* UNOROUTER Models */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
              <button 
                onClick={() => toggleExpand("UNOROUTER")}
                className="w-full flex items-center justify-between p-4 hover:bg-neutral-800 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-semibold text-neutral-300 uppercase tracking-wider">UNOROUTER Fleet</h3>
                  <span className="text-xs text-neutral-500 bg-neutral-950 px-2 py-0.5 rounded border border-neutral-800">
                    {Object.values(result.models?.UNOROUTER || {}).flat().length} models
                  </span>
                </div>
                {expanded.UNOROUTER ? <ChevronUp className="w-4 h-4 text-neutral-500" /> : <ChevronDown className="w-4 h-4 text-neutral-500" />}
              </button>
              
              {expanded.UNOROUTER && (
                <div className="p-4 border-t border-neutral-800 bg-neutral-950/50 grid grid-cols-1 md:grid-cols-2 gap-2">
                  {Object.entries(result.models?.UNOROUTER || {}).map(([role, items]: any) => 
                    items.map((item: any, idx: number) => (
                      <ModelRow key={`${role}-${idx}`} name={role} modelId={item.model} data={item.res} />
                    ))
                  )}
                </div>
              )}
            </div>

            {/* OPENROUTER Models */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
              <button 
                onClick={() => toggleExpand("OPENROUTER")}
                className="w-full flex items-center justify-between p-4 hover:bg-neutral-800 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-semibold text-neutral-300 uppercase tracking-wider">OPENROUTER Fleet</h3>
                  <span className="text-xs text-neutral-500 bg-neutral-950 px-2 py-0.5 rounded border border-neutral-800">
                    {Object.values(result.models?.OPENROUTER || {}).flat().length} models
                  </span>
                </div>
                {expanded.OPENROUTER ? <ChevronUp className="w-4 h-4 text-neutral-500" /> : <ChevronDown className="w-4 h-4 text-neutral-500" />}
              </button>
              
              {expanded.OPENROUTER && (
                <div className="p-4 border-t border-neutral-800 bg-neutral-950/50 grid grid-cols-1 md:grid-cols-2 gap-2">
                  {Object.entries(result.models?.OPENROUTER || {}).map(([role, items]: any) => 
                    items.map((item: any, idx: number) => (
                      <ModelRow key={`${role}-${idx}`} name={role} modelId={item.model} data={item.res} />
                    ))
                  )}
                </div>
              )}
            </div>

            {/* FINAL JUDGE */}
            <div className="bg-neutral-900 border border-neutral-800 p-5 rounded-xl flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-neutral-400 mb-1 uppercase tracking-wider">Final Judge</h3>
                  <div className="text-xs text-neutral-500 flex flex-col gap-0.5 mt-2">
                    <div>Provider: <span className="font-mono text-neutral-300">{result.finalJudge?.provider || "UNKNOWN"}</span></div>
                    <div>Model: <span className="font-mono text-neutral-300">{result.finalJudge?.model || "UNKNOWN"}</span></div>
                    <div>Source: <span className="font-mono text-neutral-300">{result.finalJudge?.source || "UNKNOWN"}</span></div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className={clsx(
                    "px-3 py-1 rounded text-xs font-bold border uppercase",
                    result.finalJudge?.status === "ONLINE" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : 
                    result.finalJudge?.status === "FALLBACK" ? "bg-amber-500/10 text-amber-400 border-amber-500/30" :
                    "bg-red-500/10 text-red-400 border-red-500/30"
                  )}>
                    {result.finalJudge?.status || "UNKNOWN"}
                  </div>
                  {result.finalJudge?.output?.decision && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-neutral-500">Decision:</span>
                      <span className={clsx(
                        "text-sm font-bold",
                        result.finalJudge.output.decision === "LONG" ? "text-emerald-400" :
                        result.finalJudge.output.decision === "SHORT" ? "text-red-400" : "text-neutral-400"
                      )}>{result.finalJudge.output.decision}</span>
                    </div>
                  )}
                  {result.finalJudge?.output?.confidence !== undefined && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-neutral-500">Confidence:</span>
                      <span className="text-sm font-bold text-neutral-300">{result.finalJudge.output.confidence}%</span>
                    </div>
                  )}
                </div>
              </div>
              {result.finalJudge?.output?.reason && (
                <div className="mt-2 p-3 bg-neutral-950 rounded text-xs text-neutral-400 border border-neutral-800">
                  <span className="text-neutral-500 mb-1 block">
                    {result.finalJudge?.output?.error ? "Final Judge Error:" : "Reasoning:"}
                  </span>
                  {result.finalJudge.output.reason}
                </div>
              )}
              {result.finalJudge?.output?.httpStatus && (
                <div className="text-[11px] text-neutral-600 font-mono">
                  HTTP {result.finalJudge.output.httpStatus}
                </div>
              )}
            </div>

            {/* Diagnostics */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
               <button 
                onClick={() => toggleExpand("DIAGNOSTICS")}
                className="w-full flex items-center justify-between p-4 hover:bg-neutral-800 transition-colors text-left"
              >
                <h3 className="text-sm font-semibold text-neutral-300 uppercase tracking-wider">Diagnostics</h3>
                {expanded.DIAGNOSTICS ? <ChevronUp className="w-4 h-4 text-neutral-500" /> : <ChevronDown className="w-4 h-4 text-neutral-500" />}
              </button>
              
              {expanded.DIAGNOSTICS && result.debug && (
                <div className="p-4 border-t border-neutral-800 bg-neutral-950/50 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs font-mono">
                  <div>
                    <div className="text-neutral-500 mb-1">Binance WS</div>
                    <div className={result.debug.wsHealthy ? "text-emerald-400" : "text-amber-400"}>
                      {result.debug.wsStatus}
                    </div>
                  </div>
                  <div>
                    <div className="text-neutral-500 mb-1">Price Age</div>
                    <div className={result.debug.priceAgeMs > 30000 ? "text-amber-400" : "text-emerald-400"}>
                      {result.debug.priceAgeMs} ms
                    </div>
                  </div>
                  <div>
                    <div className="text-neutral-500 mb-1">Candle Age ({result.timeframe})</div>
                    <div className="text-neutral-300">
                      {result.debug.candleAgeMs} ms
                    </div>
                  </div>
                  <div>
                    <div className="text-neutral-500 mb-1">REST Fallback</div>
                    <div className={result.debug.restFallbackUsed ? "text-amber-400" : "text-neutral-400"}>
                      {result.debug.restFallbackUsed ? "USED" : "NOT REQUIRED"}
                    </div>
                  </div>
                </div>
              )}
              
              {expanded.DIAGNOSTICS && (
                <div className="p-4 border-t border-neutral-800 bg-neutral-950/30">
                  <OpenRouterStatus />
                </div>
              )}
            </div>

          </div>
        ) : (
          <div className="h-full min-h-[400px] border border-neutral-800 border-dashed rounded-xl flex flex-col items-center justify-center text-neutral-500 p-8 text-center">
            {isScanning ? (
              <>
                <Loader2 className="w-10 h-10 animate-spin text-indigo-500 mb-4" />
                <p className="text-sm text-white">Analyzing market data across multiple AI models...</p>
                <p className="text-xs mt-2 opacity-60">Running APINEX + XKIRO + OPENROUTER Fleets simultaneously.</p>
              </>
            ) : (
              <>
                <Activity className="w-10 h-10 mb-4 opacity-50" />
                <p className="text-sm">Select a market and timeframe to begin analysis.</p>
              </>
            )}
          </div>
        )}
      </div>
      
      <NotificationConfigModal 
        isOpen={isConfigModalOpen} 
        onClose={() => setIsConfigModalOpen(false)} 
      />
    </div>
  );
}

function ModelRow({ name, modelId, data }: { name: string, modelId: string, data: any, key?: string }) {
  const isError = data?.error || data?.status === 'unavailable' || data?.status === 'billing_required';
  const errorText = typeof data?.error === 'string' ? data.error.toUpperCase() : "ERROR";
  const isBilling = data?.status === 'billing_required' || data?.error === 'BILLING_REQUIRED';

  let statusText = "COMPLETED";
  if (isError) {
     if (isBilling) statusText = "BILLING_REQUIRED";
     else if (errorText.includes("TIMEOUT")) statusText = "TIMEOUT";
     else if (errorText.includes("NOT FOUND")) statusText = "MODEL_NOT_FOUND";
     else if (errorText.includes("AUTH")) statusText = "AUTH_ERROR";
     else if (errorText.includes("MALFORMED")) statusText = "MALFORMED_JSON";
     else statusText = "ERROR";
  }

  return (
    <div className="flex items-center justify-between py-2 border-b border-neutral-800 last:border-0 bg-neutral-900 px-3 rounded-lg mb-1">
      <div className="flex flex-col">
        <span className="text-xs font-medium text-neutral-300 flex items-center gap-2">
          {statusText === "COMPLETED" ? <CheckCircle className="w-3 h-3 text-emerald-500" /> : <XCircle className="w-3 h-3 text-red-500" />}
          {name}
        </span>
        <span className="text-[10px] text-neutral-500 ml-5 font-mono">{modelId}</span>
      </div>
      
      <div className="flex flex-col items-end">
        <span className={clsx("text-xs font-mono text-right", statusText === "COMPLETED" ? "text-emerald-400" : "text-amber-400")}>
          {statusText}
        </span>
        {statusText === "COMPLETED" && (
           <span className={clsx("text-[10px] font-bold mt-1", 
             data?.decision === "LONG" && "text-emerald-400",
             data?.decision === "SHORT" && "text-red-400",
             data?.decision === "NO_TRADE" && "text-neutral-500"
           )}>
             {data?.decision}
           </span>
        )}
      </div>
    </div>
  );
}
