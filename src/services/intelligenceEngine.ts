import {
  AIProviderConfig,
  AISuggestion,
  BrowserNavigationResult,
  ExecutionPlan,
  FileInspectionResult,
  IntelligenceRequestResult,
  IntelligenceStatus,
  IntentClassification,
  MusicPlaybackState,
  MusicSourceType,
  PendingInteractivePrompt,
  PendingToolApproval,
  PermissionRequest,
  SelectedFileMetadata,
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
import { fileAccessService } from './fileAccessService';
import { browserActionService } from './browserActionService';
import { webSearchService, extractSearchIntent } from './webSearchService';
import { musicService, MUSIC_SOURCE_CHOICES } from './musicService';

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
  private listeners: Set<(snapshot: IntelligenceStateSnapshot) => void> = new Set();

  constructor() {
    musicService.subscribe(() => {
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
      activeSuggestions: suggestionEngine.getActiveSuggestions()
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
    followUp: FollowUpResolution
  ): IntentClassification {
    const text = rawInput.trim();
    const lower = text.toLowerCase();
    const missingInformation: string[] = [];

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
      /\b(prepare my project|prepare.*demo|demonstration|multi[- ]step|workflow|create a plan|plan how|step[- ]by[- ]step|full audit)\b/i.test(
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

    // 3. Music Playback / Audio Controls
    if (
      /\b(play\s+(?:some\s+)?(?:music|song|songs|track|tracks|audio|relaxing|instrumental|ambient|jazz|lofi|classical|music\s+on)|pause\s+(?:the\s+)?music|resume\s+(?:the\s+)?music|stop\s+(?:the\s+)?music|volume\s+(?:up|down|to|\d+)|find\s+(?:a\s+)?(?:track|song|music)|listen\s+to\s+music)\b/i.test(
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
      /\b(search\s+(?:the\s+web|online|google|duckduckgo|wikipedia)?\s*(?:for|about)?|find\s+information\s+(?:about|on)|find\s+(?:info|details)\s+(?:about|on)|find\s+documentation\s+for|look\s+up|research\b|web\s+search)\b/i.test(
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

    // 5. File Access Intent
    if (
      /\b(open\s+(?:my\s+|a\s+|the\s+)?(?:file|project\s+report|report|document|pdf|image|photo|project\s+folder|folder)|select\s+(?:a\s+)?file|read\s+(?:the\s+)?(?:selected\s+)?(?:file|document|report)|summarize\s+(?:the\s+)?(?:selected\s+)?(?:report|file|document)|import\s+(?:a\s+|an\s+)?(?:3d\s+model|model\s+file|glb|gltf|obj|stl))\b/i.test(
        lower
      )
    ) {
      return {
        category: 'FILE_ACTION',
        confidence: 0.91,
        summary: 'User-selected file access or inspection request.',
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

    // 10. Workspace or Model inspection
    if (
      /\b(inspect|explain|describe|analyze|how many vertices|what model|imported model|components|current workspace|what is loaded)\b/i.test(
        lower
      )
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

  private looksLikeBrowserIntent(lower: string): boolean {
    if (/\b(open\s+a\s+new\s+tab|open\s+new\s+tab|open\s+website|open\s+site)\b/i.test(lower)) {
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
              : existing.category === 'WEB_SEARCH'
              ? 'WEB_SEARCH'
              : existing.category === 'MUSIC_PLAYBACK'
              ? 'MUSIC_ACTION'
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
          : existing.category === 'WEB_SEARCH'
          ? 'Search completed.'
          : existing.category === 'FILE_ACCESS'
          ? 'Opening the selected file.'
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

  public async processRequest(params: {
    input: string;
    snapshot: WorkspaceContextSnapshot;
    source?: 'VOICE' | 'CONSOLE';
  }): Promise<IntelligenceRequestResult> {
    const rawInput = params.input.trim();
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

    const fingerprint = rawInput.toLowerCase();
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

    const toolRecords: ToolActivityRecord[] = [];

    try {
      this.setStatus(
        'UNDERSTANDING',
        `Understanding request: "${rawInput.slice(0, 48)}"`,
        'Understanding your request.'
      );

      const followUp = conversationManager.resolveFollowUp(rawInput, params.snapshot);
      const classification = this.classifyIntent(rawInput, params.snapshot, followUp);

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

      // 2. Phase 5 — FILE_ACTION
      if (classification.category === 'FILE_ACTION') {
        const lower = rawInput.toLowerCase();

        // Handle "open my project folder" honestly without claiming filesystem access
        if (/\bfolder\b/i.test(lower)) {
          const prompt: PendingInteractivePrompt = {
            kind: 'FILE_PICKER',
            requestedAction: 'Select file(s) from your project folder',
            message:
              'Browser security prevents JARVIS from silently scanning local folders. Select the specific file(s) from your project folder using the file picker below.'
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

      // 3. Phase 5 — BROWSER_ACTION
      if (classification.category === 'BROWSER_ACTION') {
        const extractedTarget = this.extractBrowserTarget(rawInput);
        if (!extractedTarget) {
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

        const { preview, permissionRequest } = browserActionService.requestOpenWebsitePermission(
          extractedTarget,
          `User requested opening "${extractedTarget}" in a new browser tab`
        );

        if (!preview.valid || !preview.normalizedUrl || !permissionRequest) {
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

        this.pendingPermission = permissionRequest;
        this.pendingPermissionInputFingerprint = fingerprint;
        const targetUrl = preview.normalizedUrl;
        this.permissionExecutors.set(permissionRequest.id, async (permissionId) => {
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
        });

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

      // 4. Phase 5 — WEB_SEARCH
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

        const perm = webSearchService.requestSearchPermission(
          searchIntent.query,
          searchIntent.provider,
          `Execute web search for "${searchIntent.query}" via ${searchIntent.provider}`
        );
        this.pendingPermission = perm;
        this.pendingPermissionInputFingerprint = fingerprint;
        this.permissionExecutors.set(perm.id, async (permissionId, signal) => {
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
        });

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
        conversationManager.addTurn({ role: 'assistant', text: choiceRes.reply, intent: 'MUSIC_ACTION' });
        if (choiceRes.permissionRequest) {
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
          const pending: PendingToolApproval = {
            id: `apr-${Date.now().toString(36)}`,
            toolName: 'clear_persistent_memory',
            args: {},
            reason: 'Clearing all saved persistent user memories cannot be undone.',
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
          if (toolDef?.requiresConfirmation) {
            const pending: PendingToolApproval = {
              id: `apr-${Date.now().toString(36)}`,
              toolName: mapped.toolName,
              args: mapped.args,
              reason: `Consequential tool "${mapped.toolName}" requires your explicit confirmation.`,
              permissionLevel: toolDef.permissionLevel
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

      // 8. External AI Provider Reasoning
      const isServerBacked =
        cfg.provider === 'BACKEND' ||
        ((cfg.provider === 'GEMINI' || cfg.provider === 'GROQ') && !contextualAI.hasApiKey());
      const shouldQueryExternal =
        cfg.provider !== 'LOCAL' && (contextualAI.hasApiKey() || isServerBacked);

      if (shouldQueryExternal) {
        const providerLabel = isServerBacked
          ? `Backend (${cfg.backendMode || 'AUTO'})`
          : `${cfg.provider} (${cfg.modelName})`;
        this.setStatus('ANALYZING', `Querying ${providerLabel} with session context...`);
        const systemPrompt = this.buildSystemPrompt(params.snapshot, rawInput, groundedToolSummary);
        const messages = conversationManager.buildModelMessages(systemPrompt, 12);

        const extRes = await contextualAI.queryStructuredCompletion({
          messages,
          signal: controller.signal,
          timeoutMs: 18000
        });

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
        memoryCandidate,
        snapshot: params.snapshot
      });
    } finally {
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
      status: this.status
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
      status: params.status
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
