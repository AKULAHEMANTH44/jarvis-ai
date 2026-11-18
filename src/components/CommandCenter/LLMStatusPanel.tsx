import React, { useEffect, useState } from 'react';
import { Sparkles, RefreshCw, ShieldAlert, Cpu, ArrowRightLeft } from 'lucide-react';
import { contextualAI } from '../../services/contextualAI';
import { BackendLLMStatusResponse, LLMMode } from '../../types/assistant';

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
  const [backendStatus, setBackendStatus] = useState<BackendLLMStatusResponse | null>(null);
  const [backendProbeFailed, setBackendProbeFailed] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [currentMode, setCurrentMode] = useState<LLMMode>(
    contextualAI.getConfig().backendMode || 'AUTO'
  );

  const fetchStatus = async () => {
    setIsLoading(true);
    try {
      const status = await contextualAI.getBackendStatus(currentMode);
      setBackendStatus(status);
      setBackendProbeFailed(!status);
      if (status?.mode) {
        setCurrentMode(status.mode);
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchStatus();
    const interval = setInterval(() => void fetchStatus(), 30000);
    return () => clearInterval(interval);
  }, []);

  const handleCycleMode = async () => {
    const nextMode: LLMMode =
      currentMode === 'AUTO'
        ? 'GEMINI_ONLY'
        : currentMode === 'GEMINI_ONLY'
        ? 'GROQ_ONLY'
        : 'AUTO';
    setCurrentMode(nextMode);
    await contextualAI.setBackendMode(nextMode);
    await fetchStatus();
  };

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'connected':
        return 'text-emerald-400 bg-emerald-950/60 border-emerald-500/40';
      case 'rate_limited':
        return 'text-amber-400 bg-amber-950/60 border-amber-500/40';
      case 'not_configured':
        return 'text-zinc-400 bg-zinc-900/60 border-zinc-700/40';
      case 'error':
        return 'text-rose-400 bg-rose-950/60 border-rose-500/40';
      default:
        return 'text-cyan-400 bg-cyan-950/60 border-cyan-500/40';
    }
  };

  const getStatusDot = (status?: string) => {
    switch (status) {
      case 'connected':
        return 'bg-emerald-400';
      case 'rate_limited':
        return 'bg-amber-400';
      case 'not_configured':
        return 'bg-zinc-600';
      case 'error':
        return 'bg-rose-500';
      default:
        return 'bg-cyan-500';
    }
  };

  const isGeminiConnected = backendStatus?.gemini?.status === 'connected';
  const isGroqConnected = backendStatus?.groq?.status === 'connected';

  return (
    <div className="bg-[#020814]/90 border border-cyan-500/30 rounded-xl p-3 flex flex-col space-y-2.5 shadow-[0_0_20px_rgba(0,240,255,0.1)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-cyan-500/20 pb-1.5">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
          <span className="font-orbitron font-bold text-[11px] text-white tracking-wider">
            LLM NEURAL BACKEND
          </span>
          <button
            type="button"
            onClick={handleCycleMode}
            title="Click to cycle orchestrator mode: AUTO -> GEMINI_ONLY -> GROQ_ONLY"
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono border border-cyan-500/40 bg-cyan-950/40 text-cyan-300 hover:border-cyan-400 hover:text-white transition-all ml-1"
          >
            <ArrowRightLeft className="w-2.5 h-2.5" />
            <span>MODE: {currentMode}</span>
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchStatus}
            disabled={isLoading}
            title="Probe backend provider health"
            className="text-cyan-400 hover:text-white transition-colors"
          >
            <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin text-cyan-200' : ''}`} />
          </button>
          <button
            type="button"
            onClick={onOpenAIConfig}
            className="text-[9px] font-mono text-cyan-300 hover:text-white underline decoration-cyan-500/50"
          >
            Configure
          </button>
        </div>
      </div>

      {/* Primary & Fallback Provider Grid */}
      <div className="grid grid-cols-2 gap-2 font-mono text-[10px]">
        {/* Gemini Primary Provider Card */}
        <div className="p-2 rounded bg-black/50 border border-cyan-500/20 flex flex-col justify-between space-y-1 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-white font-bold tracking-wide flex items-center gap-1">
              <span>Google Gemini</span>
              <span className="text-[8px] px-1 py-0.2 rounded bg-cyan-950 border border-cyan-500/30 text-cyan-300">
                PRIMARY
              </span>
            </span>
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${getStatusDot(backendStatus?.gemini?.status)}`}
            />
          </div>
          <div className="text-[9px] text-cyan-400/80 truncate">
            Model: {backendStatus?.gemini?.model || 'gemini-4-hydrogen'}
          </div>
          <div className="flex items-center justify-between pt-0.5">
            <span
              className={`px-1.5 py-0.5 rounded text-[8px] border font-bold uppercase ${getStatusColor(
                backendStatus?.gemini?.status
              )}`}
            >
              {backendStatus?.gemini?.status === 'connected'
                ? 'CONNECTED'
                : backendStatus?.gemini?.status === 'not_configured'
                ? 'NO SERVER KEY'
                : backendStatus?.gemini?.status === 'rate_limited'
                ? 'RATE LIMITED'
                : 'STANDBY / OFFLINE'}
            </span>
            {currentMode === 'GROQ_ONLY' && (
              <span className="text-[8px] text-zinc-500">BYPASSED</span>
            )}
          </div>
        </div>

        {/* Groq Fallback Provider Card */}
        <div className="p-2 rounded bg-black/50 border border-cyan-500/20 flex flex-col justify-between space-y-1 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-white font-bold tracking-wide flex items-center gap-1">
              <span>Groq Ultra-Fast</span>
              <span className="text-[8px] px-1 py-0.2 rounded bg-amber-950/60 border border-amber-500/30 text-amber-300">
                FALLBACK
              </span>
            </span>
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${getStatusDot(backendStatus?.groq?.status)}`}
            />
          </div>
          <div className="text-[9px] text-cyan-400/80 truncate">
            Model: {backendStatus?.groq?.model || 'llama-3.3-70b-versatile'}
          </div>
          <div className="flex items-center justify-between pt-0.5">
            <span
              className={`px-1.5 py-0.5 rounded text-[8px] border font-bold uppercase ${getStatusColor(
                backendStatus?.groq?.status
              )}`}
            >
              {backendStatus?.groq?.status === 'connected'
                ? currentMode === 'GROQ_ONLY'
                  ? 'ACTIVE PRIMARY'
                  : 'READY (FALLBACK)'
                : backendStatus?.groq?.status === 'not_configured'
                ? 'NO SERVER KEY'
                : backendStatus?.groq?.status === 'rate_limited'
                ? 'RATE LIMITED'
                : 'STANDBY / OFFLINE'}
            </span>
            {currentMode === 'GEMINI_ONLY' && (
              <span className="text-[8px] text-zinc-500">DISABLED</span>
            )}
          </div>
        </div>
      </div>

      {/* Auxiliary Providers Status Ribbon */}
      <div className="grid grid-cols-2 gap-1.5 font-mono text-[9px] border-t border-cyan-500/20 pt-1.5">
        <div className="flex items-center justify-between px-2 py-1 rounded bg-black/30 border border-cyan-500/10 text-cyan-300/80">
          <span className="flex items-center gap-1">
            <Cpu className="w-3 h-3 text-emerald-400" />
            <span>JARVIS Local Core MK-7</span>
          </span>
          <span className="text-emerald-400 font-bold">100% READY</span>
        </div>
        <div className="flex items-center justify-between px-2 py-1 rounded bg-black/30 border border-cyan-500/10 text-cyan-300/80">
          <span className="truncate">Active Provider:</span>
          <span className="text-white font-bold truncate ml-1">
            {backendStatus?.activeProvider === 'GEMINI'
              ? 'Gemini Primary'
              : backendStatus?.activeProvider === 'GROQ'
              ? 'Groq Fallback'
              : provider === 'LOCAL'
              ? 'Local Autonomous'
              : hasApiKey
              ? provider
              : 'Standby / Fallback'}
          </span>
        </div>
      </div>

      {/* Notice if backend unreachable or neither key is configured */}
      {backendProbeFailed ? (
        <div className="flex items-center gap-1.5 text-[8px] text-amber-300/90 bg-amber-950/30 border border-amber-500/30 rounded px-2 py-1">
          <ShieldAlert className="w-3 h-3 text-amber-400 shrink-0" />
          <span className="truncate">
            Backend /api/llm/status unreachable. Local autonomous fallback active.
          </span>
        </div>
      ) : (
        backendStatus &&
        !isGeminiConnected &&
        !isGroqConnected && (
          <div className="flex items-center gap-1.5 text-[8px] text-amber-300/90 bg-amber-950/30 border border-amber-500/30 rounded px-2 py-1">
            <ShieldAlert className="w-3 h-3 text-amber-400 shrink-0" />
            <span className="truncate">
              Configure GEMINI_API_KEY / GROQ_API_KEY in server/.env for live cloud intelligence.
            </span>
          </div>
        )
      )}
    </div>
  );
};
