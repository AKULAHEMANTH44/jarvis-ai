import { ChatMessage, ProviderStatusDetail } from './types.js';

export const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';
export const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

export interface GroqCallOptions {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  model?: string;
  signal?: AbortSignal;
}

export interface GroqCallResult {
  ok: boolean;
  text: string;
  model: string;
  isRateLimit?: boolean;
  error?: string;
  durationMs: number;
}

export class GroqProvider {
  private lastHealthCheck: { timestamp: number; ok: boolean; message: string } | null = null;

  public isConfigured(): boolean {
    return Boolean((process.env.GROQ_API_KEY || '').trim());
  }

  public getModelName(overrideModel?: string): string {
    return (overrideModel || process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL).trim();
  }

  public async generate(options: GroqCallOptions): Promise<GroqCallResult> {
    const start = Date.now();
    const model = this.getModelName(options.model);
    const apiKey = (process.env.GROQ_API_KEY || '').trim();

    if (!apiKey) {
      return {
        ok: false,
        text: '',
        model,
        error: 'GROQ_API_KEY is not configured on the server.',
        durationMs: Date.now() - start
      };
    }

    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), 20000);

    const onExternalAbort = () => timeoutController.abort();
    options.signal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
      const response = await fetch(GROQ_API_URL, {
        method: 'POST',
        signal: timeoutController.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'User-Agent': 'jarvis-ai-brain/1.0'
        },
        body: JSON.stringify({
          model,
          messages: options.messages,
          temperature: typeof options.temperature === 'number' ? options.temperature : 0.7,
          max_tokens: options.maxTokens || 2048
        })
      });

      const durationMs = Date.now() - start;

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        let parsedMessage = `HTTP ${response.status}`;
        try {
          const json = JSON.parse(errorBody);
          if (json.error?.message) {
            parsedMessage = json.error.message;
          }
        } catch {
          if (errorBody) parsedMessage = errorBody;
        }

        const isRateLimit = response.status === 429;
        this.lastHealthCheck = {
          timestamp: Date.now(),
          ok: false,
          message: isRateLimit ? 'Rate limit exceeded (429)' : parsedMessage
        };

        return {
          ok: false,
          text: '',
          model,
          isRateLimit,
          error: isRateLimit
            ? `Groq rate limit exceeded: ${parsedMessage}`
            : `Groq error (${response.status}): ${parsedMessage}`,
          durationMs
        };
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content?.trim() || '';

      if (!text) {
        return {
          ok: false,
          text: '',
          model,
          error: 'Groq returned an empty response content.',
          durationMs
        };
      }

      this.lastHealthCheck = { timestamp: Date.now(), ok: true, message: 'Connected and responding' };

      return {
        ok: true,
        text,
        model,
        durationMs
      };
    } catch (err: unknown) {
      const durationMs = Date.now() - start;
      const isAbort =
        (err instanceof Error && err.name === 'AbortError') || timeoutController.signal.aborted;
      const message = isAbort
        ? 'Groq request timed out or was aborted'
        : err instanceof Error
        ? err.message
        : String(err);

      this.lastHealthCheck = {
        timestamp: Date.now(),
        ok: false,
        message
      };

      return {
        ok: false,
        text: '',
        model,
        error: `Groq connection failure: ${message}`,
        durationMs
      };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onExternalAbort);
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
        message: 'GROQ_API_KEY is not set in server environment',
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

export const groqProvider = new GroqProvider();
