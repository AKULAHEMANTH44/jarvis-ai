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
