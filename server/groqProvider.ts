import { ChatMessage, MultimodalAttachmentPayload, ProviderStatusDetail } from './types.js';

export const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';
export const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

export interface GroqCallOptions {
  messages: ChatMessage[];
  attachments?: MultimodalAttachmentPayload[];
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
  aborted?: boolean;
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

  private buildMessagesWithAttachments(
    messages: ChatMessage[],
    attachments?: MultimodalAttachmentPayload[]
  ): ChatMessage[] {
    if (!attachments || attachments.length === 0) return messages;
    const cloned = messages.map((m) => ({ ...m }));
    let lastUserIdx = -1;
    for (let i = cloned.length - 1; i >= 0; i--) {
      if (cloned[i].role === 'user') {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx < 0) {
      cloned.push({ role: 'user', content: 'Analyze the attached user content.' });
      lastUserIdx = cloned.length - 1;
    }

    const blocks: string[] = [];
    for (const att of attachments) {
      if (att.kind === 'TEXT' && att.textContent) {
        blocks.push(
          `<attached_user_file name="${att.name}" mime="${att.mimeType}">\n${att.textContent.slice(0, 14000)}\n</attached_user_file>`
        );
      } else {
        const extractedNote = att.textContent
          ? `Extracted readable text:\n${att.textContent.slice(0, 6000)}`
          : 'Binary pixel/stream contents are not readable by text-only Groq fallback; state this limitation clearly instead of guessing visual details.';
        blocks.push(
          `<attached_binary_metadata name="${att.name}" kind="${att.kind}" mime="${att.mimeType}" bytes="${att.sizeBytes}">\n${extractedNote}\n</attached_binary_metadata>`
        );
      }
    }

    if (blocks.length > 0) {
      cloned[lastUserIdx].content = `${cloned[lastUserIdx].content}\n\n${blocks.join('\n\n')}`;
    }
    return cloned;
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

    if (options.signal?.aborted) {
      return {
        ok: false,
        text: '',
        model,
        aborted: true,
        error: 'Groq request aborted by client.',
        durationMs: Date.now() - start
      };
    }

    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), 20000);

    const onExternalAbort = () => timeoutController.abort();
    options.signal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
      const messages = this.buildMessagesWithAttachments(options.messages, options.attachments);
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
          messages,
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
        const isAuthError = response.status === 401 || response.status === 403;
        this.lastHealthCheck = {
          timestamp: Date.now(),
          ok: false,
          message: isAuthError
            ? 'Invalid or unauthorized API key'
            : isRateLimit
            ? 'Rate limit exceeded (429)'
            : parsedMessage
        };

        return {
          ok: false,
          text: '',
          model,
          isRateLimit,
          error: isAuthError
            ? `Groq authentication error (${response.status}): ${parsedMessage}`
            : isRateLimit
            ? `Groq rate limit exceeded: ${parsedMessage}`
            : `Groq error (${response.status}): ${parsedMessage}`,
          durationMs
        };
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content?.trim() || '';

      if (!text) {
        this.lastHealthCheck = {
          timestamp: Date.now(),
          ok: false,
          message: 'Empty response content'
        };
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

      if (!options.signal?.aborted) {
        this.lastHealthCheck = {
          timestamp: Date.now(),
          ok: false,
          message
        };
      }

      return {
        ok: false,
        text: '',
        model,
        aborted: Boolean(options.signal?.aborted),
        error: `Groq connection failure: ${message}`,
        durationMs
      };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  public async generateStream(
    options: GroqCallOptions,
    onChunk: (delta: string) => void
  ): Promise<GroqCallResult> {
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

    if (options.signal?.aborted) {
      return {
        ok: false,
        text: '',
        model,
        aborted: true,
        error: 'Groq stream aborted by client.',
        durationMs: Date.now() - start
      };
    }

    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), 30000);
    const onExternalAbort = () => timeoutController.abort();
    options.signal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
      const messages = this.buildMessagesWithAttachments(options.messages, options.attachments);
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
          messages,
          stream: true,
          temperature: typeof options.temperature === 'number' ? options.temperature : 0.7,
          max_tokens: options.maxTokens || 2048
        })
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        const isRateLimit = response.status === 429;
        this.lastHealthCheck = {
          timestamp: Date.now(),
          ok: false,
          message: isRateLimit ? 'Rate limit exceeded (429)' : `HTTP ${response.status}`
        };
        return {
          ok: false,
          text: '',
          model,
          isRateLimit,
          error: isRateLimit
            ? `Groq rate limit exceeded: ${errorBody || 'HTTP 429'}`
            : `Groq stream error (${response.status}): ${errorBody || 'Request failed'}`,
          durationMs: Date.now() - start
        };
      }

      if (!response.body || typeof response.body.getReader !== 'function') {
        const data = await response.json().catch(() => null);
        const text = data?.choices?.[0]?.message?.content?.trim() || '';
        if (text) {
          onChunk(text);
          this.lastHealthCheck = { timestamp: Date.now(), ok: true, message: 'Connected and responding' };
          return { ok: true, text, model, durationMs: Date.now() - start };
        }
        return { ok: false, text: '', model, error: 'Groq stream body unavailable.', durationMs: Date.now() - start };
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      while (true) {
        if (options.signal?.aborted) {
          await reader.cancel().catch(() => {});
          return {
            ok: false,
            text: fullText,
            model,
            aborted: true,
            error: 'Groq stream cancelled.',
            durationMs: Date.now() - start
          };
        }

        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const parsed = JSON.parse(payload);
            const delta = parsed?.choices?.[0]?.delta?.content;
            if (typeof delta === 'string' && delta.length > 0) {
              fullText += delta;
              onChunk(delta);
            }
          } catch {
            // Skip partial or malformed SSE JSON frame cleanly
          }
        }
      }

      const cleaned = fullText.trim();
      if (!cleaned) {
        return {
          ok: false,
          text: '',
          model,
          error: 'Groq stream completed without output text.',
          durationMs: Date.now() - start
        };
      }

      this.lastHealthCheck = { timestamp: Date.now(), ok: true, message: 'Connected and streaming' };
      return { ok: true, text: cleaned, model, durationMs: Date.now() - start };
    } catch (err: unknown) {
      const durationMs = Date.now() - start;
      const isAbort =
        (err instanceof Error && err.name === 'AbortError') || timeoutController.signal.aborted;
      const message = isAbort
        ? 'Groq stream timed out or was aborted'
        : err instanceof Error
        ? err.message
        : String(err);

      return {
        ok: false,
        text: '',
        model,
        aborted: Boolean(options.signal?.aborted),
        error: `Groq stream connection failure: ${message}`,
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
