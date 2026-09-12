import React, { useState } from 'react';
import { X, Bell, AlertTriangle, Save, Check } from 'lucide-react';
import clsx from 'clsx';

interface NotificationConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function NotificationConfigModal({ isOpen, onClose }: NotificationConfigModalProps) {
  const [confidenceThreshold, setConfidenceThreshold] = useState(80);
  const [volatilitySpike, setVolatilitySpike] = useState(2.5);
  const [notifyOnNoTrade, setNotifyOnNoTrade] = useState(false);
  const [emailAlerts, setEmailAlerts] = useState(false);
  const [saved, setSaved] = useState(false);

  if (!isOpen) return null;

  const handleSave = () => {
    // In a real app, save to backend/localStorage
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 1000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl w-full max-w-md overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-4 border-b border-neutral-800 bg-neutral-950/50">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-indigo-400" />
            <h2 className="font-semibold text-white">Alert Configurations</h2>
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-6">
          <div>
            <label className="flex items-center justify-between text-sm font-medium text-neutral-300 mb-2">
              High Confidence Threshold
              <span className="text-indigo-400 font-mono">{confidenceThreshold}%</span>
            </label>
            <p className="text-xs text-neutral-500 mb-3">Alert me when a final signal confidence exceeds this value.</p>
            <input 
              type="range" 
              min="50" max="100" 
              value={confidenceThreshold} 
              onChange={(e) => setConfidenceThreshold(Number(e.target.value))}
              className="w-full accent-indigo-500"
            />
          </div>

          <div>
            <label className="flex items-center justify-between text-sm font-medium text-neutral-300 mb-2">
              Volatility Spike Trigger (ATR%)
              <span className="text-amber-400 font-mono">{volatilitySpike.toFixed(1)}%</span>
            </label>
            <p className="text-xs text-neutral-500 mb-3">Alert me when the market experiences sudden rapid movement.</p>
            <input 
              type="range" 
              min="0.5" max="10" step="0.5"
              value={volatilitySpike} 
              onChange={(e) => setVolatilitySpike(Number(e.target.value))}
              className="w-full accent-amber-500"
            />
          </div>

          <div className="space-y-3 pt-2 border-t border-neutral-800">
            <label className="flex items-center gap-3 cursor-pointer group">
              <div className="relative flex items-center justify-center w-5 h-5 border border-neutral-700 rounded bg-neutral-950 group-hover:border-indigo-500 transition-colors">
                <input 
                  type="checkbox" 
                  className="absolute opacity-0 cursor-pointer"
                  checked={notifyOnNoTrade}
                  onChange={(e) => setNotifyOnNoTrade(e.target.checked)}
                />
                {notifyOnNoTrade && <Check className="w-3 h-3 text-indigo-500" />}
              </div>
              <span className="text-sm text-neutral-300 select-none">Notify on SYSTEM NO_TRADE errors</span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer group">
              <div className="relative flex items-center justify-center w-5 h-5 border border-neutral-700 rounded bg-neutral-950 group-hover:border-indigo-500 transition-colors">
                <input 
                  type="checkbox" 
                  className="absolute opacity-0 cursor-pointer"
                  checked={emailAlerts}
                  onChange={(e) => setEmailAlerts(e.target.checked)}
                />
                {emailAlerts && <Check className="w-3 h-3 text-indigo-500" />}
              </div>
              <span className="text-sm text-neutral-300 select-none">Send me Email summaries (Hourly)</span>
            </label>
          </div>
          
          <div className="bg-blue-500/10 border border-blue-500/20 text-blue-400 p-3 rounded-lg flex items-start gap-3">
             <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-blue-400" />
             <p className="text-xs">
               Alerts require the browser window to remain open for push notifications, unless backend webhooks are configured.
             </p>
          </div>
        </div>

        <div className="p-4 border-t border-neutral-800 flex justify-end gap-3 bg-neutral-950/50">
          <button 
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-neutral-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={handleSave}
            className={clsx(
              "flex items-center gap-2 px-5 py-2 text-sm font-medium text-white rounded-lg transition-colors",
              saved ? "bg-emerald-600 hover:bg-emerald-500" : "bg-indigo-600 hover:bg-indigo-500"
            )}
          >
            {saved ? <><Check className="w-4 h-4" /> Saved</> : <><Save className="w-4 h-4" /> Save Settings</>}
          </button>
        </div>
      </div>
    </div>
  );
}
