import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiProvider } from '../server/geminiProvider.js';
import { GroqProvider } from '../server/groqProvider.js';
import { LLMService } from '../server/llmService.js';
import { ContextualAIService } from '../src/services/contextualAI';

describe('Phase 6 — Secure Gemini + Groq Backend Integration', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe('1. Gemini Provider', () => {
    it('reports not configured when GEMINI_API_KEY is missing', async () => {
      delete process.env.GEMINI_API_KEY;
      const provider = new GeminiProvider();
      expect(provider.isConfigured()).toBe(false);

      const status = await provider.getStatus();
      expect(status.configured).toBe(false);
      expect(status.status).toBe('not_configured');

      const result = await provider.generate({
        messages: [{ role: 'user', content: 'Hello' }]
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('GEMINI_API_KEY is not configured');
    });

    it('generates response and identifies model alias when configured', async () => {
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      const provider = new GeminiProvider();
      expect(provider.isConfigured()).toBe(true);
      expect(provider.getModelName()).toBe('gemini-4-hydrogen');

      // Mock the internal client
      provider.setClient({
        models: {
          generateContent: vi.fn().mockResolvedValue({
            text: 'Volumetric core online, sir.'
          })
        }
      }, 'test-gemini-key');

      const res = await provider.generate({
        messages: [
          { role: 'system', content: 'You are JARVIS.' },
          { role: 'user', content: 'Initialize holographic display.' }
        ]
      });

      expect(res.ok).toBe(true);
      expect(res.text).toBe('Volumetric core online, sir.');
      expect(res.model).toBe('gemini-4-hydrogen');

      const status = await provider.getStatus();
      expect(status.status).toBe('connected');
    });

    it('identifies 429 rate limit errors from Gemini', async () => {
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      const provider = new GeminiProvider();
      provider.setClient({
        models: {
          generateContent: vi.fn().mockRejectedValue(new Error('429 Resource Exhausted: Quota exceeded'))
        }
      }, 'test-gemini-key');

      const res = await provider.generate({
        messages: [{ role: 'user', content: 'Run scan' }]
      });

      expect(res.ok).toBe(false);
      expect(res.isRateLimit).toBe(true);
      expect(res.error).toContain('rate limit');

      const status = await provider.getStatus();
      expect(status.status).toBe('rate_limited');
    });
  });

  describe('2. Groq Provider', () => {
    it('reports not configured when GROQ_API_KEY is missing', async () => {
      delete process.env.GROQ_API_KEY;
      const provider = new GroqProvider();
      expect(provider.isConfigured()).toBe(false);

      const status = await provider.getStatus();
      expect(status.configured).toBe(false);
      expect(status.status).toBe('not_configured');

      const result = await provider.generate({
        messages: [{ role: 'user', content: 'Hello' }]
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('GROQ_API_KEY is not configured');
    });

    it('generates completion via OpenAI-compatible endpoint when configured', async () => {
      process.env.GROQ_API_KEY = 'gsk-test-key';
      const provider = new GroqProvider();
      expect(provider.isConfigured()).toBe(true);
      expect(provider.getModelName()).toBe('llama-3.3-70b-versatile');

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: 'Groq ultra-fast neural execution complete.'
              }
            }
          ]
        })
      });
      vi.stubGlobal('fetch', mockFetch);

      const res = await provider.generate({
        messages: [{ role: 'user', content: 'Compute trajectory' }]
      });

      expect(res.ok).toBe(true);
      expect(res.text).toBe('Groq ultra-fast neural execution complete.');
      expect(res.model).toBe('llama-3.3-70b-versatile');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('catches and marks HTTP 429 rate limits from Groq', async () => {
      process.env.GROQ_API_KEY = 'gsk-test-key';
      const provider = new GroqProvider();

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => JSON.stringify({ error: { message: 'Rate limit reached for requests per minute' } })
      });
      vi.stubGlobal('fetch', mockFetch);

      const res = await provider.generate({
        messages: [{ role: 'user', content: 'Compute trajectory' }]
      });

      expect(res.ok).toBe(false);
      expect(res.isRateLimit).toBe(true);
      expect(res.error).toContain('Rate limit reached');

      const status = await provider.getStatus();
      expect(status.status).toBe('rate_limited');
    });
  });

  describe('3. LLM Orchestrator Service (Modes & Fallback)', () => {
    it('enforces GEMINI_ONLY mode without invoking Groq on failure', async () => {
      process.env.GEMINI_API_KEY = 'gemini-key';
      process.env.GROQ_API_KEY = 'groq-key';

      const service = new LLMService();
      // Mock Gemini to fail
      vi.spyOn((service as any), 'chat');
      const geminiSpy = vi.spyOn(
        (await import('../server/geminiProvider.js')).geminiProvider,
        'generate'
      ).mockResolvedValue({
        ok: false,
        text: '',
        model: 'gemini-4-hydrogen',
        error: 'Gemini service temporarily unavailable',
        durationMs: 10
      });
      const groqSpy = vi.spyOn(
        (await import('../server/groqProvider.js')).groqProvider,
        'generate'
      );

      const res = await service.chat({
        messages: [{ role: 'user', content: 'Diagnose power cell' }],
        mode: 'GEMINI_ONLY'
      });

      expect(res.ok).toBe(false);
      expect(res.provider).toBe('GEMINI');
      expect(res.fallbackTriggered).toBe(false);
      expect(geminiSpy).toHaveBeenCalledTimes(1);
      expect(groqSpy).not.toHaveBeenCalled();
    });

    it('enforces GROQ_ONLY mode without invoking Gemini', async () => {
      process.env.GEMINI_API_KEY = 'gemini-key';
      process.env.GROQ_API_KEY = 'groq-key';

      const service = new LLMService();
      const geminiSpy = vi.spyOn(
        (await import('../server/geminiProvider.js')).geminiProvider,
        'generate'
      );
      const groqSpy = vi.spyOn(
        (await import('../server/groqProvider.js')).groqProvider,
        'generate'
      ).mockResolvedValue({
        ok: true,
        text: 'Groq exclusive response.',
        model: 'llama-3.3-70b-versatile',
        durationMs: 15
      });

      const res = await service.chat({
        messages: [{ role: 'user', content: 'Run test' }],
        mode: 'GROQ_ONLY'
      });

      expect(res.ok).toBe(true);
      expect(res.provider).toBe('GROQ');
      expect(res.text).toBe('Groq exclusive response.');
      expect(res.fallbackTriggered).toBe(false);
      expect(geminiSpy).not.toHaveBeenCalled();
      expect(groqSpy).toHaveBeenCalledTimes(1);
    });

    it('in AUTO mode, uses Gemini when healthy and does not trigger fallback', async () => {
      const service = new LLMService();
      vi.spyOn((await import('../server/geminiProvider.js')).geminiProvider, 'isConfigured').mockReturnValue(true);
      vi.spyOn((await import('../server/geminiProvider.js')).geminiProvider, 'generate').mockResolvedValue({
        ok: true,
        text: 'Primary Gemini neural output.',
        model: 'gemini-4-hydrogen',
        durationMs: 25
      });
      const groqSpy = vi.spyOn((await import('../server/groqProvider.js')).groqProvider, 'generate');

      const res = await service.chat({
        messages: [{ role: 'user', content: 'Status check' }],
        mode: 'AUTO'
      });

      expect(res.ok).toBe(true);
      expect(res.provider).toBe('GEMINI');
      expect(res.text).toBe('Primary Gemini neural output.');
      expect(res.fallbackTriggered).toBe(false);
      expect(groqSpy).not.toHaveBeenCalled();
    });

    it('in AUTO mode, automatically triggers Groq fallback when Gemini rate-limits or fails', async () => {
      const service = new LLMService();
      vi.spyOn((await import('../server/geminiProvider.js')).geminiProvider, 'isConfigured').mockReturnValue(true);
      vi.spyOn((await import('../server/geminiProvider.js')).geminiProvider, 'generate').mockResolvedValue({
        ok: false,
        text: '',
        model: 'gemini-4-hydrogen',
        isRateLimit: true,
        error: 'Gemini 429 Rate limit exceeded',
        durationMs: 12
      });

      vi.spyOn((await import('../server/groqProvider.js')).groqProvider, 'isConfigured').mockReturnValue(true);
      const groqSpy = vi.spyOn((await import('../server/groqProvider.js')).groqProvider, 'generate').mockResolvedValue({
        ok: true,
        text: 'Fallback Groq output: All subsystems nominal.',
        model: 'llama-3.3-70b-versatile',
        durationMs: 20
      });

      const res = await service.chat({
        messages: [{ role: 'user', content: 'Perform analysis' }],
        mode: 'AUTO'
      });

      expect(res.ok).toBe(true);
      expect(res.provider).toBe('GROQ');
      expect(res.fallbackTriggered).toBe(true);
      expect(res.text).toContain('Fallback Groq output');
      expect(groqSpy).toHaveBeenCalledTimes(1);
    });

    it('in AUTO mode, uses Groq directly if Gemini key is absent but Groq key is present', async () => {
      const service = new LLMService();
      vi.spyOn((await import('../server/geminiProvider.js')).geminiProvider, 'isConfigured').mockReturnValue(false);
      vi.spyOn((await import('../server/groqProvider.js')).groqProvider, 'isConfigured').mockReturnValue(true);
      vi.spyOn((await import('../server/groqProvider.js')).groqProvider, 'generate').mockResolvedValue({
        ok: true,
        text: 'Groq direct fallback output.',
        model: 'llama-3.3-70b-versatile',
        durationMs: 18
      });

      const res = await service.chat({
        messages: [{ role: 'user', content: 'Inspect system' }],
        mode: 'AUTO'
      });

      expect(res.ok).toBe(true);
      expect(res.provider).toBe('GROQ');
      expect(res.fallbackTriggered).toBe(true);
    });

    it('reports clear error when neither key is configured', async () => {
      const service = new LLMService();
      vi.spyOn((await import('../server/geminiProvider.js')).geminiProvider, 'isConfigured').mockReturnValue(false);
      vi.spyOn((await import('../server/groqProvider.js')).groqProvider, 'isConfigured').mockReturnValue(false);

      const res = await service.chat({
        messages: [{ role: 'user', content: 'Hello' }],
        mode: 'AUTO'
      });

      expect(res.ok).toBe(false);
      expect(res.provider).toBe('NONE');
      expect(res.error).toContain('Neither GEMINI_API_KEY nor GROQ_API_KEY is configured');
    });

    it('returns comprehensive system status for LLMStatusPanel', async () => {
      const service = new LLMService();
      vi.spyOn((await import('../server/geminiProvider.js')).geminiProvider, 'getStatus').mockResolvedValue({
        configured: true,
        model: 'gemini-4-hydrogen',
        status: 'connected',
        message: 'Connected and responding',
        lastChecked: 1000
      });
      vi.spyOn((await import('../server/groqProvider.js')).groqProvider, 'getStatus').mockResolvedValue({
        configured: true,
        model: 'llama-3.3-70b-versatile',
        status: 'connected',
        message: 'Connected and responding',
        lastChecked: 1000
      });

      const status = await service.getStatus('AUTO');
      expect(status.ok).toBe(true);
      expect(status.mode).toBe('AUTO');
      expect(status.primaryProvider).toBe('GEMINI');
      expect(status.fallbackProvider).toBe('GROQ');
      expect(status.activeProvider).toBe('GEMINI');
      expect(status.gemini.status).toBe('connected');
      expect(status.groq.status).toBe('connected');
    });
  });

  describe('4. ContextualAI Client-to-Backend Integration', () => {
    it('proxies queryStructuredCompletion to /api/llm/chat when BACKEND provider is configured', async () => {
      const ai = new ContextualAIService();
      ai.saveConfig({
        provider: 'BACKEND',
        backendMode: 'AUTO',
        modelName: 'JARVIS Dual-Neural Core MK-8'
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          text: 'Backend synthesized intelligence reply.',
          provider: 'GEMINI',
          model: 'gemini-4-hydrogen',
          mode: 'AUTO',
          fallbackTriggered: false
        })
      });
      vi.stubGlobal('fetch', mockFetch);

      const res = await ai.queryStructuredCompletion({
        messages: [{ role: 'user', content: 'What is the status of the arc reactor?' }]
      });

      expect(res.ok).toBe(true);
      expect(res.text).toBe('Backend synthesized intelligence reply.');
      expect(res.provider).toBe('GEMINI');
      expect(res.fallbackTriggered).toBe(false);
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/llm/chat',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
      );
    });

    it('propagates fallback metadata when Groq fallback was triggered on server', async () => {
      const ai = new ContextualAIService();
      ai.saveConfig({
        provider: 'BACKEND',
        backendMode: 'AUTO'
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          text: 'Groq fallback intelligence reply.',
          provider: 'GROQ',
          model: 'llama-3.3-70b-versatile',
          mode: 'AUTO',
          fallbackTriggered: true
        })
      });
      vi.stubGlobal('fetch', mockFetch);

      const res = await ai.queryStructuredCompletion({
        messages: [{ role: 'user', content: 'Analyze sensor arrays' }]
      });

      expect(res.ok).toBe(true);
      expect(res.provider).toBe('GROQ');
      expect(res.fallbackTriggered).toBe(true);
    });

    it('queries backend status and updates mode via getBackendStatus and setBackendMode', async () => {
      const ai = new ContextualAIService();
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            ok: true,
            mode: 'AUTO',
            gemini: { configured: true, status: 'connected' },
            groq: { configured: true, status: 'connected' },
            activeProvider: 'GEMINI'
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ ok: true, currentMode: 'GROQ_ONLY' })
        });
      vi.stubGlobal('fetch', mockFetch);

      const status = await ai.getBackendStatus();
      expect(status?.mode).toBe('AUTO');
      expect(status?.activeProvider).toBe('GEMINI');

      const modeUpdated = await ai.setBackendMode('GROQ_ONLY');
      expect(modeUpdated).toBe(true);
      expect(ai.getConfig().backendMode).toBe('GROQ_ONLY');
    });

    it('maintains pure LOCAL mode offline behavior without network calls', async () => {
      const ai = new ContextualAIService();
      ai.saveConfig({
        provider: 'LOCAL',
        modelName: 'JARVIS Local Core MK-7'
      });

      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);

      const res = await ai.queryStructuredCompletion({
        messages: [{ role: 'user', content: 'Test local' }]
      });

      expect(res.ok).toBe(false);
      expect(res.error).toContain('Provider is set to LOCAL mode');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
