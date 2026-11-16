import { GoogleGenAI } from '@google/genai';
import { ChatMessage, ProviderStatusDetail } from './types.js';

export const DEFAULT_GEMINI_MODEL = 'gemini-4-hydrogen';

export interface GeminiCallOptions {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  model?: string;
  signal?: AbortSignal;
}

export interface GeminiCallResult {
  ok: boolean;
  text: string;
  model: string;
  isRateLimit?: boolean;
  error?: string;
  durationMs: number;
}

export class GeminiProvider {
  private client: GoogleGenAI | null = null;
  private cachedApiKey: string | null = null;
  private lastHealthCheck: { timestamp: number; ok: boolean; message: string } | null = null;

  private getClient(): GoogleGenAI | null {
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) {
      this.client = null;
      this.cachedApiKey = null;
      return null;
    }

    if (this.client && this.cachedApiKey === apiKey) {
      return this.client;
    }

    this.cachedApiKey = apiKey;
    this.client = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: { 'User-Agent': 'aistudio-build' }
      }
    });

    return this.client;
  }

  public setClient(client: any, apiKey: string = 'test-gemini-key') {
    this.client = client;
    this.cachedApiKey = apiKey;
  }

  public isConfigured(): boolean {
    return Boolean((process.env.GEMINI_API_KEY || '').trim());
  }

  public getModelName(overrideModel?: string): string {
    return (overrideModel || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim();
  }

  public async generate(options: GeminiCallOptions): Promise<GeminiCallResult> {
    const start = Date.now();
    const model = this.getModelName(options.model);
    const client = this.getClient();

    if (!client) {
      return {
        ok: false,
        text: '',
        model,
        error: 'GEMINI_API_KEY is not configured on the server.',
        durationMs: Date.now() - start
      };
    }

    try {
      const systemMessages = options.messages.filter((m) => m.role === 'system');
      const nonSystemMessages = options.messages.filter((m) => m.role !== 'system');

      const systemInstruction = systemMessages.map((m) => m.content).join('\n\n') || undefined;

      // Map chat messages to Gemini contents structure
      const contents = nonSystemMessages.map((msg) => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      }));

      // Ensure at least one content entry exists
      if (contents.length === 0) {
        contents.push({ role: 'user', parts: [{ text: 'Hello' }] });
      }

      const response = await client.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
          temperature: typeof options.temperature === 'number' ? options.temperature : 0.7,
          maxOutputTokens: options.maxTokens || 2048
        }
      });

      const text = response.text?.trim() || '';

      if (!text) {
        return {
          ok: false,
          text: '',
          model,
          error: 'Gemini returned an empty response candidate.',
          durationMs: Date.now() - start
        };
      }

      this.lastHealthCheck = { timestamp: Date.now(), ok: true, message: 'Connected and responding' };

      return {
        ok: true,
        text,
        model,
        durationMs: Date.now() - start
      };
    } catch (err: unknown) {
      const durationMs = Date.now() - start;
      const errorMessage = err instanceof Error ? err.message : String(err);
      const isRateLimit =
        errorMessage.includes('429') ||
        errorMessage.toLowerCase().includes('resource_exhausted') ||
        errorMessage.toLowerCase().includes('rate limit') ||
        errorMessage.toLowerCase().includes('quota');

      this.lastHealthCheck = {
        timestamp: Date.now(),
        ok: false,
        message: isRateLimit ? 'Rate limit exceeded (429)' : errorMessage
      };

      return {
        ok: false,
        text: '',
        model,
        isRateLimit,
        error: isRateLimit ? `Gemini rate limit exceeded: ${errorMessage}` : `Gemini error: ${errorMessage}`,
        durationMs
      };
    }
  }

  public async getStatus(): Promise<ProviderStatusDetail> {
    const configured = this.isConfigured();
    const model = this.getModelName();

    if (!configured) {
      return {
        configured: false,
        model,
        status: 'not_configured',
        message: 'GEMINI_API_KEY is not set in server environment',
        lastChecked: Date.now()
      };
    }

    if (this.lastHealthCheck) {
      return {
        configured: true,
        model,
        status: this.lastHealthCheck.ok
          ? 'connected'
          : this.lastHealthCheck.message.includes('429')
          ? 'rate_limited'
          : 'error',
        message: this.lastHealthCheck.message,
        lastChecked: this.lastHealthCheck.timestamp
      };
    }

    return {
      configured: true,
      model,
      status: 'connected',
      message: 'Configured and ready (Standby)',
      lastChecked: Date.now()
    };
  }
}

export const geminiProvider = new GeminiProvider();
