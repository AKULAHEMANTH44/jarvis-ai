import React from 'react';
import { Sparkles, Calendar, Mic, Wrench, Shield, Box, FileText } from 'lucide-react';
import { audioService } from '../../services/soundFx';

interface QuickCommandsPanelProps {
  onOpenObjectLab: () => void;
  onOpenTasks: () => void;
  onOpenVoiceConsole: () => void;
  onOpenBrain: () => void;
  onTriggerRescan: () => void;
}

export const QuickCommandsPanel: React.FC<QuickCommandsPanelProps> = ({
  onOpenObjectLab,
  onOpenTasks,
  onOpenVoiceConsole,
  onOpenBrain,
  onTriggerRescan
}) => {
  const actions = [
    { label: 'Holographic Object Lab', icon: <Box className="w-4 h-4 text-cyan-400" />, action: onOpenObjectLab },
    { label: 'Task Engine', icon: <Wrench className="w-4 h-4 text-cyan-400" />, action: onOpenTasks },
    { label: 'Vocal Console', icon: <Mic className="w-4 h-4 text-cyan-400" />, action: onOpenVoiceConsole },
    { label: 'AI Intelligence Brain', icon: <Sparkles className="w-4 h-4 text-cyan-400" />, action: onOpenBrain },
    { label: 'Laser Scan Pass', icon: <Shield className="w-4 h-4 text-cyan-400" />, action: onTriggerRescan }
  ];

  return (
    <div className="bg-[#020814]/90 border border-cyan-500/30 rounded-xl p-3.5 flex flex-col space-y-3 shadow-[0_0_20px_rgba(0,240,255,0.1)]">
      <div className="flex items-center justify-between border-b border-cyan-500/20 pb-2">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-cyan-400" />
          <span className="font-orbitron font-bold text-xs text-white tracking-wider">QUICK COMMANDS</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 font-mono text-xs">
        {actions.map((act) => (
          <button
            key={act.label}
            type="button"
            onClick={() => {
              audioService.playChirp(1300);
              act.action();
            }}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-black/40 hover:bg-cyan-500/20 border border-cyan-500/30 hover:border-cyan-400 text-cyan-200 hover:text-white transition-all font-orbitron text-[11px]"
          >
            <div className="flex items-center gap-2.5 truncate">
              {act.icon}
              <span className="truncate">{act.label}</span>
            </div>
            <span className="text-[10px] text-cyan-400/60 font-mono">EXEC</span>
          </button>
        ))}
      </div>
    </div>
  );
};
