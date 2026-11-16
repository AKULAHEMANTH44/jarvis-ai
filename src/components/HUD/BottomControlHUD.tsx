import React, { useState } from 'react';
import { audioService } from '../../services/soundFx';
import { HudDrawerId } from '../../utils/hudState';
import { IntelligenceStatus } from '../../types/assistant';
import {
  Orbit,
  Hand,
  Mic,
  Brain,
  Layers,
  RotateCcw,
  Eye,
  ChevronUp,
  ChevronDown
} from 'lucide-react';

interface BottomControlHUDProps {
  activeDrawer: HudDrawerId | null;
  isFocusMode: boolean;
  isCameraActive: boolean;
  isVoiceActive: boolean;
  intelligenceStatus?: IntelligenceStatus;
  activeSuggestionCount?: number;
  onSelectVisionHome: () => void;
  onSelectDrawer: (drawer: HudDrawerId) => void;
  onResetTransform: () => void;
  onToggleFocusMode: () => void;
}

export const BottomControlHUD: React.FC<BottomControlHUDProps> = ({
  activeDrawer,
  isFocusMode,
  isCameraActive,
  isVoiceActive,
  intelligenceStatus = 'STANDBY',
  activeSuggestionCount = 0,
  onSelectVisionHome,
  onSelectDrawer,
  onResetTransform,
  onToggleFocusMode
}) => {
  const [mobileCollapsed, setMobileCollapsed] = useState<boolean>(false);

  if (isFocusMode) return null;

  const isVisionActive = activeDrawer === null;
  const isGestureActive = activeDrawer === 'GESTURE';
  const isVoiceDrawerActive = activeDrawer === 'VOICE';
  const isBrainActive = activeDrawer === 'BRAIN';
  const isModelsActive = activeDrawer === 'MODELS' || activeDrawer === 'LAB';
  const isBrainAttention =
    intelligenceStatus === 'AWAITING_APPROVAL' ||
    intelligenceStatus === 'ERROR' ||
    activeSuggestionCount > 0;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-1.5 max-w-[95vw] pointer-events-none select-none">
      {/* Mobile-only collapsible trigger */}
      <button
        type="button"
        onClick={() => {
          audioService.playChirp(1200);
          setMobileCollapsed((prev) => !prev);
        }}
        aria-expanded={!mobileCollapsed}
        className="sm:hidden pointer-events-auto flex items-center gap-1 px-3 py-1 rounded-full bg-[#020812]/85 border border-cyan-500/35 text-cyan-200 font-orbitron text-[10px] tracking-wider shadow-[0_0_16px_rgba(0,240,255,0.18)]"
      >
        {mobileCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        <span>{mobileCollapsed ? 'CONTROLS' : 'HIDE'}</span>
      </button>

      {/* Compact Floating Control Strip */}
      <nav
        aria-label="Hologram Quick Controls"
        className={`pointer-events-auto px-2 py-1.5 rounded-xl bg-[#020812]/88 border border-cyan-500/30 shadow-[0_0_24px_rgba(0,240,255,0.15)] transition-all duration-200 ${
          mobileCollapsed ? 'hidden sm:flex sm:items-center sm:gap-1.5' : 'grid grid-cols-4 gap-1 sm:flex sm:items-center sm:gap-1.5'
        }`}
      >
        <button
          type="button"
          onClick={() => {
            audioService.playChirp(1300);
            onSelectVisionHome();
          }}
          title="Clean Vision Hologram View"
          aria-pressed={isVisionActive}
          className={`flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-lg border text-[9px] sm:text-[10px] font-orbitron tracking-wider whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 ${
            isVisionActive
              ? 'border-cyan-400 bg-cyan-500/20 text-white shadow-[0_0_12px_rgba(0,240,255,0.25)]'
              : 'border-transparent text-cyan-300/80 hover:text-white hover:border-cyan-500/30'
          }`}
        >
          <Orbit className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-cyan-300" />
          <span>VISION</span>
        </button>

        <button
          type="button"
          onClick={() => {
            audioService.playChirp(1250);
            onSelectDrawer('GESTURE');
          }}
          data-testid="bottom-gesture-btn"
          title="Optical Sensor & Neural Gesture Controls"
          aria-pressed={isGestureActive}
          className={`flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-lg border text-[9px] sm:text-[10px] font-orbitron tracking-wider whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 ${
            isGestureActive
              ? 'border-cyan-400 bg-cyan-500/20 text-white shadow-[0_0_12px_rgba(0,240,255,0.25)]'
              : isCameraActive
              ? 'border-emerald-400/50 bg-emerald-950/30 text-emerald-200 hover:border-emerald-300'
              : 'border-transparent text-cyan-300/80 hover:text-white hover:border-cyan-500/30'
          }`}
        >
          <Hand className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
          <span>GESTURE</span>
        </button>

        <button
          type="button"
          onClick={() => {
            audioService.playChirp(1250);
            onSelectDrawer('VOICE');
          }}
          data-testid="bottom-voice-btn"
          title="Open Vocal Console & Command History"
          aria-pressed={isVoiceDrawerActive}
          className={`flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-lg border text-[9px] sm:text-[10px] font-orbitron tracking-wider whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 ${
            isVoiceDrawerActive
              ? 'border-cyan-400 bg-cyan-500/20 text-white shadow-[0_0_12px_rgba(0,240,255,0.25)]'
              : isVoiceActive
              ? 'border-emerald-400/50 bg-emerald-950/30 text-emerald-200 hover:border-emerald-300'
              : 'border-transparent text-cyan-300/80 hover:text-white hover:border-cyan-500/30'
          }`}
        >
          <Mic className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
          <span>VOICE</span>
        </button>

        <button
          type="button"
          onClick={() => {
            audioService.playChirp(1300);
            onSelectDrawer('BRAIN');
          }}
          data-testid="bottom-brain-btn"
          title={`Open AI Intelligence Brain (${intelligenceStatus})`}
          aria-pressed={isBrainActive}
          className={`relative flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-lg border text-[9px] sm:text-[10px] font-orbitron tracking-wider whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 ${
            isBrainActive
              ? 'border-cyan-400 bg-cyan-500/20 text-white shadow-[0_0_12px_rgba(0,240,255,0.25)]'
              : isBrainAttention
              ? 'border-amber-400/55 bg-amber-950/30 text-amber-200 hover:border-amber-300'
              : 'border-transparent text-cyan-300/80 hover:text-white hover:border-cyan-500/30'
          }`}
        >
          <Brain className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
          <span>BRAIN</span>
          {activeSuggestionCount > 0 && (
            <span className="px-1 rounded bg-amber-400/25 text-amber-200 text-[8px] font-mono">
              {activeSuggestionCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            audioService.playChirp(1250);
            onSelectDrawer('MODELS');
          }}
          data-testid="bottom-models-btn"
          title="Open Holographic Models & Reconstruction Lab"
          aria-pressed={isModelsActive}
          className={`flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-lg border text-[9px] sm:text-[10px] font-orbitron tracking-wider whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 ${
            isModelsActive
              ? 'border-cyan-400 bg-cyan-500/20 text-white shadow-[0_0_12px_rgba(0,240,255,0.25)]'
              : 'border-transparent text-cyan-300/80 hover:text-white hover:border-cyan-500/30'
          }`}
        >
          <Layers className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
          <span>MODELS</span>
        </button>

        <div className="h-4 w-[1px] bg-cyan-500/25 mx-0.5 hidden sm:block" />

        <button
          type="button"
          onClick={() => {
            audioService.playChirp(1050);
            onResetTransform();
          }}
          data-testid="bottom-reset-btn"
          title="Reset Hologram Position, Scale & Dispersion"
          className="flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-lg border border-transparent text-cyan-300/80 hover:text-white hover:border-cyan-500/30 text-[9px] sm:text-[10px] font-orbitron tracking-wider whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400"
        >
          <RotateCcw className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
          <span>RESET</span>
        </button>

        <button
          type="button"
          onClick={() => {
            audioService.playChirp(1400);
            onToggleFocusMode();
          }}
          data-testid="bottom-focus-btn"
          title="Enter Full Immersive Focus Mode"
          className="flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-lg border border-cyan-400/40 bg-cyan-500/15 hover:bg-cyan-500/30 text-white text-[9px] sm:text-[10px] font-orbitron tracking-wider whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400"
        >
          <Eye className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-cyan-300" />
          <span>FOCUS</span>
        </button>
      </nav>
    </div>
  );
};
