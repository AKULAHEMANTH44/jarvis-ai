export interface VoiceCommand {
  patterns: string[];
  description: string;
  category: 'NAVIGATION' | 'MANIPULATION' | 'CINEMATIC' | 'SYSTEM' | 'AI' | 'SPATIAL' | 'AUTOMATION';
  action: (args?: string) => boolean | Promise<boolean> | void;
  feedbackText: string;
  failureText?: string;
  requiresConfirmation?: boolean;
}

export interface AssistantMessage {
  id: string;
  sender: 'USER' | 'JARVIS';
  text: string;
  timestamp: string;
  type?: 'COMMAND' | 'RESPONSE' | 'ALERT' | 'INFO' | 'CONFIRMATION_REQUEST';
  actionPayload?: {
    actionType: string;
    targetId?: string;
    description: string;
  };
}

export interface SystemStatusTelemetry {
  cpuLoad: number;
  memoryUsage: number;
  powerOutputGigaWatts: number;
  coreTemperatureKelvin: number;
  containmentStability: number;
  fps: number;
  uptimeSeconds: number;
  batteryLevel?: number;
  networkLatencyMs?: number;
}

// Automation Task Engine types
export type AutomationStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'WAITING_CONFIRMATION'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface AutomationStep {
  id: string;
  description: string;
  status: 'PENDING' | 'EXECUTING' | 'DONE' | 'FAILED';
  action: () => Promise<void> | void;
}

export interface AutomationTask {
  id: string;
  title: string;
  intent: string;
  steps: AutomationStep[];
  currentStepIndex: number;
  status: AutomationStatus;
  requiredPermissions: string[];
  progressPercent: number;
  createdAt: number;
  result?: string;
  error?: string;
}

// Desktop Assistant Bridge types
export interface DesktopPermissionRequest {
  id: string;
  action: 'FILE_READ' | 'FILE_WRITE' | 'CODE_EXEC' | 'DELETE_OBJECT' | 'SYSTEM_COMMAND';
  target: string;
  reason: string;
  timestamp: number;
}

export type LLMMode = 'AUTO' | 'GEMINI_ONLY' | 'GROQ_ONLY';

export type ProviderStatusState = 'connected' | 'not_configured' | 'error' | 'rate_limited' | 'disabled';

export interface ProviderStatusDetail {
  configured: boolean;
  model: string;
  status: ProviderStatusState;
  message?: string;
  lastChecked: number;
}

export interface BackendLLMStatusResponse {
  ok: boolean;
  mode: LLMMode;
  primaryProvider: 'GEMINI';
  fallbackProvider: 'GROQ';
  gemini: ProviderStatusDetail;
  groq: ProviderStatusDetail;
  activeProvider: 'GEMINI' | 'GROQ' | 'NONE';
  serverTime: number;
}

export interface AIProviderConfig {
  provider: 'LOCAL' | 'BACKEND' | 'OPENAI' | 'ANTHROPIC' | 'GEMINI' | 'GROQ';
  apiKey?: string;
  modelName: string;
  customEndpoint?: string;
  temperature: number;
  backendMode?: LLMMode;
}

// ============================================================================
// Phase 4 — JARVIS AI Intelligence Brain Types
// ============================================================================

export type IntelligenceStatus =
  | 'STANDBY'
  | 'LISTENING'
  | 'UNDERSTANDING'
  | 'ANALYZING'
  | 'PLANNING'
  | 'AWAITING_APPROVAL'
  | 'EXECUTING'
  | 'VERIFYING'
  | 'RESPONDING'
  | 'SUGGESTING'
  | 'ERROR';

export type IntentCategory =
  | 'WORKSPACE_ACTION'
  | 'OBJECT_INSPECTION'
  | 'MULTI_STEP_PLAN'
  | 'CONVERSATIONAL_QA'
  | 'CALCULATION'
  | 'DIAGNOSTICS'
  | 'DOCUMENTATION'
  | 'MEMORY_MANAGEMENT'
  | 'FILE_ACTION'
  | 'FOLDER_ACTION'
  | 'APPLICATION_LAUNCH'
  | 'BROWSER_ACTION'
  | 'WEB_SEARCH'
  | 'MUSIC_ACTION'
  | 'CLARIFICATION_NEEDED';

export interface IntentClassification {
  category: IntentCategory;
  confidence: number;
  summary: string;
  requiresTool: boolean;
  requiresPlan: boolean;
  missingInformation: string[];
  resolvedReferences: string[];
}

export interface ConversationTurn {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: number;
  resolvedSubject?: string;
  intent?: IntentCategory;
  toolNames?: string[];
  source?: 'VOICE' | 'CONSOLE' | 'SYSTEM';
}

export interface ConversationSessionSummary {
  sessionId: string;
  topic: string;
  activeSubjects: string[];
  turnCount: number;
  summaryText: string;
  updatedAt: number;
}

export type MemoryCategory =
  | 'USER_PREFERENCE'
  | 'PROJECT_INFO'
  | 'APP_CONFIG'
  | 'FREQUENT_COMMAND'
  | 'WORKING_CONTEXT';

export interface MemoryEntry {
  id: string;
  category: MemoryCategory;
  key: string;
  value: string;
  createdAt: number;
  updatedAt: number;
  source: 'USER_EXPLICIT' | 'CONSENT_PROMPT' | 'COMMAND_FREQ';
}

export interface MemoryConsentCandidate {
  id: string;
  category: MemoryCategory;
  key: string;
  value: string;
  reason: string;
  detectedAt: number;
}

export interface MemoryPersistenceResult {
  ok: boolean;
  error?: string;
}

export type SuggestionPriority = 'LOW' | 'MEDIUM' | 'HIGH';
export type SuggestionStatus = 'ACTIVE' | 'REJECTED' | 'ACCEPTED' | 'SAVED' | 'CONVERTED';

export interface AISuggestion {
  id: string;
  title: string;
  explanation: string;
  reason: string;
  priority: SuggestionPriority;
  recommendedAction: string;
  relatedTool?: string;
  toolArgs?: Record<string, unknown>;
  status: SuggestionStatus;
  createdAt: number;
  signature: string;
}

export type ToolPermissionLevel = 'READ_ONLY' | 'WORKSPACE_MUTATION' | 'CONSEQUENTIAL';

export interface ToolInputPropertySchema {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
  enum?: string[];
  min?: number;
  max?: number;
}

export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, ToolInputPropertySchema>;
  required?: string[];
}

export interface ToolResult {
  ok: boolean;
  summary: string;
  data?: Record<string, unknown>;
  verified: boolean;
  verificationDetail?: string;
  error?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  permissionLevel: ToolPermissionLevel;
  requiresConfirmation: boolean;
  inputSchema: ToolInputSchema;
  execute: (args: Record<string, unknown>) => Promise<ToolResult> | ToolResult;
  verify?: (args: Record<string, unknown>, result: ToolResult) => Promise<boolean> | boolean;
}

export interface ToolActivityRecord {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  permissionLevel: ToolPermissionLevel;
  approvedByUser: boolean;
  status: 'PENDING_APPROVAL' | 'EXECUTED' | 'FAILED' | 'DENIED' | 'CANCELLED';
  verified: boolean;
  summary: string;
  error?: string;
  timestamp: number;
}

export interface PlanStep {
  id: string;
  title: string;
  description: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  requiresConfirmation: boolean;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
  verificationNote?: string;
  error?: string;
}

export interface PlanApproach {
  id: string;
  label: string;
  tradeoff: string;
  recommended: boolean;
}

export interface ExecutionPlan {
  id: string;
  objective: string;
  constraints: string[];
  missingInfo: string[];
  approaches: PlanApproach[];
  steps: PlanStep[];
  status: 'DRAFT' | 'AWAITING_APPROVAL' | 'EXECUTING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'CANCELLED';
  requiresApproval: boolean;
  createdAt: number;
  completedAt?: number;
}

export interface WorkspaceContextSnapshot {
  mode: string;
  selectedObjectId: string | null;
  selectedObjectName: string;
  selectedModelId: string;
  objectCount: number;
  objectsSummary: {
    id: string;
    name: string;
    modelId: string;
    vertexCount?: number;
    faceCount?: number;
    componentCount?: number;
    isLocked: boolean;
    isDisintegrated: boolean;
    dispersionPhase?: string;
    renderMode?: string;
    selectedComponentId?: string | null;
    isolatedComponentId?: string | null;
    components?: { id: string; name: string }[];
  }[];
  renderMode: string;
  explosionAmount: number;
  dispersionAmount: number;
  isCameraActive: boolean;
  isVoiceActive: boolean;
  hasLabError: boolean;
  labError?: string | null;
  provider: AIProviderConfig['provider'];
  hasProviderKey: boolean;
  modelName: string;
  notesPreview: string;
  isInteracting?: boolean;
}

export interface PendingToolApproval {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  reason: string;
  permissionLevel: ToolPermissionLevel;
}

// ============================================================================
// Phase 5 — Permission-Based Real-World Action System Types
// ============================================================================

export type PermissionCategory =
  | 'FILE_ACCESS'
  | 'FOLDER_ACCESS'
  | 'APPLICATION_LAUNCH'
  | 'BROWSER_ACCESS'
  | 'WEB_SEARCH'
  | 'MUSIC_PLAYBACK'
  | 'MUSIC_CONTROL'
  | 'EXTERNAL_NAVIGATION'
  | 'WORKSPACE_ACCESS';

export type PermissionStatus =
  | 'NOT_REQUESTED'
  | 'AWAITING_APPROVAL'
  | 'APPROVED'
  | 'DENIED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'FAILED';

export type PermissionRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface PermissionRequest {
  id: string;
  category: PermissionCategory;
  requestedAction: string;
  target: string;
  targetFingerprint: string;
  reason: string;
  riskLevel: PermissionRiskLevel;
  requestedScope: string;
  createdAt: number;
  expiresAt: number;
  status: PermissionStatus;
  decidedAt?: number;
  executedAt?: number;
  completedAt?: number;
  resultSummary?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export type PermissionAuditDecision =
  | 'REQUESTED'
  | 'APPROVED_ONCE'
  | 'DENIED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'REJECTED_TARGET_MISMATCH'
  | 'COMPLETED'
  | 'FAILED';

export interface PermissionAuditEntry {
  id: string;
  permissionId: string;
  category: PermissionCategory;
  requestedAction: string;
  target: string;
  decision: PermissionAuditDecision;
  executionStatus: PermissionStatus;
  resultSummary: string;
  timestamp: number;
}

export type SupportedFileKind = 'TEXT' | 'DOCUMENT' | 'IMAGE' | 'AUDIO' | 'MODEL_3D' | 'UNSUPPORTED' | 'BLOCKED';

export interface SelectedFileMetadata {
  fileId: string;
  name: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  sizeFormatted: string;
  kind: SupportedFileKind;
  intendedOperation: string;
  supported: boolean;
  reasonIfUnsupported?: string;
  selectedAt: number;
}

export interface FileInspectionResult {
  ok: boolean;
  fileId: string;
  name: string;
  extension: string;
  kind: SupportedFileKind;
  sizeFormatted: string;
  intendedOperation: string;
  textContent?: string;
  summary?: string;
  previewUrl?: string;
  handedOffToLab?: boolean;
  handedOffToMusic?: boolean;
  error?: string;
}

export interface BrowserNavigationPreview {
  valid: boolean;
  rawInput: string;
  normalizedUrl?: string;
  hostname?: string;
  protocol?: string;
  error?: string;
}

export interface BrowserNavigationResult {
  ok: boolean;
  url?: string;
  hostname?: string;
  openedInNewTab: boolean;
  popupBlocked?: boolean;
  summary: string;
  error?: string;
}

export type WebSearchProviderId = 'DUCKDUCKGO' | 'WIKIPEDIA' | 'GOOGLE' | 'MDN' | 'GITHUB';

export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

export interface WebSearchResponse {
  ok: boolean;
  query: string;
  provider: WebSearchProviderId;
  searchUrl: string;
  results: WebSearchResultItem[];
  sourceSummary?: string;
  openedInBrowser?: boolean;
  popupBlocked?: boolean;
  cancelled?: boolean;
  distinctionNotice: string;
  error?: string;
}

export type MusicSourceType =
  | 'LOCAL_AUDIO'
  | 'SPOTIFY'
  | 'YOUTUBE_MUSIC'
  | 'SOUNDCLOUD'
  | 'YOUTUBE'
  | 'DIRECT_STREAM';

export type MusicPlaybackStatus =
  | 'IDLE'
  | 'AWAITING_SOURCE'
  | 'AWAITING_APPROVAL'
  | 'PLAYING'
  | 'PAUSED'
  | 'STOPPED'
  | 'OPENED_EXTERNAL_LINK'
  | 'UNAVAILABLE'
  | 'ERROR';

export interface MusicPlaybackState {
  status: MusicPlaybackStatus;
  sourceType: MusicSourceType | null;
  trackTitle: string | null;
  sourceUrl?: string;
  volume: number;
  currentTimeSec: number;
  durationSec: number;
  isActualAudioPlaying: boolean;
  autoplayBlocked?: boolean;
  popupBlocked?: boolean;
  statusMessage: string;
  error?: string;
}

export interface SelectedFolderMetadata {
  folderId: string;
  name: string;
  path: string;
  selectedAt: number;
}

export interface PendingInteractivePrompt {
  kind: 'FILE_PICKER' | 'FOLDER_PICKER' | 'MUSIC_SOURCE' | 'AMBIGUOUS_CLARIFICATION';
  message: string;
  requestedAction?: string;
  query?: string;
  allowFolderSelection?: boolean;
  musicChoices?: { id: MusicSourceType; label: string; description: string }[];
}

export interface IntelligenceRequestResult {
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
  memoryCandidate?: MemoryConsentCandidate;
  activitySummary: string;
  cancelled?: boolean;
  error?: string;
}

