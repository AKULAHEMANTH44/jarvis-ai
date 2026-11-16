import React from 'react';
import { Activity, ShieldCheck, Sparkles, AlertTriangle, CheckCircle2, Wrench } from 'lucide-react';
import { AISuggestion, PermissionRequest, ToolActivityRecord } from '../../types/assistant';

interface LiveIntelligenceFeedProps {
  suggestions: AISuggestion[];
  recentTools: ToolActivityRecord[];
  pendingPermission: PermissionRequest | null;
  onApprovePermission: (permId: string) => void;
  onDenyPermission: (permId: string) => void;
  onOpenPermissions: () => void;
}

export const LiveIntelligenceFeed: React.FC<LiveIntelligenceFeedProps> = ({
  suggestions,
  recentTools,
  pendingPermission,
  onApprovePermission,
  onDenyPermission,
  onOpenPermissions
}) => {
  return (
    <div className="bg-[#020814]/90 border border-cyan-500/30 rounded-xl p-3.5 flex flex-col space-y-3 shadow-[0_0_20px_rgba(0,240,255,0.1)] max-h-64 overflow-hidden">
      <div className="flex items-center justify-between border-b border-cyan-500/20 pb-2 shrink-0">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          <span className="font-orbitron font-bold text-xs text-white tracking-wider">LIVE INTELLIGENCE FEED</span>
        </div>
        <span className="font-mono text-[10px] text-cyan-400/75">REAL-TIME STREAM</span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 pr-1 font-mono text-[11px] no-scrollbar">
        {pendingPermission && (
          <div className="p-2.5 rounded-lg border border-amber-400/60 bg-amber-950/40 text-amber-100 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-orbitron font-bold text-[10px] text-amber-300">PERMISSION REQUEST</span>
              <span className="text-[9px] uppercase">{pendingPermission.category}</span>
            </div>
            <p className="text-[11px] leading-snug">{pendingPermission.reason}</p>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => onApprovePermission(pendingPermission.id)}
                className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-orbitron text-[9px] font-bold"
              >
                APPROVE ONCE
              </button>
              <button
                type="button"
                onClick={() => onDenyPermission(pendingPermission.id)}
                className="px-2.5 py-1 rounded bg-red-950/60 hover:bg-red-900 border border-red-500/40 text-red-200 font-orbitron text-[9px]"
              >
                DENY
              </button>
            </div>
          </div>
        )}

        {suggestions[0] && (
          <div className="p-2.5 rounded-lg border border-cyan-400/40 bg-cyan-950/30 text-cyan-200 space-y-1">
            <div className="flex items-center gap-1.5 font-orbitron text-[10px] font-bold text-white">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span className="truncate">{suggestions[0].title}</span>
            </div>
            <p className="text-[10px] text-cyan-100/80 leading-snug">{suggestions[0].explanation}</p>
          </div>
        )}

        {recentTools.slice(0, 4).map((rec) => (
          <div key={rec.id} className="p-2 rounded bg-black/40 border border-cyan-500/20 flex items-start gap-2">
            <Wrench className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between text-[9px] text-cyan-400/70">
                <span className="font-orbitron font-semibold">{rec.toolName}</span>
                <span>{new Date(rec.timestamp).toLocaleTimeString()}</span>
              </div>
              <p className="text-[10px] text-white truncate">{rec.summary}</p>
            </div>
          </div>
        ))}

        {recentTools.length === 0 && !suggestions[0] && !pendingPermission && (
          <div className="text-center py-6 text-cyan-400/50 text-[11px] font-mono">
            No active tool executions or pending requests. Systems nominal.
          </div>
        )}
      </div>
    </div>
  );
};
