import React from 'react';
import {
  LayoutDashboard,
  Monitor,
  Cpu,
  Bot,
  ListTodo,
  Calendar,
  Database,
  MessageSquare,
  BookOpen,
  Wrench,
  Workflow,
  Mic,
  Eye,
  Shield,
  Camera,
  Hand,
  Code2,
  Activity
} from 'lucide-react';
import { audioService } from '../../services/soundFx';

export type CommandCenterNavId =
  | 'DASHBOARD'
  | 'DESKTOP'
  | 'DEV_STUDIO'
  | 'SYSTEM_HEALTH'
  | 'OPTICAL'
  | 'AI_CORE'
  | 'AGENTS'
  | 'TASKS'
  | 'CALENDAR'
  | 'MEMORY'
  | 'CONVERSATIONS'
  | 'KNOWLEDGE'
  | 'TOOLS'
  | 'PERMISSIONS'
  | 'WORKFLOWS'
  | 'VOICE'
  | 'FOCUS';

interface CommandSidebarProps {
  activeNav: CommandCenterNavId;
  onSelectNav: (nav: CommandCenterNavId) => void;
  isCameraActive?: boolean;
  onToggleCamera?: () => void;
  isVoiceActive: boolean;
  isFocusMode: boolean;
  onToggleVoice: () => void;
  onToggleFocus: () => void;
  pendingPermissionCount: number;
}

const NAV_ITEMS: { id: CommandCenterNavId; label: string; icon: React.ReactNode; badge?: number }[] = [
  { id: 'DASHBOARD', label: 'Command Center', icon: <LayoutDashboard className="w-4 h-4" /> },
  { id: 'DESKTOP', label: 'Desktop Control', icon: <Monitor className="w-4 h-4" /> },
  { id: 'DEV_STUDIO', label: 'AI Dev Studio', icon: <Code2 className="w-4 h-4" /> },
  { id: 'SYSTEM_HEALTH', label: 'System Health', icon: <Activity className="w-4 h-4" /> },
  { id: 'OPTICAL', label: 'Optics & Gestures', icon: <Hand className="w-4 h-4" /> },
  { id: 'AI_CORE', label: 'AI Core', icon: <Cpu className="w-4 h-4" /> },
  { id: 'AGENTS', label: 'Agents', icon: <Bot className="w-4 h-4" /> },
  { id: 'TASKS', label: 'Tasks', icon: <ListTodo className="w-4 h-4" /> },
  { id: 'CALENDAR', label: 'Calendar', icon: <Calendar className="w-4 h-4" /> },
  { id: 'MEMORY', label: 'Memory', icon: <Database className="w-4 h-4" /> },
  { id: 'CONVERSATIONS', label: 'Conversations', icon: <MessageSquare className="w-4 h-4" /> },
  { id: 'KNOWLEDGE', label: 'Knowledge Base', icon: <BookOpen className="w-4 h-4" /> },
  { id: 'TOOLS', label: 'Tools & Skills', icon: <Wrench className="w-4 h-4" /> },
  { id: 'PERMISSIONS', label: 'Permissions', icon: <Shield className="w-4 h-4" /> },
  { id: 'WORKFLOWS', label: 'Workflows', icon: <Workflow className="w-4 h-4" /> }
];

export const CommandSidebar: React.FC<CommandSidebarProps> = ({
  activeNav,
  onSelectNav,
  isCameraActive = false,
  onToggleCamera,
  isVoiceActive,
  isFocusMode,
  onToggleVoice,
  onToggleFocus,
  pendingPermissionCount
}) => {
  return (
    <aside
      aria-label="Command Center Sidebar"
      className="w-16 md:w-56 lg:w-64 bg-[#02060e]/95 border-r border-cyan-500/25 flex flex-col shrink-0 select-none z-30 transition-all duration-200"
    >
      {/* Brand Header */}
      <div className="h-14 px-3 md:px-4 flex items-center justify-center md:justify-start gap-3 border-b border-cyan-500/20 bg-black/40">
        <img src="/jarvis-arc.svg" alt="Arc Reactor" className="w-6 h-6 shrink-0" />
        <div className="hidden md:flex flex-col min-w-0">
          <span className="font-orbitron font-extrabold text-sm tracking-[0.18em] text-white truncate">
            J.A.R.V.I.S.
          </span>
          <span className="font-mono text-[9px] text-cyan-400/75 tracking-widest truncate">
            MARK VII COMMAND
          </span>
        </div>
      </div>

      {/* Navigation List */}
      <nav className="flex-1 overflow-y-auto px-2 md:px-3 py-3 space-y-1 no-scrollbar" aria-label="Command Navigation">
        {NAV_ITEMS.map((item) => {
          const isActive = activeNav === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              aria-label={item.label}
              title={item.label}
              onClick={() => {
                audioService.playChirp(1300);
                onSelectNav(item.id);
              }}
              className={`w-full flex items-center justify-center md:justify-between px-2 md:px-3 py-2 rounded-lg font-orbitron text-xs tracking-wider transition-all duration-150 ${
                isActive
                  ? 'bg-cyan-500/20 border border-cyan-400 text-white shadow-[0_0_16px_rgba(0,240,255,0.25)] font-bold'
                  : 'text-cyan-300/75 hover:text-white hover:bg-cyan-500/10 border border-transparent'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className={isActive ? 'text-cyan-400' : 'text-cyan-400/70'}>{item.icon}</span>
                <span className="hidden md:inline truncate">{item.label}</span>
              </div>
              {item.id === 'PERMISSIONS' && pendingPermissionCount > 0 && (
                <span className="hidden md:inline px-1.5 py-0.5 rounded bg-amber-500/25 border border-amber-400/50 text-amber-200 text-[9px] font-mono tabular-nums">
                  {pendingPermissionCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer Utilities */}
      <div className="p-2 md:p-3 border-t border-cyan-500/20 bg-black/50 space-y-2">
        {onToggleCamera && (
          <button
            type="button"
            aria-label={isCameraActive ? 'Deactivate Optical Sensor' : 'Activate Optical Sensor'}
            title="Optical Sensor"
            onClick={() => {
              audioService.playChirp(isCameraActive ? 800 : 1500);
              onToggleCamera();
            }}
            className={`w-full flex items-center justify-center md:justify-between px-2 md:px-3 py-2 rounded-lg font-orbitron text-xs tracking-wider border transition-colors ${
              isCameraActive
                ? 'bg-emerald-950/50 border-emerald-400 text-emerald-200 font-bold'
                : 'bg-cyan-950/30 border-cyan-500/30 text-cyan-300 hover:text-white'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Camera className="w-4 h-4 shrink-0" />
              <span className="hidden md:inline">Optical Sensor</span>
            </div>
            <span className="hidden md:inline font-mono text-[10px]">
              {isCameraActive ? 'ACTIVE' : 'OFFLINE'}
            </span>
          </button>
        )}

        <button
          type="button"
          aria-label={isVoiceActive ? 'Disable Voice Recognition' : 'Enable Voice Recognition'}
          title="Voice Status"
          onClick={() => {
            audioService.playChirp(1200);
            onToggleVoice();
          }}
          className={`w-full flex items-center justify-center md:justify-between px-2 md:px-3 py-2 rounded-lg font-orbitron text-xs tracking-wider border transition-colors ${
            isVoiceActive
              ? 'bg-emerald-950/50 border-emerald-400 text-emerald-200 font-bold'
              : 'bg-cyan-950/30 border-cyan-500/30 text-cyan-300 hover:text-white'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <Mic className="w-4 h-4 shrink-0" />
            <span className="hidden md:inline">Voice Status</span>
          </div>
          <span className="hidden md:inline font-mono text-[10px]">
            {isVoiceActive ? 'ACTIVE' : 'STANDBY'}
          </span>
        </button>

        <button
          type="button"
          aria-label={isFocusMode ? 'Exit Focus Mode' : 'Enter Focus Mode'}
          title="Focus Mode"
          onClick={() => {
            audioService.playChirp(1400);
            onToggleFocus();
          }}
          className={`w-full flex items-center justify-center md:justify-between px-2 md:px-3 py-2 rounded-lg font-orbitron text-xs tracking-wider border transition-colors ${
            isFocusMode
              ? 'bg-cyan-500/30 border-cyan-300 text-white font-bold'
              : 'bg-cyan-950/30 border-cyan-500/30 text-cyan-300 hover:text-white'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <Eye className="w-4 h-4 shrink-0" />
            <span className="hidden md:inline">Focus Mode</span>
          </div>
          <span className="hidden md:inline font-mono text-[10px]">
            {isFocusMode ? 'ON' : 'OFF'}
          </span>
        </button>
      </div>
    </aside>
  );
};
