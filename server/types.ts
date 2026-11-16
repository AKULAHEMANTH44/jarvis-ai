export type LLMMode = 'AUTO' | 'GEMINI_ONLY' | 'GROQ_ONLY';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMChatRequest {
  messages: ChatMessage[];
  mode?: LLMMode;
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

export interface LLMChatResponse {
  ok: boolean;
  text: string;
  provider: 'GEMINI' | 'GROQ' | 'NONE';
  model: string;
  mode: LLMMode;
  fallbackTriggered: boolean;
  error?: string;
  durationMs: number;
}

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
