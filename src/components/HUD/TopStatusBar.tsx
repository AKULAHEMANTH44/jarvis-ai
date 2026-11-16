import React, { useState, useEffect } from 'react';
import { audioService } from '../../services/soundFx';
import { HudDrawerId } from '../../utils/hudState';
import { IntelligenceStatus } from '../../types/assistant';
import {
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  Eye,
  X
} from 'lucide-react';

interface TopStatusBarProps {
  fps: number;
  coreState?: string;
  isCameraActive: boolean;
  isVoiceActive: boolean;
  activeDrawer: HudDrawerId | null;
  isFocusMode: boolean;
  intelligenceStatus?: IntelligenceStatus;
  activeSuggestionCount?: number;
  onSelectVisionHome: () => void;
  onSelectDrawer: (drawer: HudDrawerId) => void;
  onToggleFocusMode: () => void;
}

const NAV_ITEMS: { id: 'VISION' | HudDrawerId; label: string }[] = [
  { id: 'VISION', label: 'VISION' },
  { id: 'MODELS', label: 'MODELS' },
  { id: 'TELEMETRY', label: 'TELEMETRY' },
  { id: 'GESTURE', label: 'GESTURE' },
  { id: 'TASKS', label: 'TASKS' },
  { id: 'BRAIN', label: 'BRAIN' },
  { id: 'CONFIG', label: 'CONFIG' }
];

export const TopStatusBar: React.FC<TopStatusBarProps> = ({
  fps,
  coreState = 'ACTIVE',
  isCameraActive,
  isVoiceActive,
  activeDrawer,
  isFocusMode,
  intelligenceStatus = 'STANDBY',
  activeSuggestionCount = 0,
  onSelectVisionHome,
  onSelectDrawer,
  onToggleFocusMode
}) => {
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  useEffect(() => {
    const syncFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', syncFs);
    return () => document.removeEventListener('fullscreenchange', syncFs);
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

  if (isFocusMode) {
    return (
      <header
        data-testid="focus-top-bar"
        className="fixed top-3 inset-x-4 z-30 pointer-events-none flex items-center justify-between gap-4 select-none"
      >
        <div className="pointer-events-auto flex items-center gap-3 px-3 py-1.5 rounded-lg bg-[#020812]/75 border border-cyan-500/25 text-xs">
          <img src="/jarvis-arc.svg" alt="Arc Reactor" className="w-4 h-4 shrink-0" />
          <span className="font-orbitron font-bold tracking-[0.18em] text-white whitespace-nowrap">
            J.A.R.V.I.S.
          </span>
          <span className="text-cyan-500/40" aria-hidden="true">·</span>
          <span className="font-mono text-[11px] text-cyan-200 whitespace-nowrap tabular-nums">
            CORE: {coreState}
          </span>
          <span className="hidden sm:inline text-cyan-500/40" aria-hidden="true">·</span>
          <span className="hidden sm:inline font-mono text-[11px] text-cyan-300/80 whitespace-nowrap tabular-nums">
            {fps || 60} FPS
          </span>
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          <button
            type="button"
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
            aria-label={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
            className="p-2 rounded-lg border border-cyan-500/30 bg-[#020812]/80 text-cyan-300 hover:text-white hover:border-cyan-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 transition-colors"
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>

          <button
            type="button"
            onClick={() => {
              audioService.playChirp(1300);
              onToggleFocusMode();
            }}
            data-testid="exit-focus-btn"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cyan-400/60 bg-[#020812]/85 hover:bg-cyan-500/20 text-white font-orbitron text-[10px] tracking-wider whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 transition-colors"
          >
            <X className="w-3.5 h-3.5 text-cyan-300" />
            <span>EXIT FOCUS</span>
          </button>
        </div>
      </header>
    );
  }

  return (
    <header className="relative z-30 flex items-center justify-between gap-2 sm:gap-4 px-2.5 sm:px-5 h-11 bg-[#020812]/80 border-b border-cyan-500/20 text-cyan-400 select-none">
      {/* Zone 1: J.A.R.V.I.S. Identity & Compact Telemetry Readout */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0 shrink-0">
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <img src="/jarvis-arc.svg" alt="Arc Reactor" className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" />
          <span className="font-orbitron font-extrabold text-xs sm:text-sm tracking-[0.1em] sm:tracking-[0.18em] text-white whitespace-nowrap shrink-0">
            J.A.R.V.I.S.
          </span>
        </div>

        <div className="hidden lg:flex items-center gap-2.5 pl-3 border-l border-cyan-500/25 text-[10px] font-mono whitespace-nowrap">
          <span
            data-testid="core-state-readout"
            className={`font-semibold tabular-nums ${
              coreState.includes('DISINTEGRATED') || coreState.includes('FROZEN') || coreState.includes('LOST')
                ? 'text-amber-300'
                : coreState.includes('LISTENING') || coreState.includes('SPEAKING') || coreState.includes('RECONSTRUCT')
                ? 'text-emerald-400'
                : 'text-cyan-200'
            }`}
          >
            CORE {coreState}
          </span>
          <span className="text-cyan-500/35" aria-hidden="true">·</span>
          <span className="text-cyan-300/80 tabular-nums">{fps || 60} FPS</span>
          <span className="text-cyan-500/35" aria-hidden="true">·</span>
          <button
            type="button"
            onClick={() => {
              audioService.playChirp(1200);
              onSelectDrawer('GESTURE');
            }}
            title="Camera Optical Sensor Status (Click to open Gesture Drawer)"
            className={`hover:text-white transition-colors ${
              isCameraActive ? 'text-emerald-400 font-semibold' : 'text-cyan-400/70'
            }`}
          >
            CAM {isCameraActive ? 'ON' : 'OFF'}
          </button>
          <span className="text-cyan-500/35" aria-hidden="true">·</span>
          <button
            type="button"
            onClick={() => {
              audioService.playChirp(1200);
              onSelectDrawer('VOICE');
            }}
            title="Voice Recognition Status (Click to open Vocal Console)"
            className={`hover:text-white transition-colors ${
              isVoiceActive ? 'text-emerald-400 font-semibold' : 'text-cyan-400/70'
            }`}
          >
            VOICE {isVoiceActive ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {/* Zone 2: Single-Line Contextual Navigation */}
      <nav
        aria-label="JARVIS Primary Navigation"
        className="flex items-center gap-0.5 sm:gap-2 overflow-x-auto no-scrollbar py-1 min-w-0"
      >
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.id === 'VISION'
              ? activeDrawer === null
              : activeDrawer === item.id || (item.id === 'MODELS' && activeDrawer === 'LAB');
          const showBrainBadge =
            item.id === 'BRAIN' &&
            (activeSuggestionCount > 0 ||
              intelligenceStatus === 'AWAITING_APPROVAL' ||
              intelligenceStatus === 'ERROR');

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                audioService.playChirp(1300);
                if (item.id === 'VISION') {
                  onSelectVisionHome();
                } else {
                  onSelectDrawer(item.id);
                }
              }}
              aria-pressed={isActive}
              title={
                item.id === 'BRAIN'
                  ? `AI Intelligence Brain (${intelligenceStatus})`
                  : undefined
              }
              className={`relative flex items-center gap-1 px-1.5 sm:px-2.5 py-1 text-[9px] sm:text-[10px] font-orbitron tracking-wider whitespace-nowrap shrink-0 rounded transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 ${
                isActive
                  ? 'text-white bg-cyan-500/20 border border-cyan-400/70 shadow-[0_0_12px_rgba(0,240,255,0.22)]'
                  : showBrainBadge
                  ? 'text-amber-200 border border-amber-400/40 bg-amber-950/30 hover:text-white'
                  : 'text-cyan-300/75 border border-transparent hover:text-white hover:border-cyan-500/30'
              }`}
            >
              <span>{item.label}</span>
              {item.id === 'BRAIN' && activeSuggestionCount > 0 && (
                <span className="px-1 rounded bg-amber-400/25 text-amber-200 text-[8px] font-mono">
                  {activeSuggestionCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Zone 3: Immersive Focus & System Utilities */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={() => {
            audioService.playChirp(1400);
            onToggleFocusMode();
          }}
          data-testid="top-focus-btn"
          title="Enter Immersive Focus Mode"
          className="flex items-center gap-1 px-2.5 py-1 rounded border border-cyan-400/45 bg-cyan-500/15 hover:bg-cyan-500/30 text-cyan-100 font-orbitron text-[10px] tracking-wider whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 transition-colors"
        >
          <Eye className="w-3 h-3 text-cyan-300" />
          <span className="hidden sm:inline">FOCUS</span>
        </button>

        <button
          type="button"
          onClick={toggleMute}
          title={isMuted ? 'Unmute Sound' : 'Mute Sound'}
          aria-label={isMuted ? 'Unmute Sound' : 'Mute Sound'}
          className={`p-1.5 rounded border transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 ${
            isMuted
              ? 'border-red-500/50 text-red-400 bg-red-950/40'
              : 'border-cyan-500/30 text-cyan-400 hover:text-white hover:bg-cyan-500/15'
          }`}
        >
          {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
        </button>

        <button
          type="button"
          onClick={toggleFullscreen}
          title={isFullscreen ? 'Exit Fullscreen' : 'Toggle Fullscreen'}
          aria-label={isFullscreen ? 'Exit Fullscreen' : 'Toggle Fullscreen'}
          className="hidden sm:inline-flex p-1.5 rounded border border-cyan-500/30 text-cyan-400 hover:text-white hover:bg-cyan-500/15 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 transition-colors"
        >
          {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
      </div>
    </header>
  );
};
