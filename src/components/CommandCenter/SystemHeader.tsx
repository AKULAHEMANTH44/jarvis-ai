import React, { useState, useEffect } from 'react';
import { Search, Bell, Settings, ShieldCheck, User, Volume2, VolumeX, Maximize2, Minimize2 } from 'lucide-react';
import { audioService } from '../../services/soundFx';
import { IntelligenceStatus } from '../../types/assistant';

interface SystemHeaderProps {
  fps: number;
  intelligenceStatus: IntelligenceStatus;
  pendingPermissionCount: number;
  onOpenAIConfig: () => void;
  onOpenPermissions: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}

export const SystemHeader: React.FC<SystemHeaderProps> = ({
  fps,
  intelligenceStatus,
  pendingPermissionCount,
  onOpenAIConfig,
  onOpenPermissions,
  searchQuery,
  onSearchChange
}) => {
  const [timeStr, setTimeStr] = useState<string>(() => new Date().toLocaleTimeString());
  const [dateStr, setDateStr] = useState<string>(() =>
    new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  );
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeStr(new Date().toLocaleTimeString());
    }, 1000);
    const syncFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', syncFs);
    return () => {
      clearInterval(timer);
      document.removeEventListener('fullscreenchange', syncFs);
    };
  }, []);

  const toggleMute = () => {
    const muted = audioService.toggleMute();
    setIsMuted(muted);
    if (!muted) audioService.playChirp(1400);
  };

  const toggleFullscreen = () => {
    audioService.playChirp(1200);
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };

  return (
    <header className="h-14 px-4 bg-[#02060e]/90 border-b border-cyan-500/25 flex items-center justify-between gap-4 select-none z-20 shrink-0">
      {/* System Status & DateTime */}
      <div className="flex items-center gap-4 min-w-0">
        <div className="flex items-center gap-2 px-2.5 py-1 rounded bg-cyan-950/40 border border-cyan-500/30 text-cyan-200 text-xs font-mono">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-orbitron font-bold tracking-wider">SYSTEM NOMINAL</span>
          <span className="text-cyan-500/40" aria-hidden="true">·</span>
          <span className="tabular-nums">{fps} FPS</span>
        </div>

        <div className="hidden md:flex items-center gap-2 text-xs font-mono text-cyan-300/80">
          <span className="tabular-nums">{dateStr}</span>
          <span className="text-cyan-500/40" aria-hidden="true">·</span>
          <span className="tabular-nums text-white font-semibold">{timeStr}</span>
        </div>
      </div>

      {/* Global Search */}
      <div className="flex-1 max-w-md hidden lg:flex items-center relative">
        <Search className="w-3.5 h-3.5 text-cyan-400/60 absolute left-3 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search commands, agents, memory, files..."
          className="w-full bg-black/60 border border-cyan-500/30 rounded-lg pl-9 pr-3 py-1.5 text-xs font-mono text-white placeholder-cyan-500/50 focus:outline-none focus:border-cyan-400"
        />
      </div>

      {/* Utilities & Operator Profile */}
      <div className="flex items-center gap-2.5">
        {/* Notifications / Permissions */}
        <button
          type="button"
          onClick={() => {
            audioService.playChirp(1300);
            onOpenPermissions();
          }}
          title="Permissions & Notifications"
          className="relative p-2 rounded-lg border border-cyan-500/30 bg-black/50 text-cyan-300 hover:text-white hover:border-cyan-400 transition-colors"
        >
          <Bell className="w-3.5 h-3.5" />
          {pendingPermissionCount > 0 && (
            <span className="absolute -top-1 -right-1 px-1.5 py-0.2 rounded-full bg-amber-500 text-black text-[9px] font-mono font-bold tabular-nums">
              {pendingPermissionCount}
            </span>
          )}
        </button>

        {/* Settings */}
        <button
          type="button"
          onClick={() => {
            audioService.playChirp(1300);
            onOpenAIConfig();
          }}
          title="AI Provider Settings"
          className="p-2 rounded-lg border border-cyan-500/30 bg-black/50 text-cyan-300 hover:text-white hover:border-cyan-400 transition-colors"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>

        {/* Audio Mute */}
        <button
          type="button"
          onClick={toggleMute}
          title={isMuted ? 'Unmute Sound' : 'Mute Sound'}
          className={`p-2 rounded-lg border transition-colors ${
            isMuted
              ? 'border-red-500/50 text-red-400 bg-red-950/40'
              : 'border-cyan-500/30 bg-black/50 text-cyan-300 hover:text-white'
          }`}
        >
          {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
        </button>

        {/* Fullscreen */}
        <button
          type="button"
          onClick={toggleFullscreen}
          title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
          className="hidden sm:flex p-2 rounded-lg border border-cyan-500/30 bg-black/50 text-cyan-300 hover:text-white transition-colors"
        >
          {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>

        {/* Operator Profile */}
        <div className="flex items-center gap-2 pl-3 border-l border-cyan-500/25">
          <div className="w-7 h-7 rounded-lg bg-cyan-500/20 border border-cyan-400/50 flex items-center justify-center text-cyan-200">
            <User className="w-3.5 h-3.5" />
          </div>
          <div className="hidden xl:flex flex-col">
            <span className="font-orbitron font-bold text-[10px] text-white">STARK, T.</span>
            <span className="font-mono text-[9px] text-cyan-400/70">OPERATOR MK-7</span>
          </div>
        </div>
      </div>
    </header>
  );
};
