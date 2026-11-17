import {
  AIProviderConfig,
  BackendLLMStatusResponse,
  LLMMode,
  PendingAttachment
} from '../types/assistant';

const AI_CONFIG_KEY = 'jarvis_ai_provider_config';

export const DEFAULT_AI_CONFIG: AIProviderConfig = {
  provider: 'BACKEND',
  modelName: 'JARVIS Dual-Neural Core',
  temperature: 0.7,
  backendMode: 'AUTO'
};

function isValidExternalEndpoint(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') return true;
    // Allow loopback HTTP only for local inference engines (e.g. Ollama / LM Studio)
    if (
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function serializeAttachments(attachments?: PendingAttachment[]) {
  if (!attachments || attachments.length === 0) return undefined;
  return attachments.slice(0, 3).map((att) => ({
    id: att.id,
    name: att.name,
    mimeType: att.mimeType,
    kind: att.kind,
    sizeBytes: att.sizeBytes,
    ...(att.base64Data ? { base64Data: att.base64Data } : {}),
    ...(att.textContent ? { textContent: att.textContent } : {})
  }));
}

export class ContextualAIService {
  private config: AIProviderConfig;
  // Volatile in-memory API key only — never persisted to localStorage or disk
  private volatileApiKey: string = '';
  private conversationHistory: { role: 'user' | 'assistant' | 'system'; content: string }[] = [];
  private cachedBackendStatus: BackendLLMStatusResponse | null = null;

  constructor() {
    this.config = this.loadConfig();
    this.initSystemPrompt();
  }

  private initSystemPrompt() {
    this.conversationHistory = [
      {
        role: 'system',
        content: `You are J.A.R.V.I.S. (Just A Rather Very Intelligent System), the high-tech AI assistant to Tony Stark. You speak with a refined, concise British cadence. You assist with 3D holographic reconstruction, manipulation, workspace automation, system diagnostics, and scientific visualization.`
      }
    ];
  }

  private loadConfig(): AIProviderConfig {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const saved = window.localStorage.getItem(AI_CONFIG_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as Partial<AIProviderConfig>;
          // Scrub any legacy persisted key from localStorage immediately
          if ('apiKey' in parsed && parsed.apiKey) {
            delete parsed.apiKey;
            window.localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(parsed));
          }
          return {
            ...DEFAULT_AI_CONFIG,
            provider: parsed.provider || DEFAULT_AI_CONFIG.provider,
            modelName: parsed.modelName || DEFAULT_AI_CONFIG.modelName,
            customEndpoint: parsed.customEndpoint,
            temperature: typeof parsed.temperature === 'number' ? parsed.temperature : DEFAULT_AI_CONFIG.temperature,
            backendMode: parsed.backendMode || DEFAULT_AI_CONFIG.backendMode
          };
        }
      } catch {
        console.warn('Failed to load AI provider config from local storage.');
      }
    }
    return { ...DEFAULT_AI_CONFIG };
  }

  public saveConfig(newConfig: Partial<AIProviderConfig>) {
    if (newConfig.apiKey !== undefined) {
      this.volatileApiKey = newConfig.apiKey.trim();
    }

    const sanitizedEndpoint = newConfig.customEndpoint !== undefined
      ? newConfig.customEndpoint.trim()
      : this.config.customEndpoint;

    this.config = {
      ...this.config,
      provider: newConfig.provider ?? this.config.provider,
      modelName: newConfig.modelName ?? this.config.modelName,
      customEndpoint: sanitizedEndpoint || undefined,
      temperature: newConfig.temperature ?? this.config.temperature,
      backendMode: newConfig.backendMode ?? this.config.backendMode
    };

    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        // Persist only non-secret configuration fields
        const safePersist = {
          provider: this.config.provider,
          modelName: this.config.modelName,
          customEndpoint: this.config.customEndpoint,
          temperature: this.config.temperature,
          backendMode: this.config.backendMode
        };
        window.localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(safePersist));
      } catch {
        console.warn('Failed to save non-secret AI config.');
      }
    }
  }

  public async getBackendStatus(mode?: LLMMode): Promise<BackendLLMStatusResponse | null> {
    try {
      const url = mode ? `/api/llm/status?mode=${encodeURIComponent(mode)}` : '/api/llm/status';
      const res = await fetch(url);
      if (!res.ok) return null;
      const data: BackendLLMStatusResponse = await res.json();
      this.cachedBackendStatus = data;
      return data;
    } catch {
      return null;
    }
  }

  public async setBackendMode(mode: LLMMode): Promise<boolean> {
    this.saveConfig({ backendMode: mode });
    try {
      const res = await fetch('/api/llm/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode })
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  public getCachedBackendStatus(): BackendLLMStatusResponse | null {
    return this.cachedBackendStatus;
  }

  public clearApiKey() {
    this.volatileApiKey = '';
  }

  public hasApiKey(): boolean {
    return this.volatileApiKey.length > 0;
  }

  public getConfig(): AIProviderConfig {
    return {
      ...this.config,
      apiKey: this.volatileApiKey ? this.volatileApiKey : undefined
    };
  }

  public addHistory(role: 'user' | 'assistant', content: string) {
    this.conversationHistory.push({ role, content });
    if (this.conversationHistory.length > 20) {
      this.conversationHistory = [
        this.conversationHistory[0],
        ...this.conversationHistory.slice(-15)
      ];
    }
  }

  public getHistory() {
    return [...this.conversationHistory];
  }

  public resetHistory() {
    this.initSystemPrompt();
  }

  // Parse natural conversational intent in local mode
  public parseLocalIntent(userInput: string, activeModelName: string): {
    intent: string;
    action?: string;
    params?: Record<string, unknown>;
    reply: string;
    requiresConfirmation?: boolean;
  } {
    const text = userInput.toLowerCase();

    // 1. Multi-step Automation Intent
    if (text.includes('automation') || text.includes('workflow') || text.includes('protocol') || text.includes('prepare the lab')) {
      return {
        intent: 'AUTOMATION_WORKFLOW',
        action: 'START_WORKFLOW',
        reply: 'Initiating structured automation protocol, sir. Verifying security permissions.'
      };
    }

    // 2. Reconstruction & Scan Intents
    if (text.includes('reconstruct') || text.includes('laser scan') || text.includes('rescan')) {
      return {
        intent: 'HOLOGRAM_RECONSTRUCT',
        action: 'RECONSTRUCT_SCAN',
        reply: `Running volumetric laser reconstruction pass on ${activeModelName}.`
      };
    }

    // 3. Spatial Duplication
    if (text.includes('duplicate') || text.includes('clone') || text.includes('make a copy')) {
      return {
        intent: 'OBJECT_DUPLICATION',
        action: 'DUPLICATE',
        reply: `Duplicating ${activeModelName} in spatial coordinates.`
      };
    }

    // 4. Spatial Deletion
    if (text.includes('delete') || text.includes('remove') || text.includes('destroy') || text.includes('dismiss')) {
      return {
        intent: 'OBJECT_DELETION',
        action: 'DELETE',
        requiresConfirmation: true,
        reply: `Please confirm: do you wish to de-materialize the selected ${activeModelName}?`
      };
    }

    // 5. Spatial Formations
    if (text.includes('orbit formation') || text.includes('orbit')) {
      return {
        intent: 'LAYOUT_FORMATION',
        action: 'FORMATION_ORBIT',
        reply: 'Rearranging holographic modules into orbital trajectory formation.'
      };
    }
    if (text.includes('grid formation') || text.includes('grid layout')) {
      return {
        intent: 'LAYOUT_FORMATION',
        action: 'FORMATION_GRID',
        reply: 'Arranging all active modules into planar matrix grid.'
      };
    }
    if (text.includes('line formation') || text.includes('lineup')) {
      return {
        intent: 'LAYOUT_FORMATION',
        action: 'FORMATION_LINE',
        reply: 'Aligning holographic models in linear telemetry array.'
      };
    }

    // 6. Desktop File / Notes Actions
    if (text.includes('save note') || text.includes('export note') || text.includes('save file')) {
      return {
        intent: 'DESKTOP_FILE_SAVE',
        action: 'SAVE_FILE',
        reply: 'Exporting workspace memo to authorized local file system.'
      };
    }
    if (text.includes('open file') || text.includes('read file')) {
      return {
        intent: 'DESKTOP_FILE_OPEN',
        action: 'OPEN_FILE',
        reply: 'Opening file dialog for user authorization.'
      };
    }

    // 7. Conversational contextual responses
    if (text.includes('who are you') || text.includes('what are you')) {
      return {
        intent: 'IDENTITY_QUERY',
        reply: 'I am JARVIS: Just A Rather Very Intelligent System. Currently operating Stark Industries Mark VII autonomous holographic laboratory.'
      };
    }
    if (text.includes('how are you') || text.includes('status')) {
      return {
        intent: 'STATUS_QUERY',
        reply: 'All systems operate at optimal efficiency. Fusion containment is 99.8% and optical tracking latency is sub-16 milliseconds.'
      };
    }
    if (text.includes('thank')) {
      return {
        intent: 'COURTESY',
        reply: 'Always a privilege, sir. At your command.'
      };
    }

    return {
      intent: 'GENERAL_CHAT',
      reply: `Command acknowledged regarding ${activeModelName}. Ready for further instructions.`
    };
  }

  private recordUserAndAssistantTurn(prompt: string, reply: string) {
    const last = this.conversationHistory[this.conversationHistory.length - 1];
    if (!last || last.role !== 'user' || last.content !== prompt) {
      this.addHistory('user', prompt);
    }
    this.addHistory('assistant', reply);
  }

  public async queryStructuredCompletion(options: {
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
    attachments?: PendingAttachment[];
    signal?: AbortSignal;
    timeoutMs?: number;
    mode?: LLMMode;
  }): Promise<{
    ok: boolean;
    text: string;
    error?: string;
    aborted?: boolean;
    provider: AIProviderConfig['provider'];
    fallbackTriggered?: boolean;
    model?: string;
  }> {
    const provider = this.config.provider;

    // 1. Explicit LOCAL mode
    if (provider === 'LOCAL') {
      return {
        ok: false,
        text: '',
        error: 'Provider is set to LOCAL mode.',
        provider: 'LOCAL'
      };
    }

    if (options.signal?.aborted) {
      return { ok: false, text: '', error: 'Request cancelled.', aborted: true, provider };
    }

    const timeoutMs = options.timeoutMs ?? 25000;
    const timeoutController = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      timeoutController.abort();
    }, timeoutMs);

    const onExternalAbort = () => timeoutController.abort();
    options.signal?.addEventListener('abort', onExternalAbort, { once: true });

    // 2. BACKEND mode or server-backed provider (when no volatile client key is entered)
    const isServerBacked =
      provider === 'BACKEND' ||
      ((provider === 'GEMINI' || provider === 'GROQ') && !this.volatileApiKey);

    if (isServerBacked) {
      try {
        const mode: LLMMode =
          options.mode ||
          this.config.backendMode ||
          (provider === 'GROQ' ? 'GROQ_ONLY' : provider === 'GEMINI' ? 'GEMINI_ONLY' : 'AUTO');

        const serializedAttachments = serializeAttachments(options.attachments);
        const res = await fetch('/api/llm/chat', {
          method: 'POST',
          signal: timeoutController.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: options.messages,
            mode,
            temperature: this.config.temperature,
            model: this.config.modelName && !this.config.modelName.includes('Core')
              ? this.config.modelName
              : undefined,
            ...(serializedAttachments ? { attachments: serializedAttachments } : {})
          })
        });

        const data = await res.json().catch(() => null);

        if (!res.ok || !data?.ok) {
          return {
            ok: false,
            text: '',
            error: data?.error || `Server backend returned HTTP ${res.status}`,
            provider: (data?.provider as AIProviderConfig['provider']) || 'BACKEND',
            fallbackTriggered: Boolean(data?.fallbackTriggered),
            model: data?.model
          };
        }

        return {
          ok: true,
          text: data.text || '',
          provider: (data.provider as AIProviderConfig['provider']) || 'BACKEND',
          fallbackTriggered: Boolean(data.fallbackTriggered),
          model: data.model
        };
      } catch (err: unknown) {
        if (options.signal?.aborted) {
          return { ok: false, text: '', error: 'Request cancelled by user.', aborted: true, provider };
        }
        if (timedOut || (err instanceof Error && err.name === 'AbortError')) {
          return {
            ok: false,
            text: '',
            error: `Backend request timed out after ${Math.round(timeoutMs / 1000)}s.`,
            provider
          };
        }
        return {
          ok: false,
          text: '',
          error: 'Backend communication encountered a network or connection error.',
          provider
        };
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onExternalAbort);
      }
    }

    // 3. Client volatile key check for external client-side calls
    if (!this.volatileApiKey) {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onExternalAbort);
      return {
        ok: false,
        text: '',
        error: `No session API key supplied for ${provider}.`,
        provider
      };
    }

    try {
      const systemContent = options.messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n\n');
      const chatMessages = options.messages.filter((m) => m.role !== 'system');

      if (provider === 'OPENAI') {
        const endpoint = this.config.customEndpoint || 'https://api.openai.com/v1/chat/completions';
        if (!isValidExternalEndpoint(endpoint)) {
          return {
            ok: false,
            text: '',
            error: 'Blocked external request: endpoint must use HTTPS (or localhost for local inference).',
            provider
          };
        }

        const res = await fetch(endpoint, {
          method: 'POST',
          signal: timeoutController.signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.volatileApiKey}`
          },
          body: JSON.stringify({
            model: this.config.modelName || 'gpt-4o-mini',
            messages: options.messages,
            temperature: this.config.temperature
          })
        });

        if (!res.ok) {
          return {
            ok: false,
            text: '',
            error: `External provider returned HTTP ${res.status}. Verify key and model configuration.`,
            provider
          };
        }
        const data = await res.json();
        const reply = data.choices?.[0]?.message?.content?.trim() || '';
        if (!reply) {
          return {
            ok: false,
            text: '',
            error: 'No response received from external provider.',
            provider
          };
        }
        return { ok: true, text: reply, provider };
      }

      if (provider === 'GEMINI') {
        const model = (this.config.modelName || 'gemini-4-hydrogen').trim();
        const endpoint =
          this.config.customEndpoint ||
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
        if (!isValidExternalEndpoint(endpoint)) {
          return {
            ok: false,
            text: '',
            error: 'Blocked external request: endpoint must use HTTPS (or localhost for local inference).',
            provider
          };
        }

        const contents = chatMessages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        }));

        const res = await fetch(endpoint, {
          method: 'POST',
          signal: timeoutController.signal,
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.volatileApiKey
          },
          body: JSON.stringify({
            ...(systemContent ? { systemInstruction: { parts: [{ text: systemContent }] } } : {}),
            contents,
            generationConfig: {
              temperature: this.config.temperature
            }
          })
        });

        if (!res.ok) {
          return {
            ok: false,
            text: '',
            error: `External provider returned HTTP ${res.status}. Verify key and model configuration.`,
            provider
          };
        }
        const data = await res.json();
        const reply =
          data.candidates?.[0]?.content?.parts
            ?.map((p: { text?: string }) => p.text || '')
            .join('')
            .trim() || '';
        if (!reply) {
          return {
            ok: false,
            text: '',
            error: 'No response received from Gemini provider.',
            provider
          };
        }
        return { ok: true, text: reply, provider };
      }

      if (provider === 'ANTHROPIC') {
        const endpoint = this.config.customEndpoint || 'https://api.anthropic.com/v1/messages';
        if (!isValidExternalEndpoint(endpoint)) {
          return {
            ok: false,
            text: '',
            error: 'Blocked external request: endpoint must use HTTPS (or localhost for local inference).',
            provider
          };
        }

        const messages = chatMessages.map((m) => ({ role: m.role, content: m.content }));
        const res = await fetch(endpoint, {
          method: 'POST',
          signal: timeoutController.signal,
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.volatileApiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: this.config.modelName || 'claude-3-5-sonnet-latest',
            max_tokens: 768,
            temperature: this.config.temperature,
            ...(systemContent ? { system: systemContent } : {}),
            messages
          })
        });

        if (!res.ok) {
          return {
            ok: false,
            text: '',
            error: `External provider returned HTTP ${res.status}. Verify key and model configuration.`,
            provider
          };
        }
        const data = await res.json();
        const reply = Array.isArray(data.content)
          ? data.content
              .map((block: { text?: string }) => block.text || '')
              .join('')
              .trim()
          : '';
        if (!reply) {
          return {
            ok: false,
            text: '',
            error: 'No response received from Anthropic provider.',
            provider
          };
        }
        return { ok: true, text: reply, provider };
      }

      return { ok: false, text: '', error: 'Unsupported provider configured.', provider };
    } catch (err) {
      if (options.signal?.aborted) {
        return { ok: false, text: '', error: 'Request cancelled by user.', aborted: true, provider };
      }
      if (timedOut || (err instanceof Error && err.name === 'AbortError')) {
        return {
          ok: false,
          text: '',
          error: `External provider request timed out after ${Math.round(timeoutMs / 1000)}s.`,
          provider
        };
      }
      return {
        ok: false,
        text: '',
        error: 'External provider communication encountered a network or authentication error.',
        provider
      };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  public async queryStreamingCompletion(options: {
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
    attachments?: PendingAttachment[];
    signal?: AbortSignal;
    timeoutMs?: number;
    mode?: LLMMode;
    onChunk?: (
      delta: string,
      accumulated: string,
      meta?: { provider?: AIProviderConfig['provider']; model?: string; fallbackTriggered?: boolean }
    ) => void;
  }): Promise<{
    ok: boolean;
    text: string;
    error?: string;
    aborted?: boolean;
    provider: AIProviderConfig['provider'];
    fallbackTriggered?: boolean;
    model?: string;
    streamed: boolean;
  }> {
    const provider = this.config.provider;

    if (provider === 'LOCAL') {
      return {
        ok: false,
        text: '',
        error: 'Provider is set to LOCAL mode.',
        provider: 'LOCAL',
        streamed: false
      };
    }

    if (options.signal?.aborted) {
      return {
        ok: false,
        text: '',
        error: 'Request cancelled by user.',
        aborted: true,
        provider,
        streamed: false
      };
    }

    const isServerBacked =
      provider === 'BACKEND' ||
      ((provider === 'GEMINI' || provider === 'GROQ') && !this.volatileApiKey);

    // Client volatile API key paths delegate cleanly to structured completion & emit once
    if (!isServerBacked) {
      const res = await this.queryStructuredCompletion(options);
      if (res.ok && res.text && options.onChunk) {
        options.onChunk(res.text, res.text, {
          provider: res.provider,
          model: res.model,
          fallbackTriggered: res.fallbackTriggered
        });
      }
      return { ...res, streamed: false };
    }

    const timeoutMs = options.timeoutMs ?? 30000;
    const timeoutController = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      timeoutController.abort();
    }, timeoutMs);

    const onExternalAbort = () => timeoutController.abort();
    options.signal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
      const mode: LLMMode =
        options.mode ||
        this.config.backendMode ||
        (provider === 'GROQ' ? 'GROQ_ONLY' : provider === 'GEMINI' ? 'GEMINI_ONLY' : 'AUTO');

      const serializedAttachments = serializeAttachments(options.attachments);
      const res = await fetch('/api/llm/chat/stream', {
        method: 'POST',
        signal: timeoutController.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: options.messages,
          mode,
          temperature: this.config.temperature,
          model: this.config.modelName && !this.config.modelName.includes('Core')
            ? this.config.modelName
            : undefined,
          ...(serializedAttachments ? { attachments: serializedAttachments } : {})
        })
      });

      const contentType = res.headers?.get?.('content-type') || '';

      // Graceful compatibility if a mock fetch or proxy responds with plain JSON
      if (!contentType.includes('text/event-stream') || !res.body?.getReader) {
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          return {
            ok: false,
            text: '',
            error: data?.error || `Server backend returned HTTP ${res.status}`,
            provider: (data?.provider as AIProviderConfig['provider']) || 'BACKEND',
            fallbackTriggered: Boolean(data?.fallbackTriggered),
            model: data?.model,
            streamed: false
          };
        }
        const fullText = data.text || '';
        if (fullText && options.onChunk) {
          options.onChunk(fullText, fullText, {
            provider: (data.provider as AIProviderConfig['provider']) || 'BACKEND',
            model: data.model,
            fallbackTriggered: Boolean(data.fallbackTriggered)
          });
        }
        return {
          ok: true,
          text: fullText,
          provider: (data.provider as AIProviderConfig['provider']) || 'BACKEND',
          fallbackTriggered: Boolean(data.fallbackTriggered),
          model: data.model,
          streamed: false
        };
      }

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        return {
          ok: false,
          text: '',
          error: data?.error || `Streaming backend returned HTTP ${res.status}`,
          provider: (data?.provider as AIProviderConfig['provider']) || 'BACKEND',
          streamed: false
        };
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';
      let activeProvider: AIProviderConfig['provider'] = 'BACKEND';
      let activeModel: string | undefined;
      let fallbackTriggered = false;
      let streamError: string | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith('data:')) continue;
          const payloadStr = line.slice(5).trim();
          if (!payloadStr || payloadStr === '[DONE]') continue;

          try {
            const ev = JSON.parse(payloadStr) as {
              type: 'meta' | 'chunk' | 'done' | 'error';
              provider?: 'GEMINI' | 'GROQ' | 'NONE';
              model?: string;
              fallbackTriggered?: boolean;
              text?: string;
              error?: string;
            };

            if (ev.type === 'meta') {
              if (ev.provider && ev.provider !== 'NONE') activeProvider = ev.provider;
              if (ev.model) activeModel = ev.model;
              if (ev.fallbackTriggered !== undefined) fallbackTriggered = ev.fallbackTriggered;
            } else if (ev.type === 'chunk' && ev.text) {
              accumulated += ev.text;
              options.onChunk?.(ev.text, accumulated, {
                provider: activeProvider,
                model: activeModel,
                fallbackTriggered
              });
            } else if (ev.type === 'done') {
              if (ev.provider && ev.provider !== 'NONE') activeProvider = ev.provider;
              if (ev.model) activeModel = ev.model;
              if (ev.fallbackTriggered !== undefined) fallbackTriggered = ev.fallbackTriggered;
              if (ev.text && !accumulated) {
                accumulated = ev.text;
              }
            } else if (ev.type === 'error') {
              streamError = ev.error || 'Streaming error returned by backend.';
            }
          } catch {
            // Skip malformed SSE frame
          }
        }
      }

      if (streamError && !accumulated) {
        return {
          ok: false,
          text: '',
          error: streamError,
          provider: activeProvider,
          fallbackTriggered,
          model: activeModel,
          streamed: true
        };
      }

      return {
        ok: Boolean(accumulated),
        text: accumulated,
        error: accumulated ? undefined : streamError || 'Empty stream response from backend.',
        provider: activeProvider,
        fallbackTriggered,
        model: activeModel,
        streamed: true
      };
    } catch (err: unknown) {
      if (options.signal?.aborted) {
        return {
          ok: false,
          text: '',
          error: 'Request cancelled by user.',
          aborted: true,
          provider,
          streamed: false
        };
      }
      if (timedOut || (err instanceof Error && err.name === 'AbortError')) {
        return {
          ok: false,
          text: '',
          error: `Streaming request timed out after ${Math.round(timeoutMs / 1000)}s.`,
          provider,
          streamed: false
        };
      }
      return {
        ok: false,
        text: '',
        error: 'Backend streaming encountered a network or connection error.',
        provider,
        streamed: false
      };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  // Connects to external LLM API or secure backend
  public async queryExternalAI(prompt: string, signal?: AbortSignal): Promise<string> {
    const isServer =
      this.config.provider === 'BACKEND' ||
      ((this.config.provider === 'GEMINI' || this.config.provider === 'GROQ') && !this.volatileApiKey);

    if (this.config.provider === 'LOCAL' || (!isServer && !this.volatileApiKey)) {
      return '';
    }

    const res = await this.queryStructuredCompletion({
      messages: [...this.conversationHistory, { role: 'user', content: prompt }],
      signal
    });

    if (res.ok && res.text) {
      this.recordUserAndAssistantTurn(prompt, res.text);
      return res.text;
    }

    if (res.aborted) return '';
    return res.error || 'External provider communication encountered a network or authentication error.';
  }
}

export const contextualAI = new ContextualAIService();
