import React from 'react';
import { Database, MessageSquare, Wrench } from 'lucide-react';
import { memoryManager } from '../../services/memoryManager';
import { conversationManager } from '../../services/conversationManager';

interface MemoryInsightsPanelProps {
  memoryCount: number;
  onOpenMemory: () => void;
}

export const MemoryInsightsPanel: React.FC<MemoryInsightsPanelProps> = ({
  memoryCount,
  onOpenMemory
}) => {
  const sessionCount = conversationManager.listSessions().length;

  return (
    <div className="bg-[#020814]/90 border border-cyan-500/30 rounded-xl p-3 flex flex-col space-y-2.5 shadow-[0_0_20px_rgba(0,240,255,0.1)]">
      <div className="flex items-center justify-between border-b border-cyan-500/20 pb-1.5">
        <div className="flex items-center gap-1.5">
          <Database className="w-3.5 h-3.5 text-cyan-400" />
          <span className="font-orbitron font-bold text-[11px] text-white tracking-wider">MEMORY INSIGHTS</span>
        </div>
        <button
          type="button"
          onClick={onOpenMemory}
          className="text-[9px] font-mono text-cyan-300 hover:text-white"
        >
          Manage
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 font-mono text-[10px]">
        <div className="p-2 rounded bg-black/40 border border-cyan-500/20">
          <span className="text-cyan-400/60 block text-[8px] font-orbitron">SAVED MEMORIES</span>
          <span className="text-white font-semibold tabular-nums">{memoryCount} entries</span>
        </div>
        <div className="p-2 rounded bg-black/40 border border-cyan-500/20">
          <span className="text-cyan-400/60 block text-[8px] font-orbitron">CONVERSATIONS</span>
          <span className="text-white font-semibold tabular-nums">{sessionCount} sessions</span>
        </div>
      </div>
    </div>
  );
};
