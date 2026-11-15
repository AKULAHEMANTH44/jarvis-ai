import React, { useRef, useEffect } from 'react';
import { HolographicPanel } from '../Common/HolographicPanel';
import { AssistantMessage } from '../../types/assistant';
import { Volume2, Send, Terminal, Trash2 } from 'lucide-react';
import { audioService } from '../../services/soundFx';

interface VoiceConsoleHUDProps {
  messages: AssistantMessage[];
  onSendCommand: (cmd: string) => void;
  isListening: boolean;
  isSpeaking: boolean;
  isProcessing?: boolean;
  onClearHistory?: () => void;
}

export const VoiceConsoleHUD: React.FC<VoiceConsoleHUDProps> = ({
  messages,
  onSendCommand,
  isListening,
  isSpeaking,
  isProcessing = false,
  onClearHistory
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [inputValue, setInputValue] = React.useState<string>('');

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
    'Open holographic workspace',
    'Show me the vehicle',
    'Rotate it 360 degrees',
    'Explode the model',
    'Disintegrate',
    'Reconstruct the object',
    'Return to normal view',
    'Activate diagnostics'
  ];

  return (
    <div className="w-84 max-w-sm flex flex-col space-y-2">
      <HolographicPanel
        title="J.A.R.V.I.S. VOCAL CONSOLE"
        subtitle={`SPEECH & SYNTHESIS STREAM · ${messages.length} ENTRIES`}
        reactive={isListening || isSpeaking || isProcessing}
        icon={<Terminal className="w-4 h-4 text-cyan-400" />}
        headerRight={
          <div className="flex items-center space-x-1.5 font-mono text-[10px]">
            {isProcessing && (
              <span className="text-amber-300 font-bold">PROCESSING</span>
            )}
            {isSpeaking && (
              <span className="flex items-center space-x-1 text-cyan-300">
                <Volume2 className="w-3.5 h-3.5" />
                <span>SPEAKING</span>
              </span>
            )}
            {isListening && (
              <span className="flex items-center space-x-1 text-emerald-400 font-bold">
                <span>LISTENING</span>
              </span>
            )}
            {onClearHistory && messages.length > 1 && (
              <button
                onClick={() => {
                  audioService.playChirp(950);
                  onClearHistory();
                }}
                title="Clear Console History"
                className="p-0.5 rounded border border-cyan-500/30 text-cyan-400/70 hover:text-white"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        }
      >
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
            className="px-2.5 py-1 bg-cyan-500/20 hover:bg-cyan-500/40 border border-cyan-400 rounded text-cyan-300"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </HolographicPanel>
    </div>
  );
};
