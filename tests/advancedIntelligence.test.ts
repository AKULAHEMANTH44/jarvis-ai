import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IntelligenceEngine } from '../src/services/intelligenceEngine';
import { ContextualAIService, contextualAI } from '../src/services/contextualAI';
import { conversationManager } from '../src/services/conversationManager';
import { MemoryManager, memoryManager, containsSensitiveSecret } from '../src/services/memoryManager';
import { PlanningEngine } from '../src/services/planningEngine';
import { SuggestionEngine } from '../src/services/suggestionEngine';
import { FileAccessService } from '../src/services/fileAccessService';
import { agentOrchestrator } from '../src/services/agentOrchestrator';
import { speechService } from '../src/services/speechService';
import { permissionPolicy } from '../src/services/permissionPolicy';
import { toolRegistry, WorkspaceToolHost } from '../src/services/toolRegistry';
import { LLMService } from '../server/llmService.js';
import { geminiProvider } from '../server/geminiProvider.js';
import { groqProvider, GroqProvider } from '../server/groqProvider.js';
import { PendingAttachment, VoiceCommand, WorkspaceContextSnapshot } from '../src/types/assistant';

function createMemoryStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, val: string) => {
      store.set(key, String(val));
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    })
  };
}

function makeSnapshot(overrides: Partial<WorkspaceContextSnapshot> = {}): WorkspaceContextSnapshot {
  return {
    mode: 'WORKSPACE',
    selectedObjectId: 'obj-1',
    selectedObjectName: 'ARC REACTOR MK-VII',
    selectedModelId: 'arc_reactor',
    objectCount: 1,
    objectsSummary: [
      {
        id: 'obj-1',
        name: 'ARC REACTOR MK-VII',
        modelId: 'arc_reactor',
        vertexCount: 4200,
        faceCount: 2800,
        componentCount: 3,
        isLocked: false,
        isDisintegrated: false,
        dispersionPhase: 'COMPLETE',
        renderMode: 'HYBRID',
        components: [
          { id: 'c1', name: 'Palladium Core' },
          { id: 'c2', name: 'Solenoid Coil' },
          { id: 'c3', name: 'Containment Housing' }
        ]
      }
    ],
    renderMode: 'HYBRID',
    explosionAmount: 0,
    dispersionAmount: 0,
    isCameraActive: false,
    isVoiceActive: false,
    hasLabError: false,
    labError: null,
    provider: 'LOCAL',
    hasProviderKey: false,
    modelName: 'JARVIS Local Core MK-7',
    notesPreview: 'Mark VII Memorandum',
    isInteracting: false,
    ...overrides
  };
}

function makeMockFile(
  name: string,
  content: string | Uint8Array,
  type: string,
  sizeOverride?: number
): File {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  const textStr = typeof content === 'string' ? content : new TextDecoder('latin1').decode(bytes);
  return {
    name,
    type,
    size: sizeOverride ?? bytes.byteLength,
    lastModified: Date.now(),
    text: async () => textStr,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  } as unknown as File;
}

describe('Batch 2 — Advanced AI Intelligence, Multimodal, Streaming & Autonomous Workflows', () => {
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    process.env = { ...originalEnv };
    const storage = createMemoryStorageMock();
    vi.stubGlobal('window', {
      localStorage: storage,
      navigator: { onLine: true }
    });
    vi.stubGlobal('localStorage', storage);

    contextualAI.saveConfig({
      provider: 'LOCAL',
      backendMode: 'AUTO',
      modelName: 'JARVIS Local Core MK-7',
      temperature: 0.35
    });
    contextualAI.clearApiKey();
    contextualAI.resetHistory();
    conversationManager.resetAllSessions();
    memoryManager.clearAllMemories();
    memoryManager.setEnabled(true);
    agentOrchestrator.clearHistory();
    toolRegistry.clearActivityHistory();
    toolRegistry.setHost(null);
    await permissionPolicy.resetAllPermissions(true);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    toolRegistry.setHost(null);
    speechService.setUnmatchedTranscriptHandler(null);
    speechService.setCommandExecutedCallback(null);
    speechService.setCancelCallback(null);
    agentOrchestrator.clearHistory();
    contextualAI.clearApiKey();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('1. Preserves multi-turn topic continuity across follow-ups without fabricating actions', async () => {
    const engine = new IntelligenceEngine();
    const snap = makeSnapshot();

    const first = await engine.processRequest({
      input: 'I am building a JARVIS drone telemetry module',
      snapshot: snap
    });
    expect(first.status).toBe('RESPONDING');
    expect(first.reply.toLowerCase()).toContain('drone telemetry module');

    const followUp = await engine.processRequest({
      input: 'what were we working on?',
      snapshot: snap
    });
    expect(followUp.classification.category).toBe('ANALYSIS_REQUEST');
    expect(followUp.agentRun?.role).toBe('ANALYSIS');
    expect(followUp.reply).toContain('Session History');
    expect(followUp.reply.toLowerCase()).toContain('drone telemetry module');
  });

  it('2. MemoryManager searches memories by keyword/category and blocks expanded secret formats', () => {
    const mm = new MemoryManager('adv_mem_test', 'adv_mem_cfg');
    mm.saveMemory({
      category: 'PROJECT_INFO',
      key: 'Telemetry Core',
      value: 'Supports TypeScript Three.js volumetric shaders'
    });
    mm.saveMemory({
      category: 'USER_PREFERENCE',
      key: 'Render Style',
      value: 'Hybrid wireframe mode with high contrast'
    });

    const matches = mm.searchMemories('volumetric shaders');
    expect(matches.length).toBe(1);
    expect(matches[0]?.key).toBe('Telemetry Core');

    const filteredByCat = mm.searchMemories('wireframe', 'PROJECT_INFO');
    expect(filteredByCat.length).toBe(0);

    // Reject Groq gsk_, AWS AKIA, Slack xoxb-, and JWT tokens
    expect(containsSensitiveSecret('gsk_1234567890abcdef1234567890')).toBe(true);
    expect(containsSensitiveSecret('AKIAIOSFODNN7EXAMPLE')).toBe(true);
    expect(containsSensitiveSecret('xoxb-1234567890-1234567890-abcdef')).toBe(true);
    expect(containsSensitiveSecret('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature1234')).toBe(true);

    const blockedGroq = mm.saveMemory({
      category: 'APP_CONFIG',
      key: 'Groq Token',
      value: 'gsk_1234567890abcdef1234567890'
    });
    expect(blockedGroq.persistence.ok).toBe(false);
  });

  it('3. Fixes compound wake-word fallback routing while preserving voice commands and mic permission guards', async () => {
    let executed = '';
    const cmds: VoiceCommand[] = [
      {
        patterns: ['hello jarvis', 'hey jarvis', 'jarvis'],
        description: 'Greeting',
        category: 'SYSTEM',
        action: () => {
          executed = 'GREETING';
        },
        feedbackText: 'Good evening, sir.'
      },
      {
        patterns: ['open holographic workspace'],
        description: 'Workspace',
        category: 'NAVIGATION',
        action: () => {
          executed = 'WORKSPACE';
        },
        feedbackText: 'Opening holographic workspace.'
      }
    ];
    speechService.registerCommands(cmds);

    const unmatchedSpy = vi.fn().mockResolvedValue('Project analysis complete.');
    speechService.setUnmatchedTranscriptHandler(unmatchedSpy);

    // Pure greeting stays a greeting
    speechService.handleTranscript('Hello JARVIS', 'VOICE');
    expect(executed).toBe('GREETING');

    // Compound wake word + registered command executes the specific command
    speechService.handleTranscript('JARVIS, open holographic workspace', 'VOICE');
    expect(executed).toBe('WORKSPACE');

    // Compound wake word + general question falls through to IntelligenceEngine handler instead of stopping at "jarvis"
    executed = '';
    speechService.handleTranscript('JARVIS, explain this project', 'VOICE');
    await new Promise((r) => setTimeout(r, 10));
    expect(executed).toBe('');
    expect(unmatchedSpy).toHaveBeenCalledWith('JARVIS, explain this project', 'VOICE');

    // Enforces persistent permission policy before accessing browser microphone
    permissionPolicy.setCapabilityDecision('MICROPHONE_ACCESS', 'DENIED');
    const blockedMic = await speechService.startListeningWithPermission();
    expect(blockedMic.started).toBe(false);
    expect(blockedMic.micGranted).toBe(false);
    expect(blockedMic.error).toContain('Microphone Access is disabled');
  });

  it('4. FileAccessService prepares multimodal image, PDF, and sanitized SVG/text attachments while blocking executables and oversized files', async () => {
    const fs = new FileAccessService();

    // SVG treated as plain text (script-safe)
    const svgFile = makeMockFile(
      'diagram.svg',
      '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="5"/></svg>',
      'image/svg+xml'
    );
    const svgRes = await fs.prepareMultimodalAttachment(svgFile);
    expect(svgRes.ok).toBe(true);
    expect(svgRes.attachment?.kind).toBe('TEXT');
    expect(svgRes.attachment?.mimeType).toBe('text/plain');
    expect(svgRes.attachment?.textContent).toContain('<circle');

    // PNG image -> base64 IMAGE
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const pngFile = makeMockFile('blueprint.png', pngBytes, 'image/png');
    const pngRes = await fs.prepareMultimodalAttachment(pngFile);
    expect(pngRes.ok).toBe(true);
    expect(pngRes.attachment?.kind).toBe('IMAGE');
    expect(pngRes.attachment?.base64Data).toBeTruthy();

    // PDF document with literal text -> PDF with extracted snippet
    const pdfContent = '%PDF-1.4\n1 0 obj <<>> stream\n(Turbine rotor stress tolerance nominal) Tj\nendstream';
    const pdfFile = makeMockFile('spec.pdf', pdfContent, 'application/pdf');
    const pdfRes = await fs.prepareMultimodalAttachment(pdfFile);
    expect(pdfRes.ok).toBe(true);
    expect(pdfRes.attachment?.kind).toBe('PDF');
    expect(pdfRes.attachment?.textContent).toContain('Turbine rotor stress tolerance');

    // Blocked executable
    const exeFile = makeMockFile('payload.exe', 'MZ', 'application/octet-stream');
    const exeRes = await fs.prepareMultimodalAttachment(exeFile);
    expect(exeRes.ok).toBe(false);
    expect(exeRes.error).toContain('blocked');

    // Over 8MB rejected
    const hugeFile = makeMockFile('huge.png', pngBytes, 'image/png', 9 * 1024 * 1024);
    const hugeRes = await fs.prepareMultimodalAttachment(hugeFile);
    expect(hugeRes.ok).toBe(false);
    expect(hugeRes.error).toContain('8 MB');
  });

  it('5. GroqProvider discloses text-only limitation when image attachments are sent', async () => {
    process.env.GROQ_API_KEY = 'gsk-test-key';
    const gp = new GroqProvider();

    let capturedBody: { messages?: Array<{ role: string; content: string }> } = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedBody = JSON.parse(String(init?.body || '{}'));
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: 'Cannot inspect binary image pixels directly.' } }]
          })
        };
      })
    );

    const res = await gp.generate({
      messages: [{ role: 'user', content: 'Describe this schematic' }],
      attachments: [
        {
          id: 'img-1',
          name: 'schematic.png',
          mimeType: 'image/png',
          kind: 'IMAGE',
          sizeBytes: 1024,
          base64Data: 'iVBORw0KGgo='
        }
      ]
    });

    expect(res.ok).toBe(true);
    const sentPrompt = capturedBody.messages?.[0]?.content || '';
    expect(sentPrompt).toContain('text-only Groq fallback');
    expect(sentPrompt).toContain('schematic.png');
  });

  it('6. LLMService.chatStream falls back from Gemini to Groq before first chunk in AUTO mode and rejects >3 attachments', async () => {
    const service = new LLMService();
    const events: Array<{ type: string; provider?: string; text?: string }> = [];

    // Reject >3 attachments
    const tooManyRes = await service.chatStream(
      {
        messages: [{ role: 'user', content: 'Analyze all' }],
        attachments: [1, 2, 3, 4].map((n) => ({
          id: `a${n}`,
          name: `f${n}.txt`,
          mimeType: 'text/plain',
          kind: 'TEXT',
          sizeBytes: 10,
          textContent: 'hi'
        }))
      },
      (ev) => events.push(ev)
    );
    expect(tooManyRes.ok).toBe(false);
    expect(tooManyRes.error).toContain('Maximum 3 attachments');

    vi.spyOn(geminiProvider, 'isConfigured').mockReturnValue(true);
    vi.spyOn(groqProvider, 'isConfigured').mockReturnValue(true);
    vi.spyOn(geminiProvider, 'generateStream').mockResolvedValue({
      ok: false,
      text: '',
      model: 'gemini-4-hydrogen',
      isRateLimit: true,
      error: '429 quota exceeded',
      durationMs: 5
    });
    vi.spyOn(groqProvider, 'generateStream').mockImplementation(async (_opts, onChunk) => {
      onChunk('Fallback ');
      onChunk('streamed reply.');
      return {
        ok: true,
        text: 'Fallback streamed reply.',
        model: 'llama-3.3-70b-versatile',
        durationMs: 12
      };
    });

    const streamEvents: string[] = [];
    const res = await service.chatStream(
      { messages: [{ role: 'user', content: 'Analyze core' }], mode: 'AUTO' },
      (ev) => {
        if (ev.type === 'chunk' && ev.text) streamEvents.push(ev.text);
      }
    );

    expect(res.ok).toBe(true);
    expect(res.provider).toBe('GROQ');
    expect(res.fallbackTriggered).toBe(true);
    expect(streamEvents).toEqual(['Fallback ', 'streamed reply.']);
  });

  it('7. ContextualAIService.queryStreamingCompletion parses incremental SSE frames and supports mid-stream AbortSignal cancellation', async () => {
    const ai = new ContextualAIService();
    ai.saveConfig({ provider: 'BACKEND', backendMode: 'AUTO' });

    const encoder = new TextEncoder();
    const sseStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"type":"meta","provider":"GEMINI","model":"gemini-4-hydrogen","fallbackTriggered":false}\n\n')
        );
        controller.enqueue(encoder.encode('data: {"type":"chunk","text":"Arc "}\n\n'));
        controller.enqueue(encoder.encode('data: {"type":"chunk","text":"telemetry nominal."}\n\n'));
        controller.enqueue(
          encoder.encode('data: {"type":"done","provider":"GEMINI","model":"gemini-4-hydrogen","text":"Arc telemetry nominal."}\n\n')
        );
        controller.close();
      }
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: sseStream
      })
    );

    const chunks: string[] = [];
    const okRes = await ai.queryStreamingCompletion({
      messages: [{ role: 'user', content: 'Stream reactor check' }],
      onChunk: (delta) => chunks.push(delta)
    });

    expect(okRes.ok).toBe(true);
    expect(okRes.streamed).toBe(true);
    expect(okRes.provider).toBe('GEMINI');
    expect(okRes.text).toBe('Arc telemetry nominal.');
    expect(chunks).toEqual(['Arc ', 'telemetry nominal.']);

    // Abort mid-flight
    const abortCtrl = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      })
    );

    const pending = ai.queryStreamingCompletion({
      messages: [{ role: 'user', content: 'Cancel me' }],
      signal: abortCtrl.signal
    });
    abortCtrl.abort();
    const abortedRes = await pending;
    expect(abortedRes.aborted).toBe(true);
    expect(abortedRes.ok).toBe(false);
  });

  it('8. PlanningEngine enforces dependency skipping, bounded retries on transient read-only failure, and logs execution history', async () => {
    const pe = new PlanningEngine();
    const snap = makeSnapshot();

    // Case A: Host allows read-only inspect_selected_model (step-1) but rejects explode (step-2), causing step-3 (dependsOn: ['step-2']) to be SKIPPED
    const partialHost: WorkspaceToolHost = {
      getContextSnapshot: () => snap,
      selectModel: () => false,
      setRenderMode: () => false,
      setExplosionAmount: () => false,
      disintegrate: () => false,
      reconstruct: () => false,
      rotate360: () => false,
      frameModel: () => false,
      resetCamera: () => false,
      resetTransform: () => false,
      applyFormation: () => false,
      duplicateSelected: () => false,
      deleteSelected: async () => false,
      selectComponent: () => false,
      isolateComponent: () => false,
      undo: () => false,
      redo: () => false,
      appendNote: () => false,
      exportNotes: async () => false
    };
    toolRegistry.setHost(partialHost);

    const modelPlan = pe.createPlanFromRequest('Inspect and explain model components', snap);
    const partial = await pe.executePlan(modelPlan.id, { approved: true });
    expect(partial.status).toBe('PARTIAL');
    expect(partial.steps[0].status).toBe('COMPLETED');
    expect(partial.steps[1].status).toBe('FAILED');
    expect(partial.steps[2].status).toBe('SKIPPED');
    expect(partial.steps[2].verificationNote).toContain('prerequisite step(s) incomplete');
    expect(pe.getExecutionHistory().some((p) => p.id === modelPlan.id)).toBe(true);

    // Case B: Bounded retry recovers when a read-only tool fails once then succeeds
    let callCount = 0;
    const realExecute = toolRegistry.executeTool.bind(toolRegistry);
    vi.spyOn(toolRegistry, 'executeTool').mockImplementation(async (name, args, ctx) => {
      if (name === 'retrieve_context_and_memory' && callCount === 0) {
        callCount++;
        return {
          result: { ok: false, verified: false, summary: 'Transient context lock', error: 'TRANSIENT' },
          record: {
            id: 'rec-fail',
            toolName: name,
            args,
            permissionLevel: 'SAFE',
            status: 'FAILED',
            summary: 'Transient failure',
            timestamp: Date.now()
          }
        };
      }
      return realExecute(name, args, ctx);
    });

    const researchPlan = pe.createPlanFromRequest('Research propulsion architecture', snap);
    const recovered = await pe.executePlan(researchPlan.id, { approved: false });
    expect(recovered.status).toBe('COMPLETED');
    expect(recovered.steps[0].retryCount).toBe(1);
    expect(recovered.steps[0].verificationNote).toContain('Recovered after 1 retry');
  });

  it('9. AgentOrchestrator runs RESEARCH, CODING, ANALYSIS, and WORKFLOW roles safely without bypassing approvals', async () => {
    const snap = makeSnapshot({ provider: 'LOCAL' });

    const research = await agentOrchestrator.runResearchAgent({
      query: 'Research plasma containment rings',
      snapshot: snap
    });
    expect(research.ok).toBe(true);
    expect(research.run.role).toBe('RESEARCH');
    expect(research.reply).toContain('Search web for');

    const codeAttachment: PendingAttachment = {
      id: 'att-ts',
      name: 'sample.ts',
      mimeType: 'text/plain',
      kind: 'TEXT',
      sizeBytes: 120,
      sizeFormatted: '120 B',
      textContent: '// TODO: tighten type\nexport const x: any = 1;\nconsole.log(x);'
    };
    const coding = await agentOrchestrator.runCodingAgent({
      prompt: 'Review sample.ts',
      snapshot: snap,
      attachments: [codeAttachment]
    });
    expect(coding.ok).toBe(true);
    expect(coding.run.role).toBe('CODING');
    expect(coding.reply).toContain('1 TODO/FIXME marker');
    expect(coding.reply).toContain('npx tsc --noEmit');

    const imgAttachment: PendingAttachment = {
      id: 'att-img',
      name: 'frame.png',
      mimeType: 'image/png',
      kind: 'IMAGE',
      sizeBytes: 2048,
      sizeFormatted: '2.0 KB',
      base64Data: 'iVBORw0KGgo='
    };
    const analysis = await agentOrchestrator.runAnalysisAgent({
      prompt: 'Analyze attached frame',
      snapshot: snap,
      attachments: [imgAttachment]
    });
    expect(analysis.ok).toBe(true);
    expect(analysis.run.role).toBe('ANALYSIS');
    expect(analysis.reply).toContain('frame.png');
    expect(analysis.reply).toContain('Binary image pixels cannot be visually inspected in LOCAL mode');

    // WORKFLOW agent must hold plans that require confirmation rather than auto-executing
    const deleteSpy = vi.fn().mockResolvedValue(true);
    const mockHost: WorkspaceToolHost = {
      getContextSnapshot: () => snap,
      selectModel: () => true,
      setRenderMode: () => true,
      setExplosionAmount: () => true,
      disintegrate: () => true,
      reconstruct: () => true,
      rotate360: () => true,
      frameModel: () => true,
      resetCamera: () => true,
      resetTransform: () => true,
      applyFormation: () => true,
      duplicateSelected: () => true,
      deleteSelected: deleteSpy,
      selectComponent: () => true,
      isolateComponent: () => true,
      undo: () => true,
      redo: () => true,
      appendNote: () => true,
      exportNotes: async () => true
    };
    toolRegistry.setHost(mockHost);

    const wfConfirm = await agentOrchestrator.runWorkflowAgent({
      objective: 'Prepare my project for demonstration',
      snapshot: snap
    });
    expect(wfConfirm.ok).toBe(true);
    expect(wfConfirm.plan?.status).toBe('AWAITING_APPROVAL');
    expect(deleteSpy).not.toHaveBeenCalled();

    // Read-only workflow runs cleanly without mutating state
    const wfReadOnly = await agentOrchestrator.runWorkflowAgent({
      objective: 'Research system telemetry',
      snapshot: snap
    });
    expect(wfReadOnly.ok).toBe(true);
    expect(wfReadOnly.plan?.status).toBe('COMPLETED');
    expect(agentOrchestrator.getSnapshot().history.length).toBeGreaterThanOrEqual(4);
  });

  it('10. SuggestionEngine generates plan-failure & long-session suggestions without auto-executing, and suppresses during interaction', () => {
    const se = new SuggestionEngine();
    const pe = new PlanningEngine();
    const snap = makeSnapshot();

    const incompletePlan = pe.createPlanFromRequest('Prepare my project for demonstration', snap);
    incompletePlan.status = 'PARTIAL';

    // Suppressed while user is actively interacting
    const duringInteract = se.evaluateContext({
      snapshot: { ...snap, isInteracting: true },
      recentTurns: [],
      status: 'RESPONDING',
      latestPlan: incompletePlan,
      sessionTurnCount: 12
    });
    expect(duringInteract.length).toBe(0);

    // Generates incomplete plan review + long session recall when idle
    const active = se.evaluateContext({
      snapshot: snap,
      recentTurns: [{ id: 't1', sessionId: 's', role: 'user', text: 'I updated the code', timestamp: Date.now() }],
      status: 'RESPONDING',
      latestPlan: incompletePlan,
      sessionTurnCount: 12
    });

    expect(active.some((s) => s.title.includes('Review Incomplete Plan'))).toBe(true);
    expect(active.some((s) => s.title.includes('Archive Long Session Context'))).toBe(true);
    expect(active.some((s) => s.title.includes('Post-Change Verification'))).toBe(true);
  });
});
