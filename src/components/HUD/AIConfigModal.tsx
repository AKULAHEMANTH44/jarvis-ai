import React, { useState } from 'react';
import { KeyRound, ShieldCheck, Cpu, X, Save } from 'lucide-react';
import { HolographicPanel } from '../Common/HolographicPanel';
import { AIProviderConfig } from '../../types/assistant';
import { contextualAI } from '../../services/contextualAI';
import { audioService } from '../../services/soundFx';

interface AIConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AIConfigModal: React.FC<AIConfigModalProps> = ({ isOpen, onClose }) => {
  const [config, setConfig] = useState<AIProviderConfig>(contextualAI.getConfig());
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleSave = () => {
    audioService.playActivationWhoosh();
    contextualAI.saveConfig(config);
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in select-none">
      <div className="w-full max-w-lg border border-cyan-500/50 rounded-lg shadow-[0_0_35px_rgba(0,240,255,0.3)] overflow-hidden">
        <HolographicPanel
          title="AI INTELLIGENCE & LLM PROVIDER"
          subtitle="MULTIMODAL PERSONAL ASSISTANT CONFIG"
          icon={<Cpu className="w-5 h-5 text-cyan-400" />}
          headerRight={
            <button
              onClick={() => { audioService.playChirp(800); onClose(); }}
              className="text-cyan-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          }
          className="bg-[#030d18]/95"
        >
          <div className="space-y-4 py-2 font-mono text-xs text-cyan-300">
            {/* Provider Selector */}
            <div>
              <label className="block text-[11px] font-bold text-white mb-1.5">
                NEURAL INTELLIGENCE PROVIDER:
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => { audioService.playChirp(1200); setConfig(c => ({ ...c, provider: 'LOCAL', modelName: 'JARVIS Local Core MK-7' })); }}
                  className={`p-2 rounded border text-left flex flex-col ${
                    config.provider === 'LOCAL'
                      ? 'border-emerald-400 bg-emerald-950/40 text-white font-bold'
                      : 'border-cyan-500/30 bg-black/50 text-cyan-400/80 hover:bg-cyan-950/40'
                  }`}
                >
                  <span className="font-orbitron text-[11px]">LOCAL AUTONOMOUS</span>
                  <span className="text-[9px] text-emerald-400 font-normal">100% On-Device • Zero Network • Private</span>
                </button>
                <button
                  type="button"
                  onClick={() => { audioService.playChirp(1200); setConfig(c => ({ ...c, provider: 'OPENAI', modelName: 'gpt-4o-mini' })); }}
                  className={`p-2 rounded border text-left flex flex-col ${
                    config.provider === 'OPENAI'
                      ? 'border-cyan-400 bg-cyan-950/40 text-white font-bold'
                      : 'border-cyan-500/30 bg-black/50 text-cyan-400/80 hover:bg-cyan-950/40'
                  }`}
                >
                  <span className="font-orbitron text-[11px]">OPENAI / CUSTOM API</span>
                  <span className="text-[9px] text-cyan-400/70 font-normal">Bring Your Own Key • Cloud LLM</span>
                </button>
              </div>
            </div>

            {/* API Key input if External Provider selected */}
            {config.provider !== 'LOCAL' && (
              <div className="space-y-3 p-3 bg-black/60 rounded border border-cyan-500/30">
                <div>
                  <label className="block text-[10px] text-cyan-400/80 mb-1">
                    API KEY (STORED LOCALLY IN BROWSER ONLY):
                  </label>
                  <input
                    type="password"
                    value={config.apiKey || ''}
                    onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                    placeholder="sk-..."
                    className="w-full bg-cyan-950/50 border border-cyan-500/40 rounded px-2.5 py-1 text-white focus:outline-none focus:border-cyan-400"
                  />
                </div>

                <div>
                  <label className="block text-[10px] text-cyan-400/80 mb-1">
                    MODEL IDENTIFIER:
                  </label>
                  <input
                    type="text"
                    value={config.modelName}
                    onChange={(e) => setConfig({ ...config, modelName: e.target.value })}
                    placeholder="gpt-4o-mini or custom model"
                    className="w-full bg-cyan-950/50 border border-cyan-500/40 rounded px-2.5 py-1 text-white focus:outline-none focus:border-cyan-400"
                  />
                </div>

                <div>
                  <label className="block text-[10px] text-cyan-400/80 mb-1">
                    CUSTOM ENDPOINT (OPTIONAL):
                  </label>
                  <input
                    type="text"
                    value={config.customEndpoint || ''}
                    onChange={(e) => setConfig({ ...config, customEndpoint: e.target.value })}
                    placeholder="https://api.openai.com/v1/chat/completions"
                    className="w-full bg-cyan-950/50 border border-cyan-500/40 rounded px-2.5 py-1 text-white focus:outline-none focus:border-cyan-400"
                  />
                </div>
              </div>
            )}

            {/* Privacy Guarantee */}
            <div className="p-2.5 bg-cyan-950/30 border border-cyan-500/20 rounded flex items-start space-x-2 text-[10px]">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <p className="text-cyan-300/80 leading-relaxed">
                <strong className="text-white">Security Shield:</strong> API keys are never bundled into client source files or sent to unauthorized endpoints. In Local mode, JARVIS uses a contextual state machine with zero external network requests.
              </p>
            </div>

            {/* Footer Buttons */}
            <div className="flex justify-end space-x-2 pt-2 border-t border-cyan-500/20">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded border border-cyan-500/30 bg-black/40 text-cyan-400 hover:text-white"
              >
                CANCEL
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="px-4 py-1.5 rounded border border-cyan-400 bg-cyan-500/30 hover:bg-cyan-500/50 text-white font-orbitron font-bold flex items-center space-x-1.5 shadow-[0_0_15px_rgba(0,240,255,0.4)]"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{savedSuccess ? 'CONFIG PERSISTED!' : 'APPLY CONFIGURATION'}</span>
              </button>
            </div>
          </div>
        </HolographicPanel>
      </div>
    </div>
  );
};
