import React, { useState } from 'react';
import { Mic, MicOff, Send, Radio, Square } from 'lucide-react';
import { audioService } from '../../services/soundFx';
import { VoiceLifecycleState } from '../../services/speechService';

interface VoiceCommandDockProps {
  isVoiceActive: boolean;
  voiceLifecycleState?: VoiceLifecycleState;
  onToggleVoice: () => void;
  onSendCommand: (text: string) => void;
  isProcessing: boolean;
  onCancelRequest?: () => void;
  onOpenVoiceConsole: () => void;
}

export const VoiceCommandDock: React.FC<VoiceCommandDockProps> = ({
  isVoiceActive,
  voiceLifecycleState = isVoiceActive ? 'LISTENING' : 'IDLE',
  onToggleVoice,
  onSendCommand,
  isProcessing,
  onCancelRequest,
  onOpenVoiceConsole
}) => {
  const [inputVal, setInputVal] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputVal.trim()) return;
    audioService.playChirp(1400);
    onSendCommand(inputVal.trim());
    setInputVal('');
  };

  const effectiveVoiceState: VoiceLifecycleState = isProcessing
    ? 'PROCESSING'
    : voiceLifecycleState;

  return (
    <div className="h-16 px-4 bg-[#02060e]/95 border-t border-cyan-500/25 flex items-center justify-between gap-4 select-none z-20 shrink-0">
      {/* Location / Voice Lifecycle Status */}
      <div className="hidden md:flex items-center gap-2 text-[11px] font-mono text-cyan-300/80" aria-live="polite">
        <Radio className="w-3.5 h-3.5 text-cyan-400" />
        <span>VOICE:</span>
        <span
          className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${
            effectiveVoiceState === 'LISTENING'
              ? 'border-emerald-400/50 bg-emerald-950/50 text-emerald-300'
              : effectiveVoiceState === 'PROCESSING'
              ? 'border-amber-400/50 bg-amber-950/50 text-amber-200'
              : effectiveVoiceState === 'SPEAKING'
              ? 'border-cyan-400/60 bg-cyan-950/60 text-cyan-200'
              : effectiveVoiceState === 'ERROR'
              ? 'border-rose-400/50 bg-rose-950/50 text-rose-300'
              : 'border-cyan-500/30 bg-black/50 text-cyan-300/80'
          }`}
        >
          {effectiveVoiceState}
        </span>
      </div>

      {/* Central Talk to JARVIS Microphone & Prompt Bar */}
      <div className="flex-1 max-w-xl flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            audioService.playChirp(1250);
            onToggleVoice();
          }}
          aria-label={isVoiceActive ? 'Disable Microphone' : 'Enable Microphone'}
          title={isVoiceActive ? 'Disable Microphone' : 'Enable Microphone'}
          className={`p-2.5 rounded-xl border transition-all ${
            isVoiceActive
              ? 'bg-emerald-600 border-emerald-400 text-white shadow-[0_0_16px_rgba(16,185,129,0.4)]'
              : 'bg-black/60 border-cyan-500/40 text-cyan-300 hover:text-white'
          }`}
        >
          {isVoiceActive ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
        </button>

        <form onSubmit={handleSubmit} className="flex-1 flex items-center gap-1.5">
          <input
            type="text"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            aria-label="Talk or type command to JARVIS"
            placeholder={
              effectiveVoiceState === 'LISTENING'
                ? 'Listening to voice command...'
                : effectiveVoiceState === 'PROCESSING'
                ? 'Processing JARVIS request...'
                : effectiveVoiceState === 'SPEAKING'
                ? 'JARVIS speaking...'
                : 'Talk or type to J.A.R.V.I.S...'
            }
            className="w-full bg-black/70 border border-cyan-500/30 rounded-xl px-3.5 py-2 text-xs font-mono text-white placeholder-cyan-500/50 focus:outline-none focus:border-cyan-400 shadow-inner"
          />
          {isProcessing && onCancelRequest && (
            <button
              type="button"
              onClick={() => {
                audioService.playChirp(900);
                onCancelRequest();
              }}
              aria-label="Cancel Active AI Request"
              title="Stop & Cancel Active Request"
              className="p-2.5 rounded-xl bg-red-950/60 hover:bg-red-900/70 border border-red-400/70 text-red-200 transition-colors"
            >
              <Square className="w-4 h-4" />
            </button>
          )}
          <button
            type="submit"
            aria-label="Send Command"
            className="p-2.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/40 border border-cyan-400 text-cyan-300 transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>

      {/* Executive Briefing / Actions */}
      <div className="hidden lg:flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            audioService.playChirp(1300);
            onOpenVoiceConsole();
          }}
          className="px-3 py-1.5 rounded-lg border border-cyan-500/30 bg-cyan-950/40 hover:bg-cyan-500/20 text-cyan-200 font-orbitron text-[10px] tracking-wider transition-colors"
        >
          VOCAL CONSOLE
        </button>
      </div>
    </div>
  );
};
