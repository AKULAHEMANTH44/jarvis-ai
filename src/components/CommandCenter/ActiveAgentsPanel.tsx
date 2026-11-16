import React from 'react';
import { Bot, CheckCircle2, Circle, Shield } from 'lucide-react';

interface ActiveAgentsPanelProps {
  isVoiceActive: boolean;
  isCameraActive: boolean;
  hasProviderKey: boolean;
}

export const ActiveAgentsPanel: React.FC<ActiveAgentsPanelProps> = ({
  isVoiceActive,
  isCameraActive,
  hasProviderKey
}) => {
  const agents = [
    { name: 'Coding Agent', role: 'Full-Stack Code Analysis & Execution', active: true },
    { name: 'Research Agent', role: 'Web Search & Knowledge Retrieval', active: true },
    { name: 'Memory Agent', role: 'User-Controlled Persistent Memory', active: true },
    { name: 'Browser Agent', role: 'External Navigation & URL Security', active: true },
    { name: 'Task Agent', role: 'Autonomous Multi-Step Workflows', active: true },
    { name: 'System Agent', role: 'Optical Tracking & Audio Synthesis', active: isVoiceActive || isCameraActive }
  ];

  return (
    <div className="bg-[#020814]/90 border border-cyan-500/30 rounded-xl p-3.5 flex flex-col space-y-3 shadow-[0_0_20px_rgba(0,240,255,0.1)]">
      <div className="flex items-center justify-between border-b border-cyan-500/20 pb-2">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-cyan-400" />
          <span className="font-orbitron font-bold text-xs text-white tracking-wider">ACTIVE AGENTS</span>
        </div>
        <span className="font-mono text-[10px] text-cyan-400/75">{agents.filter(a => a.active).length}/6 ACTIVE</span>
      </div>

      <div className="space-y-2 font-mono text-[11px]">
        {agents.map((agent) => (
          <div key={agent.name} className="p-2 rounded bg-black/40 border border-cyan-500/25 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className={`w-2 h-2 rounded-full shrink-0 ${agent.active ? 'bg-emerald-400 animate-pulse' : 'bg-cyan-600/50'}`} />
              <div className="flex flex-col min-w-0">
                <span className="font-orbitron font-semibold text-white text-[10px] truncate">{agent.name}</span>
                <span className="text-[9px] text-cyan-300/70 truncate">{agent.role}</span>
              </div>
            </div>
            <span className={`px-1.5 py-0.5 rounded text-[9px] shrink-0 ${agent.active ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/40' : 'bg-cyan-950/40 text-cyan-400/60 border border-cyan-500/20'}`}>
              {agent.active ? 'ONLINE' : 'STANDBY'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
