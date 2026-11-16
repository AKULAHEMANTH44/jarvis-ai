import React, { useState, useEffect, useRef } from 'react';
import {
  AISuggestion,
  ConversationSessionSummary,
  ConversationTurn,
  ExecutionPlan,
  IntelligenceStatus,
  MemoryCategory,
  MemoryConsentCandidate,
  MemoryEntry,
  ToolActivityRecord,
  ToolDefinition,
  WorkspaceContextSnapshot
} from '../../types/assistant';
import { intelligenceEngine, IntelligenceStateSnapshot } from '../../services/intelligenceEngine';
import { conversationManager } from '../../services/conversationManager';
import { memoryManager } from '../../services/memoryManager';
import { suggestionEngine } from '../../services/suggestionEngine';
import { planningEngine } from '../../services/planningEngine';
import { toolRegistry } from '../../services/toolRegistry';
import { contextualAI } from '../../services/contextualAI';
import { audioService } from '../../services/soundFx';
import {
  Brain,
  Check,
  Database,
  Lightbulb,
  ListChecks,
  Plus,
  Send,
  ShieldAlert,
  Sparkles,
  Square,
  Trash2,
  Wrench,
  X,
  Edit3,
  Bookmark,
  Play,
  Settings,
  AlertTriangle
} from 'lucide-react';

export type IntelligenceTabId = 'CHAT' | 'PLAN' | 'SUGGESTIONS' | 'MEMORY' | 'TOOLS';

interface IntelligenceHUDProps {
  intelligenceState: IntelligenceStateSnapshot;
  workspaceSnapshot: WorkspaceContextSnapshot;
  requestedTab?: { tab: IntelligenceTabId; nonce: number } | null;
  onSubmitPrompt: (prompt: string) => void;
  onCancelRequest: () => void;
  onOpenAIConfig: () => void;
  onOpenTasksDrawer: () => void;
  onClose: () => void;
}

const MEMORY_CATEGORIES: { id: MemoryCategory; label: string }[] = [
  { id: 'USER_PREFERENCE', label: 'Preference' },
  { id: 'PROJECT_INFO', label: 'Project Info' },
  { id: 'APP_CONFIG', label: 'App Config' },
  { id: 'FREQUENT_COMMAND', label: 'Command' },
  { id: 'WORKING_CONTEXT', label: 'Working Context' }
];

function getStatusBadgeStyle(status: IntelligenceStatus): string {
  switch (status) {
    case 'STANDBY':
      return 'border-cyan-500/35 bg-cyan-950/40 text-cyan-300';
    case 'LISTENING':
      return 'border-emerald-400/60 bg-emerald-950/50 text-emerald-300';
    case 'UNDERSTANDING':
    case 'ANALYZING':
    case 'PLANNING':
    case 'EXECUTING':
    case 'VERIFYING':
      return 'border-amber-400/60 bg-amber-950/50 text-amber-200';
    case 'AWAITING_APPROVAL':
      return 'border-amber-400 bg-amber-900/50 text-amber-100 font-bold';
    case 'RESPONDING':
    case 'SUGGESTING':
      return 'border-cyan-400 bg-cyan-500/20 text-white';
    case 'ERROR':
      return 'border-red-500/65 bg-red-950/50 text-red-300';
  }
}

export const IntelligenceHUD: React.FC<IntelligenceHUDProps> = ({
  intelligenceState,
  workspaceSnapshot,
  requestedTab,
  onSubmitPrompt,
  onCancelRequest,
  onOpenAIConfig,
  onOpenTasksDrawer,
  onClose
}) => {
  const [activeTab, setActiveTab] = useState<IntelligenceTabId>('CHAT');
  const [promptInput, setPromptInput] = useState('');
  const [sessionList, setSessionList] = useState<ConversationSessionSummary[]>(() =>
    conversationManager.listSessions()
  );
  const [currentSessionId, setCurrentSessionId] = useState<string>(() =>
    conversationManager.getCurrentSessionId()
  );
  const [turns, setTurns] = useState<ConversationTurn[]>(() => conversationManager.getTurns());
  const [memories, setMemories] = useState<MemoryEntry[]>(() => memoryManager.getMemories());
  const [memoryEnabled, setMemoryEnabled] = useState<boolean>(() => memoryManager.isEnabled());
  const [pendingMemoryCandidates, setPendingMemoryCandidates] = useState<MemoryConsentCandidate[]>(
    () => memoryManager.getPendingCandidates()
  );
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [newMemCategory, setNewMemCategory] = useState<MemoryCategory>('PROJECT_INFO');
  const [newMemKey, setNewMemKey] = useState('');
  const [newMemValue, setNewMemValue] = useState('');
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const [suggestions, setSuggestions] = useState<AISuggestion[]>(() =>
    suggestionEngine.getSuggestions()
  );
  const [plans, setPlans] = useState<ExecutionPlan[]>(() => planningEngine.getPlans());
  const [toolHistory, setToolHistory] = useState<ToolActivityRecord[]>(() =>
    toolRegistry.getActivityHistory(30)
  );
  const [registeredTools] = useState<ToolDefinition[]>(() => toolRegistry.listTools());

  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (requestedTab) {
      setActiveTab(requestedTab.tab);
    }
  }, [requestedTab]);

  const syncConversation = () => {
    setSessionList(conversationManager.listSessions());
    setCurrentSessionId(conversationManager.getCurrentSessionId());
    setTurns(conversationManager.getTurns());
  };

  useEffect(() => {
    syncConversation();
  }, [intelligenceState]);

  useEffect(() => {
    const unsubMem = memoryManager.subscribe(() => {
      setMemories(memoryManager.getMemories());
      setMemoryEnabled(memoryManager.isEnabled());
      setPendingMemoryCandidates(memoryManager.getPendingCandidates());
    });
    const unsubSug = suggestionEngine.subscribe(() => {
      setSuggestions(suggestionEngine.getSuggestions());
    });
    const unsubPlan = planningEngine.subscribe(() => {
      setPlans(planningEngine.getPlans());
    });
    const unsubTool = toolRegistry.subscribe(() => {
      setToolHistory(toolRegistry.getActivityHistory(30));
    });
    return () => {
      unsubMem();
      unsubSug();
      unsubPlan();
      unsubTool();
    };
  }, []);

  useEffect(() => {
    if (chatScrollRef.current && activeTab === 'CHAT') {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [turns, activeTab]);

  const isBusy =
    intelligenceState.status === 'UNDERSTANDING' ||
    intelligenceState.status === 'ANALYZING' ||
    intelligenceState.status === 'PLANNING' ||
    intelligenceState.status === 'EXECUTING' ||
    intelligenceState.status === 'VERIFYING';

  const cfg = contextualAI.getConfig();
  const hasKey = contextualAI.hasApiKey();
  const activeSuggestions = suggestions.filter((s) => s.status === 'ACTIVE');
  const savedSuggestions = suggestions.filter((s) => s.status === 'SAVED');
  const latestPlan = plans[0] || null;
  const sessionSummary = conversationManager.summarizeSession(currentSessionId);

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = promptInput.trim();
    if (!trimmed) return;
    audioService.playChirp(1350);
    setPromptInput('');
    onSubmitPrompt(trimmed);
  };

  const handleSaveMemory = (e: React.FormEvent) => {
    e.preventDefault();
    setMemoryError(null);
    const res = memoryManager.saveMemory({
      category: newMemCategory,
      key: newMemKey,
      value: newMemValue,
      source: 'USER_EXPLICIT'
    });
    if (!res.persistence.ok) {
      setMemoryError(res.persistence.error || 'Failed to persist memory.');
      return;
    }
    setNewMemKey('');
    setNewMemValue('');
    audioService.playChirp(1400);
  };

  return (
    <div
      data-testid="intelligence-brain-panel"
      className="flex flex-col w-full max-h-[60vh] rounded-xl bg-[#020914]/95 border border-cyan-500/40 shadow-[0_0_32px_rgba(0,240,255,0.22)] overflow-hidden text-cyan-200 font-mono"
    >
      {/* Top Header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-cyan-500/25 bg-black/50 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Brain className="w-4 h-4 text-cyan-400 shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-orbitron font-bold text-[10.5px] tracking-[0.15em] text-white truncate">
                AI INTELLIGENCE BRAIN
              </span>
              <span
                data-testid="brain-status-pill"
                className={`px-1.5 py-0.5 rounded border text-[9px] font-orbitron tracking-wider whitespace-nowrap ${getStatusBadgeStyle(
                  intelligenceState.status
                )}`}
              >
                {intelligenceState.status}
              </span>
            </div>
            <p className="text-[9.5px] text-cyan-400/75 truncate">
              {intelligenceState.activitySummary}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              audioService.playChirp(1200);
              onOpenAIConfig();
            }}
            title="Configure AI Provider & Volatile Session Key"
            className={`flex items-center gap-1 px-2 py-1 rounded border text-[9px] font-orbitron transition-colors ${
              cfg.provider === 'LOCAL'
                ? 'border-cyan-500/40 bg-cyan-950/40 text-cyan-300'
                : hasKey
                ? 'border-emerald-400/60 bg-emerald-950/40 text-emerald-300'
                : 'border-amber-400/60 bg-amber-950/40 text-amber-200'
            }`}
          >
            <Settings className="w-3 h-3" />
            <span>
              {cfg.provider}
              {cfg.provider !== 'LOCAL' ? (hasKey ? ' · READY' : ' · NO KEY') : ''}
            </span>
          </button>

          {isBusy && (
            <button
              type="button"
              onClick={() => {
                audioService.playChirp(900);
                onCancelRequest();
              }}
              aria-label="Cancel Active AI Request"
              className="flex items-center gap-1 px-2 py-1 rounded border border-red-400/60 bg-red-950/50 text-red-200 hover:bg-red-900/60 text-[9px] font-orbitron"
            >
              <Square className="w-2.5 h-2.5" />
              <span>CANCEL</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              audioService.playChirp(1000);
              onClose();
            }}
            aria-label="Close Intelligence Brain"
            className="p-1 rounded border border-cyan-500/30 text-cyan-300 hover:text-white hover:border-cyan-400"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Sub-Navigation Tabs */}
      <div
        role="tablist"
        aria-label="Intelligence Brain Sections"
        className="flex items-center gap-1 px-2.5 py-1.5 border-b border-cyan-500/20 bg-black/30 overflow-x-auto no-scrollbar shrink-0"
      >
        {(
          [
            { id: 'CHAT', label: 'CONTEXT', icon: Sparkles },
            { id: 'PLAN', label: `PLAN${latestPlan ? ` (${latestPlan.steps.length})` : ''}`, icon: ListChecks },
            {
              id: 'SUGGESTIONS',
              label: `SUGGESTIONS${activeSuggestions.length > 0 ? ` (${activeSuggestions.length})` : ''}`,
              icon: Lightbulb
            },
            { id: 'MEMORY', label: `MEMORY (${memories.length})`, icon: Database },
            { id: 'TOOLS', label: `TOOLS (${toolHistory.length})`, icon: Wrench }
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => {
                audioService.playChirp(1250);
                setActiveTab(tab.id);
              }}
              className={`flex items-center gap-1 px-2 py-1 rounded border text-[9.5px] font-orbitron tracking-wider whitespace-nowrap shrink-0 transition-colors ${
                selected
                  ? 'border-cyan-400 bg-cyan-500/25 text-white font-bold'
                  : 'border-transparent text-cyan-300/75 hover:text-white hover:border-cyan-500/30'
              }`}
            >
              <Icon className="w-3 h-3" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5 text-[11px]">
        {/* Consequential Tool Approval Banner (Always surfaced prominently if pending) */}
        {intelligenceState.pendingApproval && (
          <div
            data-testid="pending-tool-approval-card"
            className="p-2.5 rounded-lg border border-amber-400/75 bg-amber-950/45 text-amber-100 space-y-2"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5 font-orbitron text-[10px] text-amber-300 font-bold">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>CONFIRMATION REQUIRED: {intelligenceState.pendingApproval.toolName}</span>
              </div>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-400/40">
                {intelligenceState.pendingApproval.permissionLevel}
              </span>
            </div>
            <p className="text-[10.5px] text-amber-100/90">
              {intelligenceState.pendingApproval.reason}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  audioService.playChirp(1450);
                  void intelligenceEngine.resolvePendingToolApproval(true);
                }}
                className="flex items-center gap-1 px-2.5 py-1 rounded border border-emerald-400/70 bg-emerald-950/60 hover:bg-emerald-900/70 text-emerald-200 text-[10px] font-orbitron"
              >
                <Check className="w-3 h-3" />
                <span>APPROVE ACTION</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  audioService.playChirp(850);
                  void intelligenceEngine.resolvePendingToolApproval(false);
                }}
                className="flex items-center gap-1 px-2.5 py-1 rounded border border-red-400/60 bg-red-950/50 hover:bg-red-900/60 text-red-200 text-[10px] font-orbitron"
              >
                <X className="w-3 h-3" />
                <span>DENY</span>
              </button>
            </div>
          </div>
        )}

        {/* Memory Consent Banner (No silent persistence) */}
        {pendingMemoryCandidates.length > 0 && (
          <div
            data-testid="memory-consent-card"
            className="p-2.5 rounded-lg border border-cyan-400/60 bg-cyan-950/40 space-y-1.5"
          >
            <div className="flex items-center justify-between text-[9.5px] font-orbitron text-cyan-200">
              <span>REMEMBER THIS FOR FUTURE SESSIONS?</span>
              <span className="text-cyan-400/80">{pendingMemoryCandidates[0].category}</span>
            </div>
            <p className="text-[10.5px] text-white">
              <strong>{pendingMemoryCandidates[0].key}:</strong> {pendingMemoryCandidates[0].value}
            </p>
            <p className="text-[9.5px] text-cyan-300/75">{pendingMemoryCandidates[0].reason}</p>
            <div className="flex items-center gap-2 pt-0.5">
              <button
                type="button"
                onClick={() => {
                  const res = memoryManager.approveCandidate(pendingMemoryCandidates[0].id);
                  if (!res.persistence.ok) {
                    setMemoryError(res.persistence.error || 'Could not save memory.');
                  } else {
                    audioService.playChirp(1400);
                  }
                }}
                className="px-2 py-0.5 rounded border border-emerald-400/60 bg-emerald-950/50 text-emerald-200 text-[9.5px] font-orbitron hover:bg-emerald-900/60"
              >
                SAVE TO MEMORY
              </button>
              <button
                type="button"
                onClick={() => {
                  audioService.playChirp(950);
                  memoryManager.dismissCandidate(pendingMemoryCandidates[0].id);
                }}
                className="px-2 py-0.5 rounded border border-cyan-500/35 text-cyan-300 text-[9.5px] font-orbitron hover:text-white"
              >
                DISMISS
              </button>
            </div>
          </div>
        )}

        {/* TAB 1: CONTEXTUAL CONVERSATION */}
        {activeTab === 'CHAT' && (
          <div className="space-y-2.5">
            {/* Session Controls */}
            <div className="flex flex-wrap items-center justify-between gap-2 p-2 rounded border border-cyan-500/25 bg-black/40">
              <div className="flex items-center gap-1.5 min-w-0">
                <label htmlFor="brain-session-select" className="text-[9.5px] text-cyan-400/80">
                  SESSION:
                </label>
                <select
                  id="brain-session-select"
                  value={currentSessionId}
                  onChange={(e) => {
                    conversationManager.switchSession(e.target.value);
                    syncConversation();
                  }}
                  className="bg-black/75 border border-cyan-500/35 rounded px-1.5 py-0.5 text-[10px] text-white max-w-[180px]"
                >
                  {sessionList.map((s) => (
                    <option key={s.sessionId} value={s.sessionId}>
                      {s.topic} ({s.turnCount})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    audioService.playChirp(1300);
                    conversationManager.createSession(`Session ${sessionList.length + 1}`);
                    syncConversation();
                  }}
                  className="flex items-center gap-1 px-2 py-0.5 rounded border border-cyan-500/40 bg-cyan-950/40 text-cyan-200 hover:text-white text-[9.5px]"
                >
                  <Plus className="w-3 h-3" />
                  <span>NEW</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    audioService.playChirp(950);
                    conversationManager.clearCurrentSession();
                    syncConversation();
                  }}
                  className="flex items-center gap-1 px-2 py-0.5 rounded border border-cyan-500/30 text-cyan-300/80 hover:text-white text-[9.5px]"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>CLEAR</span>
                </button>
              </div>
            </div>

            {sessionSummary && sessionSummary.turnCount > 0 && (
              <div className="px-2.5 py-1.5 rounded border border-cyan-500/20 bg-cyan-950/20 text-[10px] text-cyan-300/85">
                {sessionSummary.summaryText}
              </div>
            )}

            {/* Turn Feed */}
            <div
              ref={chatScrollRef}
              className="h-44 overflow-y-auto space-y-2 pr-1 scroll-smooth"
            >
              {turns.length === 0 ? (
                <div className="p-3 rounded border border-cyan-500/20 bg-black/35 text-[10.5px] text-cyan-300/80 space-y-1.5">
                  <p>
                    Contextual Brain ready for <strong>{workspaceSnapshot.selectedObjectName}</strong> ({workspaceSnapshot.objectCount} object{workspaceSnapshot.objectCount === 1 ? '' : 's'} active).
                  </p>
                  <p className="text-[9.5px] text-cyan-400/75">
                    Try: "Inspect my current workspace", "Prepare my project for demonstration", "Calculate 24 * 18", or "What formats are supported?".
                  </p>
                </div>
              ) : (
                turns.map((t) => (
                  <div
                    key={t.id}
                    className={`p-2 rounded border ${
                      t.role === 'user'
                        ? 'border-cyan-400/45 bg-black/55 text-white ml-4'
                        : 'border-cyan-500/30 bg-cyan-950/30 text-cyan-100 mr-2'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-[9px] text-cyan-400/70 mb-1">
                      <span className="font-orbitron font-bold">
                        {t.role === 'user' ? 'STARK // USER' : 'J.A.R.V.I.S. BRAIN'}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {t.intent && (
                          <span className="px-1 rounded bg-cyan-500/15 border border-cyan-500/25">
                            {t.intent}
                          </span>
                        )}
                        <span>{new Date(t.timestamp).toLocaleTimeString()}</span>
                      </div>
                    </div>
                    <p className="leading-snug whitespace-pre-wrap">{t.text}</p>
                    {t.toolNames && t.toolNames.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {t.toolNames.map((tool) => (
                          <span
                            key={tool}
                            className="px-1.5 py-0.5 rounded bg-emerald-950/50 border border-emerald-400/40 text-emerald-300 text-[9px]"
                          >
                            VERIFIED TOOL: {tool}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {intelligenceState.lastError && (
              <div className="flex items-center gap-1.5 p-2 rounded border border-red-500/45 bg-red-950/40 text-red-200 text-[10px]">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-red-400" />
                <span>{intelligenceState.lastError}</span>
              </div>
            )}

            {/* Prompt Input */}
            <form onSubmit={handleChatSubmit} className="flex gap-1.5">
              <input
                type="text"
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                placeholder="Ask a contextual question, plan a task, or inspect workspace..."
                className="flex-1 bg-black/75 border border-cyan-500/40 rounded px-2.5 py-1.5 text-xs text-white placeholder-cyan-500/50 focus:outline-none focus:border-cyan-400"
              />
              <button
                type="submit"
                aria-label="Send to AI Brain"
                className="px-3 py-1.5 rounded border border-cyan-400 bg-cyan-500/20 hover:bg-cyan-500/35 text-white flex items-center gap-1 text-[10px] font-orbitron"
              >
                <Send className="w-3.5 h-3.5" />
                <span>ASK</span>
              </button>
            </form>
          </div>
        )}

        {/* TAB 2: MULTI-STEP PLAN */}
        {activeTab === 'PLAN' && (
          <div className="space-y-2.5">
            {!latestPlan ? (
              <div className="p-3 rounded border border-cyan-500/25 bg-black/40 space-y-2">
                <p className="text-cyan-200">
                  No structured multi-step plan active yet.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    audioService.playChirp(1300);
                    onSubmitPrompt('Prepare my project for demonstration');
                  }}
                  className="px-2.5 py-1 rounded border border-cyan-400/60 bg-cyan-500/20 hover:bg-cyan-500/35 text-white text-[10px] font-orbitron"
                >
                  GENERATE DEMO READINESS PLAN
                </button>
              </div>
            ) : (
              <div className="p-2.5 rounded border border-cyan-500/35 bg-black/45 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-orbitron text-[10.5px] font-bold text-white">
                      {latestPlan.objective}
                    </div>
                    <div className="text-[9.5px] text-cyan-400/80">
                      Status: <span className="text-white font-semibold">{latestPlan.status}</span>
                    </div>
                  </div>
                  <span className="px-1.5 py-0.5 rounded border border-cyan-500/35 text-[9px]">
                    {latestPlan.steps.length} STEPS
                  </span>
                </div>

                {latestPlan.constraints.length > 0 && (
                  <div className="p-2 rounded bg-cyan-950/25 border border-cyan-500/20 text-[9.5px] space-y-0.5">
                    <div className="font-orbitron text-cyan-300">CONSTRAINTS & LIMITS:</div>
                    {latestPlan.constraints.map((c, idx) => (
                      <div key={idx}>• {c}</div>
                    ))}
                  </div>
                )}

                {latestPlan.approaches.length > 0 && (
                  <div className="space-y-1">
                    <div className="font-orbitron text-[9.5px] text-cyan-300">EVALUATED APPROACHES:</div>
                    {latestPlan.approaches.map((a) => (
                      <div
                        key={a.id}
                        className={`p-1.5 rounded border text-[9.5px] ${
                          a.recommended
                            ? 'border-cyan-400/50 bg-cyan-950/35 text-white'
                            : 'border-cyan-500/20 bg-black/30 text-cyan-300/80'
                        }`}
                      >
                        <div className="font-semibold">{a.label}</div>
                        <div className="text-cyan-300/75">{a.tradeoff}</div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-1">
                  <div className="font-orbitron text-[9.5px] text-cyan-300">ORDERED EXECUTION STEPS:</div>
                  {latestPlan.steps.map((s, idx) => (
                    <div
                      key={s.id}
                      className="p-2 rounded border border-cyan-500/25 bg-black/50 space-y-0.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-white">
                          {idx + 1}. {s.title}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[8.5px] font-orbitron ${
                            s.status === 'COMPLETED'
                              ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-400/50'
                              : s.status === 'FAILED'
                              ? 'bg-red-950/60 text-red-300 border border-red-400/50'
                              : s.status === 'RUNNING'
                              ? 'bg-amber-950/60 text-amber-200 border border-amber-400/50'
                              : 'bg-cyan-950/40 text-cyan-300 border border-cyan-500/30'
                          }`}
                        >
                          {s.status}
                        </span>
                      </div>
                      <p className="text-[9.5px] text-cyan-300/80">{s.description}</p>
                      {s.verificationNote && (
                        <p className="text-[9.5px] text-emerald-300/90">{s.verificationNote}</p>
                      )}
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-1.5 pt-1">
                  {(latestPlan.status === 'AWAITING_APPROVAL' || latestPlan.status === 'DRAFT') && (
                    <button
                      type="button"
                      onClick={() => {
                        audioService.playActivationWhoosh();
                        void intelligenceEngine.approveAndExecutePlan(latestPlan.id);
                      }}
                      className="flex items-center gap-1 px-2.5 py-1 rounded border border-emerald-400/70 bg-emerald-950/50 hover:bg-emerald-900/60 text-emerald-200 text-[9.5px] font-orbitron"
                    >
                      <Play className="w-3 h-3" />
                      <span>APPROVE & EXECUTE</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      audioService.playChirp(1250);
                      if (planningEngine.sendPlanToTaskQueue(latestPlan.id)) {
                        onOpenTasksDrawer();
                      }
                    }}
                    className="px-2.5 py-1 rounded border border-cyan-400/50 bg-cyan-500/15 hover:bg-cyan-500/30 text-cyan-100 text-[9.5px] font-orbitron"
                  >
                    SEND TO TASK ENGINE
                  </button>
                  {latestPlan.status === 'AWAITING_APPROVAL' && (
                    <button
                      type="button"
                      onClick={() => {
                        audioService.playChirp(900);
                        planningEngine.cancelPlan(latestPlan.id);
                      }}
                      className="px-2.5 py-1 rounded border border-red-400/50 bg-red-950/40 text-red-200 text-[9.5px] font-orbitron"
                    >
                      CANCEL PLAN
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: CONTEXTUAL SUGGESTIONS */}
        {activeTab === 'SUGGESTIONS' && (
          <div className="space-y-2">
            {activeSuggestions.length === 0 && savedSuggestions.length === 0 ? (
              <div className="p-3 rounded border border-cyan-500/20 bg-black/40 text-cyan-300/80">
                No active suggestions right now. Suggestions appear when a workspace conflict, multi-part assembly, import issue, or optimization opportunity is detected.
              </div>
            ) : (
              <>
                {activeSuggestions.map((sug) => (
                  <div
                    key={sug.id}
                    className="p-2.5 rounded border border-cyan-500/35 bg-black/45 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-orbitron text-[10px] font-bold text-white">
                        {sug.title}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[8.5px] font-orbitron border ${
                          sug.priority === 'HIGH'
                            ? 'border-amber-400 text-amber-200 bg-amber-950/50'
                            : 'border-cyan-500/40 text-cyan-300 bg-cyan-950/40'
                        }`}
                      >
                        {sug.priority}
                      </span>
                    </div>
                    <p className="text-[10.5px] text-cyan-100">{sug.explanation}</p>
                    <p className="text-[9.5px] text-cyan-400/80">Reason: {sug.reason}</p>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          audioService.playChirp(1400);
                          void suggestionEngine.acceptSuggestion(sug.id);
                        }}
                        className="flex items-center gap-1 px-2 py-0.5 rounded border border-emerald-400/60 bg-emerald-950/50 text-emerald-200 text-[9.5px] font-orbitron"
                      >
                        <Check className="w-3 h-3" />
                        <span>ACCEPT</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          audioService.playChirp(1150);
                          suggestionEngine.saveForLater(sug.id);
                        }}
                        className="flex items-center gap-1 px-2 py-0.5 rounded border border-cyan-500/40 text-cyan-200 text-[9.5px] font-orbitron"
                      >
                        <Bookmark className="w-3 h-3" />
                        <span>SAVE LATER</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          audioService.playChirp(1250);
                          if (suggestionEngine.convertToTask(sug.id)) {
                            onOpenTasksDrawer();
                          }
                        }}
                        className="px-2 py-0.5 rounded border border-cyan-400/50 bg-cyan-500/15 text-cyan-100 text-[9.5px] font-orbitron"
                      >
                        TO TASK
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          audioService.playChirp(900);
                          suggestionEngine.rejectSuggestion(sug.id);
                        }}
                        className="px-2 py-0.5 rounded border border-red-400/40 text-red-200 text-[9.5px] font-orbitron"
                      >
                        DISMISS
                      </button>
                    </div>
                  </div>
                ))}

                {savedSuggestions.length > 0 && (
                  <div className="pt-1 space-y-1.5">
                    <div className="font-orbitron text-[9.5px] text-cyan-400/80">SAVED FOR LATER:</div>
                    {savedSuggestions.map((sug) => (
                      <div
                        key={sug.id}
                        className="p-2 rounded border border-cyan-500/25 bg-black/35 flex items-center justify-between gap-2"
                      >
                        <div>
                          <div className="text-white font-semibold text-[10px]">{sug.title}</div>
                          <div className="text-[9.5px] text-cyan-300/75">{sug.recommendedAction}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void suggestionEngine.acceptSuggestion(sug.id)}
                          className="px-2 py-0.5 rounded border border-emerald-400/60 text-emerald-200 text-[9px] font-orbitron shrink-0"
                        >
                          RUN
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* TAB 4: USER-CONTROLLED MEMORY */}
        {activeTab === 'MEMORY' && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2 p-2 rounded border border-cyan-500/25 bg-black/45">
              <div>
                <div className="font-orbitron text-[10px] text-white">
                  PERSISTENT MEMORY: {memoryEnabled ? 'ENABLED' : 'DISABLED'}
                </div>
                <p className="text-[9.5px] text-cyan-400/75">
                  Session history is volatile. Only explicitly approved items persist to localStorage (secrets blocked).
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const res = memoryManager.setEnabled(!memoryEnabled);
                  if (!res.ok) setMemoryError(res.error || 'Failed to update setting.');
                }}
                className={`px-2.5 py-1 rounded border text-[9.5px] font-orbitron shrink-0 ${
                  memoryEnabled
                    ? 'border-emerald-400/70 bg-emerald-950/50 text-emerald-200'
                    : 'border-amber-400/60 bg-amber-950/40 text-amber-200'
                }`}
              >
                {memoryEnabled ? 'DISABLE' : 'ENABLE'}
              </button>
            </div>

            {memoryError && (
              <div className="p-2 rounded border border-red-500/50 bg-red-950/40 text-red-200 text-[10px]">
                {memoryError}
              </div>
            )}

            <form onSubmit={handleSaveMemory} className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
              <select
                aria-label="Memory Category"
                value={newMemCategory}
                onChange={(e) => setNewMemCategory(e.target.value as MemoryCategory)}
                className="bg-black/75 border border-cyan-500/35 rounded px-2 py-1 text-[10px] text-white"
              >
                {MEMORY_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={newMemKey}
                onChange={(e) => setNewMemKey(e.target.value)}
                placeholder="Key (e.g. Render Pref)"
                className="bg-black/75 border border-cyan-500/35 rounded px-2 py-1 text-[10px] text-white placeholder-cyan-500/50"
              />
              <div className="flex gap-1">
                <input
                  type="text"
                  value={newMemValue}
                  onChange={(e) => setNewMemValue(e.target.value)}
                  placeholder="Value..."
                  className="flex-1 min-w-0 bg-black/75 border border-cyan-500/35 rounded px-2 py-1 text-[10px] text-white placeholder-cyan-500/50"
                />
                <button
                  type="submit"
                  className="px-2 py-1 rounded border border-cyan-400 bg-cyan-500/20 text-white text-[9.5px] font-orbitron"
                >
                  ADD
                </button>
              </div>
            </form>

            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
              {memories.length === 0 ? (
                <p className="text-[10px] text-cyan-400/75 p-2">
                  No user-approved memories stored yet.
                </p>
              ) : (
                memories.map((m) => (
                  <div
                    key={m.id}
                    className="p-2 rounded border border-cyan-500/25 bg-black/45 flex items-start justify-between gap-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-[9px] text-cyan-400/80">
                        <span className="px-1 rounded border border-cyan-500/30">{m.category}</span>
                        <span className="font-semibold text-white truncate">{m.key}</span>
                      </div>
                      {editingMemoryId === m.id ? (
                        <div className="flex gap-1 mt-1">
                          <input
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="flex-1 bg-black/80 border border-cyan-400 rounded px-1.5 py-0.5 text-[10px] text-white"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const res = memoryManager.updateMemory(m.id, { value: editValue });
                              if (!res.persistence.ok) {
                                setMemoryError(res.persistence.error || 'Update failed.');
                              } else {
                                setEditingMemoryId(null);
                              }
                            }}
                            className="px-1.5 py-0.5 rounded border border-emerald-400/60 text-emerald-200 text-[9px]"
                          >
                            SAVE
                          </button>
                        </div>
                      ) : (
                        <p className="text-[10.5px] text-cyan-100 break-words mt-0.5">{m.value}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        aria-label={`Edit ${m.key}`}
                        onClick={() => {
                          setEditingMemoryId(m.id);
                          setEditValue(m.value);
                        }}
                        className="p-1 rounded border border-cyan-500/30 text-cyan-300 hover:text-white"
                      >
                        <Edit3 className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${m.key}`}
                        onClick={() => {
                          const res = memoryManager.deleteMemory(m.id);
                          if (!res.ok) setMemoryError(res.error || 'Delete failed.');
                        }}
                        className="p-1 rounded border border-red-500/35 text-red-300 hover:text-white"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {memories.length > 0 && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    const res = memoryManager.clearAllMemories();
                    if (!res.ok) setMemoryError(res.error || 'Clear failed.');
                  }}
                  className="px-2.5 py-1 rounded border border-red-400/50 bg-red-950/40 text-red-200 text-[9.5px] font-orbitron"
                >
                  CLEAR ALL MEMORIES
                </button>
              </div>
            )}
          </div>
        )}

        {/* TAB 5: CONTROLLED TOOL ACTIVITY */}
        {activeTab === 'TOOLS' && (
          <div className="space-y-2">
            <div className="font-orbitron text-[9.5px] text-cyan-300">
              VERIFIED TOOL EXECUTION LOG ({toolHistory.length})
            </div>
            {toolHistory.length === 0 ? (
              <p className="text-[10px] text-cyan-400/75 p-2 rounded border border-cyan-500/20 bg-black/35">
                No controlled tool executions recorded in this session yet.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {toolHistory.map((rec) => (
                  <div
                    key={rec.id}
                    className="p-2 rounded border border-cyan-500/25 bg-black/45 space-y-0.5"
                  >
                    <div className="flex items-center justify-between gap-2 text-[9px]">
                      <span className="font-orbitron font-bold text-white">{rec.toolName}</span>
                      <div className="flex items-center gap-1">
                        <span className="px-1 rounded border border-cyan-500/30 text-cyan-300">
                          {rec.permissionLevel}
                        </span>
                        <span
                          className={`px-1 rounded border ${
                            rec.status === 'EXECUTED' && rec.verified
                              ? 'border-emerald-400/60 text-emerald-300'
                              : rec.status === 'PENDING_APPROVAL'
                              ? 'border-amber-400/60 text-amber-200'
                              : 'border-red-400/60 text-red-300'
                          }`}
                        >
                          {rec.status}
                          {rec.verified ? ' · VERIFIED' : ''}
                        </span>
                      </div>
                    </div>
                    <p className="text-[10px] text-cyan-200">{rec.summary}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="pt-1">
              <div className="font-orbitron text-[9.5px] text-cyan-300 mb-1">
                REGISTERED CONTROLLED TOOLS ({registeredTools.length})
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                {registeredTools.map((t) => (
                  <div
                    key={t.name}
                    className="p-1.5 rounded border border-cyan-500/20 bg-black/35 text-[9.5px]"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-semibold text-white truncate">{t.name}</span>
                      <span className="text-[8.5px] text-cyan-400/80 shrink-0">
                        {t.permissionLevel}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
