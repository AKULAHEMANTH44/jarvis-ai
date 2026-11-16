import React from 'react';
import { Activity, Cpu, HardDrive, Zap } from 'lucide-react';

interface SystemMonitorPanelProps {
  fps: number;
}

export const SystemMonitorPanel: React.FC<SystemMonitorPanelProps> = ({ fps }) => {
  return (
    <div className="bg-[#020814]/90 border border-cyan-500/30 rounded-xl p-3 flex flex-col space-y-2.5 shadow-[0_0_20px_rgba(0,240,255,0.1)]">
      <div className="flex items-center justify-between border-b border-cyan-500/20 pb-1.5">
        <div className="flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-cyan-400" />
          <span className="font-orbitron font-bold text-[11px] text-white tracking-wider">SYSTEM MONITOR</span>
        </div>
        <span className="font-mono text-[9px] text-emerald-400">STABLE</span>
      </div>

      <div className="grid grid-cols-3 gap-2 font-mono text-[10px]">
        <div className="p-2 rounded bg-black/40 border border-cyan-500/20">
          <span className="text-cyan-400/60 block text-[8px] font-orbitron">CPU USAGE</span>
          <span className="text-white font-semibold tabular-nums">18.4%</span>
        </div>
        <div className="p-2 rounded bg-black/40 border border-cyan-500/20">
          <span className="text-cyan-400/60 block text-[8px] font-orbitron">RAM ALLOC</span>
          <span className="text-white font-semibold tabular-nums">4.2 GB</span>
        </div>
        <div className="p-2 rounded bg-black/40 border border-cyan-500/20">
          <span className="text-cyan-400/60 block text-[8px] font-orbitron">RENDER FPS</span>
          <span className="text-white font-semibold tabular-nums">{fps} FPS</span>
        </div>
      </div>
    </div>
  );
};
