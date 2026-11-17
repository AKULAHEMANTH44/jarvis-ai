import { geminiProvider } from './geminiProvider.js';
import { groqProvider } from './groqProvider.js';
import {
  BackendLLMStatusResponse,
  LLMChatRequest,
  LLMChatResponse,
  LLMMode,
  LLMStreamEvent,
  MultimodalAttachmentPayload
} from './types.js';

const ALLOWED_ATTACHMENT_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json'
]);

const MAX_ATTACHMENTS_PER_REQUEST = 3;
const MAX_ATTACHMENT_BASE64_CHARS = 11_000_000; // ~8 MB binary

export function validateAttachments(attachments?: MultimodalAttachmentPayload[]): {
  ok: boolean;
  sanitized?: MultimodalAttachmentPayload[];
  error?: string;
} {
  if (!attachments || attachments.length === 0) {
    return { ok: true, sanitized: undefined };
  }
  if (!Array.isArray(attachments)) {
    return { ok: false, error: 'Invalid attachments payload.' };
  }
  if (attachments.length > MAX_ATTACHMENTS_PER_REQUEST) {
    return { ok: false, error: `Maximum ${MAX_ATTACHMENTS_PER_REQUEST} attachments allowed per request.` };
  }

  const sanitized: MultimodalAttachmentPayload[] = [];
  for (const att of attachments) {
    if (!att || typeof att.name !== 'string' || typeof att.mimeType !== 'string') {
      return { ok: false, error: 'Malformed attachment metadata.' };
    }
    const lowerMime = att.mimeType.toLowerCase().trim();
    const isTextMime = lowerMime.startsWith('text/') || lowerMime === 'application/json';
    if (!ALLOWED_ATTACHMENT_MIMES.has(lowerMime) && !isTextMime) {
      return { ok: false, error: `Disallowed attachment MIME type: ${att.mimeType}` };
    }
    if (att.base64Data && att.base64Data.length > MAX_ATTACHMENT_BASE64_CHARS) {
      return { ok: false, error: `Attachment "${att.name}" exceeds 8 MB payload limit.` };
    }
    sanitized.push({
      id: String(att.id || att.name),
      name: att.name.slice(0, 120),
      mimeType: lowerMime,
      kind: att.kind === 'IMAGE' || att.kind === 'PDF' ? att.kind : 'TEXT',
      sizeBytes: Number(att.sizeBytes) || 0,
      base64Data: att.base64Data,
      textContent: att.textContent ? String(att.textContent).slice(0, 24000) : undefined
    });
  }
  return { ok: true, sanitized };
}

export class LLMService {
  private defaultMode: LLMMode = 'AUTO';

  constructor() {
    const envMode = (process.env.DEFAULT_LLM_MODE || 'AUTO').toUpperCase().trim();
    if (envMode === 'GEMINI_ONLY' || envMode === 'GROQ_ONLY' || envMode === 'AUTO') {
      this.defaultMode = envMode as LLMMode;
    }
  }

  public getDefaultMode(): LLMMode {
    return this.defaultMode;
  }

  public setDefaultMode(mode: LLMMode) {
    this.defaultMode = mode;
  }

  public async chat(request: LLMChatRequest, signal?: AbortSignal): Promise<LLMChatResponse> {
    const start = Date.now();
    const mode: LLMMode = request.mode || this.defaultMode;

    if (!request.messages || !Array.isArray(request.messages) || request.messages.length === 0) {
      return {
        ok: false,
        text: '',
        provider: 'NONE',
        model: 'unknown',
        mode,
        fallbackTriggered: false,
        error: 'Invalid request: messages array is required.',
        durationMs: 0
      };
    }

    const attCheck = validateAttachments(request.attachments);
    if (!attCheck.ok) {
      return {
        ok: false,
        text: '',
        provider: 'NONE',
        model: 'unknown',
        mode,
        fallbackTriggered: false,
        error: attCheck.error || 'Attachment validation failed.',
        durationMs: 0
      };
    }
    const attachments = attCheck.sanitized;

    // 1. GEMINI ONLY MODE
    if (mode === 'GEMINI_ONLY') {
      const geminiRes = await geminiProvider.generate({
        messages: request.messages,
        attachments,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        model: request.model,
        signal
      });

      return {
        ok: geminiRes.ok,
        text: geminiRes.text,
        provider: 'GEMINI',
        model: geminiRes.model,
        mode,
        fallbackTriggered: false,
        error: geminiRes.error,
        durationMs: Date.now() - start
      };
    }

    // 2. GROQ ONLY MODE
    if (mode === 'GROQ_ONLY') {
      const groqRes = await groqProvider.generate({
        messages: request.messages,
        attachments,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        model: request.model,
        signal
      });

      return {
        ok: groqRes.ok,
        text: groqRes.text,
        provider: 'GROQ',
        model: groqRes.model,
        mode,
        fallbackTriggered: false,
        error: groqRes.error,
        durationMs: Date.now() - start
      };
    }

    // 3. AUTO MODE (Gemini primary -> Groq fallback)
    const isGeminiConfigured = geminiProvider.isConfigured();
    const isGroqConfigured = groqProvider.isConfigured();

    if (!isGeminiConfigured && !isGroqConfigured) {
      return {
        ok: false,
        text: '',
        provider: 'NONE',
        model: 'none',
        mode: 'AUTO',
        fallbackTriggered: false,
        error:
          'Neither GEMINI_API_KEY nor GROQ_API_KEY is configured on the server. Please set keys in server/.env or environment variables.',
        durationMs: Date.now() - start
      };
    }

    // If Gemini is not configured, but Groq is, directly fallback to Groq
    if (!isGeminiConfigured && isGroqConfigured) {
      const groqRes = await groqProvider.generate({
        messages: request.messages,
        attachments,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        model: request.model,
        signal
      });

      return {
        ok: groqRes.ok,
        text: groqRes.text,
        provider: 'GROQ',
        model: groqRes.model,
        mode: 'AUTO',
        fallbackTriggered: true,
        error: groqRes.error,
        durationMs: Date.now() - start
      };
    }

    // Attempt Gemini first
    const geminiRes = await geminiProvider.generate({
      messages: request.messages,
      attachments,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      model: request.model,
      signal
    });

    if (geminiRes.aborted || signal?.aborted) {
      return {
        ok: false,
        text: '',
        provider: 'GEMINI',
        model: geminiRes.model,
        mode: 'AUTO',
        fallbackTriggered: false,
        error: geminiRes.error || 'Request aborted by client.',
        durationMs: Date.now() - start
      };
    }

    if (geminiRes.ok && geminiRes.text) {
      return {
        ok: true,
        text: geminiRes.text,
        provider: 'GEMINI',
        model: geminiRes.model,
        mode: 'AUTO',
        fallbackTriggered: false,
        durationMs: Date.now() - start
      };
    }

    // Gemini encountered an issue (rate limit, error, timeout)
    console.warn(
      `[JARVIS LLM AUTO] Primary Gemini provider failed (${geminiRes.error || 'unknown error'}). Evaluating Groq fallback...`
    );

    if (isGroqConfigured) {
      const groqRes = await groqProvider.generate({
        messages: request.messages,
        attachments,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        signal
      });

      if (groqRes.ok && groqRes.text) {
        return {
          ok: true,
          text: groqRes.text,
          provider: 'GROQ',
          model: groqRes.model,
          mode: 'AUTO',
          fallbackTriggered: true,
          durationMs: Date.now() - start
        };
      }

      // Both failed
      return {
        ok: false,
        text: '',
        provider: 'NONE',
        model: `${geminiRes.model} -> ${groqRes.model}`,
        mode: 'AUTO',
        fallbackTriggered: true,
        error: `Primary provider failed: [${geminiRes.error}]. Fallback provider failed: [${groqRes.error}].`,
        durationMs: Date.now() - start
      };
    }

    // Groq is not configured to serve as fallback
    return {
      ok: false,
      text: '',
      provider: 'GEMINI',
      model: geminiRes.model,
      mode: 'AUTO',
      fallbackTriggered: false,
      error: `${geminiRes.error} (Note: GROQ_API_KEY is not configured for automatic fallback).`,
      durationMs: Date.now() - start
    };
  }

  public async chatStream(
    request: LLMChatRequest,
    onEvent: (event: LLMStreamEvent) => void,
    signal?: AbortSignal
  ): Promise<LLMChatResponse> {
    const start = Date.now();
    const mode: LLMMode = request.mode || this.defaultMode;

    if (!request.messages || !Array.isArray(request.messages) || request.messages.length === 0) {
      const error = 'Invalid request: messages array is required.';
      onEvent({ type: 'error', error, provider: 'NONE', mode });
      return {
        ok: false,
        text: '',
        provider: 'NONE',
        model: 'unknown',
        mode,
        fallbackTriggered: false,
        error,
        durationMs: 0
      };
    }

    const attCheck = validateAttachments(request.attachments);
    if (!attCheck.ok) {
      const error = attCheck.error || 'Attachment validation failed.';
      onEvent({ type: 'error', error, provider: 'NONE', mode });
      return {
        ok: false,
        text: '',
        provider: 'NONE',
        model: 'unknown',
        mode,
        fallbackTriggered: false,
        error,
        durationMs: 0
      };
    }
    const attachments = attCheck.sanitized;

    const runGeminiStream = async (fallbackNote: boolean) => {
      let emitted = false;
      onEvent({
        type: 'meta',
        provider: 'GEMINI',
        model: geminiProvider.getModelName(request.model),
        mode,
        fallbackTriggered: fallbackNote
      });
      const res = await geminiProvider.generateStream(
        {
          messages: request.messages,
          attachments,
          temperature: request.temperature,
          maxTokens: request.maxTokens,
          model: request.model,
          signal
        },
        (delta) => {
          emitted = true;
          onEvent({ type: 'chunk', text: delta, provider: 'GEMINI' });
        }
      );
      return { res, emitted };
    };

    const runGroqStream = async (fallbackTriggered: boolean) => {
      onEvent({
        type: 'meta',
        provider: 'GROQ',
        model: groqProvider.getModelName(mode === 'GROQ_ONLY' ? request.model : undefined),
        mode,
        fallbackTriggered
      });
      return groqProvider.generateStream(
        {
          messages: request.messages,
          attachments,
          temperature: request.temperature,
          maxTokens: request.maxTokens,
          model: mode === 'GROQ_ONLY' ? request.model : undefined,
          signal
        },
        (delta) => {
          onEvent({ type: 'chunk', text: delta, provider: 'GROQ', fallbackTriggered });
        }
      );
    };

    if (mode === 'GEMINI_ONLY') {
      const { res } = await runGeminiStream(false);
      const out: LLMChatResponse = {
        ok: res.ok,
        text: res.text,
        provider: 'GEMINI',
        model: res.model,
        mode,
        fallbackTriggered: false,
        error: res.error,
        durationMs: Date.now() - start
      };
      onEvent(res.ok ? { type: 'done', ...out } : { type: 'error', error: res.error, provider: 'GEMINI', mode });
      return out;
    }

    if (mode === 'GROQ_ONLY') {
      const res = await runGroqStream(false);
      const out: LLMChatResponse = {
        ok: res.ok,
        text: res.text,
        provider: 'GROQ',
        model: res.model,
        mode,
        fallbackTriggered: false,
        error: res.error,
        durationMs: Date.now() - start
      };
      onEvent(res.ok ? { type: 'done', ...out } : { type: 'error', error: res.error, provider: 'GROQ', mode });
      return out;
    }

    // AUTO Mode
    const isGeminiConfigured = geminiProvider.isConfigured();
    const isGroqConfigured = groqProvider.isConfigured();

    if (!isGeminiConfigured && !isGroqConfigured) {
      const error =
        'Neither GEMINI_API_KEY nor GROQ_API_KEY is configured on the server. Please set keys in server/.env or environment variables.';
      onEvent({ type: 'error', error, provider: 'NONE', mode });
      return {
        ok: false,
        text: '',
        provider: 'NONE',
        model: 'none',
        mode: 'AUTO',
        fallbackTriggered: false,
        error,
        durationMs: Date.now() - start
      };
    }

    if (!isGeminiConfigured && isGroqConfigured) {
      const res = await runGroqStream(true);
      const out: LLMChatResponse = {
        ok: res.ok,
        text: res.text,
        provider: 'GROQ',
        model: res.model,
        mode: 'AUTO',
        fallbackTriggered: true,
        error: res.error,
        durationMs: Date.now() - start
      };
      onEvent(res.ok ? { type: 'done', ...out } : { type: 'error', error: res.error, provider: 'GROQ', mode });
      return out;
    }

    const { res: geminiRes, emitted } = await runGeminiStream(false);
    if (geminiRes.aborted || signal?.aborted) {
      const out: LLMChatResponse = {
        ok: false,
        text: '',
        provider: 'GEMINI',
        model: geminiRes.model,
        mode: 'AUTO',
        fallbackTriggered: false,
        error: geminiRes.error || 'Stream cancelled.',
        durationMs: Date.now() - start
      };
      onEvent({ type: 'error', error: out.error, provider: 'GEMINI', mode });
      return out;
    }

    if (geminiRes.ok && geminiRes.text) {
      const out: LLMChatResponse = {
        ok: true,
        text: geminiRes.text,
        provider: 'GEMINI',
        model: geminiRes.model,
        mode: 'AUTO',
        fallbackTriggered: false,
        durationMs: Date.now() - start
      };
      onEvent({ type: 'done', ...out });
      return out;
    }

    // Automatic Groq fallback when Gemini fails before completing cleanly
    if (isGroqConfigured && !emitted) {
      const groqRes = await runGroqStream(true);
      if (groqRes.ok && groqRes.text) {
        const out: LLMChatResponse = {
          ok: true,
          text: groqRes.text,
          provider: 'GROQ',
          model: groqRes.model,
          mode: 'AUTO',
          fallbackTriggered: true,
          durationMs: Date.now() - start
        };
        onEvent({ type: 'done', ...out });
        return out;
      }

      const error = `Primary provider failed: [${geminiRes.error}]. Fallback provider failed: [${groqRes.error}].`;
      onEvent({ type: 'error', error, provider: 'NONE', mode });
      return {
        ok: false,
        text: '',
        provider: 'NONE',
        model: `${geminiRes.model} -> ${groqRes.model}`,
        mode: 'AUTO',
        fallbackTriggered: true,
        error,
        durationMs: Date.now() - start
      };
    }

    const error = isGroqConfigured
      ? `${geminiRes.error}`
      : `${geminiRes.error} (Note: GROQ_API_KEY is not configured for automatic fallback).`;
    onEvent({ type: 'error', error, provider: 'GEMINI', mode });
    return {
      ok: false,
      text: '',
      provider: 'GEMINI',
      model: geminiRes.model,
      mode: 'AUTO',
      fallbackTriggered: false,
      error,
      durationMs: Date.now() - start
    };
  }

  public async getStatus(requestedMode?: LLMMode): Promise<BackendLLMStatusResponse> {
    const mode = requestedMode || this.defaultMode;
    const [geminiStatus, groqStatus] = await Promise.all([
      geminiProvider.getStatus(),
      groqProvider.getStatus()
    ]);

    let activeProvider: 'GEMINI' | 'GROQ' | 'NONE' = 'NONE';
    if (mode === 'GEMINI_ONLY') {
      activeProvider = geminiStatus.configured ? 'GEMINI' : 'NONE';
    } else if (mode === 'GROQ_ONLY') {
      activeProvider = groqStatus.configured ? 'GROQ' : 'NONE';
    } else {
      if (geminiStatus.configured) {
        activeProvider = 'GEMINI';
      } else if (groqStatus.configured) {
        activeProvider = 'GROQ';
      }
    }

    return {
      ok: true,
      mode,
      primaryProvider: 'GEMINI',
      fallbackProvider: 'GROQ',
      gemini: geminiStatus,
      groq: groqStatus,
      activeProvider,
      serverTime: Date.now()
    };
  }
}

export const llmService = new LLMService();
