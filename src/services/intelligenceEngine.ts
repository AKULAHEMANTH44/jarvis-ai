import {
  AIProviderConfig,
  AISuggestion,
  AgentRunSnapshot,
  BrowserNavigationResult,
  ExecutionPlan,
  FileInspectionResult,
  IntelligenceRequestResult,
  IntelligenceStatus,
  IntentClassification,
  MusicPlaybackState,
  MusicSourceType,
  PendingAttachment,
  PendingInteractivePrompt,
  PendingToolApproval,
  PermissionCapabilityId,
  PermissionCategory,
  PermissionRequest,
  PermissionSecurityLevel,
  SelectedFileMetadata,
  SelectedFolderMetadata,
  ToolActivityRecord,
  WebSearchResponse,
  WorkspaceContextSnapshot
} from '../types/assistant';
import { contextualAI } from './contextualAI';
import { conversationManager, FollowUpResolution } from './conversationManager';
import { memoryManager } from './memoryManager';
import { planningEngine } from './planningEngine';
import { suggestionEngine } from './suggestionEngine';
import { toolRegistry } from './toolRegistry';
import { permissionManager } from './permissionManager';
import { permissionPolicy } from './permissionPolicy';
import { fileAccessService } from './fileAccessService';
import { browserActionService } from './browserActionService';
import { webSearchService, extractSearchIntent } from './webSearchService';
import { musicService, MUSIC_SOURCE_CHOICES } from './musicService';
import { desktopBridge, DesktopExecutionResult, WebPageInspectionResult } from './desktopBridge';
import { desktopWorkflowService } from './desktopWorkflowService';
import { agentOrchestrator } from './agentOrchestrator';
import { devStudioService } from './devStudioService';

export interface IntelligenceStateSnapshot {
  status: IntelligenceStatus;
  activitySummary: string;
  stageFeedback: string;
  activeRequestId: string | null;
  lastError: string | null;
  lastProviderUsed: AIProviderConfig['provider'];
  lastResult: IntelligenceRequestResult | null;
  pendingApproval: PendingToolApproval | null;
  pendingPermission: PermissionRequest | null;
  interactivePrompt: PendingInteractivePrompt | null;
  pendingFileMetadata: SelectedFileMetadata | null;
  lastOpenedFile: FileInspectionResult | null;
  lastBrowserAction: BrowserNavigationResult | null;
  lastSearchResult: WebSearchResponse | null;
  musicState: MusicPlaybackState;
  latestPlan: ExecutionPlan | null;
  activeSuggestions: AISuggestion[];
  streamingText: string;
  activeAgentRun: AgentRunSnapshot | null;
}

type PermissionExecutor = (
  permissionId: string,
  signal?: AbortSignal
) => Promise<{
  ok: boolean;
  reply: string;
  toolRecord?: ToolActivityRecord;
  openedFile?: FileInspectionResult;
  browserAction?: BrowserNavigationResult;
  searchResult?: WebSearchResponse;
  musicState?: MusicPlaybackState;
  error?: string;
}>;

const INTERNAL_WORKSPACE_TARGETS = new Set([
  'laboratory',
  'object laboratory',
  'lab',
  'models',
  'gesture',
  'gesture controls',
  'camera',
  'voice',
  'vocal console',
  'brain',
  'intelligence brain',
  'config',
  'settings',
  'ai settings',
  'tasks',
  'task engine',
  'memory',
  'plan',
  'suggestions',
  'interface',
  'holographic interface',
  'workspace',
  'holographic workspace'
]);

const APPROVED_APP_ALIASES: { id: string; displayName: string; pattern: RegExp }[] = [
  { id: 'VS_CODE', displayName: 'Visual Studio Code', pattern: /\b(visual\s+studio\s+code|vs\s*code)\b/i },
  { id: 'NOTEPAD', displayName: 'Notepad', pattern: /\bnotepad(?:\.exe)?\b/i },
  { id: 'CALCULATOR', displayName: 'Windows Calculator', pattern: /\b(?:windows\s+)?(?:calculator|calc(?:\.exe)?)\b/i },
  { id: 'EXPLORER', displayName: 'File Explorer', pattern: /\b(?:file|windows)\s+explorer\b/i },
  { id: 'CHROME', displayName: 'Google Chrome', pattern: /\b(?:google\s+)?chrome(?:\.exe)?\b/i },
  { id: 'BROWSER', displayName: 'Default Web Browser', pattern: /\b(?:default\s+(?:web\s+)?browser|web\s+browser)\b/i },
  { id: 'SPOTIFY', displayName: 'Spotify', pattern: /\bspotify(?:\.exe)?\b/i }
];

const BLOCKED_SHELL_OR_SYSTEM_PATTERN =
  /\b(?:open|launch|start|run|execute)\s+(?:the\s+)?(?:cmd(?:\.exe)?|command\s+prompt|powershell(?:\.exe)?|pwsh(?:\.exe)?|bash|zsh|terminal|regedit(?:\.exe)?|registry\s+editor|wscript(?:\.exe)?|cscript(?:\.exe)?|rundll32(?:\.exe)?|mshta(?:\.exe)?)\b/i;

export class IntelligenceEngine {
  private status: IntelligenceStatus = 'STANDBY';
  private activitySummary: string = 'Intelligence Brain standing by.';
  private stageFeedback: string = 'Ready.';
  private activeAbortController: AbortController | null = null;
  private activeRequestId: string | null = null;
  private activeRequestFingerprint: string | null = null;
  private lastError: string | null = null;
  private lastResult: IntelligenceRequestResult | null = null;
  private pendingApproval: PendingToolApproval | null = null;
  private pendingPermission: PermissionRequest | null = null;
  private pendingPermissionInputFingerprint: string | null = null;
  private permissionExecutors: Map<string, PermissionExecutor> = new Map();
  private interactivePrompt: PendingInteractivePrompt | null = null;
  private pendingFileMetadata: SelectedFileMetadata | null = null;
  private lastOpenedFile: FileInspectionResult | null = null;
  private lastBrowserAction: BrowserNavigationResult | null = null;
  private lastSearchResult: WebSearchResponse | null = null;
  private streamingText: string = '';
  private listeners: Set<(snapshot: IntelligenceStateSnapshot) => void> = new Set();

  constructor() {
    musicService.subscribe(() => {
      if (this.listeners.size > 0) {
        this.emit();
      }
    });
    agentOrchestrator.subscribe(() => {
      if (this.listeners.size > 0) {
        this.emit();
      }
    });
    permissionManager.subscribe(() => {
      if (this.pendingPermission) {
        const latest = permissionManager.getRequest(this.pendingPermission.id);
        if (latest && latest.status !== 'AWAITING_APPROVAL' && latest.status !== 'EXECUTING') {
          if (latest.status === 'EXPIRED' || latest.status === 'DENIED' || latest.status === 'CANCELLED') {
            this.permissionExecutors.delete(latest.id);
            this.pendingPermission = null;
            this.pendingPermissionInputFingerprint = null;
            if (this.status === 'AWAITING_APPROVAL') {
              this.status = 'STANDBY';
              this.activitySummary = latest.resultSummary || `Permission ${latest.status.toLowerCase()}.`;
              this.stageFeedback = latest.status === 'EXPIRED' ? 'Permission expired.' : 'Action cancelled.';
            }
          }
        }
      }
      if (this.listeners.size > 0) {
        this.emit();
      }
    });
  }

  public subscribe(listener: (snapshot: IntelligenceStateSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  public getSnapshot(): IntelligenceStateSnapshot {
    const cfg = contextualAI.getConfig();
    // Refresh expiration state safely
    if (this.pendingPermission) {
      const fresh = permissionManager.getRequest(this.pendingPermission.id);
      if (!fresh || fresh.status !== 'AWAITING_APPROVAL') {
        this.pendingPermission = null;
      }
    }
    return {
      status: this.status,
      activitySummary: this.activitySummary,
      stageFeedback: this.stageFeedback,
      activeRequestId: this.activeRequestId,
      lastError: this.lastError,
      lastProviderUsed: cfg.provider,
      lastResult: this.lastResult,
      pendingApproval: this.pendingApproval ? { ...this.pendingApproval } : null,
      pendingPermission: this.pendingPermission ? { ...this.pendingPermission } : null,
      interactivePrompt: this.interactivePrompt ? { ...this.interactivePrompt } : null,
      pendingFileMetadata: this.pendingFileMetadata ? { ...this.pendingFileMetadata } : null,
      lastOpenedFile: this.lastOpenedFile ? { ...this.lastOpenedFile } : null,
      lastBrowserAction: this.lastBrowserAction ? { ...this.lastBrowserAction } : null,
      lastSearchResult: this.lastSearchResult ? { ...this.lastSearchResult } : null,
      musicState: musicService.getState(),
      latestPlan: planningEngine.getLatestPlan(),
      activeSuggestions: suggestionEngine.getActiveSuggestions(),
      streamingText: this.streamingText,
      activeAgentRun: agentOrchestrator.getSnapshot().activeRun
    };
  }

  private setStatus(status: IntelligenceStatus, activitySummary: string, stageFeedback?: string) {
    this.status = status;
    this.activitySummary = activitySummary;
    if (stageFeedback) {
      this.stageFeedback = stageFeedback;
    }
    this.emit();
  }

  private emit() {
    const snap = this.getSnapshot();
    this.listeners.forEach((fn) => fn(snap));
  }

  public setListeningState(listening: boolean) {
    if (this.activeRequestId) return;
    if (listening) {
      this.setStatus('LISTENING', 'Microphone active; awaiting spoken or typed request.', 'Listening.');
    } else if (this.status === 'LISTENING') {
      this.setStatus('STANDBY', 'Intelligence Brain standing by.', 'Ready.');
    }
  }

  public cancelActiveRequest(): boolean {
    let cancelled = false;
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
      this.activeRequestId = null;
      this.activeRequestFingerprint = null;
      cancelled = true;
    }
    if (agentOrchestrator.cancelActiveRun()) {
      cancelled = true;
    }
    if (webSearchService.cancelActiveSearch()) {
      cancelled = true;
    }
    if (this.pendingPermission) {
      const permId = this.pendingPermission.id;
      this.permissionExecutors.delete(permId);
      this.pendingPermission = null;
      this.pendingPermissionInputFingerprint = null;
      permissionManager.cancel(permId, 'Action cancelled by user.');
      cancelled = true;
    }
    if (cancelled) {
      this.streamingText = '';
      this.setStatus('STANDBY', 'Active request cancelled by user.', 'Action cancelled.');
    }
    return cancelled;
  }

  public clearInteractivePrompt() {
    this.interactivePrompt = null;
    this.emit();
  }

  public classifyIntent(
    rawInput: string,
    snapshot: WorkspaceContextSnapshot,
    followUp: FollowUpResolution,
    attachments: PendingAttachment[] = []
  ): IntentClassification {
    const text = rawInput.trim();
    const lower = text.toLowerCase();
    const missingInformation: string[] = [];
    const hasAttachments = attachments.length > 0;

    // 1. Calculation detection
    const mathCandidate = this.extractMathExpression(text);
    if (mathCandidate) {
      return {
        category: 'CALCULATION',
        confidence: 0.94,
        summary: `Evaluate mathematical expression: ${mathCandidate}`,
        requiresTool: true,
        requiresPlan: false,
        missingInformation,
        resolvedReferences: followUp.resolvedReferences
      };
    }

    // 2. Multi-step planning detection
    if (
      /\b(prepare my project|prepare.*demo|demonstration|multi[- ]step|workflow|run\s+workflow|execute\s+workflow|start\s+workflow|create a plan|plan how|step[- ]by[- ]step|full audit)\b/i.test(
        lower
      )
    ) {
      return {
        category: 'MULTI_STEP_PLAN',
        confidence: 0.92,
        summary: `Decompose complex objective into verified steps: "${text.slice(0, 60)}"`,
        requiresTool: true,
        requiresPlan: true,
        missingInformation,
        resolvedReferences: followUp.resolvedReferences
      };
    }

    // 3. Music Playback / Audio Controls / Spotify App
    if (
      /\b(play\s+(?:my\s+)?(?:selected\s+)?(?:some\s+)?(?:music|song|songs|track|tracks|audio|relaxing|instrumental|ambient|jazz|lofi|classical|music\s+on)|pause\s+(?:the\s+)?(?:music|spotify)|resume\s+(?:the\s+)?(?:music|spotify)|stop\s+(?:the\s+)?(?:music|spotify)|volume\s+(?:up|down|to|\d+)|find\s+(?:a\s+)?(?:track|song|music)|listen\s+to\s+music|(?:open|launch|start)\s+spotify)\b/i.test(
        lower
      ) ||
      /\bplay\b.*\b(on\s+(?:spotify|youtube\s+music|soundcloud|youtube)|music|song|track|album|playlist)\b/i.test(
        lower
      )
    ) {
      return {
        category: 'MUSIC_ACTION',
        confidence: 0.92,
        summary: 'Controlled music playback or music service action.',
        requiresTool: true,
        requiresPlan: false,
        missingInformation,
        resolvedReferences: followUp.resolvedReferences
      };
    }

    // 4. Web Search Intent (check BEFORE internal documentation so "Find documentation for Three.js" searches the web!)
    if (
      /\b(search\s+(?:the\s+web|online|google|duckduckgo|wikipedia)?\s*(?:for|about)?|find\s+information\s+(?:about|on)|find\s+(?:info|details)\s+(?:about|on)|find\s+documentation\s+for|look\s+up|web\s+search)\b/i.test(
        lower
      )
    ) {
      return {
        category: 'WEB_SEARCH',
        confidence: 0.91,
        summary: 'Permission-gated external web search query.',
        requiresTool: true,
        requiresPlan: false,
        missingInformation,
        resolvedReferences: followUp.resolvedReferences
      };
    }

    // 4a. Controlled Research Synthesis Agent (distinct from raw web search)
    if (
      /\b(research|investigate|deep\s+dive(?:\s+into)?|summarize\s+research)\b/i.test(lower)
    ) {
      return {
        category: 'RESEARCH_REQUEST',
        confidence: 0.9,
        summary: 'Controlled Research & Synthesis Agent task.',
        requiresTool: false,
        requiresPlan: false,
        missingInformation,
        resolvedReferences: followUp.resolvedReferences
      };
    }

    // 4b. Desktop Application Launch (check BEFORE file/browser intents so "open File Explorer" or "open Calculator" routes properly)
    if (
      BLOCKED_SHELL_OR_SYSTEM_PATTERN.test(lower) ||
      this.detectApplicationTarget(lower) ||
      /\b(?:open|launch|start|run)\s+(?:an?\s+)?(?:app|application|program|software)\b/i.test(lower)
    ) {
      return {
        category: 'APPLICATION_LAUNCH',
        confidence: 0.93,
        summary: 'Permission-gated desktop application launch request.',
        requiresTool: true,
        requiresPlan: false,
        missingInformation,
        resolvedReferences: followUp.resolvedReferences
      };
    }

    // 4c. Folder Access Intent (when an explicit path exists, selected folder exists, or saved approved folders exist)
    if (
      /\b(open|show|browse|reveal)\b.*\bfolder\b/i.test(lower) &&
      (this.extractLocalFilesystemPath(text) !== null ||
        desktopBridge.getSelectedFolder() !== null ||
        permissionPolicy.getApprovedFolders().length > 0)
    ) {
      return {
        category: 'FOLDER_ACTION',
        confidence: 0.92,
        summary: 'Permission-gated local folder access request.',
        requiresTool: true,
        requiresPlan: false,
        missingInformation,
        resolvedReferences: followUp.resolvedReferences
      };
    }

    // 4d. Ambiguous notes request clarification
    if (/\b(open\s+my\s+notes|open\s+notes)\b/i.test(lower)) {
      missingInformation.push('Did you mean to open the file or browse its containing directory?');
      return {
        category: 'CLARIFICATION_NEEDED',
        confidence: 0.94,
        summary: 'Ambiguous request: notes file vs containing directory.',
        requiresTool: false,
        requiresPlan: false,
        missingInformation,
        resolvedReferences: followUp.resolvedReferences
      };
    }

    // 5. File Access, Creation & Search Intent
    if (
      this.extractLocalFilesystemPath(text) !== null ||
      /\b(find\s+(?:a\s+)?file|search\s+(?:for\s+)?(?:a\s+)?file|search\s+files|create\s+(?:a\s+)?(?:text\s+)?file|write\s+(?:a\s+)?(?:text\s+)?file|save\s+(?:text\s+)?to\s+file|read\s+(?:the\s+)?(?:file\s+)?[a-zA-Z0-9_.-]+\.[a-zA-Z0-9]+|open\s+(?:my\s+|a\s+|the\s+)?(?:file|project\s+report|report|document|pdf|image|photo|selected\s+project\s+folder|project\s+folder|folder)|select\s+(?:a\s+)?(?:file|folder)|read\s+(?:the\s+)?(?:selected\s+)?(?:file|document|report)|summarize\s+(?:the\s+)?(?:selected\s+)?(?:report|file|document)|import\s+(?:a\s+|an\s+)?(?:3d\s+model|model\s+file|glb|gltf|obj|stl))\b/i.test(
        lower
      )
    ) {
      return {
        category: 'FILE_ACTION',
        confidence: 0.91,
        summary: 'User-selected file access, creation, search, or inspection request.',
        requiresTool: true,
        requiresPlan: false,
        missingInformation,
        resolvedReferences: followUp.resolvedReferences
      };
    }

    // 6. Browser Navigation Intent
    if (this.looksLikeBrowserIntent(lower)) {
      return {
        category: 'BROWSER_ACTION',
        confidence: 0.9,
        summary: 'Permission-gated browser tab navigation.',
        requiresTool: true,
        requiresPlan: false,
        missingInformation,
        resolvedReferences: followUp.resolvedReferences
      };
    }

    // 7. Clarification needed on ambiguous component isolation/selection
    if (/\b(isolate component|select component|highlight part)\b/i.test(lower)) {
      const selected = snapshot.objectsSummary.find((o) => o.id === snapshot.selectedObjectId);
      const hasComps = (selected?.components?.length || 0) > 0;
      const matchesExistingComp = selected?.components?.some(
        (c) => lower.includes(c.name.toLowerCase()) || lower.includes(c.id.toLowerCase())
      );
      if (!matchesExistingComp) {
        missingInformation.push(
          hasComps
            ? `Specify which component to target (${selected!.components!.map((c) => c.name).slice(0, 5).join(', ')}).`
            : 'Current object does not expose named sub-components.'
        );
        return {
          category: 'CLARIFICATION_NEEDED',
          confidence: 0.88,
          summary: 'Missing target component identifier.',
          requiresTool: true,
          requiresPlan: false,
          missingInformation,
          resolvedReferences: followUp.resolvedReferences
        };
      }
    }

    // 8. Diagnostics (network/hardware/provider)
    if (
      /\b(network diagnostics|provider status|hardware telemetry|connectivity|check api|ai status)\b/i.test(
        lower
      )
    ) {
      return {
        category: 'DIAGNOSTICS',
        confidence: 0.9,
        summary: 'Run local hardware, network, and AI provider diagnostics.',
        requiresTool: true,
        requiresPlan: false,
        missingInformation,
        resolvedReferences: followUp.resolvedReferences
      };
    }

    // 9. Built-in JARVIS Documentation & help
    if (
      /\b(what\s+(?:\w+\s+)?formats|supported\s+(?:files|formats)|formats\s+are\s+supported|shortcuts|how do i|documentation|what gestures|what can you do|help me use)\b/i.test(
        lower
      )
    ) {
      return {
        category: 'DOCUMENTATION',
        confidence: 0.89,
        summary: 'Retrieve documented capabilities and control reference.',
        requiresTool: true,
        requiresPlan: false,
        missingInformation,
        resolvedReferences: followUp.resolvedReferences
      };
    }

    // 10. Workspace or Model inspection (preserve Phase 4 exact matching)
    if (
      /\b(inspect|how many vertices|what model|imported model|components|current workspace|what is loaded)\b/i.test(
        lower
      ) ||
      (/\b(explain|describe|analyze)\b/i.test(lower) &&
        /\b(model|object|mesh|geometry|workspace|reactor|thruster|dna|lattice)\b/i.test(lower))
    ) {
      return {
        category: 'OBJECT_INSPECTION',
        confidence: 0.9,
        summary: 'Inspect workspace or selected/imported 3D model state.',
        requiresTool: true,
        requiresPlan: false,
        missingInformation,
        resolvedReferences: followUp.resolvedReferences
      };
    }

    // 10b. Coding Assistance & AI Dev Studio Intent
    const hasCodeAttachment = attachments.some((a) =>
      /\.(ts|tsx|js|jsx|py|json|css|html|yml|yaml|md)$/i.test(a.name)
    );
    if (
      /\b(debug|fix\s+(?:this|the)\s+bug|review\s+(?:this|the)\s+code|write\s+(?:unit\s+)?tests|refactor|stack\s*trace|typescript\s+error|lint\s+error|python\s+calculator|fastapi\s+backend|login\s+page|react\s+component|generate\s+code|run\s+(?:the\s+)?(?:project\s+)?tests|generate\s+(?:a\s+)?readme|architecture\s+doc|inspect\s+(?:this|the)\s+project)\b/i.test(
        lower
      ) ||
      (hasCodeAttachment && /\b(explain|review|analyze|check|debug|audit|fix)\b/i.test(lower))
    ) {
      return {
        category: 'CODING_ASSISTANCE',
        confidence: 0.9,
        summary: 'Controlled Coding, Verification & AI Dev Studio assistance.',
        requiresTool: false,
        requiresPlan: false,
        missingInformation,
        resolvedReferences: followUp.resolvedReferences
      };
    }

    // 10c. Analysis & Project/Session/Multimodal Recall Intent
    if (
      hasAttachments ||
      /\b(what were we working on|summarize\s+(?:our|this)\s+(?:session|conversation)|session\s+recap|explain\s+this\s+project|compare|trade[- ]?offs|analyze)\b/i.test(
        lower
      )
    ) {
      return {
        category: 'ANALYSIS_REQUEST',
        confidence: 0.89,
        summary: hasAttachments
          ? `Multimodal analysis across ${attachments.length} attachment(s).`
          : 'Contextual session, project, or trade-off analysis.',
        requiresTool: false,
        requiresPlan: false,
        missingInformation,
        resolvedReferences: followUp.resolvedReferences
      };
    }

    // 11. Memory queries / clearing
    if (
      /\b(what do you remember|show memory|saved memories|clear memory|forget everything)\b/i.test(
        lower
      )
    ) {
      return {
        category: 'MEMORY_MANAGEMENT',
        confidence: 0.9,
        summary: 'Inspect or manage user-controlled persistent memory.',
        requiresTool: true,
        requiresPlan: false,
        missingInformation,
        resolvedReferences: followUp.resolvedReferences
      };
    }

    // 12. Controlled Workspace Action
    if (
      /\b(delete|remove object|de-materialize|export note|save notes|duplicate|clone|wireframe|point cloud|solid holo|hybrid mode)\b/i.test(
        lower
      )
    ) {
      return {
        category: 'WORKSPACE_ACTION',
        confidence: 0.88,
        summary: 'Execute controlled workspace tool action with verification.',
        requiresTool: true,
        requiresPlan: false,
        missingInformation,
        resolvedReferences: followUp.resolvedReferences
      };
    }

    return {
      category: 'CONVERSATIONAL_QA',
      confidence: 0.8,
      summary: followUp.isFollowUp
        ? `Contextual follow-up (${followUp.inferredSubject || 'active topic'})`
        : 'Conversational engineering or general assistant query.',
      requiresTool: false,
      requiresPlan: false,
      missingInformation,
      resolvedReferences: followUp.resolvedReferences
    };
  }

  private detectApplicationTarget(lower: string): { id: string; displayName: string } | null {
    if (!/\b(open|launch|start|run)\b/i.test(lower)) {
      return null;
    }
    for (const entry of APPROVED_APP_ALIASES) {
      if (entry.pattern.test(lower)) {
        return { id: entry.id, displayName: entry.displayName };
      }
    }
    return null;
  }

  private extractLocalFilesystemPath(rawInput: string): string | null {
    const winMatch = rawInput.match(/([a-zA-Z]:\\[^\n"']+?)(?=[.?!]*(?:\s*$))/);
    if (winMatch) return winMatch[1].trim();
    const posixMatch = rawInput.match(/(\/(?:tmp|Users|home|var|mnt|opt|workspace|app)(?:\/[^\s"']+)+)/);
    if (posixMatch) return posixMatch[1].replace(/[.?!]+$/, '').trim();
    const traversalMatch = rawInput.match(/((?:\.\.|%2e%2e)(?:[\\/][^\s"']+)+)/i);
    if (traversalMatch) return traversalMatch[1].trim();
    return null;
  }

  private looksLikeBrowserIntent(lower: string): boolean {
    if (
      /\b(open\s+a\s+new\s+tab|open\s+new\s+tab|open\s+website|open\s+site|inspect\s+(?:this\s+)?(?:website|webpage|page|site|url))\b/i.test(
        lower
      ) ||
      /\binspect\s+https?:\/\/\S+/i.test(lower)
    ) {
      return true;
    }
    const navMatch = lower.match(
      /\b(?:open|navigate\s+to|go\s+to|visit|browse\s+to|launch)\s+([a-z0-9.-/:?=&_%+-]+(?:\s+[a-z0-9.-]+)?)/i
    );
    if (!navMatch) return false;
    const rawTarget = navMatch[1].replace(/[.?!]+$/, '').trim().toLowerCase();
    if (!rawTarget) return false;
    if (INTERNAL_WORKSPACE_TARGETS.has(rawTarget)) return false;
    if (/\b(file|folder|report|document|model|music|song|track|memory|brain|lab)\b/.test(rawTarget)) {
      return false;
    }
    return true;
  }

  private extractBrowserTarget(rawInput: string): string | null {
    const cleaned = rawInput
      .trim()
      .replace(/^(?:hey\s+|hi\s+|please\s+)?(?:jarvis[,\s]+)?/i, '')
      .replace(/[.?!]+$/, '')
      .trim();

    if (/^(?:open\s+(?:a\s+)?new\s+tab|open\s+(?:a\s+)?website|navigate)$/i.test(cleaned)) {
      return null;
    }

    const inspectMatch = cleaned.match(
      /(?:inspect\s+(?:this\s+)?(?:website\s+|webpage\s+|page\s+|url\s+)?)(https?:\/\/\S+|[a-z0-9.-]+\.[a-z]{2,}(?:\/\S*)?)/i
    );
    if (inspectMatch) return inspectMatch[1].trim();

    const urlMatch = cleaned.match(/https?:\/\/\S+|javascript:\S+|data:\S+|file:\S+/i);
    if (urlMatch) return urlMatch[0];

    const phraseMatch = cleaned.match(
      /(?:open|navigate\s+to|go\s+to|visit|browse\s+to|launch)\s+(?:the\s+)?(?:website\s+)?(.+?)(?:\s+in\s+(?:a\s+)?new\s+tab)?$/i
    );
    if (!phraseMatch) return null;
    const candidate = phraseMatch[1].trim();
    if (!candidate || /^(?:a\s+)?(?:new\s+)?tab$/i.test(candidate) || /^(?:a\s+)?website$/i.test(candidate)) {
      return null;
    }
    return candidate;
  }

  private extractMathExpression(input: string): string | null {
    const trimmed = input.trim();
    const explicit = trimmed.match(/^(?:calculate|compute|evaluate|math|what is)\s+(.+)$/i);
    const candidate = (explicit ? explicit[1] : trimmed).replace(/\?$/, '').trim();
    if (
      /^[0-9+\-*/^%().,\s]+$|^(?:sqrt|sin|cos|tan|log|ln|abs|round|floor|ceil|min|max|pi|e|[0-9+\-*/^%().,\s])+$/i.test(
        candidate
      )
    ) {
      if (/[+\-*/^%]|\b(?:sqrt|sin|cos|tan|log|ln|abs)\b/i.test(candidate) && /\d/.test(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  public handleUserPickedFiles(
    files: File[],
    options: { preferMusicPlayback?: boolean } = {}
  ): {
    metadata: SelectedFileMetadata | null;
    permissionRequest?: PermissionRequest;
    reply: string;
    error?: string;
  } {
    this.interactivePrompt = null;
    if (!files || files.length === 0) {
      this.setStatus('STANDBY', 'File selection cancelled by user.', 'Action cancelled.');
      return {
        metadata: null,
        reply: 'File selection was cancelled. No files were accessed.'
      };
    }

    const file = files[0];
    this.setStatus('ANALYZING', `Identifying selected file "${file.name}"...`, 'Identifying the requested file.');
    const metadata = fileAccessService.registerSelectedFile(file);
    this.pendingFileMetadata = metadata;

    if (!metadata.supported) {
      const msg = metadata.reasonIfUnsupported || `Unsupported file "${metadata.name}".`;
      this.lastError = msg;
      this.setStatus('ERROR', msg, 'Unable to complete the requested action.');
      return {
        metadata,
        reply: `Unable to open "${metadata.name}": ${msg}`,
        error: msg
      };
    }

    const isAudioForMusic = options.preferMusicPlayback || metadata.kind === 'AUDIO';
    if (isAudioForMusic && metadata.kind === 'AUDIO') {
      const perm = musicService.requestMusicPermission({
        sourceType: 'LOCAL_AUDIO',
        targetLabel: metadata.name,
        reason: `Play selected local audio track "${metadata.name}" (${metadata.sizeFormatted})`,
        metadata: { fileId: metadata.fileId }
      });
      this.pendingPermission = perm;
      this.permissionExecutors.set(perm.id, async (permissionId) => {
        const res = await toolRegistry.executeTool(
          'control_music_playback',
          { action: 'PLAY_LOCAL', fileId: metadata.fileId, permissionId },
          { approvedByUser: true }
        );
        const musicState = (res.result.data?.musicState as MusicPlaybackState | undefined) || musicService.getState();
        return {
          ok: res.result.ok,
          reply: res.result.summary,
          toolRecord: res.record,
          musicState,
          error: res.result.error
        };
      });

      const reply = `I found ${metadata.name} (${metadata.sizeFormatted}). Do you approve starting local audio playback?`;
      this.setStatus('AWAITING_APPROVAL', `Waiting for approval to play ${metadata.name}`, 'Waiting for your permission.');
      return { metadata, permissionRequest: perm, reply };
    }

    const { permissionRequest, error } = fileAccessService.requestFileAccessPermission(
      metadata.fileId,
      `User selected ${metadata.name} for ${metadata.intendedOperation.toLowerCase()}`
    );

    if (!permissionRequest || error) {
      const msg = error || 'Unable to prepare file permission request.';
      this.setStatus('ERROR', msg, 'Unable to complete the requested action.');
      return { metadata, reply: msg, error: msg };
    }

    this.pendingPermission = permissionRequest;
    this.permissionExecutors.set(permissionRequest.id, async (permissionId) => {
      const res = await toolRegistry.executeTool(
        'access_user_file',
        { fileId: metadata.fileId, permissionId },
        { approvedByUser: true }
      );
      const openedFile = res.result.data?.fileResult as FileInspectionResult | undefined;
      if (openedFile) {
        this.lastOpenedFile = openedFile;
      }
      return {
        ok: res.result.ok,
        reply: res.result.summary,
        toolRecord: res.record,
        openedFile,
        error: res.result.error
      };
    });

    const reply = `I found ${metadata.name} (${metadata.sizeFormatted}, .${metadata.extension}). Intended operation: ${metadata.intendedOperation}. Do you approve opening this file?`;
    this.setStatus(
      'AWAITING_APPROVAL',
      `Waiting for approval to access ${metadata.name}`,
      'Waiting for your permission.'
    );
    return { metadata, permissionRequest, reply };
  }

  public handleUserPickedFolder(folder: SelectedFolderMetadata | null): {
    folder: SelectedFolderMetadata | null;
    permissionRequest?: PermissionRequest;
    reply: string;
    error?: string;
  } {
    this.interactivePrompt = null;
    if (!folder || !folder.path) {
      this.setStatus('STANDBY', 'Folder selection cancelled by user.', 'Action cancelled.');
      return {
        folder: null,
        reply: 'Folder selection was cancelled. No directories were opened.'
      };
    }

    const cleanFolder = desktopBridge.setSelectedFolder(folder.path, folder.name);
    const isAlreadySaved = permissionPolicy.isPathWithinApprovedFolders(cleanFolder.path);
    const evalRes = permissionPolicy.evaluateActionPolicy({
      capability: 'FOLDER_ACCESS',
      targetPath: cleanFolder.path,
      isNewlyPickedOrUnrecognized: !isAlreadySaved
    });

    if (evalRes.outcome === 'BLOCKED') {
      permissionManager.recordPolicyBlock({
        category: 'FOLDER_ACCESS',
        requestedAction: 'Open folder in File Explorer',
        target: cleanFolder.path,
        reason: evalRes.reason,
        securityLevel: evalRes.level,
        capabilityId: 'FOLDER_ACCESS'
      });
      this.lastError = evalRes.reason;
      this.setStatus('ERROR', evalRes.reason, 'Folder Access is disabled in Permissions.');
      return { folder: cleanFolder, reply: evalRes.reason, error: 'PERMISSION_DENIED_BY_POLICY' };
    }

    const perm = permissionManager.createRequest({
      category: 'FOLDER_ACCESS',
      requestedAction: 'Open selected folder in File Explorer',
      target: cleanFolder.path,
      reason: `User selected folder "${cleanFolder.name}" (${cleanFolder.path}) to open.`,
      riskLevel: 'MEDIUM',
      securityLevel: 'LEVEL_2_SESSION_CONFIRMATION',
      capabilityId: 'FOLDER_ACCESS',
      requestedScope: `Single-use open access to folder "${cleanFolder.path}"`
    });

    this.pendingPermission = perm;
    this.permissionExecutors.set(perm.id, async (permissionId) => {
      const res = await toolRegistry.executeTool(
        'open_desktop_folder',
        { folderPath: cleanFolder.path, permissionId },
        { approvedByUser: true }
      );
      return {
        ok: res.result.ok,
        reply: res.result.summary,
        toolRecord: res.record,
        error: res.result.error
      };
    });

    const reply = `Selected folder "${cleanFolder.name}" (${cleanFolder.path}). Do you approve opening this folder?`;
    this.setStatus(
      'AWAITING_APPROVAL',
      `Waiting for approval to open folder ${cleanFolder.name}`,
      'Waiting for your permission.'
    );
    return { folder: cleanFolder, permissionRequest: perm, reply };
  }

  public selectMusicSourceChoice(
    sourceType: MusicSourceType,
    query = ''
  ): {
    permissionRequest?: PermissionRequest;
    interactivePrompt?: PendingInteractivePrompt;
    reply: string;
  } {
    const cleanQuery = query.trim();

    if (sourceType === 'LOCAL_AUDIO') {
      const prompt: PendingInteractivePrompt = {
        kind: 'FILE_PICKER',
        requestedAction: 'Select a local audio file (.mp3, .wav, .ogg, .m4a, .flac)',
        message: 'Select a local audio track from your device to review playback permission.'
      };
      this.interactivePrompt = prompt;
      const reply = 'Please select an audio file from your device for playback permission.';
      this.setStatus('STANDBY', 'Awaiting user audio file selection.', 'Identifying the requested file.');
      return { interactivePrompt: prompt, reply };
    }

    if (
      sourceType === 'SPOTIFY' ||
      sourceType === 'YOUTUBE_MUSIC' ||
      sourceType === 'SOUNDCLOUD' ||
      sourceType === 'YOUTUBE'
    ) {
      this.interactivePrompt = null;
      const label = cleanQuery || sourceType.replace('_', ' ');
      const perm = musicService.requestMusicPermission({
        sourceType,
        targetLabel: label,
        reason: `Open ${sourceType.replace('_', ' ')} for "${label}"`
      });
      this.pendingPermission = perm;
      this.permissionExecutors.set(perm.id, async (permissionId) => {
        const res = await toolRegistry.executeTool(
          'control_music_playback',
          {
            action: 'OPEN_SERVICE',
            sourceType,
            query: cleanQuery,
            permissionId
          },
          { approvedByUser: true }
        );
        const musicState = (res.result.data?.musicState as MusicPlaybackState | undefined) || musicService.getState();
        return {
          ok: res.result.ok,
          reply: res.result.summary,
          toolRecord: res.record,
          musicState,
          error: res.result.error
        };
      });

      const reply = `I am ready to open ${sourceType.replace('_', ' ')} for "${label}" in a new browser tab. Do you approve?`;
      this.setStatus(
        'AWAITING_APPROVAL',
        `Waiting for approval to open ${sourceType.replace('_', ' ')}`,
        'Waiting for your permission.'
      );
      return { permissionRequest: perm, reply };
    }

    return { reply: 'Unsupported music source selected.' };
  }

  public async resolvePendingPermission(
    decision: 'APPROVE_ONCE' | 'DENY' | 'CANCEL',
    permissionId?: string
  ): Promise<IntelligenceRequestResult | null> {
    const targetId = permissionId || this.pendingPermission?.id;
    if (!targetId) return null;

    const existing = permissionManager.getRequest(targetId);
    if (!existing) {
      this.pendingPermission = null;
      this.permissionExecutors.delete(targetId);
      this.setStatus('STANDBY', 'Permission request was no longer active.', 'Unable to complete the requested action.');
      return null;
    }

    if (decision === 'DENY') {
      permissionManager.deny(targetId, 'Permission denied by user.');
      this.permissionExecutors.delete(targetId);
      this.pendingPermission = null;
      this.pendingPermissionInputFingerprint = null;
      const reply = `Denied ${existing.category} request for "${existing.target}". No external or file action ran.`;
      conversationManager.addTurn({ role: 'assistant', text: reply, intent: 'WORKSPACE_ACTION' });
      this.setStatus('STANDBY', reply, 'Action cancelled.');
      return this.lastResult;
    }

    if (decision === 'CANCEL') {
      permissionManager.cancel(targetId, 'Action cancelled by user.');
      this.permissionExecutors.delete(targetId);
      this.pendingPermission = null;
      this.pendingPermissionInputFingerprint = null;
      const reply = `Action cancelled for "${existing.target}".`;
      conversationManager.addTurn({ role: 'assistant', text: reply, intent: 'WORKSPACE_ACTION' });
      this.setStatus('STANDBY', reply, 'Action cancelled.');
      return this.lastResult;
    }

    // APPROVE_ONCE
    const approvedReq = permissionManager.approveOnce(targetId);
    if (!approvedReq || approvedReq.status !== 'APPROVED') {
      this.permissionExecutors.delete(targetId);
      this.pendingPermission = null;
      this.pendingPermissionInputFingerprint = null;
      const statusMsg =
        approvedReq?.status === 'EXPIRED'
          ? 'Permission expired before approval. Request the action again to issue a fresh approval prompt.'
          : 'Unable to approve permission request.';
      this.lastError = statusMsg;
      this.setStatus('ERROR', statusMsg, 'Unable to complete the requested action.');
      return this.lastResult;
    }

    const executor = this.permissionExecutors.get(targetId);
    this.permissionExecutors.delete(targetId);
    this.pendingPermission = null;
    this.pendingPermissionInputFingerprint = null;

    if (!executor) {
      const msg = 'No pending executor registered for this permission request.';
      permissionManager.completeExecution(targetId, false, msg, msg);
      this.setStatus('ERROR', msg, 'Unable to complete the requested action.');
      return null;
    }

    const controller = new AbortController();
    this.activeAbortController = controller;
    this.setStatus('EXECUTING', `Permission approved. Executing ${existing.requestedAction}...`, 'Permission approved.');

    try {
      const execOut = await executor(targetId, controller.signal);
      this.setStatus(
        'VERIFYING',
        execOut.ok ? 'Verifying completed action result...' : 'Verifying failed outcome...',
        execOut.ok ? 'Permission approved.' : 'Unable to complete the requested action.'
      );

      conversationManager.addTurn({
        role: 'assistant',
        text: execOut.reply,
        toolNames: execOut.toolRecord ? [execOut.toolRecord.toolName] : undefined
      });

      const finalResult: IntelligenceRequestResult = {
        id: `perm-res-${Date.now().toString(36)}`,
        input: existing.requestedAction,
        reply: execOut.reply,
        status: execOut.ok ? 'RESPONDING' : 'ERROR',
        classification: {
          category:
            existing.category === 'FILE_ACCESS'
              ? 'FILE_ACTION'
              : existing.category === 'FOLDER_ACCESS'
              ? 'FOLDER_ACTION'
              : existing.category === 'APPLICATION_LAUNCH'
              ? 'APPLICATION_LAUNCH'
              : existing.category === 'WEB_SEARCH'
              ? 'WEB_SEARCH'
              : existing.category === 'MUSIC_PLAYBACK' || existing.category === 'MUSIC_CONTROL'
              ? 'MUSIC_ACTION'
              : existing.category === 'CODE_PATCH' || existing.category === 'DEV_COMMAND'
              ? 'CODING_ASSISTANCE'
              : 'BROWSER_ACTION',
          confidence: 1,
          summary: existing.requestedAction,
          requiresTool: true,
          requiresPlan: false,
          missingInformation: [],
          resolvedReferences: []
        },
        providerUsed: contextualAI.getConfig().provider,
        isExternalModel: false,
        toolRecords: execOut.toolRecord ? [execOut.toolRecord] : [],
        openedFile: execOut.openedFile,
        browserAction: execOut.browserAction,
        searchResult: execOut.searchResult,
        musicState: execOut.musicState,
        activitySummary: execOut.reply,
        error: execOut.ok ? undefined : execOut.error
      };

      this.lastResult = finalResult;
      if (!execOut.ok) {
        this.lastError = execOut.error || execOut.reply;
      }

      const nextStage = execOut.ok
        ? existing.category === 'BROWSER_ACCESS'
          ? 'Website opened successfully.'
          : existing.category === 'APPLICATION_LAUNCH'
          ? 'Application launched successfully.'
          : existing.category === 'FOLDER_ACCESS'
          ? 'Folder opened successfully.'
          : existing.category === 'WEB_SEARCH'
          ? 'Search completed.'
          : existing.category === 'FILE_ACCESS'
          ? 'Opening the selected file.'
          : existing.category === 'MUSIC_CONTROL'
          ? 'Music application launched.'
          : existing.category === 'MUSIC_PLAYBACK' && execOut.musicState?.isActualAudioPlaying
          ? 'Music playback started.'
          : 'Completed approved action.'
        : 'Unable to complete the requested action.';

      this.setStatus(execOut.ok ? 'STANDBY' : 'ERROR', execOut.reply, nextStage);
      return finalResult;
    } finally {
      if (this.activeAbortController === controller) {
        this.activeAbortController = null;
      }
    }
  }

  public async grantAndApprovePendingPermission(permissionId?: string): Promise<IntelligenceRequestResult | null> {
    const targetId = permissionId || this.pendingPermission?.id;
    if (!targetId) return null;

    const existing = permissionManager.getRequest(targetId);
    if (!existing) {
      return this.resolvePendingPermission('APPROVE_ONCE', targetId);
    }

    // Level 3 operations must never grant persistent auto-approval
    if (existing.securityLevel !== 'LEVEL_3_ALWAYS_CONFIRM') {
      if (existing.category === 'APPLICATION_LAUNCH') {
        permissionPolicy.setCapabilityDecision('APPLICATION_ACCESS', 'GRANTED');
      } else if (existing.category === 'BROWSER_ACCESS' || existing.category === 'WEB_SEARCH') {
        permissionPolicy.setCapabilityDecision('BROWSER_ACCESS', 'GRANTED');
      } else if (existing.category === 'MUSIC_CONTROL' || existing.category === 'MUSIC_PLAYBACK') {
        permissionPolicy.setCapabilityDecision('MUSIC_ACCESS', 'GRANTED');
      } else if (existing.category === 'FOLDER_ACCESS') {
        permissionPolicy.setCapabilityDecision('FOLDER_ACCESS', 'GRANTED');
        permissionPolicy.addApprovedFolder(existing.target);
      }
    }

    return this.resolvePendingPermission('APPROVE_ONCE', targetId);
  }

  private blockByPolicy(params: {
    reqId: string;
    rawInput: string;
    intentCategory: IntentClassification['category'];
    classification: IntentClassification;
    permCategory: PermissionCategory;
    requestedAction: string;
    target: string;
    reason: string;
    securityLevel: PermissionSecurityLevel;
    capabilityId: PermissionCapabilityId;
    memoryCandidate?: IntelligenceRequestResult['memoryCandidate'];
    snapshot: WorkspaceContextSnapshot;
  }): IntelligenceRequestResult {
    permissionManager.recordPolicyBlock({
      category: params.permCategory,
      requestedAction: params.requestedAction,
      target: params.target,
      reason: params.reason,
      securityLevel: params.securityLevel,
      capabilityId: params.capabilityId
    });
    this.lastError = params.reason;
    conversationManager.addTurn({ role: 'assistant', text: params.reason, intent: params.intentCategory });
    this.setStatus('ERROR', params.reason, 'Blocked by persistent permissions policy.');
    return this.finishResult({
      id: params.reqId,
      input: params.rawInput,
      reply: params.reason,
      status: 'ERROR',
      classification: params.classification,
      providerUsed: 'LOCAL',
      isExternalModel: false,
      toolRecords: [],
      memoryCandidate: params.memoryCandidate,
      snapshot: params.snapshot,
      error: 'PERMISSION_DENIED_BY_POLICY',
      preserveStatus: true
    });
  }

  private async executePreapprovedAction(params: {
    reqId: string;
    rawInput: string;
    intentCategory: IntentClassification['category'];
    classification: IntentClassification;
    permCategory: PermissionCategory;
    capabilityId: PermissionCapabilityId;
    requestedAction: string;
    target: string;
    reason: string;
    requestedScope: string;
    executor: PermissionExecutor;
    signal?: AbortSignal;
    memoryCandidate?: IntelligenceRequestResult['memoryCandidate'];
    snapshot: WorkspaceContextSnapshot;
  }): Promise<IntelligenceRequestResult> {
    const prePerm = permissionManager.authorizePreapprovedExecution({
      category: params.permCategory,
      requestedAction: params.requestedAction,
      target: params.target,
      reason: params.reason,
      riskLevel: 'LOW',
      securityLevel: 'LEVEL_1_PREAPPROVED',
      capabilityId: params.capabilityId,
      requestedScope: params.requestedScope
    });

    this.setStatus('EXECUTING', `Executing pre-approved action: ${params.requestedAction}...`, 'Executing authorized action.');
    const execOut = await params.executor(prePerm.id, params.signal);
    const toolRecords = execOut.toolRecord ? [execOut.toolRecord] : [];
    this.setStatus('VERIFYING', execOut.ok ? 'Verifying completed action result...' : 'Verifying failed outcome...');

    conversationManager.addTurn({
      role: 'assistant',
      text: execOut.reply,
      intent: params.intentCategory,
      toolNames: execOut.toolRecord ? [execOut.toolRecord.toolName] : undefined
    });

    if (!execOut.ok) {
      this.lastError = execOut.error || execOut.reply;
    }

    return this.finishResult({
      id: params.reqId,
      input: params.rawInput,
      reply: execOut.reply,
      status: execOut.ok ? 'RESPONDING' : 'ERROR',
      classification: params.classification,
      providerUsed: contextualAI.getConfig().provider,
      isExternalModel: false,
      toolRecords,
      openedFile: execOut.openedFile,
      browserAction: execOut.browserAction,
      searchResult: execOut.searchResult,
      musicState: execOut.musicState,
      memoryCandidate: params.memoryCandidate,
      snapshot: params.snapshot,
      error: execOut.ok ? undefined : execOut.error
    });
  }

  public async processRequest(params: {
    input: string;
    snapshot: WorkspaceContextSnapshot;
    source?: 'VOICE' | 'CONSOLE';
    attachments?: PendingAttachment[];
  }): Promise<IntelligenceRequestResult> {
    const attachments = params.attachments || [];
    const rawInput =
      params.input.trim() ||
      (attachments.length > 0 ? 'Analyze the attached file(s).' : '');
    const source = params.source || 'CONSOLE';
    const cfg = contextualAI.getConfig();

    if (!rawInput) {
      return {
        id: `req-${Date.now()}`,
        input: '',
        reply: 'No request text supplied.',
        status: 'ERROR',
        classification: {
          category: 'CLARIFICATION_NEEDED',
          confidence: 1,
          summary: 'Empty input.',
          requiresTool: false,
          requiresPlan: false,
          missingInformation: ['Provide a spoken or typed request.'],
          resolvedReferences: []
        },
        providerUsed: cfg.provider,
        isExternalModel: false,
        toolRecords: [],
        activitySummary: 'Empty input ignored.',
        error: 'Empty input.'
      };
    }

    if (attachments.length > 3) {
      return {
        id: `req-${Date.now()}`,
        input: rawInput,
        reply: 'Maximum 3 attachments per request are supported.',
        status: 'ERROR',
        classification: {
          category: 'CLARIFICATION_NEEDED',
          confidence: 1,
          summary: 'Attachment count exceeded.',
          requiresTool: false,
          requiresPlan: false,
          missingInformation: ['Attach 3 or fewer files per turn.'],
          resolvedReferences: []
        },
        providerUsed: cfg.provider,
        isExternalModel: false,
        toolRecords: [],
        activitySummary: 'Attachment limit exceeded.',
        error: 'Too many attachments.'
      };
    }

    const attachmentSig = attachments.map((a) => `${a.name}:${a.sizeBytes}`).join(',');
    const fingerprint = `${rawInput.toLowerCase()}|${attachmentSig}`;
    if (
      (this.activeRequestId && this.activeRequestFingerprint === fingerprint) ||
      (this.pendingPermission &&
        permissionManager.getStatus(this.pendingPermission.id) === 'AWAITING_APPROVAL' &&
        this.pendingPermissionInputFingerprint === fingerprint)
    ) {
      return {
        id: this.activeRequestId || `dup-${Date.now().toString(36)}`,
        input: rawInput,
        reply: this.pendingPermission
          ? `A permission request for "${this.pendingPermission.target}" is already awaiting your approval.`
          : 'A matching request is already in progress.',
        status: this.status,
        classification: {
          category: 'CONVERSATIONAL_QA',
          confidence: 1,
          summary: 'Duplicate concurrent or pending request prevented.',
          requiresTool: false,
          requiresPlan: false,
          missingInformation: [],
          resolvedReferences: []
        },
        providerUsed: cfg.provider,
        isExternalModel: false,
        toolRecords: [],
        pendingPermission: this.pendingPermission ? { ...this.pendingPermission } : undefined,
        activitySummary: 'Prevented duplicate request.',
        cancelled: true
      };
    }

    if (this.activeAbortController) {
      this.activeAbortController.abort();
    }

    const controller = new AbortController();
    const reqId = `req-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 5)}`;
    this.activeAbortController = controller;
    this.activeRequestId = reqId;
    this.activeRequestFingerprint = fingerprint;
    this.lastError = null;
    this.streamingText = '';

    const toolRecords: ToolActivityRecord[] = [];
    const attachmentRefs = attachments.map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      mimeType: a.mimeType,
      sizeFormatted: a.sizeFormatted
    }));

    try {
      this.setStatus(
        'UNDERSTANDING',
        `Understanding request: "${rawInput.slice(0, 48)}"`,
        'Understanding your request.'
      );

      const followUp = conversationManager.resolveFollowUp(rawInput, params.snapshot);
      const classification = this.classifyIntent(rawInput, params.snapshot, followUp, attachments);

      conversationManager.addTurn({
        role: 'user',
        text: rawInput,
        intent: classification.category,
        resolvedSubject: followUp.inferredSubject,
        source
      });

      const memoryCandidate = memoryManager.detectConsentCandidate(rawInput) || undefined;
      this.setStatus('ANALYZING', classification.summary);

      // 1. Clarification Needed
      if (classification.category === 'CLARIFICATION_NEEDED') {
        const reply = `I need a quick clarification before proceeding: ${classification.missingInformation.join(' ')}`;
        conversationManager.addTurn({ role: 'assistant', text: reply, intent: classification.category });
        return this.finishResult({
          id: reqId,
          input: rawInput,
          reply,
          status: 'RESPONDING',
          classification,
          providerUsed: 'LOCAL',
          isExternalModel: false,
          toolRecords,
          memoryCandidate,
          snapshot: params.snapshot
        });
      }

      // 1b. Phase 7 — APPLICATION_LAUNCH
      if (classification.category === 'APPLICATION_LAUNCH') {
        const lower = rawInput.toLowerCase();

        // Reject shell/command prompt/terminal requests immediately
        if (BLOCKED_SHELL_OR_SYSTEM_PATTERN.test(lower)) {
          const msg =
            'Security policy blocks launching unrestricted terminal shells or system configuration binaries (cmd, powershell, bash, regedit).';
          this.lastError = msg;
          conversationManager.addTurn({ role: 'assistant', text: msg, intent: 'APPLICATION_LAUNCH' });
          this.setStatus('ERROR', msg, 'Blocked disallowed shell/system binary.');
          return this.finishResult({
            id: reqId,
            input: rawInput,
            reply: msg,
            status: 'ERROR',
            classification,
            providerUsed: 'LOCAL',
            isExternalModel: false,
            toolRecords,
            memoryCandidate,
            snapshot: params.snapshot,
            error: 'BLOCKED_SHELL_COMMAND',
            preserveStatus: true
          });
        }

        const appTarget = this.detectApplicationTarget(lower);
        if (!appTarget) {
          if (permissionPolicy.getCapabilityDecision('APPLICATION_ACCESS') === 'DENIED') {
            const evalDenied = permissionPolicy.evaluateActionPolicy({ capability: 'APPLICATION_ACCESS' });
            return this.blockByPolicy({
              reqId,
              rawInput,
              intentCategory: 'APPLICATION_LAUNCH',
              classification,
              permCategory: 'APPLICATION_LAUNCH',
              requestedAction: 'Launch desktop application',
              target: 'APPLICATION_ACCESS',
              reason: evalDenied.reason,
              securityLevel: evalDenied.level,
              capabilityId: 'APPLICATION_ACCESS',
              memoryCandidate,
              snapshot: params.snapshot
            });
          }
          const prompt: PendingInteractivePrompt = {
            kind: 'AMBIGUOUS_CLARIFICATION',
            message:
              'Which approved desktop application should I open (Visual Studio Code, Notepad, Calculator, File Explorer, or Chrome)?'
          };
          this.interactivePrompt = prompt;
          conversationManager.addTurn({ role: 'assistant', text: prompt.message, intent: 'APPLICATION_LAUNCH' });
          return this.finishResult({
            id: reqId,
            input: rawInput,
            reply: prompt.message,
            status: 'RESPONDING',
            classification,
            providerUsed: 'LOCAL',
            isExternalModel: false,
            toolRecords,
            interactivePrompt: prompt,
            memoryCandidate,
            snapshot: params.snapshot
          });
        }

        const evalRes = permissionPolicy.evaluateActionPolicy({
          capability: 'APPLICATION_ACCESS',
          appId: appTarget.id
        });

        if (evalRes.outcome === 'BLOCKED') {
          return this.blockByPolicy({
            reqId,
            rawInput,
            intentCategory: 'APPLICATION_LAUNCH',
            classification,
            permCategory: 'APPLICATION_LAUNCH',
            requestedAction: `Launch ${appTarget.displayName}`,
            target: appTarget.id,
            reason: evalRes.reason,
            securityLevel: evalRes.level,
            capabilityId: 'APPLICATION_ACCESS',
            memoryCandidate,
            snapshot: params.snapshot
          });
        }

        const appExecutor: PermissionExecutor = async (permissionId) => {
          const res = await toolRegistry.executeTool(
            'launch_desktop_application',
            { applicationId: appTarget.id, permissionId },
            { approvedByUser: true }
          );
          const desktopRes = res.result.data?.desktopResult as DesktopExecutionResult | undefined;
          return {
            ok: res.result.ok,
            reply: desktopRes?.summary || res.result.summary,
            toolRecord: res.record,
            error: res.result.error
          };
        };

        if (evalRes.outcome === 'ALLOW_PREAPPROVED') {
          return this.executePreapprovedAction({
            reqId,
            rawInput,
            intentCategory: 'APPLICATION_LAUNCH',
            classification,
            permCategory: 'APPLICATION_LAUNCH',
            capabilityId: 'APPLICATION_ACCESS',
            requestedAction: `Launch ${appTarget.displayName}`,
            target: appTarget.id,
            reason: evalRes.reason,
            requestedScope: `Level 1 preapproved launch of ${appTarget.displayName} (${appTarget.id})`,
            executor: appExecutor,
            signal: controller.signal,
            memoryCandidate,
            snapshot: params.snapshot
          });
        }

        const perm = permissionManager.createRequest({
          category: 'APPLICATION_LAUNCH',
          requestedAction: `Launch ${appTarget.displayName}`,
          target: appTarget.id,
          reason: `User requested launching approved desktop application "${appTarget.displayName}"`,
          riskLevel: 'MEDIUM',
          securityLevel: evalRes.level,
          capabilityId: 'APPLICATION_ACCESS',
          requestedScope: `Single-use launch of allowlisted application ${appTarget.displayName} (${appTarget.id})`
        });

        this.pendingPermission = perm;
        this.pendingPermissionInputFingerprint = fingerprint;
        this.permissionExecutors.set(perm.id, appExecutor);

        const reply = `Plan: Launch approved desktop application ${appTarget.displayName} (${appTarget.id}) via the secure allowlist. Do you approve?`;
        conversationManager.addTurn({ role: 'assistant', text: reply, intent: 'APPLICATION_LAUNCH' });
        this.setStatus(
          'AWAITING_APPROVAL',
          `Waiting for approval to launch ${appTarget.displayName}`,
          'Waiting for your permission.'
        );
        return this.finishResult({
          id: reqId,
          input: rawInput,
          reply,
          status: 'AWAITING_APPROVAL',
          classification,
          providerUsed: 'LOCAL',
          isExternalModel: false,
          toolRecords,
          pendingPermission: perm,
          memoryCandidate,
          snapshot: params.snapshot,
          preserveStatus: true
        });
      }

      // 1c. Phase 7 & 7.1 — FOLDER_ACTION
      if (classification.category === 'FOLDER_ACTION') {
        if (permissionPolicy.getCapabilityDecision('FOLDER_ACCESS') === 'DENIED') {
          const folderEval = permissionPolicy.evaluateActionPolicy({ capability: 'FOLDER_ACCESS' });
          return this.blockByPolicy({
            reqId,
            rawInput,
            intentCategory: 'FOLDER_ACTION',
            classification,
            permCategory: 'FOLDER_ACCESS',
            requestedAction: 'Open folder in File Explorer',
            target: this.extractLocalFilesystemPath(rawInput) || desktopBridge.getSelectedFolder()?.path || 'FOLDER_ACCESS',
            reason: folderEval.reason,
            securityLevel: folderEval.level,
            capabilityId: 'FOLDER_ACCESS',
            memoryCandidate,
            snapshot: params.snapshot
          });
        }

        const explicitPath = this.extractLocalFilesystemPath(rawInput);
        const selectedFolder = desktopBridge.getSelectedFolder();
        const savedFolders = permissionPolicy.getApprovedFolders();

        // Clarify if user asks "open project folder" but multiple approved folders exist
        if (
          !explicitPath &&
          !selectedFolder &&
          savedFolders.length > 1 &&
          !savedFolders.some((f) => rawInput.toLowerCase().includes(f.name.toLowerCase()))
        ) {
          const msg = `Which project folder would you like me to open? (${savedFolders.map((f) => f.name).join(', ')})`;
          conversationManager.addTurn({ role: 'assistant', text: msg, intent: 'FOLDER_ACTION' });
          return this.finishResult({
            id: reqId,
            input: rawInput,
            reply: msg,
            status: 'RESPONDING',
            classification,
            providerUsed: 'LOCAL',
            isExternalModel: false,
            toolRecords,
            memoryCandidate,
            snapshot: params.snapshot
          });
        }

        const savedFolder = savedFolders[0]?.path || '';
        const targetFolderPath = explicitPath || selectedFolder?.path || savedFolder;

        if (!targetFolderPath) {
          const prompt: PendingInteractivePrompt = {
            kind: 'FILE_PICKER',
            allowFolderSelection: true,
            requestedAction: 'Select a project folder or file',
            message:
              'Browser security prevents JARVIS from silently scanning local folders. Select your project folder or specific file(s) using the picker below.'
          };
          this.interactivePrompt = prompt;
          conversationManager.addTurn({ role: 'assistant', text: prompt.message, intent: 'FOLDER_ACTION' });
          return this.finishResult({
            id: reqId,
            input: rawInput,
            reply: prompt.message,
            status: 'RESPONDING',
            classification,
            providerUsed: 'LOCAL',
            isExternalModel: false,
            toolRecords,
            interactivePrompt: prompt,
            memoryCandidate,
            snapshot: params.snapshot
          });
        }

        if (/(^|[\\/])\.\.([\\/]|$)|%2e%2e/i.test(targetFolderPath)) {
          const msg = 'Blocked invalid folder path: directory traversal (..) is prohibited.';
          this.lastError = msg;
          conversationManager.addTurn({ role: 'assistant', text: msg, intent: 'FOLDER_ACTION' });
          this.setStatus('ERROR', msg, 'Blocked invalid folder path.');
          return this.finishResult({
            id: reqId,
            input: rawInput,
            reply: msg,
            status: 'ERROR',
            classification,
            providerUsed: 'LOCAL',
            isExternalModel: false,
            toolRecords,
            memoryCandidate,
            snapshot: params.snapshot,
            error: 'PATH_TRAVERSAL_BLOCKED',
            preserveStatus: true
          });
        }

        const evalRes = permissionPolicy.evaluateActionPolicy({
          capability: 'FOLDER_ACCESS',
          targetPath: targetFolderPath
        });

        desktopBridge.registerApprovedPath(targetFolderPath);

        const folderExecutor: PermissionExecutor = async (permissionId) => {
          const res = await toolRegistry.executeTool(
            'open_desktop_folder',
            { folderPath: targetFolderPath, permissionId },
            { approvedByUser: true }
          );
          const desktopRes = res.result.data?.desktopResult as DesktopExecutionResult | undefined;
          return {
            ok: res.result.ok,
            reply: desktopRes?.summary || res.result.summary,
            toolRecord: res.record,
            error: res.result.error
          };
        };

        if (evalRes.outcome === 'ALLOW_PREAPPROVED') {
          return this.executePreapprovedAction({
            reqId,
            rawInput,
            intentCategory: 'FOLDER_ACTION',
            classification,
            permCategory: 'FOLDER_ACCESS',
            capabilityId: 'FOLDER_ACCESS',
            requestedAction: 'Open folder in File Explorer',
            target: targetFolderPath,
            reason: evalRes.reason,
            requestedScope: `Open previously approved folder "${targetFolderPath}"`,
            executor: folderExecutor,
            signal: controller.signal,
            memoryCandidate,
            snapshot: params.snapshot
          });
        }

        const perm = permissionManager.createRequest({
          category: 'FOLDER_ACCESS',
          requestedAction: 'Open folder in File Explorer',
          target: targetFolderPath,
          reason: `User requested opening approved folder "${targetFolderPath}"`,
          riskLevel: 'MEDIUM',
          securityLevel: evalRes.level,
          capabilityId: 'FOLDER_ACCESS',
          requestedScope: `Single-use open access to folder "${targetFolderPath}"`
        });

        this.pendingPermission = perm;
        this.pendingPermissionInputFingerprint = fingerprint;
        this.permissionExecutors.set(perm.id, folderExecutor);

        const reply = `Plan: Open approved folder "${targetFolderPath}" in File Explorer. Do you approve?`;
        conversationManager.addTurn({ role: 'assistant', text: reply, intent: 'FOLDER_ACTION' });
        this.setStatus(
          'AWAITING_APPROVAL',
          `Waiting for approval to open folder ${targetFolderPath}`,
          'Waiting for your permission.'
        );
        return this.finishResult({
          id: reqId,
          input: rawInput,
          reply,
          status: 'AWAITING_APPROVAL',
          classification,
          providerUsed: 'LOCAL',
          isExternalModel: false,
          toolRecords,
          pendingPermission: perm,
          memoryCandidate,
          snapshot: params.snapshot,
          preserveStatus: true
        });
      }

      // 2. Phase 5, 7 & 7.1 — FILE_ACTION
      if (classification.category === 'FILE_ACTION') {
        const lower = rawInput.toLowerCase();
        const explicitFilePath = this.extractLocalFilesystemPath(rawInput);

        if (permissionPolicy.getCapabilityDecision('FOLDER_ACCESS') === 'DENIED') {
          const folderEval = permissionPolicy.evaluateActionPolicy({ capability: 'FOLDER_ACCESS' });
          return this.blockByPolicy({
            reqId,
            rawInput,
            intentCategory: 'FILE_ACTION',
            classification,
            permCategory: 'FILE_ACCESS',
            requestedAction: 'Open desktop file with default application',
            target: explicitFilePath || 'FOLDER_ACCESS',
            reason: folderEval.reason,
            securityLevel: folderEval.level,
            capabilityId: 'FOLDER_ACCESS',
            memoryCandidate,
            snapshot: params.snapshot
          });
        }

        if (explicitFilePath) {
          if (/(^|[\\/])\.\.([\\/]|$)|%2e%2e/i.test(explicitFilePath)) {
            const msg = 'Blocked invalid file path: directory traversal (..) is prohibited.';
            this.lastError = msg;
            conversationManager.addTurn({ role: 'assistant', text: msg, intent: 'FILE_ACTION' });
            this.setStatus('ERROR', msg, 'Blocked invalid file path.');
            return this.finishResult({
              id: reqId,
              input: rawInput,
              reply: msg,
              status: 'ERROR',
              classification,
              providerUsed: 'LOCAL',
              isExternalModel: false,
              toolRecords,
              memoryCandidate,
              snapshot: params.snapshot,
              error: 'PATH_TRAVERSAL_BLOCKED',
              preserveStatus: true
            });
          }

          const isWithinSavedFolder = permissionPolicy.isPathWithinApprovedFolders(explicitFilePath);
          desktopBridge.registerApprovedPath(explicitFilePath);
          const perm = permissionManager.createRequest({
            category: 'FILE_ACCESS',
            requestedAction: 'Open desktop file with default application',
            target: explicitFilePath,
            reason: `User requested opening file "${explicitFilePath}"`,
            riskLevel: 'MEDIUM',
            securityLevel: isWithinSavedFolder ? 'LEVEL_1_PREAPPROVED' : 'LEVEL_2_SESSION_CONFIRMATION',
            capabilityId: 'FOLDER_ACCESS',
            requestedScope: `Single-use open access to file "${explicitFilePath}"`
          });

          this.pendingPermission = perm;
          this.pendingPermissionInputFingerprint = fingerprint;
          this.permissionExecutors.set(perm.id, async (permissionId) => {
            const res = await toolRegistry.executeTool(
              'open_desktop_file_system',
              { filePath: explicitFilePath, permissionId },
              { approvedByUser: true }
            );
            const desktopRes = res.result.data?.desktopResult as DesktopExecutionResult | undefined;
            return {
              ok: res.result.ok,
              reply: desktopRes?.summary || res.result.summary,
              toolRecord: res.record,
              error: res.result.error
            };
          });

          const reply = `Plan: Open file "${explicitFilePath}" with its default desktop application. Do you approve?`;
          conversationManager.addTurn({ role: 'assistant', text: reply, intent: 'FILE_ACTION' });
          this.setStatus(
            'AWAITING_APPROVAL',
            `Waiting for approval to open ${explicitFilePath}`,
            'Waiting for your permission.'
          );
          return this.finishResult({
            id: reqId,
            input: rawInput,
            reply,
            status: 'AWAITING_APPROVAL',
            classification,
            providerUsed: 'LOCAL',
            isExternalModel: false,
            toolRecords,
            pendingPermission: perm,
            memoryCandidate,
            snapshot: params.snapshot,
            preserveStatus: true
          });
        }

        // 1. Natural language create text file: "create a text file named <name> containing <text>"
        const createMatch = rawInput.match(
          /(?:create|write)\s+(?:a\s+)?(?:text\s+)?file\s+(?:named\s+|called\s+)?["']?([a-zA-Z0-9_.-]+\.[a-zA-Z0-9]+)["']?\s*(?:containing|with\s+(?:content|text))?\s*["']?([\s\S]*?)["']?$/i
        );
        if (createMatch) {
          const fileName = createMatch[1];
          const fileContent = createMatch[2]?.trim() || 'Created by JARVIS Desktop Assistant.';
          const selectedFolder = desktopBridge.getSelectedFolder()?.path || permissionPolicy.getApprovedFolders()[0]?.path;
          if (!selectedFolder) {
            const msg = 'Where should I save this file? Please specify an approved directory or select a folder first.';
            conversationManager.addTurn({ role: 'assistant', text: msg, intent: 'FILE_ACTION' });
            return this.finishResult({
              id: reqId,
              input: rawInput,
              reply: msg,
              status: 'RESPONDING',
              classification,
              providerUsed: 'LOCAL',
              isExternalModel: false,
              toolRecords,
              memoryCandidate,
              snapshot: params.snapshot
            });
          }

          const targetFilePath = `${selectedFolder.replace(/[\\/]+$/, '')}/${fileName}`;
          if (/(^|[\\/])\.\.([\\/]|$)|%2e%2e/i.test(targetFilePath)) {
            const msg = 'Blocked invalid file path: directory traversal (..) is prohibited.';
            this.lastError = msg;
            conversationManager.addTurn({ role: 'assistant', text: msg, intent: 'FILE_ACTION' });
            return this.finishResult({
              id: reqId,
              input: rawInput,
              reply: msg,
              status: 'ERROR',
              classification,
              providerUsed: 'LOCAL',
              isExternalModel: false,
              toolRecords,
              memoryCandidate,
              snapshot: params.snapshot,
              error: 'PATH_TRAVERSAL_BLOCKED'
            });
          }

          const perm = permissionManager.createRequest({
            category: 'FILE_CREATE',
            requestedAction: `Create text file "${fileName}"`,
            target: targetFilePath,
            reason: `User requested creating file "${fileName}" in approved folder`,
            riskLevel: 'LOW',
            securityLevel: 'LEVEL_2_SESSION_CONFIRMATION',
            capabilityId: 'FOLDER_ACCESS',
            requestedScope: `Write new text file to "${targetFilePath}"`
          });

          this.pendingPermission = perm;
          this.pendingPermissionInputFingerprint = fingerprint;
          this.permissionExecutors.set(perm.id, async (permissionId) => {
            const res = await toolRegistry.executeTool(
              'create_desktop_text_file',
              { filePath: targetFilePath, content: fileContent, overwrite: false, permissionId },
              { approvedByUser: true }
            );
            return {
              ok: res.result.ok,
              reply: res.result.summary,
              toolRecord: res.record,
              error: res.result.error
            };
          });

          const reply = `Plan: Create text file "${fileName}" in approved folder "${selectedFolder}" (${fileContent.length} chars). Do you approve?`;
          conversationManager.addTurn({ role: 'assistant', text: reply, intent: 'FILE_ACTION' });
          this.setStatus(
            'AWAITING_APPROVAL',
            `Waiting for approval to create file ${fileName}`,
            'Waiting for your permission.'
          );
          return this.finishResult({
            id: reqId,
            input: rawInput,
            reply,
            status: 'AWAITING_APPROVAL',
            classification,
            providerUsed: 'LOCAL',
            isExternalModel: false,
            toolRecords,
            pendingPermission: perm,
            memoryCandidate,
            snapshot: params.snapshot,
            preserveStatus: true
          });
        }

        // 2. Natural language file search: "find a file named <name>" or "search files"
        const searchFileMatch = rawInput.match(
          /(?:find|search\s+for)\s+(?:a\s+)?file(?:\s+named)?\s+["']?([a-zA-Z0-9_.-]+)["']?/i
        );
        if (searchFileMatch) {
          const searchName = searchFileMatch[1].trim();
          const targetFolder = desktopBridge.getSelectedFolder()?.path || permissionPolicy.getApprovedFolders()[0]?.path;
          if (!targetFolder) {
            const msg = 'Which project folder would you like me to search? Please select or approve an access folder first.';
            conversationManager.addTurn({ role: 'assistant', text: msg, intent: 'FILE_ACTION' });
            return this.finishResult({
              id: reqId,
              input: rawInput,
              reply: msg,
              status: 'RESPONDING',
              classification,
              providerUsed: 'LOCAL',
              isExternalModel: false,
              toolRecords,
              memoryCandidate,
              snapshot: params.snapshot
            });
          }

          const listing = await desktopBridge.listFilesInFolder(targetFolder);
          if (!listing.ok) {
            const msg = `Unable to search folder "${targetFolder}": ${listing.error}`;
            conversationManager.addTurn({ role: 'assistant', text: msg, intent: 'FILE_ACTION' });
            return this.finishResult({
              id: reqId,
              input: rawInput,
              reply: msg,
              status: 'ERROR',
              classification,
              providerUsed: 'LOCAL',
              isExternalModel: false,
              toolRecords,
              memoryCandidate,
              snapshot: params.snapshot,
              error: listing.error
            });
          }

          const matchedFiles = listing.items.filter((item) =>
            item.name.toLowerCase().includes(searchName.toLowerCase())
          );
          let reply = '';
          if (matchedFiles.length > 0) {
            const fileListStr = matchedFiles
              .map((f) => `• ${f.name} (${f.isDirectory ? 'Directory' : `${f.sizeBytes} bytes`})`)
              .join('\n');
            reply = `Found ${matchedFiles.length} matching item(s) in "${targetFolder}":\n${fileListStr}\nWould you like me to read or open one of these files?`;
          } else {
            reply = `No files matching "${searchName}" were found in "${targetFolder}". (Scanned ${listing.items.length} items).`;
          }
          conversationManager.addTurn({ role: 'assistant', text: reply, intent: 'FILE_ACTION' });
          return this.finishResult({
            id: reqId,
            input: rawInput,
            reply,
            status: 'RESPONDING',
            classification,
            providerUsed: 'LOCAL',
            isExternalModel: false,
            toolRecords,
            memoryCandidate,
            snapshot: params.snapshot
          });
        }

        // 3. Natural language read file: "read <filename>"
        const readFileMatch = rawInput.match(
          /\bread\s+(?:the\s+)?(?:file\s+)?["']?([a-zA-Z0-9_.-]+\.[a-zA-Z0-9]+)["']?/i
        );
        if (readFileMatch) {
          const targetName = readFileMatch[1].trim();
          const targetFolder = desktopBridge.getSelectedFolder()?.path || permissionPolicy.getApprovedFolders()[0]?.path;
          const fullPath = targetFolder ? `${targetFolder.replace(/[\\/]+$/, '')}/${targetName}` : targetName;
          desktopBridge.registerApprovedPath(fullPath);

          const perm = permissionManager.createRequest({
            category: 'FILE_ACCESS',
            requestedAction: `Read desktop file "${targetName}"`,
            target: fullPath,
            reason: `User requested reading safe text from "${targetName}"`,
            riskLevel: 'LOW',
            securityLevel: 'LEVEL_1_PREAPPROVED',
            capabilityId: 'FOLDER_ACCESS',
            requestedScope: `Read text content from "${fullPath}"`
          });

          this.pendingPermission = perm;
          this.pendingPermissionInputFingerprint = fingerprint;
          this.permissionExecutors.set(perm.id, async (permissionId) => {
            const res = await toolRegistry.executeTool(
              'read_desktop_file',
              { filePath: fullPath, permissionId },
              { approvedByUser: true }
            );
            const readData = res.result.data?.fileRead as
              | { ok?: boolean; name?: string; sizeBytes?: number; content?: string; error?: string }
              | undefined;
            const lineCount = readData?.content ? readData.content.split(/\r?\n/).length : 0;
            const reply =
              res.result.ok && readData?.content
                ? `File "${readData.name || targetName}" (${readData.sizeBytes || readData.content.length} bytes, ${lineCount} lines):\n\n${readData.content.slice(0, 1500)}`
                : res.result.summary;
            return {
              ok: res.result.ok,
              reply,
              toolRecord: res.record,
              error: res.result.error
            };
          });

          const reply = `Plan: Read content from "${fullPath}". Do you approve?`;
          conversationManager.addTurn({ role: 'assistant', text: reply, intent: 'FILE_ACTION' });
          this.setStatus(
            'AWAITING_APPROVAL',
            `Waiting for approval to read ${targetName}`,
            'Waiting for your permission.'
          );
          return this.finishResult({
            id: reqId,
            input: rawInput,
            reply,
            status: 'AWAITING_APPROVAL',
            classification,
            providerUsed: 'LOCAL',
            isExternalModel: false,
            toolRecords,
            pendingPermission: perm,
            memoryCandidate,
            snapshot: params.snapshot,
            preserveStatus: true
          });
        }

        // Handle "open my project folder" honestly while offering native/browser folder & file pickers
        if (/\bfolder\b/i.test(lower)) {
          const prompt: PendingInteractivePrompt = {
            kind: 'FILE_PICKER',
            allowFolderSelection: true,
            requestedAction: 'Select a project folder or file(s) from your project folder',
            message:
              'Browser security prevents JARVIS from silently scanning local folders. Select your project folder or the specific file(s) from your project folder using the picker below.'
          };
          this.interactivePrompt = prompt;
          const reply = prompt.message;
          conversationManager.addTurn({ role: 'assistant', text: reply, intent: 'FILE_ACTION' });
          return this.finishResult({
            id: reqId,
            input: rawInput,
            reply,
            status: 'RESPONDING',
            classification,
            providerUsed: 'LOCAL',
            isExternalModel: false,
            toolRecords,
            interactivePrompt: prompt,
            memoryCandidate,
            snapshot: params.snapshot
          });
        }

        // Handle "summarize" or "read the selected report/file" if already opened
        if (/\b(summarize|summary|selected\s+(?:report|file|document))\b/i.test(lower) && this.lastOpenedFile?.ok) {
          if (this.lastOpenedFile.textContent) {
            const summary = fileAccessService.summarizeTextContent(this.lastOpenedFile.textContent);
            const reply = `Summary of "${this.lastOpenedFile.name}": ${summary}`;
            conversationManager.addTurn({ role: 'assistant', text: reply, intent: 'FILE_ACTION' });
            return this.finishResult({
              id: reqId,
              input: rawInput,
              reply,
              status: 'RESPONDING',
              classification,
              providerUsed: 'LOCAL',
              isExternalModel: false,
              toolRecords,
              openedFile: this.lastOpenedFile,
              memoryCandidate,
              snapshot: params.snapshot
            });
          }
        }

        const is3DModelIntent = /\b(3d\s+model|model\s+file|glb|gltf|obj|stl)\b/i.test(lower);
        const isImageIntent = /\b(image|photo|picture|png|jpg|svg)\b/i.test(lower);
        const prompt: PendingInteractivePrompt = {
          kind: 'FILE_PICKER',
          requestedAction: is3DModelIntent
            ? 'Select a 3D model (.glb, .gltf, .obj, .stl)'
            : isImageIntent
            ? 'Select an image file (.png, .jpg, .webp, .svg)'
            : 'Select a file to inspect or open',
          message:
            'I can open a file for you after you choose it and approve access. Please select the file you want me to access.'
        };
        this.interactivePrompt = prompt;
        this.stageFeedback = 'Identifying the requested file.';
        conversationManager.addTurn({ role: 'assistant', text: prompt.message, intent: 'FILE_ACTION' });
        return this.finishResult({
          id: reqId,
          input: rawInput,
          reply: prompt.message,
          status: 'RESPONDING',
          classification,
          providerUsed: 'LOCAL',
          isExternalModel: false,
          toolRecords,
          interactivePrompt: prompt,
          memoryCandidate,
          snapshot: params.snapshot
        });
      }

      // 3. Phase 5 & 7.1 — BROWSER_ACTION
      if (classification.category === 'BROWSER_ACTION') {
        const extractedTarget = this.extractBrowserTarget(rawInput);
        if (!extractedTarget) {
          const browserEvalEmpty = permissionPolicy.evaluateActionPolicy({ capability: 'BROWSER_ACCESS' });
          if (browserEvalEmpty.outcome === 'BLOCKED') {
            return this.blockByPolicy({
              reqId,
              rawInput,
              intentCategory: 'BROWSER_ACTION',
              classification,
              permCategory: 'BROWSER_ACCESS',
              requestedAction: 'Open website in new browser tab',
              target: 'BROWSER_ACCESS',
              reason: browserEvalEmpty.reason,
              securityLevel: browserEvalEmpty.level,
              capabilityId: 'BROWSER_ACCESS',
              memoryCandidate,
              snapshot: params.snapshot
            });
          }

          const prompt: PendingInteractivePrompt = {
            kind: 'AMBIGUOUS_CLARIFICATION',
            message: 'Which website or URL would you like me to open in a new browser tab?'
          };
          this.interactivePrompt = prompt;
          conversationManager.addTurn({ role: 'assistant', text: prompt.message, intent: 'BROWSER_ACTION' });
          return this.finishResult({
            id: reqId,
            input: rawInput,
            reply: prompt.message,
            status: 'RESPONDING',
            classification,
            providerUsed: 'LOCAL',
            isExternalModel: false,
            toolRecords,
            interactivePrompt: prompt,
            memoryCandidate,
            snapshot: params.snapshot
          });
        }

        const preview = browserActionService.resolveDestinationPreview(extractedTarget);
        if (!preview.valid || !preview.normalizedUrl) {
          const reply = preview.error || `Unable to verify destination "${extractedTarget}".`;
          this.lastError = reply;
          conversationManager.addTurn({ role: 'assistant', text: reply, intent: 'BROWSER_ACTION' });
          this.setStatus('ERROR', reply, 'Unable to complete the requested action.');
          return this.finishResult({
            id: reqId,
            input: rawInput,
            reply,
            status: 'ERROR',
            classification,
            providerUsed: 'LOCAL',
            isExternalModel: false,
            toolRecords,
            memoryCandidate,
            snapshot: params.snapshot,
            error: reply,
            preserveStatus: true
          });
        }

        const targetUrl = preview.normalizedUrl;

        // Webpage Inspection request: "inspect this website <url>"
        if (/\binspect\b/i.test(rawInput)) {
          this.setStatus('EXECUTING', `Inspecting web page: ${targetUrl}`);
          const res = await toolRegistry.executeTool('inspect_web_page', { url: targetUrl });
          const inspection = res.result.data?.pageInspection as WebPageInspectionResult | undefined;
          let reply = '';
          if (res.result.ok && inspection) {
            reply = `Web Page Inspection for ${targetUrl}:\n• Title: ${inspection.title || 'Untitled'}\n• Status: ${inspection.status ?? 200}\n• Description: ${inspection.description || 'No description provided'}\n• Content Preview: ${inspection.previewText || 'None'}`;
          } else {
            reply = res.result.error || `Unable to inspect ${targetUrl}`;
          }
          conversationManager.addTurn({ role: 'assistant', text: reply, intent: 'BROWSER_ACTION' });
          return this.finishResult({
            id: reqId,
            input: rawInput,
            reply,
            status: res.result.ok ? 'RESPONDING' : 'ERROR',
            classification,
            providerUsed: 'LOCAL',
            isExternalModel: false,
            toolRecords: res.record ? [...toolRecords, res.record] : toolRecords,
            memoryCandidate,
            snapshot: params.snapshot,
            error: res.result.error
          });
        }

        const evalRes = permissionPolicy.evaluateActionPolicy({ capability: 'BROWSER_ACCESS' });

        if (evalRes.outcome === 'BLOCKED') {
          return this.blockByPolicy({
            reqId,
            rawInput,
            intentCategory: 'BROWSER_ACTION',
            classification,
            permCategory: 'BROWSER_ACCESS',
            requestedAction: 'Open website in new browser tab',
            target: targetUrl,
            reason: evalRes.reason,
            securityLevel: evalRes.level,
            capabilityId: 'BROWSER_ACCESS',
            memoryCandidate,
            snapshot: params.snapshot
          });
        }

        const browserExecutor: PermissionExecutor = async (permissionId) => {
          const res = await toolRegistry.executeTool(
            'open_external_url',
            { url: targetUrl, permissionId },
            { approvedByUser: true }
          );
          const browserAction = res.result.data?.browserAction as BrowserNavigationResult | undefined;
          if (browserAction) {
            this.lastBrowserAction = browserAction;
          }
          return {
            ok: res.result.ok,
            reply: res.result.summary,
            toolRecord: res.record,
            browserAction,
            error: res.result.error
          };
        };

        if (evalRes.outcome === 'ALLOW_PREAPPROVED') {
          return this.executePreapprovedAction({
            reqId,
            rawInput,
            intentCategory: 'BROWSER_ACTION',
            classification,
            permCategory: 'BROWSER_ACCESS',
            capabilityId: 'BROWSER_ACCESS',
            requestedAction: 'Open website in new browser tab',
            target: targetUrl,
            reason: evalRes.reason,
            requestedScope: `Level 1 preapproved browser navigation to ${targetUrl}`,
            executor: browserExecutor,
            signal: controller.signal,
            memoryCandidate,
            snapshot: params.snapshot
          });
        }

        const { permissionRequest } = browserActionService.requestOpenWebsitePermission(
          extractedTarget,
          `User requested opening "${extractedTarget}" in a new browser tab`
        );

        if (!permissionRequest) {
          return this.finishResult({
            id: reqId,
            input: rawInput,
            reply: `Unable to verify destination "${extractedTarget}".`,
            status: 'ERROR',
            classification,
            providerUsed: 'LOCAL',
            isExternalModel: false,
            toolRecords,
            memoryCandidate,
            snapshot: params.snapshot,
            error: 'INVALID_URL'
          });
        }

        permissionRequest.securityLevel = evalRes.level;
        permissionRequest.capabilityId = 'BROWSER_ACCESS';
        this.pendingPermission = permissionRequest;
        this.pendingPermissionInputFingerprint = fingerprint;
        this.permissionExecutors.set(permissionRequest.id, browserExecutor);

        const reply = `I can open ${preview.hostname} (${targetUrl}) in a new browser tab. Do you approve?`;
        conversationManager.addTurn({ role: 'assistant', text: reply, intent: 'BROWSER_ACTION' });
        this.setStatus(
          'AWAITING_APPROVAL',
          `Waiting for approval to open ${preview.hostname}`,
          'Waiting for your permission.'
        );
        return this.finishResult({
          id: reqId,
          input: rawInput,
          reply,
          status: 'AWAITING_APPROVAL',
          classification,
          providerUsed: 'LOCAL',
          isExternalModel: false,
          toolRecords,
          pendingPermission: permissionRequest,
          memoryCandidate,
          snapshot: params.snapshot,
          preserveStatus: true
        });
      }

      // 4. Phase 5 & 7.1 — WEB_SEARCH
      if (classification.category === 'WEB_SEARCH') {
        const searchIntent = extractSearchIntent(rawInput);
        if (searchIntent.ambiguous || !searchIntent.query) {
          const prompt: PendingInteractivePrompt = {
            kind: 'AMBIGUOUS_CLARIFICATION',
            message:
              searchIntent.clarificationQuestion ||
              'What exact topic or keywords would you like me to search for?'
          };
          this.interactivePrompt = prompt;
          conversationManager.addTurn({ role: 'assistant', text: prompt.message, intent: 'WEB_SEARCH' });
          return this.finishResult({
            id: reqId,
            input: rawInput,
            reply: prompt.message,
            status: 'RESPONDING',
            classification,
            providerUsed: 'LOCAL',
            isExternalModel: false,
            toolRecords,
            interactivePrompt: prompt,
            memoryCandidate,
            snapshot: params.snapshot
          });
        }

        const evalRes = permissionPolicy.evaluateActionPolicy({ capability: 'BROWSER_ACCESS' });
        if (evalRes.outcome === 'BLOCKED') {
          return this.blockByPolicy({
            reqId,
            rawInput,
            intentCategory: 'WEB_SEARCH',
            classification,
            permCategory: 'WEB_SEARCH',
            requestedAction: `Search the web via ${searchIntent.provider}`,
            target: searchIntent.query,
            reason: evalRes.reason,
            securityLevel: evalRes.level,
            capabilityId: 'BROWSER_ACCESS',
            memoryCandidate,
            snapshot: params.snapshot
          });
        }

        const searchExecutor: PermissionExecutor = async (permissionId, signal) => {
          if (desktopBridge.isElectron()) {
            const desktopSearch = await toolRegistry.executeTool(
              'desktop_web_search',
              { query: searchIntent.query, permissionId },
              { approvedByUser: true }
            );
            const desktopRes = desktopSearch.result.data?.desktopResult as DesktopExecutionResult | undefined;
            return {
              ok: desktopSearch.result.ok,
              reply: desktopRes?.summary || desktopSearch.result.summary,
              toolRecord: desktopSearch.record,
              error: desktopSearch.result.error
            };
          }

          const searchRes = await webSearchService.executeApprovedSearch(
            searchIntent.query,
            permissionId,
            {
              provider: searchIntent.provider,
              signal,
              openInBrowserFallback: true
            }
          );
          this.lastSearchResult = searchRes;
          const record: ToolActivityRecord = {
            id: `tool-${Date.now().toString(36)}`,
            toolName: 'search_web',
            args: { query: searchIntent.query, provider: searchIntent.provider },
            permissionLevel: 'CONSEQUENTIAL',
            approvedByUser: true,
            status: searchRes.ok ? 'EXECUTED' : searchRes.cancelled ? 'CANCELLED' : 'FAILED',
            verified: searchRes.ok,
            summary: searchRes.ok
              ? searchRes.sourceSummary || `Search completed for "${searchRes.query}".`
              : searchRes.error || 'Search failed.',
            error: searchRes.error,
            timestamp: Date.now()
          };
          const reply = searchRes.ok
            ? searchRes.sourceSummary
              ? `Search completed (${searchRes.results.length} source result(s), external web content): ${searchRes.sourceSummary}`
              : `Search completed for "${searchRes.query}" via ${searchRes.provider}.`
            : searchRes.error || 'Unable to complete web search.';
          return {
            ok: searchRes.ok,
            reply,
            toolRecord: record,
            searchResult: searchRes,
            error: searchRes.error
          };
        };

        if (evalRes.outcome === 'ALLOW_PREAPPROVED') {
          return this.executePreapprovedAction({
            reqId,
            rawInput,
            intentCategory: 'WEB_SEARCH',
            classification,
            permCategory: 'WEB_SEARCH',
            capabilityId: 'BROWSER_ACCESS',
            requestedAction: `Search the web via ${searchIntent.provider}`,
            target: searchIntent.query,
            reason: evalRes.reason,
            requestedScope: `Level 1 preapproved web search query "${searchIntent.query}"`,
            executor: searchExecutor,
            signal: controller.signal,
            memoryCandidate,
            snapshot: params.snapshot
          });
        }

        const perm = webSearchService.requestSearchPermission(
          searchIntent.query,
          searchIntent.provider,
          `Execute web search for "${searchIntent.query}" via ${searchIntent.provider}`
        );
        perm.securityLevel = evalRes.level;
        perm.capabilityId = 'BROWSER_ACCESS';
        this.pendingPermission = perm;
        this.pendingPermissionInputFingerprint = fingerprint;
        this.permissionExecutors.set(perm.id, searchExecutor);

        const reply = `I understood your request as: ${searchIntent.displayDescription}. Shall I proceed?`;
        conversationManager.addTurn({ role: 'assistant', text: reply, intent: 'WEB_SEARCH' });
        this.setStatus(
          'AWAITING_APPROVAL',
          `Waiting for permission to search "${searchIntent.query}"`,
          'Waiting for your permission.'
        );
        return this.finishResult({
          id: reqId,
          input: rawInput,
          reply,
          status: 'AWAITING_APPROVAL',
          classification,
          providerUsed: 'LOCAL',
          isExternalModel: false,
          toolRecords,
          pendingPermission: perm,
          memoryCandidate,
          snapshot: params.snapshot,
          preserveStatus: true
        });
      }

      // 5. Phase 5 — MUSIC_ACTION
      if (classification.category === 'MUSIC_ACTION') {
        const lower = rawInput.toLowerCase();

        if (/\bpause\b/i.test(lower)) {
          const { result, record } = await toolRegistry.executeTool(
            'control_music_playback',
            { action: 'PAUSE' },
            { approvedByUser: true }
          );
          toolRecords.push(record);
          conversationManager.addTurn({
            role: 'assistant',
            text: result.summary,
            intent: 'MUSIC_ACTION',
            toolNames: ['control_music_playback']
          });
          return this.finishResult({
            id: reqId,
            input: rawInput,
            reply: result.summary,
            status: result.ok ? 'RESPONDING' : 'ERROR',
            classification,
            providerUsed: 'LOCAL',
            isExternalModel: false,
            toolRecords,
            musicState: musicService.getState(),
            memoryCandidate,
            snapshot: params.snapshot,
            error: result.ok ? undefined : result.error
          });
        }

        if (/\bresume\b|\bunpause\b|\bcontinue\s+music\b/i.test(lower)) {
          const { result, record } = await toolRegistry.executeTool(
            'control_music_playback',
            { action: 'RESUME' },
            { approvedByUser: true }
          );
          toolRecords.push(record);
          conversationManager.addTurn({
            role: 'assistant',
            text: result.summary,
            intent: 'MUSIC_ACTION',
            toolNames: ['control_music_playback']
          });
          return this.finishResult({
            id: reqId,
            input: rawInput,
            reply: result.summary,
            status: result.ok ? 'RESPONDING' : 'ERROR',
            classification,
            providerUsed: 'LOCAL',
            isExternalModel: false,
            toolRecords,
            musicState: musicService.getState(),
            memoryCandidate,
            snapshot: params.snapshot,
            error: result.ok ? undefined : result.error
          });
        }

        if (/\bstop\b/i.test(lower)) {
          const { result, record } = await toolRegistry.executeTool(
            'control_music_playback',
            { action: 'STOP' },
            { approvedByUser: true }
          );
          toolRecords.push(record);
          conversationManager.addTurn({
            role: 'assistant',
            text: result.summary,
            intent: 'MUSIC_ACTION',
            toolNames: ['control_music_playback']
          });
          return this.finishResult({
            id: reqId,
            input: rawInput,
            reply: result.summary,
            status: 'RESPONDING',
            classification,
            providerUsed: 'LOCAL',
            isExternalModel: false,
            toolRecords,
            musicState: musicService.getState(),
            memoryCandidate,
            snapshot: params.snapshot
          });
        }

        const volMatch = lower.match(/\bvolume\s*(?:to|up|down)?\s*(\d+)?/i);
        if (volMatch) {
          let nextVol = musicService.getState().volume;
          if (volMatch[1]) {
            nextVol = Math.max(0, Math.min(1, Number(volMatch[1]) / 100));
          } else if (lower.includes('up')) {
            nextVol = Math.min(1, nextVol + 0.15);
          } else if (lower.includes('down')) {
            nextVol = Math.max(0, nextVol - 0.15);
          }
          const { result, record } = await toolRegistry.executeTool(
            'control_music_playback',
            { action: 'SET_VOLUME', volume: nextVol },
            { approvedByUser: true }
          );
          toolRecords.push(record);
          conversationManager.addTurn({
            role: 'assistant',
            text: result.summary,
            intent: 'MUSIC_ACTION',
            toolNames: ['control_music_playback']
          });
          return this.finishResult({
            id: reqId,
            input: rawInput,
            reply: result.summary,
            status: 'RESPONDING',
            classification,
            providerUsed: 'LOCAL',
            isExternalModel: false,
            toolRecords,
            musicState: musicService.getState(),
            memoryCandidate,
            snapshot: params.snapshot
          });
        }

        // Open Spotify Desktop application explicitly when requested without playback query
        if (/^(?:hey\s+|hi\s+|please\s+)?(?:jarvis[,\s]+)?(?:open|launch|start)\s+spotify\.?$/i.test(lower)) {
          const musicEval = permissionPolicy.evaluateActionPolicy({ capability: 'MUSIC_ACCESS' });
          if (musicEval.outcome === 'BLOCKED') {
            return this.blockByPolicy({
              reqId,
              rawInput,
              intentCategory: 'MUSIC_ACTION',
              classification,
              permCategory: 'MUSIC_CONTROL',
              requestedAction: 'Launch approved music application: Spotify',
              target: 'SPOTIFY',
              reason: musicEval.reason,
              securityLevel: musicEval.level,
              capabilityId: 'MUSIC_ACCESS',
              memoryCandidate,
              snapshot: params.snapshot
            });
          }

          const spotifyExecutor: PermissionExecutor = async (permissionId) => {
            const res = await toolRegistry.executeTool(
              'launch_desktop_music',
              { musicTarget: 'SPOTIFY', permissionId },
              { approvedByUser: true }
            );
            const desktopRes = res.result.data?.desktopResult as DesktopExecutionResult | undefined;
            return {
              ok: res.result.ok,
              reply: desktopRes?.summary || res.result.summary,
              toolRecord: res.record,
              musicState: musicService.getState(),
              error: res.result.error
            };
          };

          if (musicEval.outcome === 'ALLOW_PREAPPROVED') {
            return this.executePreapprovedAction({
              reqId,
              rawInput,
              intentCategory: 'MUSIC_ACTION',
              classification,
              permCategory: 'MUSIC_CONTROL',
              capabilityId: 'MUSIC_ACCESS',
              requestedAction: 'Launch approved music application: Spotify',
              target: 'SPOTIFY',
              reason: musicEval.reason,
              requestedScope: 'Level 1 preapproved launch of Spotify',
              executor: spotifyExecutor,
              signal: controller.signal,
              memoryCandidate,
              snapshot: params.snapshot
            });
          }

          const perm = permissionManager.createRequest({
            category: 'MUSIC_CONTROL',
            requestedAction: 'Launch approved music application: Spotify',
            target: 'SPOTIFY',
            reason: 'User requested opening the Spotify desktop music application.',
            riskLevel: 'MEDIUM',
            securityLevel: musicEval.level,
            capabilityId: 'MUSIC_ACCESS',
            requestedScope: 'Single-use launch of approved music player (SPOTIFY)'
          });
          this.pendingPermission = perm;
          this.pendingPermissionInputFingerprint = fingerprint;
          this.permissionExecutors.set(perm.id, spotifyExecutor);
          const reply = 'Plan: Launch Spotify music application. Note: playback controls inside external desktop apps depend on OS media session support. Do you approve opening Spotify?';
          conversationManager.addTurn({ role: 'assistant', text: reply, intent: 'MUSIC_ACTION' });
          this.setStatus(
            'AWAITING_APPROVAL',
            'Waiting for approval to launch Spotify',
            'Waiting for your permission.'
          );
          return this.finishResult({
            id: reqId,
            input: rawInput,
            reply,
            status: 'AWAITING_APPROVAL',
            classification,
            providerUsed: 'LOCAL',
            isExternalModel: false,
            toolRecords,
            pendingPermission: perm,
            musicState: musicService.getState(),
            memoryCandidate,
            snapshot: params.snapshot,
            preserveStatus: true
          });
        }

        // Play user-selected music ("play my selected music" / "play selected track")
        if (/\b(?:my\s+)?selected\s+(?:music|song|track|audio)\b/i.test(lower)) {
          const musicEval = permissionPolicy.evaluateActionPolicy({ capability: 'MUSIC_ACCESS' });
          if (musicEval.outcome === 'BLOCKED') {
            return this.blockByPolicy({
              reqId,
              rawInput,
              intentCategory: 'MUSIC_ACTION',
              classification,
              permCategory: 'MUSIC_PLAYBACK',
              requestedAction: 'Play selected local music',
              target: this.pendingFileMetadata?.name || 'LOCAL_AUDIO',
              reason: musicEval.reason,
              securityLevel: musicEval.level,
              capabilityId: 'MUSIC_ACCESS',
              memoryCandidate,
              snapshot: params.snapshot
            });
          }

          if (this.pendingFileMetadata?.kind === 'AUDIO' && this.pendingFileMetadata.supported) {
            const selectedAudio = this.pendingFileMetadata;
            const localMusicExecutor: PermissionExecutor = async (permissionId) => {
              const res = await toolRegistry.executeTool(
                'control_music_playback',
                { action: 'PLAY_LOCAL', fileId: selectedAudio.fileId, permissionId },
                { approvedByUser: true }
              );
              const musicState = (res.result.data?.musicState as MusicPlaybackState | undefined) || musicService.getState();
              return {
                ok: res.result.ok,
                reply: res.result.summary,
                toolRecord: res.record,
                musicState,
                error: res.result.error
              };
            };

            if (musicEval.outcome === 'ALLOW_PREAPPROVED') {
              return this.executePreapprovedAction({
                reqId,
                rawInput,
                intentCategory: 'MUSIC_ACTION',
                classification,
                permCategory: 'MUSIC_PLAYBACK',
                capabilityId: 'MUSIC_ACCESS',
                requestedAction: 'Play selected local music',
                target: selectedAudio.name,
                reason: musicEval.reason,
                requestedScope: `Level 1 preapproved local audio playback "${selectedAudio.name}"`,
                executor: localMusicExecutor,
                signal: controller.signal,
                memoryCandidate,
                snapshot: params.snapshot
              });
            }

            const perm = musicService.requestMusicPermission({
              sourceType: 'LOCAL_AUDIO',
              targetLabel: selectedAudio.name,
              reason: `Play user-selected audio file "${selectedAudio.name}" (${selectedAudio.sizeFormatted})`,
              metadata: { fileId: selectedAudio.fileId }
            });
            perm.securityLevel = musicEval.level;
            perm.capabilityId = 'MUSIC_ACCESS';
            this.pendingPermission = perm;
            this.pendingPermissionInputFingerprint = fingerprint;
            this.permissionExecutors.set(perm.id, localMusicExecutor);

            const reply = `I found your selected audio file "${selectedAudio.name}" (${selectedAudio.sizeFormatted}). Do you approve starting playback?`;
            conversationManager.addTurn({ role: 'assistant', text: reply, intent: 'MUSIC_ACTION' });
            this.setStatus(
              'AWAITING_APPROVAL',
              `Waiting for approval to play ${selectedAudio.name}`,
              'Waiting for your permission.'
            );
            return this.finishResult({
              id: reqId,
              input: rawInput,
              reply,
              status: 'AWAITING_APPROVAL',
              classification,
              providerUsed: 'LOCAL',
              isExternalModel: false,
              toolRecords,
              pendingPermission: perm,
              musicState: musicService.getState(),
              memoryCandidate,
              snapshot: params.snapshot,
              preserveStatus: true
            });
          }

          const prompt: PendingInteractivePrompt = {
            kind: 'FILE_PICKER',
            requestedAction: 'Select an audio file (.mp3, .wav, .ogg, .m4a, .flac)',
            message: 'No audio track is currently selected. Select an audio file from your device to review playback permission.'
          };
          this.interactivePrompt = prompt;
          conversationManager.addTurn({ role: 'assistant', text: prompt.message, intent: 'MUSIC_ACTION' });
          return this.finishResult({
            id: reqId,
            input: rawInput,
            reply: prompt.message,
            status: 'RESPONDING',
            classification,
            providerUsed: 'LOCAL',
            isExternalModel: false,
            toolRecords,
            interactivePrompt: prompt,
            musicState: musicService.getState(),
            memoryCandidate,
            snapshot: params.snapshot
          });
        }

        // Block general music discovery/launch if MUSIC_ACCESS is explicitly DENIED
        const generalMusicEval = permissionPolicy.evaluateActionPolicy({ capability: 'MUSIC_ACCESS' });
        if (generalMusicEval.outcome === 'BLOCKED') {
          return this.blockByPolicy({
            reqId,
            rawInput,
            intentCategory: 'MUSIC_ACTION',
            classification,
            permCategory: 'MUSIC_PLAYBACK',
            requestedAction: 'Music access request',
            target: 'MUSIC_ACCESS',
            reason: generalMusicEval.reason,
            securityLevel: generalMusicEval.level,
            capabilityId: 'MUSIC_ACCESS',
            memoryCandidate,
            snapshot: params.snapshot
          });
        }

        // Play / Find music request
        let detectedSource: MusicSourceType | null = null;
        if (/\bspotify\b/i.test(lower)) detectedSource = 'SPOTIFY';
        else if (/\byoutube\s+music\b/i.test(lower)) detectedSource = 'YOUTUBE_MUSIC';
        else if (/\bsoundcloud\b/i.test(lower)) detectedSource = 'SOUNDCLOUD';
        else if (/\byoutube\b/i.test(lower)) detectedSource = 'YOUTUBE';
        else if (/\b(local\s+audio|local\s+file|audio\s+file|from\s+my\s+computer|from\s+device)\b/i.test(lower)) {
          detectedSource = 'LOCAL_AUDIO';
        }

        const trackQuery = rawInput
          .replace(/^(?:hey\s+|hi\s+|please\s+)?(?:jarvis[,\s]+)?/i, '')
          .replace(/^(?:play|find|listen\s+to)\s+/i, '')
          .replace(/\s+(?:on|from|using)\s+(?:spotify|youtube\s+music|soundcloud|youtube|local\s+audio|local\s+file)\.?$/i, '')
          .replace(/^(?:some\s+)?music$/i, '')
          .replace(/[.?!]+$/, '')
          .trim();

        if (!detectedSource) {
          const prompt: PendingInteractivePrompt = {
            kind: 'MUSIC_SOURCE',
            message: 'Which music source would you like me to use?',
            query: trackQuery,
            musicChoices: MUSIC_SOURCE_CHOICES
          };
          this.interactivePrompt = prompt;
          const reply = 'Which music source would you like me to use? Select Local Audio File, Spotify Web, YouTube Music, or SoundCloud in the Brain panel.';
          conversationManager.addTurn({ role: 'assistant', text: reply, intent: 'MUSIC_ACTION' });
          return this.finishResult({
            id: reqId,
            input: rawInput,
            reply,
            status: 'RESPONDING',
            classification,
            providerUsed: 'LOCAL',
            isExternalModel: false,
            toolRecords,
            interactivePrompt: prompt,
            musicState: musicService.getState(),
            memoryCandidate,
            snapshot: params.snapshot
          });
        }

        const choiceRes = this.selectMusicSourceChoice(detectedSource, trackQuery);
        if (choiceRes.permissionRequest && generalMusicEval.outcome === 'ALLOW_PREAPPROVED') {
          const preApprovedPermId = choiceRes.permissionRequest.id;
          const resExec = await this.resolvePendingPermission('APPROVE_ONCE', preApprovedPermId);
          return (
            resExec ||
            this.finishResult({
              id: reqId,
              input: rawInput,
              reply: choiceRes.reply,
              status: 'RESPONDING',
              classification,
              providerUsed: 'LOCAL',
              isExternalModel: false,
              toolRecords,
              musicState: musicService.getState(),
              memoryCandidate,
              snapshot: params.snapshot
            })
          );
        }

        conversationManager.addTurn({ role: 'assistant', text: choiceRes.reply, intent: 'MUSIC_ACTION' });
        if (choiceRes.permissionRequest) {
          choiceRes.permissionRequest.securityLevel = generalMusicEval.level;
          choiceRes.permissionRequest.capabilityId = 'MUSIC_ACCESS';
          return this.finishResult({
            id: reqId,
            input: rawInput,
            reply: choiceRes.reply,
            status: 'AWAITING_APPROVAL',
            classification,
            providerUsed: 'LOCAL',
            isExternalModel: false,
            toolRecords,
            pendingPermission: choiceRes.permissionRequest,
            musicState: musicService.getState(),
            memoryCandidate,
            snapshot: params.snapshot,
            preserveStatus: true
          });
        }

        return this.finishResult({
          id: reqId,
          input: rawInput,
          reply: choiceRes.reply,
          status: 'RESPONDING',
          classification,
          providerUsed: 'LOCAL',
          isExternalModel: false,
          toolRecords,
          interactivePrompt: choiceRes.interactivePrompt,
          musicState: musicService.getState(),
          memoryCandidate,
          snapshot: params.snapshot
        });
      }

      // 6. Multi-Step Plan
      if (classification.category === 'MULTI_STEP_PLAN') {
        if (/\b(run\s+workflow|execute\s+workflow|start\s+workflow)\b/i.test(rawInput)) {
          const selectedFolder = desktopBridge.getSelectedFolder()?.name || permissionPolicy.getApprovedFolders()[0]?.name || 'current_project';
          const wf = desktopWorkflowService.createProjectFileSummaryWorkflow(selectedFolder, 'notes.txt', 'audit_summary.txt');
          void desktopWorkflowService.runWorkflow(wf);
          const reply = `Starting multi-step desktop workflow: "${wf.title}" (${wf.steps.length} steps) targeting "${selectedFolder}". Track live step progress in the Workflows panel.`;
          conversationManager.addTurn({
            role: 'assistant',
            text: reply,
            intent: 'MULTI_STEP_PLAN'
          });
          return this.finishResult({
            id: reqId,
            input: rawInput,
            reply,
            status: 'RESPONDING',
            classification,
            providerUsed: 'LOCAL',
            isExternalModel: false,
            toolRecords,
            memoryCandidate,
            snapshot: params.snapshot
          });
        }

        this.setStatus('PLANNING', `Constructing structured execution plan for "${rawInput.slice(0, 40)}"`);
        const plan = planningEngine.createPlanFromRequest(rawInput, params.snapshot);
        if (plan.requiresApproval) {
          const reply =
            `Plan prepared for "${plan.objective}" (${plan.steps.length} steps). ` +
            `Recommended approach: ${plan.approaches[0]?.label || 'Structured Plan'}. ` +
            `Explicit approval is required in the Plan panel before executing workspace-modifying steps.`;
          conversationManager.addTurn({
            role: 'assistant',
            text: reply,
            intent: 'MULTI_STEP_PLAN'
          });
          this.setStatus('AWAITING_APPROVAL', `Awaiting approval for plan: ${plan.objective}`, 'Waiting for your permission.');
          return this.finishResult({
            id: reqId,
            input: rawInput,
            reply,
            status: 'AWAITING_APPROVAL',
            classification,
            providerUsed: cfg.provider,
            isExternalModel: false,
            toolRecords,
            plan,
            memoryCandidate,
            snapshot: params.snapshot,
            preserveStatus: true
          });
        }

        const executedPlan = await planningEngine.executePlan(plan.id, {
          approved: true,
          signal: controller.signal
        });
        const reply = planningEngine.summarizePlanOutcome(executedPlan);
        conversationManager.addTurn({
          role: 'assistant',
          text: reply,
          intent: 'MULTI_STEP_PLAN'
        });
        return this.finishResult({
          id: reqId,
          input: rawInput,
          reply,
          status: 'RESPONDING',
          classification,
          providerUsed: 'LOCAL',
          isExternalModel: false,
          toolRecords,
          plan: executedPlan,
          memoryCandidate,
          snapshot: params.snapshot
        });
      }

      // 7. Execute grounded Read-Only or Controlled Tools based on intent
      let groundedToolSummary = '';

      if (classification.category === 'CALCULATION') {
        this.setStatus('EXECUTING', 'Evaluating mathematical expression safely.');
        const expr = this.extractMathExpression(rawInput)!;
        const { result, record } = await toolRegistry.executeTool('calculate_math', { expression: expr });
        toolRecords.push(record);
        this.setStatus('VERIFYING', 'Verifying arithmetic result.');
        const reply = result.ok
          ? `Calculation verified: ${result.summary}.`
          : `Unable to compute "${expr}": ${result.error}`;
        conversationManager.addTurn({
          role: 'assistant',
          text: reply,
          intent: 'CALCULATION',
          toolNames: ['calculate_math']
        });
        return this.finishResult({
          id: reqId,
          input: rawInput,
          reply,
          status: result.ok ? 'RESPONDING' : 'ERROR',
          classification,
          providerUsed: 'LOCAL',
          isExternalModel: false,
          toolRecords,
          memoryCandidate,
          snapshot: params.snapshot,
          error: result.ok ? undefined : result.error
        });
      }

      if (classification.category === 'DIAGNOSTICS') {
        this.setStatus('EXECUTING', 'Running network, hardware, and provider diagnostics.');
        const { result, record } = await toolRegistry.executeTool(
          'network_and_hardware_diagnostics',
          {},
          { snapshot: params.snapshot }
        );
        toolRecords.push(record);
        this.setStatus('VERIFYING', 'Verifying telemetry report.');
        conversationManager.addTurn({
          role: 'assistant',
          text: result.summary,
          intent: 'DIAGNOSTICS',
          toolNames: ['network_and_hardware_diagnostics']
        });
        return this.finishResult({
          id: reqId,
          input: rawInput,
          reply: result.summary,
          status: 'RESPONDING',
          classification,
          providerUsed: 'LOCAL',
          isExternalModel: false,
          toolRecords,
          memoryCandidate,
          snapshot: params.snapshot
        });
      }

      if (classification.category === 'DOCUMENTATION') {
        this.setStatus('EXECUTING', 'Searching built-in JARVIS documentation.');
        const { result, record } = await toolRegistry.executeTool('lookup_documentation', { topic: rawInput });
        toolRecords.push(record);
        groundedToolSummary = result.summary;
      }

      if (classification.category === 'OBJECT_INSPECTION') {
        this.setStatus('EXECUTING', 'Inspecting active workspace and 3D model geometry.');
        const lower = rawInput.toLowerCase();
        const preferImported =
          lower.includes('import') ||
          lower.includes('uploaded') ||
          params.snapshot.objectsSummary.some((o) => o.modelId === 'reconstructed_object');

        const toolName =
          lower.includes('workspace') && !lower.includes('model')
            ? 'inspect_workspace'
            : 'inspect_selected_model';
        const { result, record } = await toolRegistry.executeTool(
          toolName,
          toolName === 'inspect_workspace' ? { includeComponents: true } : { preferImported },
          { snapshot: params.snapshot }
        );
        toolRecords.push(record);
        groundedToolSummary = result.summary;
      }

      if (classification.category === 'MEMORY_MANAGEMENT') {
        const lower = rawInput.toLowerCase();
        if (lower.includes('clear memory') || lower.includes('forget everything')) {
          const level3Eval = permissionPolicy.evaluateActionPolicy({
            capability: 'FOLDER_ACCESS',
            operationType: 'CLEAR_MEMORY'
          });
          const pending: PendingToolApproval = {
            id: `apr-${Date.now().toString(36)}`,
            toolName: 'clear_persistent_memory',
            args: {},
            reason: level3Eval.reason,
            permissionLevel: 'CONSEQUENTIAL'
          };
          this.pendingApproval = pending;
          const reply = 'Explicit confirmation required before clearing all persistent memories.';
          conversationManager.addTurn({ role: 'assistant', text: reply, intent: 'MEMORY_MANAGEMENT' });
          this.setStatus(
            'AWAITING_APPROVAL',
            'Awaiting confirmation to clear persistent memory.',
            'Waiting for your permission.'
          );
          return this.finishResult({
            id: reqId,
            input: rawInput,
            reply,
            status: 'AWAITING_APPROVAL',
            classification,
            providerUsed: 'LOCAL',
            isExternalModel: false,
            toolRecords,
            pendingApproval: pending,
            memoryCandidate,
            snapshot: params.snapshot,
            preserveStatus: true
          });
        }

        const { record } = await toolRegistry.executeTool('retrieve_context_and_memory', {
          query: rawInput
        });
        toolRecords.push(record);
        const memories = memoryManager.getMemories();
        const reply =
          memories.length === 0
            ? 'No persistent memories are currently stored (you can add or approve memories in the Memory tab).'
            : `Stored user-approved memories (${memories.length}): ${memories
                .slice(0, 5)
                .map((m) => `[${m.category}] ${m.key}: ${m.value}`)
                .join('; ')}.`;
        conversationManager.addTurn({
          role: 'assistant',
          text: reply,
          intent: 'MEMORY_MANAGEMENT',
          toolNames: ['retrieve_context_and_memory']
        });
        return this.finishResult({
          id: reqId,
          input: rawInput,
          reply,
          status: 'RESPONDING',
          classification,
          providerUsed: 'LOCAL',
          isExternalModel: false,
          toolRecords,
          memoryCandidate,
          snapshot: params.snapshot
        });
      }

      if (classification.category === 'WORKSPACE_ACTION') {
        const mapped = this.mapWorkspaceToolAction(rawInput);
        if (mapped) {
          const toolDef = toolRegistry.getTool(mapped.toolName);
          const opType =
            mapped.toolName === 'delete_selected_hologram'
              ? 'DELETE_OBJECT'
              : mapped.toolName === 'export_workspace_notes'
              ? 'FILE_WRITE'
              : undefined;
          const level3Eval = opType
            ? permissionPolicy.evaluateActionPolicy({ capability: 'FOLDER_ACCESS', operationType: opType })
            : null;
          if (toolDef?.requiresConfirmation || level3Eval?.level === 'LEVEL_3_ALWAYS_CONFIRM') {
            const pending: PendingToolApproval = {
              id: `apr-${Date.now().toString(36)}`,
              toolName: mapped.toolName,
              args: mapped.args,
              reason:
                level3Eval?.reason ||
                `Consequential tool "${mapped.toolName}" requires your explicit confirmation.`,
              permissionLevel: toolDef?.permissionLevel || 'CONSEQUENTIAL'
            };
            this.pendingApproval = pending;
            const reply = `Confirmation required before executing "${mapped.toolName}". Use the approval prompt in the Intelligence HUD.`;
            conversationManager.addTurn({ role: 'assistant', text: reply, intent: 'WORKSPACE_ACTION' });
            this.setStatus(
              'AWAITING_APPROVAL',
              `Awaiting user approval for ${mapped.toolName}`,
              'Waiting for your permission.'
            );
            return this.finishResult({
              id: reqId,
              input: rawInput,
              reply,
              status: 'AWAITING_APPROVAL',
              classification,
              providerUsed: 'LOCAL',
              isExternalModel: false,
              toolRecords,
              pendingApproval: pending,
              memoryCandidate,
              snapshot: params.snapshot,
              preserveStatus: true
            });
          }

          this.setStatus('EXECUTING', `Executing tool ${mapped.toolName}...`);
          const { result, record } = await toolRegistry.executeTool(mapped.toolName, mapped.args, {
            approvedByUser: true
          });
          toolRecords.push(record);
          this.setStatus('VERIFYING', `Verifying ${mapped.toolName} result...`);
          const reply = result.ok
            ? `${result.summary} (Verified)`
            : `Action could not be completed: ${result.summary}`;
          conversationManager.addTurn({
            role: 'assistant',
            text: reply,
            intent: 'WORKSPACE_ACTION',
            toolNames: [mapped.toolName]
          });
          return this.finishResult({
            id: reqId,
            input: rawInput,
            reply,
            status: result.ok ? 'RESPONDING' : 'ERROR',
            classification,
            providerUsed: 'LOCAL',
            isExternalModel: false,
            toolRecords,
            memoryCandidate,
            snapshot: params.snapshot,
            error: result.ok ? undefined : result.error
          });
        }
      }

      // 7a. Batch 5 — AI Development Studio natural-language workflow when an approved project folder is active
      if (classification.category === 'CODING_ASSISTANCE') {
        const lowerDev = rawInput.toLowerCase();
        const activeDevProject =
          devStudioService.getActiveProjectPath() ||
          desktopBridge.getSelectedFolder()?.path ||
          permissionPolicy.getApprovedFolders()[0]?.path ||
          '';

        const isDevStudioAction =
          /\b(inspect\s+(?:this|the)\s+project|python\s+calculator|fastapi\s+backend|login\s+page|react\s+component|run\s+(?:the\s+)?(?:project\s+)?tests|generate\s+(?:a\s+)?readme|architecture\s+doc)\b/i.test(
            lowerDev
          );

        if (isDevStudioAction && !activeDevProject) {
          const prompt: PendingInteractivePrompt = {
            kind: 'FOLDER_PICKER',
            requestedAction: 'Select an approved project folder for AI Development Studio',
            message: 'Select or approve a project folder first in Permissions or AI Dev Studio before inspecting or modifying project files.'
          };
          this.interactivePrompt = prompt;
          conversationManager.addTurn({ role: 'assistant', text: prompt.message, intent: 'CODING_ASSISTANCE' });
          return this.finishResult({
            id: reqId,
            input: rawInput,
            reply: prompt.message,
            status: 'RESPONDING',
            classification,
            providerUsed: 'LOCAL',
            isExternalModel: false,
            toolRecords,
            interactivePrompt: prompt,
            memoryCandidate,
            snapshot: params.snapshot
          });
        }

        if (isDevStudioAction && activeDevProject) {
          if (/\binspect\s+(?:this|the)\s+project\b/i.test(lowerDev)) {
            const { result, record } = await toolRegistry.executeTool('inspect_dev_project', {
              projectPath: activeDevProject
            });
            toolRecords.push(record);
            conversationManager.addTurn({ role: 'assistant', text: result.summary, intent: 'CODING_ASSISTANCE' });
            return this.finishResult({
              id: reqId,
              input: rawInput,
              reply: result.summary,
              status: result.ok ? 'RESPONDING' : 'ERROR',
              classification,
              providerUsed: 'LOCAL',
              isExternalModel: false,
              toolRecords,
              memoryCandidate,
              snapshot: params.snapshot,
              error: result.error
            });
          }

          if (/\brun\s+(?:the\s+)?(?:project\s+)?tests\b/i.test(lowerDev)) {
            const perm = devStudioService.requestDevCommandPermission(activeDevProject, 'npm', ['test']);
            this.pendingPermission = perm;
            this.pendingPermissionInputFingerprint = fingerprint;
            this.permissionExecutors.set(perm.id, async (permissionId) => {
              const res = await toolRegistry.executeTool(
                'run_dev_command',
                { projectPath: activeDevProject, tool: 'npm', args: ['test'], permissionId },
                { approvedByUser: true }
              );
              return {
                ok: res.result.ok,
                reply: res.result.summary,
                toolRecord: res.record,
                error: res.result.error
              };
            });
            const reply = `Prepared allowlisted test command "npm test" in "${activeDevProject}". Do you approve running it?`;
            conversationManager.addTurn({ role: 'assistant', text: reply, intent: 'CODING_ASSISTANCE' });
            this.setStatus('AWAITING_APPROVAL', 'Waiting for approval to run npm test', 'Waiting for your permission.');
            return this.finishResult({
              id: reqId,
              input: rawInput,
              reply,
              status: 'AWAITING_APPROVAL',
              classification,
              providerUsed: 'LOCAL',
              isExternalModel: false,
              toolRecords,
              pendingPermission: perm,
              memoryCandidate,
              snapshot: params.snapshot,
              preserveStatus: true
            });
          }

          if (/\b(generate\s+(?:a\s+)?readme|architecture\s+doc)\b/i.test(lowerDev)) {
            const docType = lowerDev.includes('architecture') ? 'ARCHITECTURE' : 'README';
            const docRes = await devStudioService.generateGroundedDocumentation(activeDevProject, docType);
            if (!docRes.ok || !docRes.patch) {
              const errMsg = docRes.error || 'Failed to generate documentation preview.';
              conversationManager.addTurn({ role: 'assistant', text: errMsg, intent: 'CODING_ASSISTANCE' });
              return this.finishResult({
                id: reqId,
                input: rawInput,
                reply: errMsg,
                status: 'ERROR',
                classification,
                providerUsed: 'LOCAL',
                isExternalModel: false,
                toolRecords,
                memoryCandidate,
                snapshot: params.snapshot,
                error: errMsg
              });
            }

            const perm = devStudioService.requestPatchPermission(docRes.patch.id);
            if (perm) {
              this.pendingPermission = perm;
              this.pendingPermissionInputFingerprint = fingerprint;
              const patchId = docRes.patch.id;
              this.permissionExecutors.set(perm.id, async (permissionId) => {
                const res = await toolRegistry.executeTool(
                  'apply_dev_code_patch',
                  { patchId, permissionId, overwriteConfirmed: false },
                  { approvedByUser: true }
                );
                return {
                  ok: res.result.ok,
                  reply: res.result.summary,
                  toolRecord: res.record,
                  error: res.result.error
                };
              });
            }

            const reply = `Generated grounded ${docType} preview for "${docRes.patch.relativePath}" (+${docRes.patch.preview.addedLines} lines). Review in AI Dev Studio or approve to write it.`;
            conversationManager.addTurn({ role: 'assistant', text: reply, intent: 'CODING_ASSISTANCE' });
            this.setStatus('AWAITING_APPROVAL', `Awaiting approval to save ${docRes.patch.relativePath}`, 'Waiting for your permission.');
            return this.finishResult({
              id: reqId,
              input: rawInput,
              reply,
              status: 'AWAITING_APPROVAL',
              classification,
              providerUsed: 'LOCAL',
              isExternalModel: false,
              toolRecords,
              pendingPermission: perm || undefined,
              memoryCandidate,
              snapshot: params.snapshot,
              preserveStatus: true
            });
          }

          if (/\b(python\s+calculator|fastapi\s+backend|login\s+page|react\s+component)\b/i.test(lowerDev)) {
            const { result, record } = await toolRegistry.executeTool('propose_dev_code_patch', {
              projectPath: activeDevProject,
              prompt: rawInput
            });
            toolRecords.push(record);
            const patch = result.data?.patch as { id: string; relativePath: string } | undefined;
            const perm = patch ? devStudioService.requestPatchPermission(patch.id) : null;
            if (perm && patch) {
              this.pendingPermission = perm;
              this.pendingPermissionInputFingerprint = fingerprint;
              this.permissionExecutors.set(perm.id, async (permissionId) => {
                const res = await toolRegistry.executeTool(
                  'apply_dev_code_patch',
                  { patchId: patch.id, permissionId, overwriteConfirmed: false },
                  { approvedByUser: true }
                );
                return {
                  ok: res.result.ok,
                  reply: res.result.summary,
                  toolRecord: res.record,
                  error: res.result.error
                };
              });
              this.setStatus('AWAITING_APPROVAL', `Waiting for approval to write ${patch.relativePath}`, 'Waiting for your permission.');
              conversationManager.addTurn({ role: 'assistant', text: result.summary, intent: 'CODING_ASSISTANCE' });
              return this.finishResult({
                id: reqId,
                input: rawInput,
                reply: result.summary,
                status: 'AWAITING_APPROVAL',
                classification,
                providerUsed: 'LOCAL',
                isExternalModel: false,
                toolRecords,
                pendingPermission: perm,
                memoryCandidate,
                snapshot: params.snapshot,
                preserveStatus: true
              });
            }
          }
        }
      }

      // 7b. Controlled Agent Execution Roles (RESEARCH / CODING / ANALYSIS)
      if (
        classification.category === 'RESEARCH_REQUEST' ||
        classification.category === 'CODING_ASSISTANCE' ||
        classification.category === 'ANALYSIS_REQUEST'
      ) {
        const onAgentChunk = (_delta: string, acc: string) => {
          this.streamingText = acc;
          this.emit();
        };

        const agentRes =
          classification.category === 'RESEARCH_REQUEST'
            ? await agentOrchestrator.runResearchAgent({
                query: rawInput,
                snapshot: params.snapshot,
                attachments,
                signal: controller.signal,
                onChunk: onAgentChunk
              })
            : classification.category === 'CODING_ASSISTANCE'
            ? await agentOrchestrator.runCodingAgent({
                prompt: rawInput,
                snapshot: params.snapshot,
                attachments,
                signal: controller.signal,
                onChunk: onAgentChunk
              })
            : await agentOrchestrator.runAnalysisAgent({
                prompt: rawInput,
                snapshot: params.snapshot,
                attachments,
                signal: controller.signal,
                onChunk: onAgentChunk
              });

        this.streamingText = '';

        if (agentRes.aborted || controller.signal.aborted) {
          return this.finishResult({
            id: reqId,
            input: rawInput,
            reply: agentRes.reply || 'Request cancelled.',
            status: 'STANDBY',
            classification,
            providerUsed: agentRes.providerUsed,
            isExternalModel: false,
            toolRecords,
            agentRun: agentRes.run,
            attachments: attachmentRefs.length > 0 ? attachmentRefs : undefined,
            memoryCandidate,
            snapshot: params.snapshot,
            cancelled: true
          });
        }

        conversationManager.addTurn({
          role: 'assistant',
          text: agentRes.reply,
          intent: classification.category
        });

        return this.finishResult({
          id: reqId,
          input: rawInput,
          reply: agentRes.reply,
          status: agentRes.ok ? 'RESPONDING' : 'ERROR',
          classification,
          providerUsed: agentRes.providerUsed,
          isExternalModel: agentRes.isExternalModel,
          toolRecords,
          agentRun: agentRes.run,
          attachments: attachmentRefs.length > 0 ? attachmentRefs : undefined,
          streamed: agentRes.streamed,
          fallbackUsed: agentRes.fallbackUsed,
          memoryCandidate,
          snapshot: params.snapshot,
          error: agentRes.error
        });
      }

      // 8. External AI Provider Reasoning (with SSE Streaming & Multimodal Attachments)
      const isServerBacked =
        cfg.provider === 'BACKEND' ||
        ((cfg.provider === 'GEMINI' || cfg.provider === 'GROQ') && !contextualAI.hasApiKey());
      const shouldQueryExternal =
        cfg.provider !== 'LOCAL' && (contextualAI.hasApiKey() || isServerBacked);

      if (shouldQueryExternal) {
        const providerLabel = isServerBacked
          ? `Backend (${cfg.backendMode || 'AUTO'})`
          : `${cfg.provider} (${cfg.modelName})`;
        this.setStatus('ANALYZING', `Streaming ${providerLabel} with session context...`);
        const systemPrompt = this.buildSystemPrompt(params.snapshot, rawInput, groundedToolSummary);
        const messages = conversationManager.buildModelMessages(systemPrompt, 12);

        const extRes = await contextualAI.queryStreamingCompletion({
          messages,
          attachments,
          signal: controller.signal,
          timeoutMs: 25000,
          onChunk: (_delta, acc) => {
            this.streamingText = acc;
            this.emit();
          }
        });

        this.streamingText = '';

        if (extRes.aborted || controller.signal.aborted) {
          return this.finishResult({
            id: reqId,
            input: rawInput,
            reply: 'Request cancelled.',
            status: 'STANDBY',
            classification,
            providerUsed: cfg.provider,
            isExternalModel: false,
            toolRecords,
            attachments: attachmentRefs.length > 0 ? attachmentRefs : undefined,
            memoryCandidate,
            snapshot: params.snapshot,
            cancelled: true
          });
        }

        if (extRes.ok && extRes.text) {
          this.setStatus('VERIFYING', 'Validating external model response against verified context.');
          conversationManager.addTurn({
            role: 'assistant',
            text: extRes.text,
            intent: classification.category,
            toolNames: toolRecords.map((r) => r.toolName)
          });
          return this.finishResult({
            id: reqId,
            input: rawInput,
            reply: extRes.text,
            status: 'RESPONDING',
            classification,
            providerUsed: extRes.provider || cfg.provider,
            isExternalModel: true,
            toolRecords,
            attachments: attachmentRefs.length > 0 ? attachmentRefs : undefined,
            streamed: extRes.streamed,
            fallbackUsed: Boolean(extRes.fallbackTriggered),
            memoryCandidate,
            snapshot: params.snapshot
          });
        }

        const failureMsg = extRes.error || `${cfg.provider} request failed.`;
        this.lastError = failureMsg;
        const honestFallback = groundedToolSummary
          ? `${failureMsg} Grounded local inspection report: ${groundedToolSummary}`
          : `${failureMsg} (No simulated external answer was fabricated. Switch to LOCAL mode or verify your session key/network.)`;

        conversationManager.addTurn({
          role: 'assistant',
          text: honestFallback,
          intent: classification.category,
          toolNames: toolRecords.map((r) => r.toolName)
        });
        this.setStatus('ERROR', failureMsg, 'Unable to complete the requested action.');
        return this.finishResult({
          id: reqId,
          input: rawInput,
          reply: honestFallback,
          status: 'ERROR',
          classification,
          providerUsed: cfg.provider,
          isExternalModel: false,
          toolRecords,
          attachments: attachmentRefs.length > 0 ? attachmentRefs : undefined,
          memoryCandidate,
          snapshot: params.snapshot,
          error: failureMsg,
          preserveStatus: true
        });
      }

      // 9. LOCAL Mode Grounded Response
      this.setStatus('VERIFYING', 'Synthesizing grounded LOCAL intelligence response.');
      const localReply = this.buildGroundedLocalReply({
        rawInput,
        followUp,
        classification,
        snapshot: params.snapshot,
        groundedToolSummary
      });

      conversationManager.addTurn({
        role: 'assistant',
        text: localReply,
        intent: classification.category,
        toolNames: toolRecords.map((r) => r.toolName)
      });

      return this.finishResult({
        id: reqId,
        input: rawInput,
        reply: localReply,
        status: 'RESPONDING',
        classification,
        providerUsed: 'LOCAL',
        isExternalModel: false,
        toolRecords,
        attachments: attachmentRefs.length > 0 ? attachmentRefs : undefined,
        memoryCandidate,
        snapshot: params.snapshot
      });
    } finally {
      this.streamingText = '';
      if (this.activeRequestId === reqId) {
        this.activeAbortController = null;
        this.activeRequestId = null;
        this.activeRequestFingerprint = null;
      }
    }
  }

  public async resolvePendingToolApproval(approved: boolean): Promise<IntelligenceRequestResult | null> {
    const pending = this.pendingApproval;
    if (!pending) return null;
    this.pendingApproval = null;

    if (!approved) {
      const reply = `Cancelled consequential action "${pending.toolName}" per user decision.`;
      conversationManager.addTurn({ role: 'assistant', text: reply, intent: 'WORKSPACE_ACTION' });
      this.setStatus('STANDBY', reply, 'Action cancelled.');
      return this.lastResult;
    }

    this.setStatus('EXECUTING', `Executing approved tool "${pending.toolName}"...`, 'Permission approved.');
    const { result, record } = await toolRegistry.executeTool(pending.toolName, pending.args, {
      approvedByUser: true
    });
    this.setStatus('VERIFYING', `Verified outcome for ${pending.toolName}.`);
    const reply = result.ok ? result.summary : `Tool "${pending.toolName}" did not complete: ${result.summary}`;
    conversationManager.addTurn({
      role: 'assistant',
      text: reply,
      intent: 'WORKSPACE_ACTION',
      toolNames: [pending.toolName]
    });

    const updated: IntelligenceRequestResult = {
      id: `apr-res-${Date.now().toString(36)}`,
      input: pending.toolName,
      reply,
      status: result.ok ? 'RESPONDING' : 'ERROR',
      classification: {
        category: 'WORKSPACE_ACTION',
        confidence: 1,
        summary: `Resolved approval for ${pending.toolName}`,
        requiresTool: true,
        requiresPlan: false,
        missingInformation: [],
        resolvedReferences: []
      },
      providerUsed: contextualAI.getConfig().provider,
      isExternalModel: false,
      toolRecords: [record],
      activitySummary: reply,
      error: result.ok ? undefined : result.error
    };
    this.lastResult = updated;
    this.setStatus(result.ok ? 'STANDBY' : 'ERROR', reply, result.ok ? 'Completed.' : 'Unable to complete the requested action.');
    return updated;
  }

  public async approveAndExecutePlan(planId: string): Promise<ExecutionPlan> {
    this.setStatus('EXECUTING', `Executing approved multi-step plan (${planId})...`, 'Permission approved.');
    const controller = new AbortController();
    this.activeAbortController = controller;
    try {
      const plan = await planningEngine.executePlan(planId, {
        approved: true,
        signal: controller.signal
      });
      this.setStatus('VERIFYING', 'Verifying executed plan step outcomes...');
      const summary = planningEngine.summarizePlanOutcome(plan);
      conversationManager.addTurn({ role: 'assistant', text: summary, intent: 'MULTI_STEP_PLAN' });
      this.setStatus(plan.status === 'FAILED' ? 'ERROR' : 'STANDBY', summary);
      return plan;
    } finally {
      this.activeAbortController = null;
      this.emit();
    }
  }

  public refreshSuggestions(snapshot: WorkspaceContextSnapshot) {
    const active = suggestionEngine.evaluateContext({
      snapshot,
      recentTurns: conversationManager.getRecentTurns(6),
      status: this.status,
      latestPlan: planningEngine.getLatestPlan(),
      sessionTurnCount: conversationManager.getTurns().length
    });
    if (active.length > 0 && this.status === 'STANDBY') {
      this.emit();
    }
  }

  private mapWorkspaceToolAction(
    rawInput: string
  ): { toolName: string; args: Record<string, unknown> } | null {
    const lower = rawInput.toLowerCase();
    if (/\b(delete|remove object|de-materialize)\b/i.test(lower)) {
      return { toolName: 'delete_selected_hologram', args: {} };
    }
    if (/\b(export note|save notes)\b/i.test(lower)) {
      return { toolName: 'export_workspace_notes', args: {} };
    }
    if (/\b(duplicate|clone)\b/i.test(lower)) {
      return { toolName: 'control_hologram_transform', args: { action: 'duplicate_selected' } };
    }
    if (/\bwireframe\b/i.test(lower)) {
      return { toolName: 'control_hologram_transform', args: { action: 'set_render_mode', renderMode: 'WIREFRAME' } };
    }
    if (/\bpoint cloud\b/i.test(lower)) {
      return { toolName: 'control_hologram_transform', args: { action: 'set_render_mode', renderMode: 'POINT_CLOUD' } };
    }
    if (/\bsolid\b/i.test(lower)) {
      return { toolName: 'control_hologram_transform', args: { action: 'set_render_mode', renderMode: 'SOLID_HOLO' } };
    }
    if (/\bhybrid\b/i.test(lower)) {
      return { toolName: 'control_hologram_transform', args: { action: 'set_render_mode', renderMode: 'HYBRID' } };
    }
    return null;
  }

  private buildSystemPrompt(
    snapshot: WorkspaceContextSnapshot,
    userInput: string,
    groundedToolSummary: string
  ): string {
    const approvedMemory = memoryManager.formatMemoryContext(userInput);
    const sessionSummary = conversationManager.summarizeSession();

    return [
      'You are J.A.R.V.I.S., a technical spatial intelligence assistant inside an interactive 3D holographic laboratory.',
      'Be concise, direct, and grounded strictly in verified facts. Never claim to be conscious or sentient, and never claim a tool or action ran unless verified in the context below.',
      `Current Workspace Snapshot: Mode=${snapshot.mode}, Objects=${snapshot.objectCount}, Selected="${snapshot.selectedObjectName}" (${snapshot.selectedModelId}), RenderMode=${snapshot.renderMode}, Explosion=${Math.round(snapshot.explosionAmount * 100)}%, Dispersion=${Math.round(snapshot.dispersionAmount * 100)}%, Camera=${snapshot.isCameraActive ? 'ON' : 'OFF'}, Voice=${snapshot.isVoiceActive ? 'ON' : 'OFF'}.`,
      `Approved User Memories:\n${approvedMemory}`,
      sessionSummary ? `Current Session Summary: ${sessionSummary.summaryText}` : '',
      groundedToolSummary ? `Verified Tool Output (this turn): ${groundedToolSummary}` : ''
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private buildGroundedLocalReply(params: {
    rawInput: string;
    followUp: FollowUpResolution;
    classification: IntentClassification;
    snapshot: WorkspaceContextSnapshot;
    groundedToolSummary: string;
  }): string {
    const { rawInput, followUp, classification, snapshot, groundedToolSummary } = params;
    const cfg = contextualAI.getConfig();

    if (groundedToolSummary) {
      return groundedToolSummary;
    }

    if (followUp.isFollowUp && followUp.inferredSubject) {
      const memories = memoryManager.getRelevantMemories(followUp.inferredSubject, 2);
      const memSuffix =
        memories.length > 0 ? ` Relevant saved context: ${memories.map((m) => `${m.key}: ${m.value}`).join('; ')}.` : '';
      return `Understood — continuing within context "${followUp.inferredSubject}". Regarding ${rawInput.replace(/[.?]+$/, '')}, we can inspect related workspace modules, design a multi-step plan, or verify existing controls.${memSuffix}`;
    }

    if (/\b(i am building|we are building|working on|developing)\b/i.test(rawInput)) {
      const subj = followUp.inferredSubject || 'your system';
      return `Understood — tracking active focus on ${subj} for this session. Which subsystem or task would you like to inspect, plan, or verify next?`;
    }

    const localIntent = contextualAI.parseLocalIntent(rawInput, snapshot.selectedObjectName);
    if (localIntent.intent !== 'GENERAL_CHAT') {
      return localIntent.reply;
    }

    const providerNote =
      cfg.provider === 'LOCAL'
        ? 'Currently operating in offline LOCAL mode.'
        : `Provider ${cfg.provider} has no volatile session API key configured, so LOCAL grounding is active.`;

    return `Received regarding "${snapshot.selectedObjectName}" (${classification.summary}). ${providerNote} Try file access ("open my project report"), browser actions ("open GitHub"), web search ("search for Three.js documentation"), music ("play relaxing music"), workspace inspection, or math.`;
  }

  private finishResult(params: {
    id: string;
    input: string;
    reply: string;
    status: IntelligenceStatus;
    classification: IntentClassification;
    providerUsed: AIProviderConfig['provider'];
    isExternalModel: boolean;
    toolRecords: ToolActivityRecord[];
    plan?: ExecutionPlan;
    agentRun?: AgentRunSnapshot;
    attachments?: IntelligenceRequestResult['attachments'];
    streamed?: boolean;
    fallbackUsed?: boolean;
    pendingApproval?: PendingToolApproval;
    pendingPermission?: PermissionRequest;
    interactivePrompt?: PendingInteractivePrompt;
    openedFile?: FileInspectionResult;
    browserAction?: BrowserNavigationResult;
    searchResult?: WebSearchResponse;
    musicState?: MusicPlaybackState;
    memoryCandidate?: IntelligenceRequestResult['memoryCandidate'];
    snapshot: WorkspaceContextSnapshot;
    cancelled?: boolean;
    error?: string;
    preserveStatus?: boolean;
  }): IntelligenceRequestResult {
    const activeSuggestions = suggestionEngine.evaluateContext({
      snapshot: params.snapshot,
      recentTurns: conversationManager.getRecentTurns(6),
      status: params.status,
      latestPlan: planningEngine.getLatestPlan(),
      sessionTurnCount: conversationManager.getTurns().length
    });

    const summary = params.error
      ? params.error
      : params.toolRecords.length > 0
      ? `Verified ${params.toolRecords.map((r) => r.toolName).join(', ')}.`
      : params.classification.summary;

    const result: IntelligenceRequestResult = {
      id: params.id,
      input: params.input,
      reply: params.reply,
      status: params.status,
      classification: params.classification,
      providerUsed: params.providerUsed,
      isExternalModel: params.isExternalModel,
      toolRecords: params.toolRecords,
      plan: params.plan,
      agentRun: params.agentRun,
      attachments: params.attachments,
      streamed: params.streamed,
      fallbackUsed: params.fallbackUsed,
      pendingApproval: params.pendingApproval,
      pendingPermission: params.pendingPermission,
      interactivePrompt: params.interactivePrompt,
      openedFile: params.openedFile,
      browserAction: params.browserAction,
      searchResult: params.searchResult,
      musicState: params.musicState,
      memoryCandidate: params.memoryCandidate,
      activitySummary: summary,
      cancelled: params.cancelled,
      error: params.error
    };

    this.lastResult = result;
    if (!params.preserveStatus) {
      const nextStatus: IntelligenceStatus =
        activeSuggestions.length > 0 && params.status === 'RESPONDING' ? 'SUGGESTING' : 'STANDBY';
      this.setStatus(nextStatus, summary, params.error ? 'Unable to complete the requested action.' : undefined);
    } else {
      this.emit();
    }
    return result;
  }
}

export const intelligenceEngine = new IntelligenceEngine();
