import { AIProviderConfig } from '../types/assistant';

const AI_CONFIG_KEY = 'jarvis_ai_provider_config';

export const DEFAULT_AI_CONFIG: AIProviderConfig = {
  provider: 'LOCAL',
  modelName: 'JARVIS Local Core MK-7',
  temperature: 0.7
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

export class ContextualAIService {
  private config: AIProviderConfig;
  // Volatile in-memory API key only — never persisted to localStorage or disk
  private volatileApiKey: string = '';
  private conversationHistory: { role: 'user' | 'assistant' | 'system'; content: string }[] = [];

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
            temperature: typeof parsed.temperature === 'number' ? parsed.temperature : DEFAULT_AI_CONFIG.temperature
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
      temperature: newConfig.temperature ?? this.config.temperature
    };

    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        // Persist only non-secret configuration fields
        const safePersist = {
          provider: this.config.provider,
          modelName: this.config.modelName,
          customEndpoint: this.config.customEndpoint,
          temperature: this.config.temperature
        };
        window.localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(safePersist));
      } catch {
        console.warn('Failed to save non-secret AI config.');
      }
    }
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
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<{
    ok: boolean;
    text: string;
    error?: string;
    aborted?: boolean;
    provider: AIProviderConfig['provider'];
  }> {
    const provider = this.config.provider;
    if (provider === 'LOCAL' || !this.volatileApiKey) {
      return {
        ok: false,
        text: '',
        error:
          provider === 'LOCAL'
            ? 'Provider is set to LOCAL mode.'
            : `No session API key supplied for ${provider}.`,
        provider
      };
    }

    if (options.signal?.aborted) {
      return { ok: false, text: '', error: 'Request cancelled.', aborted: true, provider };
    }

    const timeoutMs = options.timeoutMs ?? 15000;
    const timeoutController = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      timeoutController.abort();
    }, timeoutMs);

    const onExternalAbort = () => timeoutController.abort();
    options.signal?.addEventListener('abort', onExternalAbort, { once: true });

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

  // Connects to external LLM API if key is supplied by user in volatile memory
  public async queryExternalAI(prompt: string, signal?: AbortSignal): Promise<string> {
    if (this.config.provider === 'LOCAL' || !this.volatileApiKey) {
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
