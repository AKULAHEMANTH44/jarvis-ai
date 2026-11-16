import React from 'react';
import { Cpu, Database, Mic, Bot, Shield, Activity, Sparkles } from 'lucide-react';
import { IntelligenceStatus } from '../../types/assistant';

interface AICoreOverviewProps {
  intelligenceStatus: IntelligenceStatus;
  memoryCount: number;
  isVoiceActive: boolean;
  isCameraActive: boolean;
  provider: string;
  hasApiKey: boolean;
  onOpenAIConfig: () => void;
  onOpenMemory: () => void;
}

export const AICoreOverview: React.FC<AICoreOverviewProps> = ({
  intelligenceStatus,
  memoryCount,
  isVoiceActive,
  isCameraActive,
  provider,
  hasApiKey,
  onOpenAIConfig,
  onOpenMemory
}) => {
  return (
    <div className="bg-[#020814]/90 border border-cyan-500/30 rounded-xl p-3.5 flex flex-col space-y-3 shadow-[0_0_20px_rgba(0,240,255,0.1)]">
      <div className="flex items-center justify-between border-b border-cyan-500/20 pb-2">
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-cyan-400" />
          <span className="font-orbitron font-bold text-xs text-white tracking-wider">AI CORE OVERVIEW</span>
        </div>
        <span className="font-mono text-[10px] text-emerald-400 font-semibold">99.8% HEALTH</span>
      </div>

      <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
        <div className="p-2 rounded bg-black/40 border border-cyan-500/20">
          <span className="text-cyan-400/60 block text-[9px] font-orbitron">INTELLIGENCE</span>
          <span className="text-white font-semibold">{intelligenceStatus}</span>
        </div>

        <button
          type="button"
          onClick={onOpenMemory}
          className="p-2 rounded bg-black/40 border border-cyan-500/20 text-left hover:border-cyan-400/50 transition-colors"
        >
          <span className="text-cyan-400/60 block text-[9px] font-orbitron">STORED MEMORY</span>
          <span className="text-white font-semibold tabular-nums">{memoryCount} memories</span>
        </button>

        <div className="p-2 rounded bg-black/40 border border-cyan-500/20">
          <span className="text-cyan-400/60 block text-[9px] font-orbitron">VOICE SENSOR</span>
          <span className={isVoiceActive ? 'text-emerald-400 font-semibold' : 'text-cyan-300'}>
            {isVoiceActive ? 'ACTIVE' : 'STANDBY'}
          </span>
        </div>

        <div className="p-2 rounded bg-black/40 border border-cyan-500/20">
          <span className="text-cyan-400/60 block text-[9px] font-orbitron">OPTICAL TRACKING</span>
          <span className={isCameraActive ? 'text-emerald-400 font-semibold' : 'text-cyan-300'}>
            {isCameraActive ? 'ACTIVE' : 'OFFLINE'}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-cyan-500/20 text-[10px] font-mono">
        <div className="flex items-center gap-1.5 text-cyan-300">
          <Sparkles className="w-3 h-3 text-cyan-400" />
          <span>LLM: {provider} {hasApiKey ? '(Connected)' : '(Local)'}</span>
        </div>
        <button
          type="button"
          onClick={onOpenAIConfig}
          className="px-2 py-0.5 rounded border border-cyan-500/30 text-cyan-200 hover:text-white hover:border-cyan-400 font-orbitron text-[9px]"
        >
          CONFIG
        </button>
      </div>
    </div>
  );
};
