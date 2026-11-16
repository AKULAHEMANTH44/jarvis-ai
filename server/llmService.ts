import { geminiProvider } from './geminiProvider.js';
import { groqProvider } from './groqProvider.js';
import {
  BackendLLMStatusResponse,
  LLMChatRequest,
  LLMChatResponse,
  LLMMode
} from './types.js';

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

  public async chat(request: LLMChatRequest): Promise<LLMChatResponse> {
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

    // 1. GEMINI ONLY MODE
    if (mode === 'GEMINI_ONLY') {
      const geminiRes = await geminiProvider.generate({
        messages: request.messages,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        model: request.model
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
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        model: request.model
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
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        model: request.model
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
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      model: request.model
    });

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
        temperature: request.temperature,
        maxTokens: request.maxTokens
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
