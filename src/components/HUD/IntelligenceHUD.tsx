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
  PendingAttachment,
  PermissionAuditEntry,
  PermissionCapabilityId,
  PermissionDisplayState,
  PersistentPermissionConfig,
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
import { permissionManager } from '../../services/permissionManager';
import {
  ALL_CAPABILITY_IDS,
  PERMISSION_CAPABILITY_METADATA,
  permissionPolicy
} from '../../services/permissionPolicy';
import { fileAccessService } from '../../services/fileAccessService';
import { ApprovedAppInfo, desktopBridge } from '../../services/desktopBridge';
import { musicService } from '../../services/musicService';
import { audioService } from '../../services/soundFx';
import {
  Brain,
  Check,
  Database,
  Lightbulb,
  ListChecks,
  Plus,
  RefreshCw,
  Send,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Wrench,
  X,
  Edit3,
  Bookmark,
  Play,
  Pause,
  Volume2,
  Settings,
  AlertTriangle,
  FolderOpen,
  ExternalLink,
  Search,
  Music,
  Paperclip,
  FileText,
  Image as ImageIcon
} from 'lucide-react';

export type IntelligenceTabId = 'CHAT' | 'PERMISSIONS' | 'PLAN' | 'SUGGESTIONS' | 'MEMORY' | 'TOOLS';

interface IntelligenceHUDProps {
  intelligenceState: IntelligenceStateSnapshot;
  workspaceSnapshot: WorkspaceContextSnapshot;
  requestedTab?: { tab: IntelligenceTabId; nonce: number } | null;
  onSubmitPrompt: (prompt: string, attachments?: PendingAttachment[]) => void;
  onCancelRequest: () => void;
  onOpenAIConfig: () => void;
  onOpenTasksDrawer: () => void;
  onOpenSetupWizard?: () => void;
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

function formatPermissionDisplayState(state: PermissionDisplayState): {
  label: string;
  className: string;
} {
  switch (state) {
    case 'GRANTED_BY_USER':
      return { label: 'Granted by user', className: 'text-emerald-300' };
    case 'DENIED_BY_USER':
      return { label: 'Denied by user', className: 'text-red-300' };
    case 'BLOCKED_BY_OS_OR_BROWSER':
      return { label: 'Blocked by OS / Browser', className: 'text-amber-300' };
    case 'TEMPORARILY_UNAVAILABLE':
      return { label: 'Temporarily unavailable', className: 'text-amber-200' };
    default:
      return { label: 'Not yet requested', className: 'text-cyan-300/80' };
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
  onOpenSetupWizard,
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
  const [permissionHistory, setPermissionHistory] = useState<PermissionAuditEntry[]>(() =>
    permissionManager.getAuditHistory(40)
  );
  const [policyConfig, setPolicyConfig] = useState<PersistentPermissionConfig>(() =>
    permissionPolicy.getConfig()
  );
  const [approvedApps, setApprovedApps] = useState<ApprovedAppInfo[]>([]);
  const [registeredTools] = useState<ToolDefinition[]>(() => toolRegistry.listTools());
  const [filePickBusy, setFilePickBusy] = useState(false);
  const [folderPathInput, setFolderPathInput] = useState('');
  const [folderPickNotice, setFolderPickNotice] = useState<string | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [memSearchQuery, setMemSearchQuery] = useState('');

  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);

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
    void desktopBridge.getApprovedApplications().then((apps) => {
      setApprovedApps(apps);
    });
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
    const unsubPerm = permissionManager.subscribe(() => {
      setPermissionHistory(permissionManager.getAuditHistory(40));
    });
    const unsubPolicy = permissionPolicy.subscribe(() => {
      setPolicyConfig(permissionPolicy.getConfig());
    });
    return () => {
      unsubMem();
      unsubSug();
      unsubPlan();
      unsubTool();
      unsubPerm();
      unsubPolicy();
    };
  }, []);

  useEffect(() => {
    if (activeTab === 'PERMISSIONS') {
      void permissionPolicy.refreshHardwarePermissionStates();
    }
  }, [activeTab]);

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
  const pendingPerm = intelligenceState.pendingPermission;
  const musicState = intelligenceState.musicState;

  const activeAgentRun = intelligenceState.activeAgentRun;
  const streamingText = intelligenceState.streamingText;
  const planHistory = planningEngine.getExecutionHistory();
  const visibleMemories = memSearchQuery.trim()
    ? memoryManager.searchMemories(memSearchQuery.trim())
    : memories;

  const handleAttachmentFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (files.length === 0) return;

    setAttachmentError(null);
    const nextList = [...pendingAttachments];
    for (const file of files) {
      if (nextList.length >= 3) {
        setAttachmentError('Maximum 3 attachments per prompt allowed.');
        break;
      }
      const res = await fileAccessService.prepareMultimodalAttachment(file);
      if (!res.ok || !res.attachment) {
        setAttachmentError(res.error || `Could not attach "${file.name}".`);
        continue;
      }
      nextList.push(res.attachment);
    }
    setPendingAttachments(nextList);
  };

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = promptInput.trim();
    if (!trimmed && pendingAttachments.length === 0) return;
    audioService.playChirp(1350);
    const toSend = pendingAttachments.length > 0 ? [...pendingAttachments] : undefined;
    setPromptInput('');
    setPendingAttachments([]);
    setAttachmentError(null);
    onSubmitPrompt(trimmed, toSend);
  };

  const handleTriggerFilePicker = async (accept?: string) => {
    if (filePickBusy) return;
    setFilePickBusy(true);
    setFolderPickNotice(null);
    try {
      const picked = await fileAccessService.pickFilesFromBrowser({ accept });
      if (picked.cancelled) {
        intelligenceEngine.clearInteractivePrompt();
        return;
      }
      const rawFiles = picked.files
        .map((m) => fileAccessService.getRawFile(m.fileId))
        .filter((f): f is File => Boolean(f));
      if (rawFiles.length > 0) {
        intelligenceEngine.handleUserPickedFiles(rawFiles, {
          preferMusicPlayback: Boolean(accept?.includes('audio'))
        });
      }
    } finally {
      setFilePickBusy(false);
    }
  };

  const handleTriggerFolderPicker = async () => {
    if (filePickBusy) return;
    setFilePickBusy(true);
    setFolderPickNotice(null);
    try {
      const res = await desktopBridge.pickFolder();
      if (res.cancelled) {
        intelligenceEngine.clearInteractivePrompt();
        return;
      }
      if (res.folder) {
        intelligenceEngine.handleUserPickedFolder(res.folder);
        return;
      }
      if (res.error) {
        setFolderPickNotice(res.error);
      }
    } finally {
      setFilePickBusy(false);
    }
  };

  const handleStageManualFolder = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = folderPathInput.trim();
    if (!cleaned) return;
    const name = cleaned.split(/[\\/]/).filter(Boolean).pop() || cleaned;
    setFolderPickNotice(null);
    setFolderPathInput('');
    const folderMeta = desktopBridge.setSelectedFolder(cleaned, name);
    intelligenceEngine.handleUserPickedFolder(folderMeta);
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
      className="flex flex-col w-full max-h-[62vh] rounded-xl bg-[#020914]/95 border border-cyan-500/40 shadow-[0_0_32px_rgba(0,240,255,0.22)] overflow-hidden text-cyan-200 font-mono"
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
              {intelligenceState.stageFeedback} · {intelligenceState.activitySummary}
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
            className={`flex items-center gap-1 px-2 py-1 rounded border text-[9px] font-orbitron transition-colors whitespace-nowrap shrink-0 ${
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
              className="flex items-center gap-1 px-2 py-1 rounded border border-red-400/60 bg-red-950/50 text-red-200 hover:bg-red-900/60 text-[9px] font-orbitron whitespace-nowrap shrink-0"
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
            {
              id: 'PERMISSIONS',
              label: `PERMISSIONS${pendingPerm ? ' (1)' : permissionHistory.length > 0 ? ` (${permissionHistory.length})` : ''}`,
              icon: ShieldCheck
            },
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
          const highlightPerm = tab.id === 'PERMISSIONS' && Boolean(pendingPerm);
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
                  : highlightPerm
                  ? 'border-amber-400/70 bg-amber-950/40 text-amber-200'
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
        {/* Phase 5 Permission Approval Request Card (Always surfaced prominently when pending) */}
        {pendingPerm && (
          <div
            data-testid="pending-permission-card"
            className="p-3 rounded-lg border border-amber-400/80 bg-amber-950/45 text-amber-100 space-y-2"
          >
            <div className="flex items-center justify-between gap-2 text-[10px] font-orbitron text-amber-300">
              <div className="flex items-center gap-1.5 font-bold">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>PERMISSION REQUEST</span>
              </div>
              <span className="tabular-nums text-[9.5px] text-amber-200/85">
                {pendingPerm.category} · RISK {pendingPerm.riskLevel} ·{' '}
                {pendingPerm.securityLevel === 'LEVEL_3_ALWAYS_CONFIRM'
                  ? 'LEVEL 3 ALWAYS CONFIRM'
                  : pendingPerm.securityLevel === 'LEVEL_2_SESSION_CONFIRMATION'
                  ? 'LEVEL 2 SESSION'
                  : 'LEVEL 1 PRE-APPROVED'}{' '}
                · {pendingPerm.status}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-1 text-[10.5px] border-t border-b border-amber-400/25 py-1.5">
              <div>
                <span className="text-amber-300/80">Action: </span>
                <span className="text-white font-semibold">{pendingPerm.requestedAction}</span>
              </div>
              <div className="break-all">
                <span className="text-amber-300/80">Target: </span>
                <span className="text-white font-semibold">{pendingPerm.target}</span>
              </div>
              <div>
                <span className="text-amber-300/80">Reason: </span>
                <span>{pendingPerm.reason}</span>
              </div>
              <div className="text-[9.5px] text-amber-200/80 tabular-nums">
                <span>Scope: {pendingPerm.requestedScope}</span>
                <span aria-hidden="true"> · </span>
                <span>
                  Expires: {new Date(pendingPerm.expiresAt).toLocaleTimeString()}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="permission-approve-btn"
                onClick={() => {
                  audioService.playChirp(1450);
                  void intelligenceEngine.resolvePendingPermission('APPROVE_ONCE', pendingPerm.id);
                }}
                className="flex items-center gap-1 px-3 py-1.5 rounded border border-emerald-400/75 bg-emerald-950/60 hover:bg-emerald-900/70 text-emerald-100 text-[10px] font-orbitron whitespace-nowrap"
              >
                <Check className="w-3 h-3" />
                <span>APPROVE ONCE</span>
              </button>
              {pendingPerm.securityLevel !== 'LEVEL_3_ALWAYS_CONFIRM' &&
                (pendingPerm.category === 'APPLICATION_LAUNCH' ||
                  pendingPerm.category === 'BROWSER_ACCESS' ||
                  pendingPerm.category === 'WEB_SEARCH' ||
                  pendingPerm.category === 'MUSIC_CONTROL' ||
                  pendingPerm.category === 'MUSIC_PLAYBACK' ||
                  pendingPerm.category === 'FOLDER_ACCESS') && (
                  <button
                    type="button"
                    data-testid="permission-always-allow-btn"
                    onClick={() => {
                      audioService.playChirp(1520);
                      void intelligenceEngine.grantAndApprovePendingPermission(pendingPerm.id);
                    }}
                    className="flex items-center gap-1 px-3 py-1.5 rounded border border-cyan-400/75 bg-cyan-950/65 hover:bg-cyan-900/75 text-cyan-100 text-[10px] font-orbitron whitespace-nowrap"
                  >
                    <ShieldCheck className="w-3 h-3" />
                    <span>APPROVE & ALWAYS ALLOW</span>
                  </button>
                )}
              <button
                type="button"
                data-testid="permission-deny-btn"
                onClick={() => {
                  audioService.playChirp(850);
                  void intelligenceEngine.resolvePendingPermission('DENY', pendingPerm.id);
                }}
                className="flex items-center gap-1 px-3 py-1.5 rounded border border-red-400/65 bg-red-950/50 hover:bg-red-900/60 text-red-100 text-[10px] font-orbitron whitespace-nowrap"
              >
                <X className="w-3 h-3" />
                <span>DENY</span>
              </button>
              <button
                type="button"
                data-testid="permission-cancel-btn"
                onClick={() => {
                  audioService.playChirp(750);
                  void intelligenceEngine.resolvePendingPermission('CANCEL', pendingPerm.id);
                }}
                className="px-3 py-1.5 rounded border border-cyan-500/40 bg-black/40 hover:text-white text-cyan-200 text-[10px] font-orbitron whitespace-nowrap"
              >
                CANCEL
              </button>
            </div>
          </div>
        )}

        {/* Phase 5 Interactive File Picker or Music Source Prompt */}
        {intelligenceState.interactivePrompt &&
          intelligenceState.interactivePrompt.kind !== 'AMBIGUOUS_CLARIFICATION' && (
            <div
              data-testid="interactive-action-prompt"
              className="p-2.5 rounded-lg border border-cyan-400/65 bg-cyan-950/40 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-orbitron text-[10px] text-white font-bold">
                  {intelligenceState.interactivePrompt.kind === 'FILE_PICKER'
                    ? 'USER FILE SELECTION'
                    : 'SELECT MUSIC SOURCE'}
                </span>
                <button
                  type="button"
                  onClick={() => intelligenceEngine.clearInteractivePrompt()}
                  aria-label="Dismiss prompt"
                  className="text-cyan-400 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-[10.5px] text-cyan-100">
                {intelligenceState.interactivePrompt.message}
              </p>

              {(intelligenceState.interactivePrompt.kind === 'FILE_PICKER' ||
                intelligenceState.interactivePrompt.kind === 'FOLDER_PICKER') && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={filePickBusy}
                      onClick={() =>
                        void handleTriggerFilePicker(
                          intelligenceState.interactivePrompt?.requestedAction?.includes('audio')
                            ? 'audio/*'
                            : undefined
                        )
                      }
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-cyan-400 bg-cyan-500/20 hover:bg-cyan-500/35 text-white text-[10px] font-orbitron"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      <span>{filePickBusy ? 'OPENING PICKER...' : 'SELECT FILE'}</span>
                    </button>
                    {(intelligenceState.interactivePrompt.allowFolderSelection ||
                      intelligenceState.interactivePrompt.kind === 'FOLDER_PICKER') && (
                      <button
                        type="button"
                        disabled={filePickBusy}
                        onClick={() => void handleTriggerFolderPicker()}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-emerald-400/70 bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-100 text-[10px] font-orbitron"
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                        <span>SELECT FOLDER</span>
                      </button>
                    )}
                  </div>
                  {folderPickNotice && (
                    <div className="space-y-1.5 pt-1">
                      <p className="text-[9.5px] text-amber-200/90">{folderPickNotice}</p>
                      <form onSubmit={handleStageManualFolder} className="flex gap-1.5">
                        <input
                          type="text"
                          value={folderPathInput}
                          onChange={(e) => setFolderPathInput(e.target.value)}
                          placeholder="Or enter approved desktop folder path (e.g. C:\Projects\app)"
                          className="flex-1 bg-black/75 border border-cyan-500/40 rounded px-2 py-1 text-[10px] text-white placeholder-cyan-500/50"
                        />
                        <button
                          type="submit"
                          className="px-2.5 py-1 rounded border border-cyan-400 bg-cyan-500/20 text-white text-[9.5px] font-orbitron"
                        >
                          STAGE
                        </button>
                      </form>
                    </div>
                  )}
                </div>
              )}

              {intelligenceState.interactivePrompt.kind === 'MUSIC_SOURCE' &&
                intelligenceState.interactivePrompt.musicChoices && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {intelligenceState.interactivePrompt.musicChoices.map((choice) => (
                      <button
                        key={choice.id}
                        type="button"
                        onClick={() => {
                          audioService.playChirp(1300);
                          intelligenceEngine.selectMusicSourceChoice(
                            choice.id,
                            intelligenceState.interactivePrompt?.query || ''
                          );
                        }}
                        className="p-2 rounded border border-cyan-500/40 bg-black/50 hover:border-cyan-400 hover:bg-cyan-950/50 text-left space-y-0.5"
                      >
                        <div className="font-orbitron text-[10px] text-white font-bold">
                          {choice.label}
                        </div>
                        <div className="text-[9.5px] text-cyan-300/80">{choice.description}</div>
                      </button>
                    ))}
                  </div>
                )}
            </div>
          )}

        {/* Active Music Playback Bar */}
        {musicState.status !== 'IDLE' && (
          <div
            data-testid="music-status-bar"
            className="p-2.5 rounded-lg border border-cyan-500/40 bg-black/55 space-y-1.5"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <Music className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span className="font-orbitron text-[10px] text-white truncate">
                  {musicState.trackTitle || 'Audio Controller'}
                </span>
              </div>
              <span className="text-[9.5px] text-cyan-300/85 shrink-0 tabular-nums">
                {musicState.sourceType || 'AUDIO'} · {musicState.status}
              </span>
            </div>
            <p className="text-[10px] text-cyan-200/90">{musicState.statusMessage}</p>
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              {musicState.sourceType === 'LOCAL_AUDIO' && (
                <>
                  {musicState.status === 'PLAYING' ? (
                    <button
                      type="button"
                      onClick={() => musicService.pause()}
                      className="flex items-center gap-1 px-2 py-1 rounded border border-cyan-400/60 bg-cyan-950/50 text-white text-[9.5px] font-orbitron"
                    >
                      <Pause className="w-3 h-3" />
                      <span>PAUSE</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void musicService.resume()}
                      className="flex items-center gap-1 px-2 py-1 rounded border border-emerald-400/60 bg-emerald-950/50 text-emerald-100 text-[9.5px] font-orbitron"
                    >
                      <Play className="w-3 h-3" />
                      <span>RESUME</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => musicService.stop()}
                    className="flex items-center gap-1 px-2 py-1 rounded border border-red-400/50 bg-red-950/40 text-red-200 text-[9.5px] font-orbitron"
                  >
                    <Square className="w-2.5 h-2.5" />
                    <span>STOP</span>
                  </button>
                  <label className="flex items-center gap-1.5 text-[9.5px] text-cyan-300 ml-auto">
                    <Volume2 className="w-3 h-3" />
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(musicState.volume * 100)}
                      onChange={(e) => musicService.setVolume(Number(e.target.value) / 100)}
                      aria-label="Music Volume"
                      className="w-20 accent-cyan-400"
                    />
                    <span className="tabular-nums w-8">{Math.round(musicState.volume * 100)}%</span>
                  </label>
                </>
              )}
              {musicState.sourceUrl && (
                <a
                  href={musicState.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded border border-cyan-400/50 text-cyan-200 hover:text-white text-[9.5px] font-orbitron"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>OPEN SERVICE LINK</span>
                </a>
              )}
            </div>
          </div>
        )}

        {/* Phase 4 Consequential Tool Approval Banner */}
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
              <span className="text-[9px] text-amber-200/80">
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

        {/* TAB 1: CONTEXTUAL CONVERSATION & RESULT PREVIEWS */}
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
                  onClick={() => void handleTriggerFilePicker()}
                  className="flex items-center gap-1 px-2 py-0.5 rounded border border-cyan-500/40 bg-cyan-950/40 text-cyan-200 hover:text-white text-[9.5px]"
                >
                  <FolderOpen className="w-3 h-3" />
                  <span>FILE</span>
                </button>
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
                    Try: "Open GitHub", "Search for Three.js documentation", "Open my project report", or "Play relaxing music".
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
                      <div className="flex items-center gap-1.5 tabular-nums">
                        {t.intent && <span>{t.intent}</span>}
                        {t.intent && <span aria-hidden="true">·</span>}
                        <span>{new Date(t.timestamp).toLocaleTimeString()}</span>
                      </div>
                    </div>
                    <p className="leading-snug whitespace-pre-wrap">{t.text}</p>
                    {t.toolNames && t.toolNames.length > 0 && (
                      <div className="mt-1 text-[9px] text-emerald-300">
                        Verified tool: {t.toolNames.join(', ')}
                      </div>
                    )}
                  </div>
                ))
              )}

              {streamingText && (
                <div
                  data-testid="streaming-assistant-bubble"
                  className="p-2 rounded border border-amber-400/50 bg-cyan-950/40 text-cyan-100 mr-2"
                >
                  <div className="flex items-center justify-between gap-2 text-[9px] text-amber-300 mb-1">
                    <span className="font-orbitron font-bold">J.A.R.V.I.S. // STREAMING</span>
                    <span>LIVE TOKENS</span>
                  </div>
                  <p className="leading-snug whitespace-pre-wrap">{streamingText}</p>
                </div>
              )}
            </div>

            {activeAgentRun && (
              <div
                data-testid="active-agent-progress-bar"
                className="p-2 rounded border border-amber-400/50 bg-amber-950/30 flex items-center justify-between gap-2 text-[10px]"
              >
                <div className="min-w-0">
                  <span className="font-orbitron font-bold text-amber-200 mr-2">
                    [{activeAgentRun.role}]
                  </span>
                  <span className="text-cyan-100 truncate">{activeAgentRun.currentStep}</span>
                </div>
                <span className="text-amber-300 font-orbitron tabular-nums shrink-0">
                  {activeAgentRun.progressPercent}%
                </span>
              </div>
            )}

            {/* Opened File Preview */}
            {intelligenceState.lastOpenedFile?.ok && (
              <div
                data-testid="opened-file-preview"
                className="p-2.5 rounded border border-emerald-500/35 bg-black/50 space-y-1.5"
              >
                <div className="flex items-center justify-between text-[10px]">
                  <span className="font-orbitron font-bold text-white">
                    {intelligenceState.lastOpenedFile.name}
                  </span>
                  <span className="text-cyan-300/80 tabular-nums">
                    .{intelligenceState.lastOpenedFile.extension} · {intelligenceState.lastOpenedFile.sizeFormatted}
                  </span>
                </div>
                {intelligenceState.lastOpenedFile.kind === 'IMAGE' && intelligenceState.lastOpenedFile.previewUrl && (
                  <img
                    src={intelligenceState.lastOpenedFile.previewUrl}
                    alt={intelligenceState.lastOpenedFile.name}
                    className="max-h-32 rounded border border-cyan-500/30 object-contain"
                  />
                )}
                {intelligenceState.lastOpenedFile.textContent && (
                  <pre className="max-h-28 overflow-y-auto p-2 rounded bg-black/75 border border-cyan-500/20 text-[10px] text-cyan-100 whitespace-pre-wrap">
                    {intelligenceState.lastOpenedFile.textContent.slice(0, 2000)}
                  </pre>
                )}
                {intelligenceState.lastOpenedFile.previewUrl &&
                  intelligenceState.lastOpenedFile.kind === 'DOCUMENT' && (
                    <a
                      href={intelligenceState.lastOpenedFile.previewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[10px] text-cyan-300 hover:text-white underline"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>Open Document Preview</span>
                    </a>
                  )}
              </div>
            )}

            {/* Popup Blocked Direct Fallback */}
            {intelligenceState.lastBrowserAction?.popupBlocked && intelligenceState.lastBrowserAction.url && (
              <div className="p-2.5 rounded border border-amber-400/60 bg-amber-950/35 text-[10px] space-y-1">
                <p className="text-amber-200">{intelligenceState.lastBrowserAction.summary}</p>
                <a
                  href={intelligenceState.lastBrowserAction.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-white underline font-orbitron"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>Open {intelligenceState.lastBrowserAction.hostname || 'Website'} Manually</span>
                </a>
              </div>
            )}

            {/* Web Search Results */}
            {intelligenceState.lastSearchResult && (
              <div
                data-testid="web-search-results-card"
                className="p-2.5 rounded border border-cyan-500/35 bg-black/50 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2 text-[9.5px]">
                  <div className="flex items-center gap-1.5 font-orbitron text-white font-bold">
                    <Search className="w-3.5 h-3.5 text-cyan-400" />
                    <span>SEARCH: "{intelligenceState.lastSearchResult.query}"</span>
                  </div>
                  <span className="text-cyan-300/80">{intelligenceState.lastSearchResult.provider}</span>
                </div>
                <p className="text-[9.5px] text-amber-200/85">
                  {intelligenceState.lastSearchResult.distinctionNotice}
                </p>
                {intelligenceState.lastSearchResult.results.length > 0 ? (
                  <div className="space-y-1 max-h-28 overflow-y-auto pr-1">
                    {intelligenceState.lastSearchResult.results.map((item, idx) => (
                      <div key={idx} className="p-1.5 rounded border border-cyan-500/20 bg-black/45">
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10.5px] text-white font-semibold hover:text-cyan-300 underline inline-flex items-center gap-1"
                        >
                          <span>{item.title}</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                        <p className="text-[9.5px] text-cyan-200/85 mt-0.5">{item.snippet}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <a
                    href={intelligenceState.lastSearchResult.searchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[10px] text-cyan-300 hover:text-white underline"
                  >
                    <ExternalLink className="w-3 h-3" />
                    <span>Open Search Page on {intelligenceState.lastSearchResult.provider}</span>
                  </a>
                )}
              </div>
            )}

            {intelligenceState.lastError && (
              <div className="flex items-center gap-1.5 p-2 rounded border border-red-500/45 bg-red-950/40 text-red-200 text-[10px]">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-red-400" />
                <span>{intelligenceState.lastError}</span>
              </div>
            )}

            {attachmentError && (
              <div className="p-1.5 rounded border border-red-500/45 bg-red-950/35 text-red-200 text-[10px]">
                {attachmentError}
              </div>
            )}

            {pendingAttachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5" data-testid="pending-attachments-bar">
                {pendingAttachments.map((att) => (
                  <div
                    key={att.id}
                    className="flex items-center gap-1.5 px-2 py-1 rounded border border-cyan-400/50 bg-cyan-950/45 text-[10px] text-white max-w-[220px]"
                  >
                    {att.kind === 'IMAGE' && att.previewUrl ? (
                      <img
                        src={att.previewUrl}
                        alt={att.name}
                        className="w-5 h-5 rounded object-cover shrink-0 border border-cyan-400/40"
                      />
                    ) : att.kind === 'IMAGE' ? (
                      <ImageIcon className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
                    ) : (
                      <FileText className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
                    )}
                    <span className="truncate">{att.name}</span>
                    <span className="text-[9px] text-cyan-300/80 shrink-0">{att.sizeFormatted}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${att.name}`}
                      onClick={() =>
                        setPendingAttachments((prev) => prev.filter((item) => item.id !== att.id))
                      }
                      className="text-cyan-300 hover:text-white shrink-0"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Prompt Input */}
            <form onSubmit={handleChatSubmit} className="flex gap-1.5 items-center">
              <input
                ref={attachmentInputRef}
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.pdf,.txt,.md,.json,.csv,.ts,.tsx,.js,.jsx,.py,.html,.css,.yml,.yaml"
                onChange={(e) => void handleAttachmentFilesSelected(e)}
                className="hidden"
              />
              <button
                type="button"
                aria-label="Attach image, PDF, or code file"
                title="Attach up to 3 files (image, PDF, code/text)"
                onClick={() => attachmentInputRef.current?.click()}
                className="px-2 py-1.5 rounded border border-cyan-500/40 bg-black/60 hover:border-cyan-400 text-cyan-300 hover:text-white shrink-0"
              >
                <Paperclip className="w-3.5 h-3.5" />
              </button>
              <input
                type="text"
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                placeholder="Ask JARVIS or attach an image, PDF, or code file..."
                className="flex-1 bg-black/75 border border-cyan-500/40 rounded px-2.5 py-1.5 text-xs text-white placeholder-cyan-500/50 focus:outline-none focus:border-cyan-400"
              />
              <button
                type="submit"
                aria-label="Send to AI Brain"
                className="px-3 py-1.5 rounded border border-cyan-400 bg-cyan-500/20 hover:bg-cyan-500/35 text-white flex items-center gap-1 text-[10px] font-orbitron shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                <span>ASK</span>
              </button>
            </form>
          </div>
        )}

        {/* TAB 2: PERMISSION GUARD & PERSISTENT POLICY */}
        {activeTab === 'PERMISSIONS' && (
          <div className="space-y-3" data-testid="permissions-management-panel">
            <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded border border-cyan-500/25 bg-black/45">
              <div>
                <div className="font-orbitron text-[10px] text-white">
                  EXPLICIT PERMISSION GOVERNANCE
                </div>
                <p className="text-[9.5px] text-cyan-300/80">
                  Manage persistent capability grants, individual app toggles, and saved folders. Level 3 destructive actions always require once-per-action confirmation.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                {onOpenSetupWizard && (
                  <button
                    type="button"
                    data-testid="launch-setup-wizard-btn"
                    onClick={() => {
                      audioService.playChirp(1300);
                      onOpenSetupWizard();
                    }}
                    className="flex items-center gap-1 px-2.5 py-1 rounded border border-cyan-400/65 bg-cyan-500/20 hover:bg-cyan-500/35 text-white text-[9.5px] font-orbitron whitespace-nowrap"
                  >
                    <Shield className="w-3 h-3" />
                    <span>Setup Wizard</span>
                  </button>
                )}
                <button
                  type="button"
                  data-testid="reset-all-permissions-btn"
                  onClick={() => {
                    audioService.playChirp(850);
                    void permissionPolicy.resetAllPermissions(false);
                  }}
                  className="flex items-center gap-1 px-2.5 py-1 rounded border border-red-400/55 bg-red-950/40 hover:bg-red-900/55 text-red-100 text-[9.5px] font-orbitron whitespace-nowrap"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Reset All Permissions</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleTriggerFilePicker()}
                  className="flex items-center gap-1 px-2.5 py-1 rounded border border-cyan-400/50 bg-cyan-500/10 hover:bg-cyan-500/25 text-white text-[9.5px] font-orbitron whitespace-nowrap"
                >
                  <FolderOpen className="w-3 h-3" />
                  <span>SELECT FILE</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleTriggerFolderPicker()}
                  className="flex items-center gap-1 px-2.5 py-1 rounded border border-emerald-400/55 bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-100 text-[9.5px] font-orbitron whitespace-nowrap"
                >
                  <FolderOpen className="w-3 h-3" />
                  <span>Add Folder</span>
                </button>
              </div>
            </div>

            {/* Persistent Capability Controls */}
            <div className="space-y-2">
              <div className="font-orbitron text-[9.5px] text-cyan-300">
                PERSISTENT CAPABILITY PERMISSIONS ({ALL_CAPABILITY_IDS.length})
              </div>
              <div className="space-y-1.5">
                {ALL_CAPABILITY_IDS.map((capId: PermissionCapabilityId) => {
                  const meta = PERMISSION_CAPABILITY_METADATA[capId];
                  const rec = policyConfig.capabilities[capId];
                  const displayState = formatPermissionDisplayState(
                    permissionPolicy.getDisplayState(capId)
                  );
                  const isGranted = rec?.decision === 'GRANTED';
                  const isDenied = rec?.decision === 'DENIED';

                  return (
                    <div
                      key={capId}
                      data-testid={`policy-card-${capId}`}
                      className="p-2.5 rounded border border-cyan-500/25 bg-black/45 space-y-2"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-orbitron font-bold text-white text-[10px]">
                              {meta.name}
                            </span>
                            <span className={`text-[9.5px] font-semibold ${displayState.className}`}>
                              {displayState.label}
                            </span>
                            <span className="text-[9px] text-cyan-400/75 tabular-nums">
                              {rec?.updatedAt
                                ? `Updated ${new Date(rec.updatedAt).toLocaleString()}`
                                : 'Never configured'}
                            </span>
                          </div>
                          <p className="text-[9.5px] text-cyan-200/80 leading-snug">
                            {meta.description}
                          </p>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            data-testid={`cap-${capId}-enable`}
                            onClick={() => {
                              audioService.playChirp(1400);
                              permissionPolicy.setCapabilityDecision(capId, 'GRANTED');
                            }}
                            className={`px-2 py-1 rounded border text-[9.5px] font-orbitron whitespace-nowrap ${
                              isGranted
                                ? 'border-emerald-400 bg-emerald-950/75 text-emerald-100 font-bold'
                                : 'border-cyan-500/35 bg-black/40 text-cyan-200 hover:text-white'
                            }`}
                          >
                            Enable
                          </button>
                          <button
                            type="button"
                            data-testid={`cap-${capId}-revoke`}
                            onClick={() => {
                              audioService.playChirp(880);
                              permissionPolicy.setCapabilityDecision(capId, 'DENIED');
                            }}
                            className={`px-2 py-1 rounded border text-[9.5px] font-orbitron whitespace-nowrap ${
                              isDenied
                                ? 'border-red-400 bg-red-950/75 text-red-100 font-bold'
                                : 'border-cyan-500/35 bg-black/40 text-cyan-200 hover:text-white'
                            }`}
                          >
                            Revoke
                          </button>
                          {(capId === 'CAMERA_ACCESS' || capId === 'MICROPHONE_ACCESS') && (
                            <button
                              type="button"
                              aria-label={`Refresh ${meta.name} OS status`}
                              onClick={() => void permissionPolicy.refreshHardwarePermissionStates()}
                              className="p-1 rounded border border-cyan-500/30 text-cyan-300 hover:text-white"
                            >
                              <RefreshCw className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Per-App Toggles under Application Access */}
                      {capId === 'APPLICATION_ACCESS' && approvedApps.length > 0 && (
                        <div className="pt-1.5 border-t border-cyan-500/20 flex flex-wrap gap-1.5">
                          {approvedApps.map((app) => {
                            const appAllowed = policyConfig.allowedAppIds[app.id] !== false;
                            return (
                              <button
                                key={app.id}
                                type="button"
                                data-testid={`policy-app-${app.id}`}
                                onClick={() => {
                                  audioService.playChirp(appAllowed ? 900 : 1320);
                                  permissionPolicy.setAppAllowed(app.id, !appAllowed);
                                }}
                                className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[9.5px] whitespace-nowrap ${
                                  appAllowed
                                    ? 'border-emerald-400/55 bg-emerald-950/45 text-emerald-100'
                                    : 'border-red-400/45 bg-red-950/35 text-red-200/80'
                                }`}
                              >
                                {appAllowed ? (
                                  <Check className="w-2.5 h-2.5 shrink-0" />
                                ) : (
                                  <X className="w-2.5 h-2.5 shrink-0" />
                                )}
                                <span>{app.displayName}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* Saved Approved Folders List under Folder Access */}
                      {capId === 'FOLDER_ACCESS' && (
                        <div className="pt-1.5 border-t border-cyan-500/20 space-y-1">
                          {policyConfig.approvedFolders.length === 0 ? (
                            <p className="text-[9.5px] text-cyan-400/75">
                              No persistently approved folders yet. Use Add Folder to select one.
                            </p>
                          ) : (
                            policyConfig.approvedFolders.map((folder) => (
                              <div
                                key={folder.path}
                                data-testid={`approved-folder-row`}
                                className="flex items-center justify-between gap-2 px-2 py-1 rounded border border-cyan-500/20 bg-black/55 text-[9.5px]"
                              >
                                <div className="min-w-0 truncate">
                                  <span className="text-white font-semibold">{folder.name}</span>
                                  <span className="text-cyan-400/75 ml-2">{folder.path}</span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    audioService.playChirp(860);
                                    void desktopBridge.revokeFolderPath(folder.path);
                                  }}
                                  className="px-2 py-0.5 rounded border border-red-400/50 text-red-200 hover:bg-red-950/50 text-[9px] whitespace-nowrap shrink-0"
                                >
                                  Revoke
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="font-orbitron text-[9.5px] text-cyan-300">
              PERMISSION ACTIVITY HISTORY ({permissionHistory.length})
            </div>

            {permissionHistory.length === 0 ? (
              <p className="text-[10px] text-cyan-400/75 p-2.5 rounded border border-cyan-500/20 bg-black/35">
                No file, browser, web-search, or music permissions requested in this session yet.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {permissionHistory.map((entry) => (
                  <div
                    key={entry.id}
                    className="p-2 rounded border border-cyan-500/25 bg-black/45 space-y-0.5"
                  >
                    <div className="flex items-center justify-between gap-2 text-[9.5px]">
                      <span className="font-orbitron font-bold text-white truncate">
                        {entry.requestedAction}
                      </span>
                      <span className="text-[9px] text-cyan-300/80 shrink-0 tabular-nums">
                        {entry.decision} · {entry.executionStatus}
                      </span>
                    </div>
                    <div className="text-[10px] text-cyan-200/90 truncate">
                      {entry.category} · {entry.target}
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[9.5px] text-cyan-400/80">
                      <span className="truncate">{entry.resultSummary}</span>
                      <span className="shrink-0 tabular-nums">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: MULTI-STEP PLAN */}
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
                    <div className="text-[9.5px] text-cyan-400/80 tabular-nums">
                      Status: <span className="text-white font-semibold">{latestPlan.status}</span> · {latestPlan.steps.length} steps
                    </div>
                  </div>
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
                          className={`text-[9px] font-orbitron ${
                            s.status === 'COMPLETED'
                              ? 'text-emerald-300'
                              : s.status === 'FAILED'
                              ? 'text-red-300'
                              : s.status === 'RUNNING'
                              ? 'text-amber-200'
                              : 'text-cyan-300'
                          }`}
                        >
                          {s.status}
                        </span>
                      </div>
                      <p className="text-[9.5px] text-cyan-300/80">{s.description}</p>
                      {(s.dependsOn?.length || (s.retryCount || 0) > 0 || s.agentRole) && (
                        <div className="flex flex-wrap gap-2 text-[9px] text-cyan-400/75">
                          {s.agentRole && <span>Agent: {s.agentRole}</span>}
                          {s.dependsOn && s.dependsOn.length > 0 && (
                            <span>Depends on: {s.dependsOn.join(', ')}</span>
                          )}
                          {(s.retryCount || 0) > 0 && (
                            <span className="text-amber-300 tabular-nums">Retries: {s.retryCount}</span>
                          )}
                        </div>
                      )}
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

            {planHistory.length > 0 && (
              <div className="space-y-1 pt-1">
                <div className="font-orbitron text-[9.5px] text-cyan-300">
                  EXECUTION HISTORY ({planHistory.length})
                </div>
                {planHistory.slice(0, 5).map((hist) => (
                  <div
                    key={hist.id}
                    className="p-2 rounded border border-cyan-500/20 bg-black/35 flex items-center justify-between gap-2 text-[9.5px]"
                  >
                    <span className="text-cyan-100 truncate">{hist.objective}</span>
                    <span className="text-cyan-300/80 shrink-0 tabular-nums">
                      {hist.steps.filter((st) => st.status === 'COMPLETED').length}/{hist.steps.length} · {hist.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: CONTEXTUAL SUGGESTIONS */}
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
                        className={`text-[9px] font-orbitron ${
                          sug.priority === 'HIGH' ? 'text-amber-300' : 'text-cyan-300'
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

        {/* TAB 5: USER-CONTROLLED MEMORY */}
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

            <div className="flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <input
                type="text"
                value={memSearchQuery}
                onChange={(e) => setMemSearchQuery(e.target.value)}
                placeholder="Search saved memories by keyword or category..."
                className="flex-1 bg-black/75 border border-cyan-500/35 rounded px-2 py-1 text-[10px] text-white placeholder-cyan-500/50"
              />
            </div>

            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
              {visibleMemories.length === 0 ? (
                <p className="text-[10px] text-cyan-400/75 p-2">
                  {memSearchQuery.trim()
                    ? `No saved memories match "${memSearchQuery.trim()}".`
                    : 'No user-approved memories stored yet.'}
                </p>
              ) : (
                visibleMemories.map((m) => (
                  <div
                    key={m.id}
                    className="p-2 rounded border border-cyan-500/25 bg-black/45 flex items-start justify-between gap-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-[9px] text-cyan-400/80">
                        <span>{m.category}</span>
                        <span aria-hidden="true">·</span>
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

        {/* TAB 6: CONTROLLED TOOL ACTIVITY */}
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
                      <div className="text-cyan-300 tabular-nums">
                        {rec.permissionLevel} · {rec.status}
                        {rec.verified ? ' · VERIFIED' : ''}
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
