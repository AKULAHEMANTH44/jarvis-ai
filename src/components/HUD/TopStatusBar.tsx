import React, { useState, useEffect } from 'react';
import { InteractionMode } from '../../types/hologram';
import { audioService } from '../../services/soundFx';
import { Volume2, VolumeX, Maximize2, Activity, Cpu, Eye, EyeOff } from 'lucide-react';

interface TopStatusBarProps {
  mode: InteractionMode;
  fps: number;
  coreState?: string;
  onModeChange: (m: InteractionMode) => void;
  hasOpenDrawers?: boolean;
  onToggleCollapseAll?: () => void;
}

export const TopStatusBar: React.FC<TopStatusBarProps> = ({
  mode,
  fps,
  coreState = 'ACTIVE',
  onModeChange,
  hasOpenDrawers = false,
  onToggleCollapseAll
}) => {
  const [time, setTime] = useState<string>('');
  const [uptime, setUptime] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    const uptimeTimer = setInterval(() => setUptime((u) => u + 1), 1000);
    return () => {
      clearInterval(interval);
      clearInterval(uptimeTimer);
    };
  }, []);

  const formatUptime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const toggleMute = () => {
    const muted = audioService.toggleMute();
    setIsMuted(muted);
    if (!muted) audioService.playChirp(1400);
  };

  const toggleFullscreen = () => {
    audioService.playChirp(1200);
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  return (
    <header className="relative z-30 flex items-center justify-between px-5 py-2 bg-[#020812]/80 border-b border-cyan-500/20 text-cyan-400 select-none">
      {/* Left: Stark Brand & VISION X Identity */}
      <div className="flex items-center space-x-3">
        <div className="flex items-center justify-center w-7 h-7 rounded border border-cyan-400/50 bg-cyan-950/40">
          <img src="/jarvis-arc.svg" alt="Arc Reactor" className="w-4 h-4" />
        </div>
        <div className="flex items-baseline space-x-2">
          <span className="font-orbitron font-extrabold text-sm tracking-[0.18em] text-white">
            J.A.R.V.I.S.
          </span>
          <span className="text-[10px] text-cyan-300/80 font-mono tracking-widest">
            VISION X // MK-VII
          </span>
        </div>
      </div>

      {/* Center: Hairline Telemetry Strip (no pill clutter) */}
      <div className="hidden md:flex items-center space-x-4 px-3 py-0.5 border-x border-cyan-500/25 text-[11px] font-mono">
        <div className="flex items-center space-x-1.5">
          <Activity className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-cyan-400/70">CORE:</span>
          <span
            data-testid="core-state-readout"
            className={`font-bold ${
              coreState.includes('DISINTEGRATED') || coreState.includes('FROZEN') || coreState.includes('LOST')
                ? 'text-amber-300'
                : coreState.includes('LISTENING') || coreState.includes('SPEAKING') || coreState.includes('RECONSTRUCT')
                ? 'text-emerald-400'
                : 'text-cyan-200'
            }`}
          >
            {coreState}
          </span>
        </div>
        <div className="h-3 w-[1px] bg-cyan-500/25" />
        <div className="flex items-center space-x-1.5">
          <Cpu className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-cyan-400/70">FPS:</span>
          <span className="text-cyan-200 font-bold tabular-nums">{fps || 60}</span>
        </div>
        <div className="h-3 w-[1px] bg-cyan-500/25" />
        <button
          onClick={() => onModeChange(mode === 'CINEMATIC' ? 'WORKSPACE' : 'CINEMATIC')}
          title="Toggle Workspace / Cinematic Focus"
          className="flex items-center space-x-1 font-orbitron text-[10px] hover:text-white transition-colors"
        >
          <span className="text-cyan-400/70">MODE:</span>
          <span className="text-amber-300 font-bold tracking-wider">{mode}</span>
        </button>
      </div>

      {/* Right: Real-time Clock, Zen Toggle, Mute & Fullscreen */}
      <div className="flex items-center space-x-2.5 font-mono text-xs">
        <div className="hidden sm:flex items-baseline space-x-2 pr-1">
          <span className="text-white font-bold tracking-wider text-xs tabular-nums">{time}</span>
          <span className="text-[10px] text-cyan-400/60 tabular-nums">T+{formatUptime(uptime)}</span>
        </div>

        {onToggleCollapseAll && (
          <button
            onClick={() => {
              audioService.playChirp(1250);
              onToggleCollapseAll();
            }}
            title={hasOpenDrawers ? 'Collapse All HUD Drawers (Clear Center Focus)' : 'Open Workspace Drawers'}
            className={`flex items-center space-x-1 px-2 py-1 rounded border text-[10px] font-orbitron tracking-wider transition-colors ${
              !hasOpenDrawers
                ? 'border-cyan-400/60 text-cyan-200 bg-cyan-500/15'
                : 'border-cyan-500/35 text-cyan-400 hover:bg-cyan-500/15'
            }`}
          >
            {hasOpenDrawers ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            <span className="hidden lg:inline">{hasOpenDrawers ? 'CLEAR VIEW' : 'PANELS'}</span>
          </button>
        )}

        <button
          onClick={toggleMute}
          title={isMuted ? 'Unmute Sound' : 'Mute Sound'}
          className={`p-1.5 rounded border transition-colors ${
            isMuted
              ? 'border-red-500/50 text-red-400 bg-red-950/40'
              : 'border-cyan-500/35 text-cyan-400 hover:bg-cyan-500/15'
          }`}
        >
          {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
        </button>

        <button
          onClick={toggleFullscreen}
          title="Toggle Fullscreen"
          className="p-1.5 rounded border border-cyan-500/35 text-cyan-400 hover:bg-cyan-500/15 transition-colors"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};
