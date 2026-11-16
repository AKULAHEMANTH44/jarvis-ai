import React, { useState, useEffect } from 'react';
import { KeyRound, ShieldCheck, Cpu, X, Save, Trash2 } from 'lucide-react';
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

  useEffect(() => {
    if (isOpen) {
      setConfig(contextualAI.getConfig());
      setSavedSuccess(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    audioService.playActivationWhoosh();
    contextualAI.saveConfig(config);
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 1000);
  };

  const handlePurgeKey = () => {
    audioService.playChirp(800);
    contextualAI.clearApiKey();
    setConfig((c) => ({ ...c, apiKey: '' }));
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
                  onClick={() => { audioService.playChirp(1200); setConfig(c => ({ ...c, provider: 'LOCAL', modelName: 'JARVIS Local Core MK-7', customEndpoint: undefined })); }}
                  className={`p-2 rounded border text-left flex flex-col ${
                    config.provider === 'LOCAL'
                      ? 'border-emerald-400 bg-emerald-950/40 text-white font-bold'
                      : 'border-cyan-500/30 bg-black/50 text-cyan-400/80 hover:bg-cyan-950/40'
                  }`}
                >
                  <span className="font-orbitron text-[11px]">LOCAL AUTONOMOUS</span>
                  <span className="text-[9px] text-emerald-400 font-normal">100% On-Device • Zero Network</span>
                </button>
                <button
                  type="button"
                  onClick={() => { audioService.playChirp(1200); setConfig(c => ({ ...c, provider: 'OPENAI', modelName: 'gpt-4o-mini', customEndpoint: undefined })); }}
                  className={`p-2 rounded border text-left flex flex-col ${
                    config.provider === 'OPENAI'
                      ? 'border-cyan-400 bg-cyan-950/40 text-white font-bold'
                      : 'border-cyan-500/30 bg-black/50 text-cyan-400/80 hover:bg-cyan-950/40'
                  }`}
                >
                  <span className="font-orbitron text-[11px]">OPENAI / COMPAT</span>
                  <span className="text-[9px] text-cyan-400/70 font-normal">Volatile RAM Key • HTTPS Only</span>
                </button>
                <button
                  type="button"
                  onClick={() => { audioService.playChirp(1200); setConfig(c => ({ ...c, provider: 'GEMINI', modelName: 'gemini-2.5-flash', customEndpoint: undefined })); }}
                  className={`p-2 rounded border text-left flex flex-col ${
                    config.provider === 'GEMINI'
                      ? 'border-cyan-400 bg-cyan-950/40 text-white font-bold'
                      : 'border-cyan-500/30 bg-black/50 text-cyan-400/80 hover:bg-cyan-950/40'
                  }`}
                >
                  <span className="font-orbitron text-[11px]">GOOGLE GEMINI</span>
                  <span className="text-[9px] text-cyan-400/70 font-normal">Volatile RAM Key • HTTPS Only</span>
                </button>
                <button
                  type="button"
                  onClick={() => { audioService.playChirp(1200); setConfig(c => ({ ...c, provider: 'ANTHROPIC', modelName: 'claude-3-5-sonnet-latest', customEndpoint: undefined })); }}
                  className={`p-2 rounded border text-left flex flex-col ${
                    config.provider === 'ANTHROPIC'
                      ? 'border-cyan-400 bg-cyan-950/40 text-white font-bold'
                      : 'border-cyan-500/30 bg-black/50 text-cyan-400/80 hover:bg-cyan-950/40'
                  }`}
                >
                  <span className="font-orbitron text-[11px]">ANTHROPIC CLAUDE</span>
                  <span className="text-[9px] text-cyan-400/70 font-normal">Volatile RAM Key • HTTPS Only</span>
                </button>
              </div>
            </div>

            {/* API Key input if External Provider selected */}
            {config.provider !== 'LOCAL' && (
              <div className="space-y-3 p-3 bg-black/60 rounded border border-cyan-500/30">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[10px] text-cyan-400/80">
                      API KEY (VOLATILE SESSION MEMORY ONLY):
                    </label>
                    {config.apiKey && (
                      <button
                        type="button"
                        onClick={handlePurgeKey}
                        className="flex items-center space-x-1 text-[9px] text-red-400 hover:text-red-300"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>PURGE KEY</span>
                      </button>
                    )}
                  </div>
                  <input
                    type="password"
                    autoComplete="off"
                    value={config.apiKey || ''}
                    onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                    placeholder={config.provider === 'GEMINI' ? 'AIza...' : config.provider === 'ANTHROPIC' ? 'sk-ant-...' : 'sk-...'}
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
                    placeholder={
                      config.provider === 'GEMINI'
                        ? 'gemini-2.5-flash'
                        : config.provider === 'ANTHROPIC'
                        ? 'claude-3-5-sonnet-latest'
                        : 'gpt-4o-mini or custom model'
                    }
                    className="w-full bg-cyan-950/50 border border-cyan-500/40 rounded px-2.5 py-1 text-white focus:outline-none focus:border-cyan-400"
                  />
                </div>

                <div>
                  <label className="block text-[10px] text-cyan-400/80 mb-1">
                    CUSTOM ENDPOINT (OPTIONAL — HTTPS OR LOCALHOST ONLY):
                  </label>
                  <input
                    type="text"
                    value={config.customEndpoint || ''}
                    onChange={(e) => setConfig({ ...config, customEndpoint: e.target.value })}
                    placeholder={
                      config.provider === 'GEMINI'
                        ? 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
                        : config.provider === 'ANTHROPIC'
                        ? 'https://api.anthropic.com/v1/messages'
                        : 'https://api.openai.com/v1/chat/completions'
                    }
                    className="w-full bg-cyan-950/50 border border-cyan-500/40 rounded px-2.5 py-1 text-white focus:outline-none focus:border-cyan-400"
                  />
                </div>
              </div>
            )}

            {/* Privacy Guarantee */}
            <div className="p-2.5 bg-cyan-950/30 border border-cyan-500/20 rounded flex items-start space-x-2 text-[10px]">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <p className="text-cyan-300/80 leading-relaxed">
                <strong className="text-white">Security Shield:</strong> API keys are held exclusively in volatile RAM for the active session and are never persisted to disk, localStorage, or bundled into source files. In Local mode, JARVIS operates offline with zero external requests.
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
                <span>{savedSuccess ? 'CONFIG APPLIED!' : 'APPLY CONFIGURATION'}</span>
              </button>
            </div>
          </div>
        </HolographicPanel>
      </div>
    </div>
  );
};
