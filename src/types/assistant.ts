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

export interface AIProviderConfig {
  provider: 'LOCAL' | 'OPENAI' | 'ANTHROPIC' | 'GEMINI';
  apiKey?: string;
  modelName: string;
  customEndpoint?: string;
  temperature: number;
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
export type SuggestionStatus = 'ACTIVE' | 'ACCEPTED' | 'REJECTED' | 'SAVED' | 'CONVERTED';

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
  memoryCandidate?: MemoryConsentCandidate;
  activitySummary: string;
  cancelled?: boolean;
  error?: string;
}

