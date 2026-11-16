import React, { useState, useEffect } from 'react';
import { KeyRound, ShieldCheck, Cpu, X, Save, Trash2, ArrowRightLeft, RefreshCw, CheckCircle2, Sparkles } from 'lucide-react';
import { HolographicPanel } from '../Common/HolographicPanel';
import { AIProviderConfig, BackendLLMStatusResponse, LLMMode } from '../../types/assistant';
import { contextualAI } from '../../services/contextualAI';
import { audioService } from '../../services/soundFx';

interface AIConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AIConfigModal: React.FC<AIConfigModalProps> = ({ isOpen, onClose }) => {
  const [config, setConfig] = useState<AIProviderConfig>(contextualAI.getConfig());
  const [backendStatus, setBackendStatus] = useState<BackendLLMStatusResponse | null>(null);
  const [isProbing, setIsProbing] = useState<boolean>(false);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);

  const probeStatus = async (mode?: LLMMode) => {
    setIsProbing(true);
    try {
      const status = await contextualAI.getBackendStatus(mode);
      setBackendStatus(status);
    } finally {
      setIsProbing(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      const current = contextualAI.getConfig();
      setConfig(current);
      setSavedSuccess(false);
      probeStatus(current.backendMode);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async () => {
    audioService.playActivationWhoosh();
    contextualAI.saveConfig(config);
    if (config.provider === 'BACKEND' && config.backendMode) {
      await contextualAI.setBackendMode(config.backendMode);
    }
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

  const handleModeChange = (mode: LLMMode) => {
    audioService.playChirp(1200);
    setConfig((c) => ({ ...c, backendMode: mode }));
    probeStatus(mode);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in select-none">
      <div className="w-full max-w-xl border border-cyan-500/50 rounded-lg shadow-[0_0_35px_rgba(0,240,255,0.3)] overflow-hidden">
        <HolographicPanel
          title="AI INTELLIGENCE & LLM ORCHESTRATOR"
          subtitle="SECURE FULL-STACK NEURAL PROVIDER CONFIGURATION"
          icon={<Cpu className="w-5 h-5 text-cyan-400" />}
          headerRight={
            <button
              onClick={() => {
                audioService.playChirp(800);
                onClose();
              }}
              className="text-cyan-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          }
          className="bg-[#030d18]/95"
        >
          <div className="space-y-4 py-2 font-mono text-xs text-cyan-300">
            {/* Primary Provider Selector */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-bold text-white">
                  NEURAL INTELLIGENCE ARCHITECTURE:
                </label>
                <button
                  type="button"
                  onClick={() => probeStatus(config.backendMode)}
                  disabled={isProbing}
                  className="flex items-center gap-1 text-[9px] text-cyan-400 hover:text-white"
                >
                  <RefreshCw className={`w-2.5 h-2.5 ${isProbing ? 'animate-spin' : ''}`} />
                  <span>PROBE BACKEND</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {/* 1. Secure Full-Stack Backend (Gemini Primary + Groq Fallback) */}
                <button
                  type="button"
                  onClick={() => {
                    audioService.playChirp(1200);
                    setConfig((c) => ({
                      ...c,
                      provider: 'BACKEND',
                      modelName: 'JARVIS Dual-Neural Core',
                      customEndpoint: undefined
                    }));
                  }}
                  className={`col-span-2 p-2.5 rounded border text-left flex flex-col transition-all ${
                    config.provider === 'BACKEND'
                      ? 'border-cyan-400 bg-cyan-950/60 text-white font-bold shadow-[0_0_15px_rgba(0,240,255,0.2)]'
                      : 'border-cyan-500/30 bg-black/50 text-cyan-400/80 hover:bg-cyan-950/40'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-orbitron text-[11px] text-cyan-300 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                      <span>SECURE FULL-STACK BACKEND (GEMINI + GROQ)</span>
                    </span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-950 border border-emerald-500/40 text-emerald-400 font-bold">
                      RECOMMENDED
                    </span>
                  </div>
                  <span className="text-[9px] text-cyan-300/80 font-normal mt-0.5">
                    Server-Side Keys • Gemini 4 Hydrogen Primary • Groq LLaMA 3.3 Auto-Fallback
                  </span>
                </button>

                {/* 2. Local Autonomous */}
                <button
                  type="button"
                  onClick={() => {
                    audioService.playChirp(1200);
                    setConfig((c) => ({
                      ...c,
                      provider: 'LOCAL',
                      modelName: 'JARVIS Local Core MK-7',
                      customEndpoint: undefined
                    }));
                  }}
                  className={`p-2 rounded border text-left flex flex-col ${
                    config.provider === 'LOCAL'
                      ? 'border-emerald-400 bg-emerald-950/40 text-white font-bold'
                      : 'border-cyan-500/30 bg-black/50 text-cyan-400/80 hover:bg-cyan-950/40'
                  }`}
                >
                  <span className="font-orbitron text-[11px]">LOCAL AUTONOMOUS</span>
                  <span className="text-[9px] text-emerald-400 font-normal">100% On-Device • Zero Network</span>
                </button>

                {/* 3. OpenAI Direct */}
                <button
                  type="button"
                  onClick={() => {
                    audioService.playChirp(1200);
                    setConfig((c) => ({
                      ...c,
                      provider: 'OPENAI',
                      modelName: 'gpt-4o-mini',
                      customEndpoint: undefined
                    }));
                  }}
                  className={`p-2 rounded border text-left flex flex-col ${
                    config.provider === 'OPENAI'
                      ? 'border-cyan-400 bg-cyan-950/40 text-white font-bold'
                      : 'border-cyan-500/30 bg-black/50 text-cyan-400/80 hover:bg-cyan-950/40'
                  }`}
                >
                  <span className="font-orbitron text-[11px]">OPENAI (CLIENT DIRECT)</span>
                  <span className="text-[9px] text-cyan-400/70 font-normal">Volatile RAM Key • HTTPS Only</span>
                </button>

                {/* 4. Gemini Direct */}
                <button
                  type="button"
                  onClick={() => {
                    audioService.playChirp(1200);
                    setConfig((c) => ({
                      ...c,
                      provider: 'GEMINI',
                      modelName: 'gemini-4-hydrogen',
                      customEndpoint: undefined
                    }));
                  }}
                  className={`p-2 rounded border text-left flex flex-col ${
                    config.provider === 'GEMINI'
                      ? 'border-cyan-400 bg-cyan-950/40 text-white font-bold'
                      : 'border-cyan-500/30 bg-black/50 text-cyan-400/80 hover:bg-cyan-950/40'
                  }`}
                >
                  <span className="font-orbitron text-[11px]">GEMINI (CLIENT DIRECT)</span>
                  <span className="text-[9px] text-cyan-400/70 font-normal">Direct Browser Query</span>
                </button>

                {/* 5. Anthropic Direct */}
                <button
                  type="button"
                  onClick={() => {
                    audioService.playChirp(1200);
                    setConfig((c) => ({
                      ...c,
                      provider: 'ANTHROPIC',
                      modelName: 'claude-3-5-sonnet-latest',
                      customEndpoint: undefined
                    }));
                  }}
                  className={`p-2 rounded border text-left flex flex-col ${
                    config.provider === 'ANTHROPIC'
                      ? 'border-cyan-400 bg-cyan-950/40 text-white font-bold'
                      : 'border-cyan-500/30 bg-black/50 text-cyan-400/80 hover:bg-cyan-950/40'
                  }`}
                >
                  <span className="font-orbitron text-[11px]">ANTHROPIC (CLIENT DIRECT)</span>
                  <span className="text-[9px] text-cyan-400/70 font-normal">Volatile RAM Key • HTTPS Only</span>
                </button>
              </div>
            </div>

            {/* Backend Orchestrator Controls (When BACKEND mode selected) */}
            {config.provider === 'BACKEND' && (
              <div className="space-y-3 p-3 bg-black/60 rounded border border-cyan-500/30">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] text-cyan-400/90 font-bold">
                    SERVER ORCHESTRATION MODE:
                  </label>
                  <span className="text-[9px] text-cyan-300">
                    Active: <strong className="text-white">{config.backendMode || 'AUTO'}</strong>
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => handleModeChange('AUTO')}
                    className={`p-2 rounded border text-center flex flex-col items-center justify-center ${
                      (config.backendMode || 'AUTO') === 'AUTO'
                        ? 'border-cyan-400 bg-cyan-950 text-white font-bold'
                        : 'border-cyan-500/20 bg-black/40 text-cyan-400/70 hover:bg-cyan-950/30'
                    }`}
                  >
                    <span className="font-orbitron text-[10px]">AUTO DUAL</span>
                    <span className="text-[8px] text-cyan-300 font-normal">Gemini &rarr; Groq</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleModeChange('GEMINI_ONLY')}
                    className={`p-2 rounded border text-center flex flex-col items-center justify-center ${
                      config.backendMode === 'GEMINI_ONLY'
                        ? 'border-cyan-400 bg-cyan-950 text-white font-bold'
                        : 'border-cyan-500/20 bg-black/40 text-cyan-400/70 hover:bg-cyan-950/30'
                    }`}
                  >
                    <span className="font-orbitron text-[10px]">GEMINI ONLY</span>
                    <span className="text-[8px] text-cyan-300 font-normal">Primary Only</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleModeChange('GROQ_ONLY')}
                    className={`p-2 rounded border text-center flex flex-col items-center justify-center ${
                      config.backendMode === 'GROQ_ONLY'
                        ? 'border-cyan-400 bg-cyan-950 text-white font-bold'
                        : 'border-cyan-500/20 bg-black/40 text-cyan-400/70 hover:bg-cyan-950/30'
                    }`}
                  >
                    <span className="font-orbitron text-[10px]">GROQ ONLY</span>
                    <span className="text-[8px] text-cyan-300 font-normal">Ultra-Fast LLaMA</span>
                  </button>
                </div>

                {/* Live Backend Provider Probe Report */}
                {backendStatus && (
                  <div className="p-2 rounded bg-black/40 border border-cyan-500/20 space-y-1.5 text-[9px]">
                    <div className="text-[9px] text-white font-bold border-b border-cyan-500/20 pb-1">
                      SERVER PROVIDER HEALTH REPORT:
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-cyan-300">Gemini (Primary):</span>
                      <span
                        className={`font-bold ${
                          backendStatus.gemini.status === 'connected'
                            ? 'text-emerald-400'
                            : backendStatus.gemini.status === 'not_configured'
                            ? 'text-zinc-400'
                            : 'text-amber-400'
                        }`}
                      >
                        {backendStatus.gemini.status.toUpperCase()} ({backendStatus.gemini.model})
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-cyan-300">Groq (Fallback):</span>
                      <span
                        className={`font-bold ${
                          backendStatus.groq.status === 'connected'
                            ? 'text-emerald-400'
                            : backendStatus.groq.status === 'not_configured'
                            ? 'text-zinc-400'
                            : 'text-amber-400'
                        }`}
                      >
                        {backendStatus.groq.status.toUpperCase()} ({backendStatus.groq.model})
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Direct Client-Side Volatile Key Input (for OPENAI, ANTHROPIC, or client-key GEMINI) */}
            {config.provider !== 'LOCAL' && config.provider !== 'BACKEND' && (
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
                    placeholder={
                      config.provider === 'GEMINI'
                        ? 'AIza...'
                        : config.provider === 'ANTHROPIC'
                        ? 'sk-ant-...'
                        : 'sk-...'
                    }
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
                        ? 'gemini-4-hydrogen'
                        : config.provider === 'ANTHROPIC'
                        ? 'claude-3-5-sonnet-latest'
                        : 'gpt-4o-mini or custom model'
                    }
                    className="w-full bg-cyan-950/50 border border-cyan-500/40 rounded px-2.5 py-1 text-white focus:outline-none focus:border-cyan-400"
                  />
                </div>
              </div>
            )}

            {/* Architecture & Security Notice */}
            <div className="p-2.5 bg-cyan-950/30 border border-cyan-500/20 rounded flex items-start space-x-2 text-[10px]">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <p className="text-cyan-300/80 leading-relaxed">
                <strong className="text-white">Security Architecture:</strong> The secure backend reads keys from server environment variables (<code className="text-cyan-300">server/.env</code>) via <code className="text-cyan-300">GEMINI_API_KEY</code> and <code className="text-cyan-300">GROQ_API_KEY</code>. Client browsers never receive or persist credentials.
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
