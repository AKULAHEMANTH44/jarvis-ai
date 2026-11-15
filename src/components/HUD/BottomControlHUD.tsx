import React, { useEffect, useRef, useState } from 'react';
import { InteractionMode } from '../../types/hologram';
import { audioService } from '../../services/soundFx';
import { speechService } from '../../services/speechService';
import {
  Mic,
  MicOff,
  Hand,
  RotateCcw,
  Zap,
  Layers,
  Sparkles,
  Power,
  Monitor,
  Boxes
} from 'lucide-react';

interface BottomControlHUDProps {
  currentMode: InteractionMode;
  onSelectMode: (mode: InteractionMode) => void;
  isVoiceActive: boolean;
  voiceError?: string | null;
  onToggleVoice: () => void;
  onTriggerShockwave: () => void;
  onResetTransform: () => void;
  isCameraActive: boolean;
  onToggleCamera: () => void;
}

export const BottomControlHUD: React.FC<BottomControlHUDProps> = ({
  currentMode,
  onSelectMode,
  isVoiceActive,
  voiceError,
  onToggleVoice,
  onTriggerShockwave,
  onResetTransform
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

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

      for (let i = 0; i < dataArray.length && x < canvas.width; i += 2) {
        let barHeight = (dataArray[i] / 255) * canvas.height;
        if (!isVoiceActive && !speechService.isCurrentlySpeaking() && barHeight < 2) {
          barHeight = 2;
        }

        ctx.fillStyle = isVoiceActive ? '#00f0ff' : 'rgba(0, 240, 255, 0.3)';
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = isVoiceActive ? 6 : 0;
        ctx.fillRect(x, (canvas.height - barHeight) / 2, barWidth - 1, barHeight);
        x += barWidth;
      }
    };

    renderWave();
    return () => cancelAnimationFrame(animId);
  }, [analyser, isVoiceActive]);

  const handleModeClick = (mode: InteractionMode) => {
    audioService.playChirp(1400);
    onSelectMode(mode);
  };

  const modes: { id: InteractionMode; label: string; icon: React.ReactNode }[] = [
    { id: 'WORKSPACE', label: 'LAB SPACE', icon: <Boxes className="w-3.5 h-3.5" /> },
    { id: 'GESTURE', label: 'GESTURE', icon: <Hand className="w-3.5 h-3.5" /> },
    { id: 'VOICE', label: 'VOICE', icon: <Mic className="w-3.5 h-3.5" /> },
    { id: 'COMBINED', label: 'COMBINED', icon: <Zap className="w-3.5 h-3.5" /> },
    { id: 'HOLOGRAM', label: '3D HOLO', icon: <Layers className="w-3.5 h-3.5" /> },
    { id: 'CINEMATIC', label: 'CINEMATIC', icon: <Sparkles className="w-3.5 h-3.5" /> },
    { id: 'DESKTOP', label: 'DESKTOP', icon: <Monitor className="w-3.5 h-3.5" /> },
    { id: 'STANDBY', label: 'STANDBY', icon: <Power className="w-3.5 h-3.5" /> }
  ];

  return (
    <footer className="relative z-30 px-6 py-2.5 bg-black/75 backdrop-blur-md border-t border-cyan-500/30 flex items-center justify-between text-cyan-400 select-none">
      {/* Left: Mode Buttons Bar */}
      <div className="flex items-center space-x-1.5 overflow-x-auto py-1">
        {modes.map((m) => (
          <button
            key={m.id}
            onClick={() => handleModeClick(m.id)}
            className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded border text-[11px] font-orbitron tracking-wider transition-all whitespace-nowrap ${
              currentMode === m.id
                ? 'border-cyan-400 bg-cyan-500/25 text-white font-bold shadow-[0_0_15px_rgba(0,240,255,0.4)]'
                : 'border-cyan-500/20 bg-cyan-950/20 text-cyan-400/80 hover:bg-cyan-950/50 hover:text-cyan-300'
            }`}
          >
            <span>{m.icon}</span>
            <span>{m.label}</span>
          </button>
        ))}
      </div>

      {/* Center: Audio Waveform Visualizer & Voice Mic Button */}
      <div className="flex items-center space-x-3 bg-cyan-950/40 border border-cyan-500/30 px-3 py-1 rounded-full">
        <canvas
          ref={canvasRef}
          width={72}
          height={20}
          className="rounded pointer-events-none"
        />
        <button
          onClick={() => {
            audioService.playChirp(isVoiceActive ? 800 : 1800);
            onToggleVoice();
          }}
          title={voiceError || (isVoiceActive ? 'Stop Voice Sensor' : 'Enable Microphone & Voice Sensor')}
          className={`flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-orbitron font-bold transition-all ${
            isVoiceActive
              ? 'bg-red-500 text-white shadow-[0_0_15px_#ff3344] animate-pulse'
              : voiceError
              ? 'bg-amber-950/60 hover:bg-amber-900/60 text-amber-300 border border-amber-400'
              : 'bg-cyan-500/20 hover:bg-cyan-500/40 text-cyan-300 border border-cyan-400'
          }`}
        >
          {isVoiceActive ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
          <span>{isVoiceActive ? 'LISTENING' : voiceError ? 'MIC RETRY' : 'VOICE OFF'}</span>
        </button>
      </div>

      {/* Right: Quick Action Triggers */}
      <div className="flex items-center space-x-2">
        <button
          onClick={() => {
            audioService.playChirp(1000);
            onResetTransform();
          }}
          title="Reset Hologram Anchor (Pull Back gesture)"
          className="flex items-center space-x-1 px-3 py-1.5 rounded border border-cyan-500/40 bg-cyan-950/30 hover:bg-cyan-500/20 text-cyan-300 font-mono text-xs transition-all"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">RESET</span>
        </button>

        <button
          onClick={() => {
            audioService.playShockwave();
            onTriggerShockwave();
          }}
          title="Trigger Holographic Energy Shockwave (Push Forward gesture)"
          className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded border border-cyan-400 bg-cyan-500/20 hover:bg-cyan-500/40 text-white font-orbitron font-bold text-xs shadow-[0_0_15px_rgba(0,240,255,0.3)] transition-all"
        >
          <Zap className="w-3.5 h-3.5 text-cyan-300 animate-bounce" />
          <span>SHOCKWAVE</span>
        </button>
      </div>
    </footer>
  );
};
