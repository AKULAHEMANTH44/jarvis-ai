import React, { useState, useEffect } from 'react';
import { InteractionMode } from '../../types/hologram';
import { audioService } from '../../services/soundFx';
import { Volume2, VolumeX, Maximize2, ShieldCheck, Activity, Cpu } from 'lucide-react';

interface TopStatusBarProps {
  mode: InteractionMode;
  fps: number;
  coreState?: string;
  onModeChange: (m: InteractionMode) => void;
}

export const TopStatusBar: React.FC<TopStatusBarProps> = ({
  mode,
  fps,
  coreState = 'IDLE',
  onModeChange
}) => {
  const [time, setTime] = useState<string>('');
  const [date, setDate] = useState<string>('');
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [uptime, setUptime] = useState<number>(0);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      setDate(now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    const uptimeTimer = setInterval(() => setUptime(u => u + 1), 1000);
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
    <header className="relative z-30 flex items-center justify-between px-5 py-2.5 bg-black/60 backdrop-blur-md border-b border-cyan-500/30 text-cyan-400 select-none">
      {/* Left: Stark Brand & JARVIS Mark Identity */}
      <div className="flex items-center space-x-3.5">
        <div className="relative flex items-center justify-center w-8 h-8 rounded-full border border-cyan-400 shadow-[0_0_12px_rgba(0,240,255,0.6)] animate-pulse-slow">
          <img src="/jarvis-arc.svg" alt="Arc Reactor" className="w-5 h-5" />
        </div>
        <div className="flex flex-col">
          <div className="flex items-center space-x-2">
            <span className="font-orbitron font-extrabold text-sm tracking-wider text-white">
              J.A.R.V.I.S.
            </span>
            <span className="text-[10px] bg-cyan-950/80 text-cyan-300 px-1.5 py-0.5 rounded border border-cyan-500/40 font-mono tracking-widest">
              MK-VII
            </span>
          </div>
          <span className="text-[9px] text-cyan-400/70 font-mono tracking-wider">
            STARK INDUSTRIES PROTOCOL // VISION 1.2
          </span>
        </div>
      </div>

      {/* Center: Interaction Mode & Core Activity Telemetry */}
      <div className="hidden md:flex items-center space-x-4 bg-cyan-950/40 border border-cyan-500/30 px-3 py-1 rounded-full">
        <div className="flex items-center space-x-1.5 text-xs font-mono">
          <Activity className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-cyan-400/80">CORE:</span>
          <span
            className={`font-bold ${
              coreState === 'DISINTEGRATED' || coreState === 'OBJECT FROZEN'
                ? 'text-amber-300'
                : coreState === 'LISTENING' || coreState === 'SPEAKING' || coreState === 'RECONSTRUCTING'
                ? 'text-emerald-400'
                : 'text-cyan-200'
            }`}
          >
            {coreState}
          </span>
        </div>
        <div className="h-3 w-[1px] bg-cyan-500/30" />
        <div className="flex items-center space-x-1.5 text-xs font-mono">
          <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-cyan-400/80">CONTAINMENT:</span>
          <span className="text-cyan-300 font-bold">99.8%</span>
        </div>
        <div className="h-3 w-[1px] bg-cyan-500/30" />
        <div className="flex items-center space-x-1.5 text-xs font-mono">
          <Cpu className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-cyan-400/80">FPS:</span>
          <span className="text-cyan-200 font-bold tabular-nums">{fps || 60}</span>
        </div>
        <div className="h-3 w-[1px] bg-cyan-500/30" />
        <button
          onClick={() => onModeChange(mode === 'WORKSPACE' ? 'CINEMATIC' : 'WORKSPACE')}
          title="Cycle Workspace / Cinematic Focus"
          className="flex items-center space-x-1 font-orbitron text-xs hover:opacity-80"
        >
          <span className="text-cyan-400/80">MODE:</span>
          <span className="text-amber-300 font-bold tracking-wider">{mode}</span>
        </button>
      </div>

      {/* Right: Real-time Clock, Uptime & Quick Toggles */}
      <div className="flex items-center space-x-4 font-mono text-xs">
        <div className="hidden sm:flex flex-col items-end">
          <span className="text-white font-bold tracking-wider text-sm">{time}</span>
          <span className="text-[10px] text-cyan-400/70">{date} • T+{formatUptime(uptime)}</span>
        </div>

        {/* Audio Mute */}
        <button
          onClick={toggleMute}
          title={isMuted ? "Unmute Sound" : "Mute Sound"}
          className={`p-1.5 rounded border transition-all ${
            isMuted
              ? 'border-red-500/50 text-red-400 bg-red-950/40'
              : 'border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/20'
          }`}
        >
          {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>

        {/* Fullscreen */}
        <button
          onClick={toggleFullscreen}
          title="Toggle Fullscreen"
          className="p-1.5 rounded border border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/20 transition-all"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
