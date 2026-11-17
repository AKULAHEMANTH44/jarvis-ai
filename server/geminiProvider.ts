import { GoogleGenAI } from '@google/genai';
import { ChatMessage, MultimodalAttachmentPayload, ProviderStatusDetail } from './types.js';

export const DEFAULT_GEMINI_MODEL = 'gemini-4-hydrogen';

export interface GeminiCallOptions {
  messages: ChatMessage[];
  attachments?: MultimodalAttachmentPayload[];
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
  aborted?: boolean;
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

  private buildContentsAndSystem(options: GeminiCallOptions): {
    systemInstruction?: string;
    contents: Array<{ role: 'user' | 'model'; parts: Array<Record<string, unknown>> }>;
  } {
    const systemMessages = options.messages.filter((m) => m.role === 'system');
    const nonSystemMessages = options.messages.filter((m) => m.role !== 'system');
    const systemInstruction = systemMessages.map((m) => m.content).join('\n\n') || undefined;

    const contents: Array<{ role: 'user' | 'model'; parts: Array<Record<string, unknown>> }> =
      nonSystemMessages.map((msg) => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      }));

    if (contents.length === 0) {
      contents.push({ role: 'user', parts: [{ text: 'Hello' }] });
    }

    // Isolate user-supplied attachments strictly into the last user turn (never into systemInstruction)
    if (options.attachments && options.attachments.length > 0) {
      let lastUserIdx = -1;
      for (let i = contents.length - 1; i >= 0; i--) {
        if (contents[i].role === 'user') {
          lastUserIdx = i;
          break;
        }
      }
      if (lastUserIdx < 0) {
        contents.push({ role: 'user', parts: [{ text: 'Analyze the attached user content.' }] });
        lastUserIdx = contents.length - 1;
      }

      const targetParts = contents[lastUserIdx].parts;
      for (const att of options.attachments) {
        if (att.kind === 'TEXT' && att.textContent) {
          targetParts.push({
            text: `\n<attached_user_file name="${att.name}" mime="${att.mimeType}">\n${att.textContent.slice(0, 16000)}\n</attached_user_file>`
          });
        } else if ((att.kind === 'IMAGE' || att.kind === 'PDF') && att.base64Data) {
          targetParts.push({
            inlineData: {
              mimeType: att.mimeType,
              data: att.base64Data
            }
          });
          if (att.textContent) {
            targetParts.push({
              text: `\n<attached_file_extracted_text name="${att.name}">\n${att.textContent.slice(0, 8000)}\n</attached_file_extracted_text>`
            });
          }
        }
      }
    }

    return { systemInstruction, contents };
  }

  private classifyError(err: unknown, start: number, model: string): GeminiCallResult {
    const durationMs = Date.now() - start;
    const errorMessage = err instanceof Error ? err.message : String(err);
    const isAbort =
      (err instanceof Error && err.name === 'AbortError') ||
      errorMessage.toLowerCase().includes('aborted');
    if (isAbort) {
      return {
        ok: false,
        text: '',
        model,
        aborted: true,
        error: 'Gemini request aborted by client.',
        durationMs
      };
    }

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

    if (options.signal?.aborted) {
      return {
        ok: false,
        text: '',
        model,
        aborted: true,
        error: 'Gemini request aborted before start.',
        durationMs: Date.now() - start
      };
    }

    try {
      const { systemInstruction, contents } = this.buildContentsAndSystem(options);

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
      return this.classifyError(err, start, model);
    }
  }

  public async generateStream(
    options: GeminiCallOptions,
    onChunk: (delta: string) => void
  ): Promise<GeminiCallResult> {
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

    if (options.signal?.aborted) {
      return {
        ok: false,
        text: '',
        model,
        aborted: true,
        error: 'Gemini stream aborted by client.',
        durationMs: Date.now() - start
      };
    }

    try {
      const { systemInstruction, contents } = this.buildContentsAndSystem(options);

      if (typeof client.models?.generateContentStream !== 'function') {
        const single = await this.generate(options);
        if (single.ok && single.text) {
          onChunk(single.text);
        }
        return single;
      }

      const stream = await client.models.generateContentStream({
        model,
        contents,
        config: {
          systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
          temperature: typeof options.temperature === 'number' ? options.temperature : 0.7,
          maxOutputTokens: options.maxTokens || 2048
        }
      });

      let fullText = '';
      for await (const chunk of stream) {
        if (options.signal?.aborted) {
          return {
            ok: false,
            text: fullText,
            model,
            aborted: true,
            error: 'Gemini stream cancelled.',
            durationMs: Date.now() - start
          };
        }
        const part = typeof chunk?.text === 'string' ? chunk.text : '';
        if (part) {
          fullText += part;
          onChunk(part);
        }
      }

      const cleaned = fullText.trim();
      if (!cleaned) {
        return {
          ok: false,
          text: '',
          model,
          error: 'Gemini stream completed without output text.',
          durationMs: Date.now() - start
        };
      }

      this.lastHealthCheck = { timestamp: Date.now(), ok: true, message: 'Connected and streaming' };
      return {
        ok: true,
        text: cleaned,
        model,
        durationMs: Date.now() - start
      };
    } catch (err: unknown) {
      return this.classifyError(err, start, model);
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
