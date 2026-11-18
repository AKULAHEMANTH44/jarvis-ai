import React, { useRef, useEffect } from 'react';
import { HolographicPanel } from '../Common/HolographicPanel';
import { AssistantMessage, IntelligenceStatus } from '../../types/assistant';
import { Volume2, Send, Terminal, Trash2, Mic, MicOff, X, Brain, Square } from 'lucide-react';
import { audioService } from '../../services/soundFx';
import { VoiceLifecycleState } from '../../services/speechService';

interface VoiceConsoleHUDProps {
  messages: AssistantMessage[];
  onSendCommand: (cmd: string) => void;
  isListening: boolean;
  isSpeaking: boolean;
  isProcessing?: boolean;
  voiceLifecycleState?: VoiceLifecycleState;
  intelligenceStatus?: IntelligenceStatus;
  voiceError?: string | null;
  onToggleVoice?: () => void;
  onCancelRequest?: () => void;
  onOpenBrain?: () => void;
  onClearHistory?: () => void;
  onClose?: () => void;
}

export const VoiceConsoleHUD: React.FC<VoiceConsoleHUDProps> = ({
  messages,
  onSendCommand,
  isListening,
  isSpeaking,
  isProcessing = false,
  voiceLifecycleState,
  intelligenceStatus = 'STANDBY',
  voiceError = null,
  onToggleVoice,
  onCancelRequest,
  onOpenBrain,
  onClearHistory,
  onClose
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [inputValue, setInputValue] = React.useState<string>('');

  const lifecycle: VoiceLifecycleState =
    voiceLifecycleState ||
    (isSpeaking
      ? 'SPEAKING'
      : isProcessing
      ? 'PROCESSING'
      : isListening
      ? 'LISTENING'
      : voiceError
      ? 'ERROR'
      : 'IDLE');

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;
    audioService.playChirp(1400);
    onSendCommand(inputValue.trim());
    setInputValue('');
  };

  const quickPrompts = [
    'Hello JARVIS',
    'Inspect my current workspace',
    'Prepare my project for demonstration',
    'Open GitHub',
    'Search web for Three.js',
    'Open a file',
    'Play music',
    'Show me the vehicle',
    'Explode the model',
    'Return to normal view'
  ];

  return (
    <div className="w-full flex flex-col space-y-2">
      <HolographicPanel
        title="J.A.R.V.I.S. VOCAL CONSOLE"
        subtitle={`VOICE: ${lifecycle} · ${messages.length} ENTRIES`}
        reactive={isListening || isSpeaking || isProcessing}
        icon={<Terminal className="w-4 h-4 text-cyan-400" />}
        headerRight={
          <div className="flex items-center space-x-1.5 font-mono text-[10px]" aria-live="polite">
            <span
              className={`px-1.5 py-0.5 rounded border font-bold ${
                lifecycle === 'LISTENING'
                  ? 'border-emerald-400/50 bg-emerald-950/40 text-emerald-200'
                  : lifecycle === 'PROCESSING'
                  ? 'border-amber-400/50 bg-amber-950/40 text-amber-200'
                  : lifecycle === 'SPEAKING'
                  ? 'border-cyan-400/50 bg-cyan-950/40 text-cyan-200'
                  : lifecycle === 'ERROR'
                  ? 'border-rose-400/50 bg-rose-950/40 text-rose-200'
                  : 'border-cyan-500/30 bg-black/50 text-cyan-300/80'
              }`}
            >
              {lifecycle}
            </span>
            {(isProcessing || (intelligenceStatus !== 'STANDBY' && intelligenceStatus !== 'LISTENING')) && (
              <span className="px-1.5 py-0.5 rounded border border-amber-400/50 bg-amber-950/40 text-amber-200 font-bold">
                {intelligenceStatus}
              </span>
            )}
            {isProcessing && onCancelRequest && (
              <button
                type="button"
                onClick={() => {
                  audioService.playChirp(900);
                  onCancelRequest();
                }}
                aria-label="Cancel Active AI Request"
                title="Cancel Active AI Request"
                className="flex items-center space-x-1 px-1.5 py-0.5 rounded border border-red-400/60 bg-red-950/50 text-red-200 hover:bg-red-900/60"
              >
                <Square className="w-2.5 h-2.5" />
                <span>STOP</span>
              </button>
            )}
            {isSpeaking && (
              <span className="flex items-center space-x-1 text-cyan-300">
                <Volume2 className="w-3.5 h-3.5" />
                <span>SPEAKING</span>
              </span>
            )}
            {onOpenBrain && (
              <button
                type="button"
                onClick={() => {
                  audioService.playChirp(1300);
                  onOpenBrain();
                }}
                aria-label="Open AI Intelligence Brain"
                title="Open AI Intelligence Brain"
                className="flex items-center space-x-1 px-2 py-0.5 rounded border border-cyan-500/40 bg-cyan-950/40 text-cyan-200 hover:text-white"
              >
                <Brain className="w-3 h-3" />
                <span>BRAIN</span>
              </button>
            )}
            {onToggleVoice && (
              <button
                type="button"
                onClick={() => {
                  audioService.playChirp(1250);
                  onToggleVoice();
                }}
                aria-label={isListening ? 'Disable Voice Microphone' : 'Enable Voice Microphone'}
                className={`flex items-center space-x-1 px-2 py-0.5 rounded border transition-colors ${
                  isListening
                    ? 'border-emerald-400/70 bg-emerald-950/50 text-emerald-300 font-bold'
                    : voiceError
                    ? 'border-amber-400/60 bg-amber-950/40 text-amber-300'
                    : 'border-cyan-500/40 bg-cyan-950/40 text-cyan-300 hover:text-white'
                }`}
              >
                {isListening ? <Mic className="w-3 h-3" /> : <MicOff className="w-3 h-3" />}
                <span>{isListening ? 'MIC ON' : 'MIC OFF'}</span>
              </button>
            )}
            {onClearHistory && messages.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  audioService.playChirp(950);
                  onClearHistory();
                }}
                title="Clear Console History"
                aria-label="Clear Console History"
                className="p-1 rounded border border-cyan-500/30 text-cyan-400/70 hover:text-white"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
            {onClose && (
              <button
                type="button"
                onClick={() => {
                  audioService.playChirp(1000);
                  onClose();
                }}
                title="Close Vocal Console"
                aria-label="Close Vocal Console"
                className="p-1 rounded border border-cyan-500/30 text-cyan-300 hover:text-white hover:border-cyan-400"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        }
      >
        {voiceError && (
          <div role="alert" className="mb-2 px-2.5 py-1.5 rounded border border-rose-500/40 bg-rose-950/40 text-rose-200 text-[10px] font-mono">
            {voiceError}
          </div>
        )}
        {/* Message Log */}
        <div
          ref={scrollRef}
          className="h-44 overflow-y-auto space-y-2 pr-1 font-mono text-[11px] scroll-smooth"
        >
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`p-2 rounded border ${
                msg.sender === 'JARVIS'
                  ? 'border-cyan-500/30 bg-cyan-950/30 text-cyan-200'
                  : 'border-cyan-400/50 bg-black/50 text-white ml-3'
              }`}
            >
              <div className="flex items-center justify-between text-[9px] text-cyan-400/60 mb-1">
                <span className="font-orbitron font-bold">
                  {msg.sender === 'JARVIS' ? 'J.A.R.V.I.S.' : 'STARK // USER'}
                </span>
                <span>{msg.timestamp}</span>
              </div>
              <p className="leading-snug">{msg.text}</p>
            </div>
          ))}
        </div>

        {/* Quick Voice Command Chips */}
        <div className="pt-2 border-t border-cyan-500/20">
          <span className="text-[9px] font-mono text-cyan-400/60 block mb-1">
            QUICK VOICE PROTOCOLS:
          </span>
          <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto pr-1">
            {quickPrompts.map((prompt) => (
              <button
                key={prompt}
                onClick={() => {
                  audioService.playChirp(1200);
                  onSendCommand(prompt);
                }}
                className="px-2 py-0.5 rounded bg-cyan-950/50 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-[10px] font-mono transition-all"
              >
                "{prompt}"
              </button>
            ))}
          </div>
        </div>

        {/* Input Console */}
        <form onSubmit={handleSubmit} className="mt-2 flex space-x-1">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Type or speak JARVIS command..."
            className="flex-1 bg-black/70 border border-cyan-500/40 rounded px-2.5 py-1 text-xs font-mono text-white placeholder-cyan-500/50 focus:outline-none focus:border-cyan-400"
          />
          <button
            type="submit"
            aria-label="Send Command"
            className="px-2.5 py-1 bg-cyan-500/20 hover:bg-cyan-500/40 border border-cyan-400 rounded text-cyan-300"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </HolographicPanel>
    </div>
  );
};
