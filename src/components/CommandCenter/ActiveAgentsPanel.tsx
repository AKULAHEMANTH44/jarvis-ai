import React from 'react';
import { Bot } from 'lucide-react';
import { AgentRole, AgentRunSnapshot, IntelligenceStatus } from '../../types/assistant';

interface ActiveAgentsPanelProps {
  isVoiceActive: boolean;
  isCameraActive: boolean;
  hasProviderKey: boolean;
  intelligenceStatus?: IntelligenceStatus;
  activeAgentRun?: AgentRunSnapshot | null;
}

export const ActiveAgentsPanel: React.FC<ActiveAgentsPanelProps> = ({
  isVoiceActive,
  isCameraActive,
  hasProviderKey,
  intelligenceStatus = 'STANDBY',
  activeAgentRun = null
}) => {
  const agents: {
    name: string;
    role: string;
    agentRole?: AgentRole;
    ready: boolean;
  }[] = [
    { name: 'Coding Agent', role: 'Code Analysis & Verification', agentRole: 'CODING', ready: true },
    { name: 'Research Agent', role: 'Grounded Synthesis & Recall', agentRole: 'RESEARCH', ready: true },
    { name: 'Analysis Agent', role: 'Multimodal & Workspace Audit', agentRole: 'ANALYSIS', ready: true },
    { name: 'Memory Agent', role: 'User-Controlled Persistent Memory', ready: true },
    { name: 'Workflow Agent', role: 'Dependency-Aware Multi-Step Plans', agentRole: 'WORKFLOW', ready: true },
    { name: 'System Agent', role: 'Optical Tracking & Audio Synthesis', ready: isVoiceActive || isCameraActive }
  ];

  const activeCount = agents.filter((a) => a.ready).length;

  return (
    <div className="bg-[#020814]/90 border border-cyan-500/30 rounded-xl p-3.5 flex flex-col space-y-3 shadow-[0_0_20px_rgba(0,240,255,0.1)]">
      <div className="flex items-center justify-between border-b border-cyan-500/20 pb-2">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-cyan-400" />
          <span className="font-orbitron font-bold text-xs text-white tracking-wider">ACTIVE AGENTS</span>
        </div>
        <span className="font-mono text-[10px] text-cyan-400/75 tabular-nums">
          {activeAgentRun
            ? `RUNNING · ${activeAgentRun.role}`
            : `${activeCount}/${agents.length} READY · ${intelligenceStatus}`}
        </span>
      </div>

      {activeAgentRun && (
        <div className="p-2 rounded bg-amber-950/35 border border-amber-400/50 space-y-1">
          <div className="flex items-center justify-between text-[10px] font-orbitron text-amber-200">
            <span>{activeAgentRun.title}</span>
            <span className="tabular-nums">{activeAgentRun.progressPercent}%</span>
          </div>
          <p className="text-[10px] font-mono text-cyan-100 truncate">{activeAgentRun.currentStep}</p>
        </div>
      )}

      <div className="space-y-2 font-mono text-[11px]">
        {agents.map((agent) => {
          const isRunningNow = Boolean(activeAgentRun && agent.agentRole === activeAgentRun.role);
          const dotClass = isRunningNow
            ? 'bg-amber-400 animate-pulse'
            : agent.ready
            ? 'bg-emerald-400'
            : 'bg-cyan-600/50';
          const badgeClass = isRunningNow
            ? 'bg-amber-950/60 text-amber-200 border border-amber-400/60'
            : agent.ready
            ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/40'
            : 'bg-cyan-950/40 text-cyan-400/60 border border-cyan-500/20';
          const badgeLabel = isRunningNow
            ? `RUNNING ${activeAgentRun!.progressPercent}%`
            : agent.ready
            ? hasProviderKey || agent.name === 'System Agent'
              ? 'READY'
              : 'LOCAL'
            : 'STANDBY';

          return (
            <div key={agent.name} className="p-2 rounded bg-black/40 border border-cyan-500/25 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`} />
                <div className="flex flex-col min-w-0">
                  <span className="font-orbitron font-semibold text-white text-[10px] truncate">{agent.name}</span>
                  <span className="text-[9px] text-cyan-300/70 truncate">
                    {isRunningNow ? activeAgentRun!.currentStep : agent.role}
                  </span>
                </div>
              </div>
              <span className={`px-1.5 py-0.5 rounded text-[9px] shrink-0 tabular-nums ${badgeClass}`}>
                {badgeLabel}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
