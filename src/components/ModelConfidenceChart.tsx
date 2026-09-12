import React, { useMemo } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';

interface ModelConfidenceChartProps {
  scanResult: any;
}

export default function ModelConfidenceChart({ scanResult }: ModelConfidenceChartProps) {
  const data = useMemo(() => {
    if (!scanResult || !scanResult.models) return [];
    const chartData: any[] = [];
    
    for (const [provider, roles] of Object.entries(scanResult.models)) {
      let count = 0;
      let totalConfidence = 0;
      let longVotes = 0;
      let shortVotes = 0;
      let noTradeVotes = 0;

      for (const items of Object.values(roles as any)) {
        for (const item of (items as any[])) {
           if (item.res && item.res.decision && !["ERROR", "TIMEOUT", "MODEL_NOT_FOUND"].includes(item.res.decision)) {
             count++;
             totalConfidence += (item.res.confidence || 0);
             if (item.res.decision === "LONG") longVotes++;
             else if (item.res.decision === "SHORT") shortVotes++;
             else noTradeVotes++;
           }
        }
      }
      
      if (count > 0) {
        chartData.push({
          provider,
          avgConfidence: Math.round(totalConfidence / count),
          longVotes,
          shortVotes,
          noTradeVotes
        });
      }
    }
    
    return chartData;
  }, [scanResult]);

  if (!data || data.length === 0) {
    return <div className="text-xs text-neutral-500 py-4 text-center border border-dashed border-neutral-800 rounded-lg">No model data available for charting.</div>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
      <div className="h-64">
        <h3 className="text-[10px] font-semibold text-neutral-500 mb-4 uppercase tracking-wider">Vote Distribution by Provider</h3>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }} barSize={30}>
            <CartesianGrid strokeDasharray="3 3" stroke="#262626" vertical={false} />
            <XAxis dataKey="provider" stroke="#737373" fontSize={10} tickLine={false} axisLine={false} />
            <YAxis stroke="#737373" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip 
              cursor={{ fill: '#262626', opacity: 0.4 }}
              contentStyle={{ backgroundColor: '#171717', borderColor: '#262626', color: '#e5e5e5', fontSize: '12px', borderRadius: '8px' }} 
              itemStyle={{ fontSize: '12px' }}
            />
            <Legend wrapperStyle={{ fontSize: '10px', color: '#a3a3a3' }} iconType="circle" />
            <Bar dataKey="longVotes" name="LONG" fill="#10b981" stackId="a" />
            <Bar dataKey="shortVotes" name="SHORT" fill="#ef4444" stackId="a" />
            <Bar dataKey="noTradeVotes" name="NO TRADE" fill="#737373" stackId="a" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="h-64">
        <h3 className="text-[10px] font-semibold text-neutral-500 mb-4 uppercase tracking-wider">Average Confidence by Provider</h3>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#262626" vertical={false} />
            <XAxis dataKey="provider" stroke="#737373" fontSize={10} tickLine={false} axisLine={false} />
            <YAxis stroke="#737373" fontSize={10} tickLine={false} axisLine={false} domain={[0, 100]} />
            <Tooltip 
              contentStyle={{ backgroundColor: '#171717', borderColor: '#262626', color: '#e5e5e5', fontSize: '12px', borderRadius: '8px' }} 
              itemStyle={{ fontSize: '12px' }}
              formatter={(val: number) => [`${val}%`, 'Confidence']}
            />
            <Line type="monotone" dataKey="avgConfidence" name="Confidence" stroke="#8b5cf6" strokeWidth={3} dot={{ r: 4, fill: '#8b5cf6', strokeWidth: 0 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
