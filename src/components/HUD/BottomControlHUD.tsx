import React, { useEffect, useRef, useState } from 'react';
import { InteractionMode } from '../../types/hologram';
import { audioService } from '../../services/soundFx';
import { speechService } from '../../services/speechService';
import {
  Mic,
  MicOff,
  RotateCcw,
  Zap,
  Sparkles,
  Power,
  Eye,
  ScanLine,
  Activity,
  Terminal,
  Send,
  Orbit
} from 'lucide-react';

interface BottomControlHUDProps {
  currentMode: InteractionMode;
  onSelectMode: (mode: InteractionMode) => void;
  isVoiceActive: boolean;
  voiceError?: string | null;
  onToggleVoice: () => void;
  onSendCommand: (cmd: string) => void;
  onTriggerShockwave: () => void;
  onResetTransform: () => void;
  isCameraActive: boolean;
  onToggleCamera: () => void;
  isDispersed: boolean;
  onToggleDispersion: () => void;
  leftDrawerOpen: boolean;
  onToggleLeftDrawer: () => void;
  rightDrawerMode: 'CLOSED' | 'LAB' | 'DIAGNOSTICS';
  onToggleRightDrawer: (target: 'LAB' | 'DIAGNOSTICS') => void;
  voiceDrawerOpen: boolean;
  onToggleVoiceDrawer: () => void;
}

export const BottomControlHUD: React.FC<BottomControlHUDProps> = ({
  currentMode,
  onSelectMode,
  isVoiceActive,
  voiceError,
  onToggleVoice,
  onSendCommand,
  onTriggerShockwave,
  onResetTransform,
  isCameraActive,
  isDispersed,
  onToggleDispersion,
  leftDrawerOpen,
  onToggleLeftDrawer,
  rightDrawerMode,
  onToggleRightDrawer,
  voiceDrawerOpen,
  onToggleVoiceDrawer
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [quickInput, setQuickInput] = useState<string>('');

  useEffect(() => {
    const a = audioService.getAnalyser();
    if (a) setAnalyser(a);
  }, []);

  useEffect(() => {
    let animId: number;
    const canvas = canvasRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const renderWave = () => {
      animId = requestAnimationFrame(renderWave);
      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const barWidth = 3;
      let x = 0;

      for (let i = 0; i < dataArray.length && x < canvas.width; i += 3) {
        let barHeight = (dataArray[i] / 255) * canvas.height;
        if (!isVoiceActive && !speechService.isCurrentlySpeaking() && barHeight < 2) {
          barHeight = 2;
        }

        ctx.fillStyle = isVoiceActive ? '#00f0ff' : 'rgba(0, 240, 255, 0.35)';
        ctx.fillRect(x, (canvas.height - barHeight) / 2, barWidth - 1, barHeight);
        x += barWidth;
      }
    };

    renderWave();
    return () => cancelAnimationFrame(animId);
  }, [analyser, isVoiceActive]);

  const handleQuickSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = quickInput.trim();
    if (!trimmed) return;
    audioService.playChirp(1400);
    onSendCommand(trimmed);
    setQuickInput('');
  };

  return (
    <footer className="relative z-30 px-4 py-2 bg-[#020812]/85 border-t border-cyan-500/20 flex items-center justify-between gap-2 text-cyan-400 select-none">
      {/* Left: Discreet Collapsible Edge Drawer Toggles */}
      <div className="flex items-center space-x-1.5 overflow-x-auto">
        <button
          onClick={() => {
            audioService.playChirp(1200);
            onToggleLeftDrawer();
          }}
          data-testid="toggle-optical-drawer"
          className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded border text-[10px] font-orbitron tracking-wider transition-colors whitespace-nowrap ${
            leftDrawerOpen
              ? 'border-cyan-400 bg-cyan-500/20 text-white'
              : 'border-cyan-500/25 bg-[#030d1c]/80 text-cyan-300/80 hover:border-cyan-400/60 hover:text-white'
          }`}
        >
          <Eye className="w-3.5 h-3.5" />
          <span>{isCameraActive ? 'OPTICAL ON' : 'OPTICAL'}</span>
        </button>

        <button
          onClick={() => {
            audioService.playChirp(1250);
            onToggleRightDrawer('LAB');
          }}
          data-testid="toggle-lab-drawer"
          className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded border text-[10px] font-orbitron tracking-wider transition-colors whitespace-nowrap ${
            rightDrawerMode === 'LAB'
              ? 'border-cyan-400 bg-cyan-500/20 text-white'
              : 'border-cyan-500/25 bg-[#030d1c]/80 text-cyan-300/80 hover:border-cyan-400/60 hover:text-white'
          }`}
        >
          <ScanLine className="w-3.5 h-3.5" />
          <span>OBJECT LAB</span>
        </button>

        <button
          onClick={() => {
            audioService.playChirp(1250);
            onToggleRightDrawer('DIAGNOSTICS');
          }}
          data-testid="toggle-diagnostics-drawer"
          className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded border text-[10px] font-orbitron tracking-wider transition-colors whitespace-nowrap ${
            rightDrawerMode === 'DIAGNOSTICS'
              ? 'border-cyan-400 bg-cyan-500/20 text-white'
              : 'border-cyan-500/25 bg-[#030d1c]/80 text-cyan-300/80 hover:border-cyan-400/60 hover:text-white'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>DIAGNOSTICS</span>
        </button>

        <button
          onClick={() => {
            audioService.playChirp(1200);
            onToggleVoiceDrawer();
          }}
          data-testid="toggle-voice-drawer"
          className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded border text-[10px] font-orbitron tracking-wider transition-colors whitespace-nowrap ${
            voiceDrawerOpen
              ? 'border-cyan-400 bg-cyan-500/20 text-white'
              : 'border-cyan-500/25 bg-[#030d1c]/80 text-cyan-300/80 hover:border-cyan-400/60 hover:text-white'
          }`}
        >
          <Terminal className="w-3.5 h-3.5" />
          <span>VOICE LOG</span>
        </button>
      </div>

      {/* Center: Compact Inline Voice / Command Dock + Mic */}
      <div className="hidden md:flex items-center space-x-2 flex-1 max-w-md mx-2">
        <form onSubmit={handleQuickSubmit} className="flex-1 flex items-center bg-[#030c18] border border-cyan-500/35 rounded px-2 py-1">
          <input
            type="text"
            value={quickInput}
            onChange={(e) => setQuickInput(e.target.value)}
            placeholder="Command JARVIS (e.g. Disperse, Open Lab)..."
            data-testid="quick-command-input"
            className="flex-1 bg-transparent text-[11px] font-mono text-white placeholder-cyan-400/45 focus:outline-none"
          />
          <button
            type="submit"
            title="Execute Command"
            className="p-0.5 text-cyan-300 hover:text-white"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>

        <div className="flex items-center space-x-2 border border-cyan-500/30 bg-[#030c18] px-2 py-1 rounded">
          <canvas
            ref={canvasRef}
            width={44}
            height={18}
            className="pointer-events-none"
          />
          <button
            onClick={() => {
              audioService.playChirp(isVoiceActive ? 800 : 1800);
              onToggleVoice();
            }}
            title={voiceError || (isVoiceActive ? 'Stop Voice Sensor' : 'Enable Microphone & Voice Sensor')}
            className={`flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-orbitron font-bold transition-colors ${
              isVoiceActive
                ? 'bg-red-500 text-white'
                : voiceError
                ? 'bg-amber-950/60 text-amber-300 border border-amber-400'
                : 'bg-cyan-500/15 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-400/50'
            }`}
          >
            {isVoiceActive ? <Mic className="w-3 h-3" /> : <MicOff className="w-3 h-3" />}
            <span>{isVoiceActive ? 'LIVE' : 'MIC'}</span>
          </button>
        </div>
      </div>

      {/* Right: Spatial Transformations, Mode Switcher & Standby */}
      <div className="flex items-center space-x-1.5">
        <button
          onClick={() => {
            audioService.playActivationWhoosh();
            onToggleDispersion();
          }}
          data-testid="toggle-dispersion-btn"
          title="Disperse or Reconstruct Holographic Structure"
          className={`flex items-center space-x-1 px-2.5 py-1.5 rounded border font-orbitron text-[10px] font-bold tracking-wider transition-colors ${
            isDispersed
              ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200'
              : 'border-cyan-400/50 bg-cyan-500/15 hover:bg-cyan-500/30 text-cyan-200'
          }`}
        >
          <Orbit className="w-3.5 h-3.5" />
          <span>{isDispersed ? 'RECONSTRUCT' : 'DISPERSE'}</span>
        </button>

        <button
          onClick={() => {
            audioService.playChirp(1000);
            onResetTransform();
          }}
          title="Reset Environment & Anchor"
          className="flex items-center space-x-1 px-2.5 py-1.5 rounded border border-cyan-500/35 bg-[#030d1c] hover:bg-cyan-500/15 text-cyan-300 font-mono text-[10px] transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">RESET</span>
        </button>

        <button
          onClick={() => {
            audioService.playShockwave();
            onTriggerShockwave();
          }}
          title="Trigger Energy Shockwave"
          className="flex items-center space-x-1 px-2.5 py-1.5 rounded border border-cyan-400 bg-cyan-500/20 hover:bg-cyan-500/35 text-white font-orbitron font-bold text-[10px] transition-colors"
        >
          <Zap className="w-3.5 h-3.5 text-cyan-300" />
          <span className="hidden sm:inline">PULSE</span>
        </button>

        <button
          onClick={() => {
            audioService.playChirp(1400);
            onSelectMode(currentMode === 'CINEMATIC' ? 'WORKSPACE' : 'CINEMATIC');
          }}
          title="Toggle Cinematic Full Focus"
          className={`p-1.5 rounded border transition-colors ${
            currentMode === 'CINEMATIC'
              ? 'border-amber-400 bg-amber-500/20 text-amber-200'
              : 'border-cyan-500/30 bg-[#030d1c] text-cyan-400 hover:text-white'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={() => {
            audioService.playChirp(900);
            onSelectMode('STANDBY');
          }}
          data-testid="standby-btn"
          title="Enter Standby Mode"
          className="p-1.5 rounded border border-cyan-500/30 bg-[#030d1c] text-cyan-400 hover:border-amber-400/60 hover:text-amber-300 transition-colors"
        >
          <Power className="w-3.5 h-3.5" />
        </button>
      </div>
    </footer>
  );
};
