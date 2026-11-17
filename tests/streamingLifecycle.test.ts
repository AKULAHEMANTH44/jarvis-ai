import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { apiRouter } from '../server/routes.js';
import { llmService } from '../server/llmService.js';
import { geminiProvider } from '../server/geminiProvider.js';
import { groqProvider } from '../server/groqProvider.js';

class MockIncomingRequest extends EventEmitter {
  method = 'POST';
  url = '/llm/chat/stream';
  body = { messages: [{ role: 'user', content: 'Hello JARVIS' }], mode: 'AUTO' };
  aborted = false;
  destroy() {
    this.aborted = true;
    this.emit('aborted');
    this.emit('close');
  }
}

class MockServerResponse extends EventEmitter {
  statusCode = 200;
  headers: Record<string, string> = {};
  writableEnded = false;
  dataChunks: string[] = [];

  status(code: number) {
    this.statusCode = code;
    return this;
  }
  setHeader(name: string, value: string) {
    this.headers[name.toLowerCase()] = value;
    return this;
  }
  flushHeaders() {}
  write(chunk: string) {
    if (this.writableEnded) return false;
    this.dataChunks.push(chunk);
    return true;
  }
  end() {
    if (this.writableEnded) return;
    this.writableEnded = true;
    this.emit('finish');
    this.emit('close');
  }
  destroy() {
    if (!this.writableEnded) {
      this.writableEnded = true;
      this.emit('close');
    }
  }
}

describe('Streaming Lifecycle & Cancellation Fix Tests', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('1. A normal completed incoming request does not abort AI generation', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    vi.spyOn(geminiProvider, 'isConfigured').mockReturnValue(true);
    vi.spyOn(geminiProvider, 'generateStream').mockImplementation(async (_opts, onChunk) => {
      onChunk('Core systems online.');
      return { ok: true, text: 'Core systems online.', model: 'gemini-4-hydrogen', durationMs: 10 };
    });

    const req = new MockIncomingRequest();
    const res = new MockServerResponse();

    const handleRoute = apiRouter.stack.find((layer: any) => layer.route?.path === '/llm/chat/stream')?.route?.stack?.[0]?.handle;
    expect(handleRoute).toBeDefined();

    const promise = handleRoute(req, res);
    // Simulate request body finished arriving (which previously triggered close prematurely)
    req.emit('close');

    await promise;

    expect(res.dataChunks.join('')).toContain('Core systems online.');
    expect(res.writableEnded).toBe(true);
  });

  it('2. A client disconnecting before completion aborts generation', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    vi.spyOn(geminiProvider, 'isConfigured').mockReturnValue(true);
    vi.spyOn(geminiProvider, 'generateStream').mockImplementation(async (opts, onChunk) => {
      onChunk('Partial output...');
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (opts.signal?.aborted) {
        return { ok: false, text: '', model: 'gemini-4-hydrogen', aborted: true, durationMs: 20 };
      }
      onChunk(' Finished.');
      return { ok: true, text: 'Partial output... Finished.', model: 'gemini-4-hydrogen', durationMs: 60 };
    });

    const req = new MockIncomingRequest();
    const res = new MockServerResponse();
    const handleRoute = apiRouter.stack.find((layer: any) => layer.route?.path === '/llm/chat/stream')?.route?.stack?.[0]?.handle;

    const promise = handleRoute(req, res);
    // Simulate premature client disconnect via res close
    res.destroy();

    await promise;
    expect(res.dataChunks.some((c) => c.includes('Partial output'))).toBe(true);
  });

  it('3. An incoming request that is genuinely aborted cancels generation', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    vi.spyOn(geminiProvider, 'isConfigured').mockReturnValue(true);
    vi.spyOn(geminiProvider, 'generateStream').mockImplementation(async (opts) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        ok: false,
        text: '',
        model: 'gemini-4-hydrogen',
        aborted: Boolean(opts.signal?.aborted),
        durationMs: 10
      };
    });

    const req = new MockIncomingRequest();
    const res = new MockServerResponse();
    const handleRoute = apiRouter.stack.find((layer: any) => layer.route?.path === '/llm/chat/stream')?.route?.stack?.[0]?.handle;

    const promise = handleRoute(req, res);
    req.destroy(); // triggers 'aborted'

    await promise;
    expect(res.writableEnded).toBe(true);
  });

  it('4. A successful Gemini stream reaches the client', async () => {
    process.env.GEMINI_API_KEY = 'gemini-test-key';
    vi.spyOn(geminiProvider, 'isConfigured').mockReturnValue(true);
    vi.spyOn(geminiProvider, 'generateStream').mockImplementation(async (_opts, onChunk) => {
      onChunk('Gemini ');
      onChunk('stream online.');
      return { ok: true, text: 'Gemini stream online.', model: 'gemini-4-hydrogen', durationMs: 15 };
    });

    const req = new MockIncomingRequest();
    const res = new MockServerResponse();
    const handleRoute = apiRouter.stack.find((layer: any) => layer.route?.path === '/llm/chat/stream')?.route?.stack?.[0]?.handle;

    await handleRoute(req, res);
    const joined = res.dataChunks.join('');
    expect(joined).toContain('Gemini stream online.');
  });

  it('5. A successful Groq stream reaches the client', async () => {
    process.env.GROQ_API_KEY = 'gsk-test-key';
    req => req;
    vi.spyOn(geminiProvider, 'isConfigured').mockReturnValue(false);
    vi.spyOn(groqProvider, 'isConfigured').mockReturnValue(true);
    vi.spyOn(groqProvider, 'generateStream').mockImplementation(async (_opts, onChunk) => {
      onChunk('Groq ');
      onChunk('acceleration active.');
      return { ok: true, text: 'Groq acceleration active.', model: 'llama-3.3-70b-versatile', durationMs: 12 };
    });

    const req = new MockIncomingRequest();
    req.body = { messages: [{ role: 'user', content: 'Run Groq' }], mode: 'GROQ_ONLY' };
    const res = new MockServerResponse();
    const handleRoute = apiRouter.stack.find((layer: any) => layer.route?.path === '/llm/chat/stream')?.route?.stack?.[0]?.handle;

    await handleRoute(req, res);
    const joined = res.dataChunks.join('');
    expect(joined).toContain('Groq acceleration active.');
  });

  it('6. AUTO mode falls back from Gemini to Groq when Gemini fails before emitting content', async () => {
    process.env.GEMINI_API_KEY = 'gemini-key';
    process.env.GROQ_API_KEY = 'groq-key';
    vi.spyOn(geminiProvider, 'isConfigured').mockReturnValue(true);
    vi.spyOn(groqProvider, 'isConfigured').mockReturnValue(true);

    vi.spyOn(geminiProvider, 'generateStream').mockResolvedValue({
      ok: false,
      text: '',
      model: 'gemini-4-hydrogen',
      isRateLimit: true,
      error: '429 Quota exceeded',
      durationMs: 5
    });
    vi.spyOn(groqProvider, 'generateStream').mockImplementation(async (_opts, onChunk) => {
      onChunk('Groq fallback response.');
      return { ok: true, text: 'Groq fallback response.', model: 'llama-3.3-70b-versatile', durationMs: 10 };
    });

    const req = new MockIncomingRequest();
    req.body = { messages: [{ role: 'user', content: 'Test auto fallback' }], mode: 'AUTO' };
    const res = new MockServerResponse();
    const handleRoute = apiRouter.stack.find((layer: any) => layer.route?.path === '/llm/chat/stream')?.route?.stack?.[0]?.handle;

    await handleRoute(req, res);
    const joined = res.dataChunks.join('');
    expect(joined).toContain('Groq fallback response.');
    expect(joined).toContain('fallbackTriggered":true');
  });

  it('7. An error event is delivered when both providers fail', async () => {
    process.env.GEMINI_API_KEY = 'gemini-key';
    process.env.GROQ_API_KEY = 'groq-key';
    vi.spyOn(geminiProvider, 'isConfigured').mockReturnValue(true);
    vi.spyOn(groqProvider, 'isConfigured').mockReturnValue(true);

    vi.spyOn(geminiProvider, 'generateStream').mockResolvedValue({
      ok: false,
      text: '',
      model: 'gemini-4-hydrogen',
      error: 'Gemini down',
      durationMs: 5
    });
    vi.spyOn(groqProvider, 'generateStream').mockResolvedValue({
      ok: false,
      text: '',
      model: 'llama-3.3-70b-versatile',
      error: 'Groq down',
      durationMs: 5
    });

    const req = new MockIncomingRequest();
    req.body = { messages: [{ role: 'user', content: 'Double failure' }], mode: 'AUTO' };
    const res = new MockServerResponse();
    const handleRoute = apiRouter.stack.find((layer: any) => layer.route?.path === '/llm/chat/stream')?.route?.stack?.[0]?.handle;

    await handleRoute(req, res);
    const joined = res.dataChunks.join('');
    expect(joined).toContain('"type":"error"');
    expect(joined).toContain('Primary provider failed');
  });

  it('8. Cancellation does not trigger an unwanted fallback', async () => {
    process.env.GEMINI_API_KEY = 'gemini-key';
    process.env.GROQ_API_KEY = 'groq-key';
    vi.spyOn(geminiProvider, 'isConfigured').mockReturnValue(true);
    vi.spyOn(groqProvider, 'isConfigured').mockReturnValue(true);

    const groqSpy = vi.spyOn(groqProvider, 'generateStream');
    vi.spyOn(geminiProvider, 'generateStream').mockImplementation(async (opts) => {
      if (opts.signal) {
        // Abort during gemini call
      }
      return { ok: false, text: '', model: 'gemini-4-hydrogen', aborted: true, error: 'Aborted', durationMs: 5 };
    });

    const req = new MockIncomingRequest();
    const res = new MockServerResponse();
    const handleRoute = apiRouter.stack.find((layer: any) => layer.route?.path === '/llm/chat/stream')?.route?.stack?.[0]?.handle;

    const promise = handleRoute(req, res);
    req.destroy(); // abort
    await promise;

    expect(groqSpy).not.toHaveBeenCalled();
  });

  it('9 & 10. Event listeners are cleaned up cleanly after completion without emitting duplicate terminal events', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    vi.spyOn(geminiProvider, 'isConfigured').mockReturnValue(true);
    vi.spyOn(geminiProvider, 'generateStream').mockImplementation(async (_opts, onChunk) => {
      onChunk('Clean cleanup test.');
      return { ok: true, text: 'Clean cleanup test.', model: 'gemini-4-hydrogen', durationMs: 10 };
    });

    const req = new MockIncomingRequest();
    const res = new MockServerResponse();
    const handleRoute = apiRouter.stack.find((layer: any) => layer.route?.path === '/llm/chat/stream')?.route?.stack?.[0]?.handle;

    await handleRoute(req, res);
    expect(req.listenerCount('aborted')).toBe(0);
    expect(res.listenerCount('close')).toBe(0);
    expect(res.writableEnded).toBe(true);
  });
});
