import React from 'react';
import { Sparkles, CheckCircle2 } from 'lucide-react';
import { contextualAI } from '../../services/contextualAI';

interface LLMStatusPanelProps {
  provider: string;
  hasApiKey: boolean;
  onOpenAIConfig: () => void;
}

export const LLMStatusPanel: React.FC<LLMStatusPanelProps> = ({
  provider,
  hasApiKey,
  onOpenAIConfig
}) => {
  const providers = [
    { name: 'Gemini', active: provider === 'GEMINI' && hasApiKey },
    { name: 'OpenAI', active: provider === 'OPENAI' && hasApiKey },
    { name: 'Anthropic', active: provider === 'ANTHROPIC' && hasApiKey },
    { name: 'Local Core', active: provider === 'LOCAL' || !hasApiKey }
  ];

  return (
    <div className="bg-[#020814]/90 border border-cyan-500/30 rounded-xl p-3 flex flex-col space-y-2.5 shadow-[0_0_20px_rgba(0,240,255,0.1)]">
      <div className="flex items-center justify-between border-b border-cyan-500/20 pb-1.5">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
          <span className="font-orbitron font-bold text-[11px] text-white tracking-wider">LLM CONNECTIONS</span>
        </div>
        <button
          type="button"
          onClick={onOpenAIConfig}
          className="text-[9px] font-mono text-cyan-300 hover:text-white"
        >
          Configure
        </button>
      </div>

      <div className="grid grid-cols-2 gap-1.5 font-mono text-[10px]">
        {providers.map((p) => (
          <div key={p.name} className="p-1.5 rounded bg-black/40 border border-cyan-500/20 flex items-center justify-between">
            <span className="text-white truncate">{p.name}</span>
            <span className={`w-2 h-2 rounded-full shrink-0 ${p.active ? 'bg-emerald-400 animate-pulse' : 'bg-cyan-950 border border-cyan-500/40'}`} />
          </div>
        ))}
      </div>
    </div>
  );
};
