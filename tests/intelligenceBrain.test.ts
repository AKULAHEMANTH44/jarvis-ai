import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConversationManager } from '../src/services/conversationManager';
import { MemoryManager, containsSensitiveSecret } from '../src/services/memoryManager';
import { SuggestionEngine } from '../src/services/suggestionEngine';
import { PlanningEngine } from '../src/services/planningEngine';
import {
  ToolRegistry,
  WorkspaceToolHost,
  evaluateSafeMathExpression,
  toolRegistry
} from '../src/services/toolRegistry';
import { IntelligenceEngine } from '../src/services/intelligenceEngine';
import { contextualAI } from '../src/services/contextualAI';
import { conversationManager } from '../src/services/conversationManager';
import { memoryManager } from '../src/services/memoryManager';
import { suggestionEngine } from '../src/services/suggestionEngine';
import { planningEngine } from '../src/services/planningEngine';
import { speechService } from '../src/services/speechService';
import { automationEngine } from '../src/services/automationEngine';
import { IntelligenceStatus, WorkspaceContextSnapshot } from '../src/types/assistant';

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

describe('Phase 4 — JARVIS AI Intelligence Brain', () => {
  beforeEach(() => {
    const storage = createMemoryStorageMock();
    vi.stubGlobal('window', {
      localStorage: storage,
      navigator: { onLine: true }
    });
    vi.stubGlobal('localStorage', storage);
    contextualAI.saveConfig({
      provider: 'LOCAL',
      modelName: 'JARVIS Local Core MK-7',
      temperature: 0.35
    });
    contextualAI.clearApiKey();
    contextualAI.resetHistory();
    conversationManager.resetAllSessions();
    memoryManager.clearAllMemories();
    memoryManager.setEnabled(true);
    suggestionEngine.clearAll();
    planningEngine.clearPlans();
    toolRegistry.clearActivityHistory();
    toolRegistry.setHost(null);
  });

  afterEach(() => {
    toolRegistry.setHost(null);
    speechService.setUnmatchedTranscriptHandler(null);
    speechService.setCommandExecutedCallback(null);
    speechService.setCancelCallback(null);
    contextualAI.clearApiKey();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('1. IntelligenceEngine classifies requests and executes math, docs, diagnostics, and workspace inspection tools', async () => {
    const engine = new IntelligenceEngine();
    const snap = makeSnapshot();

    const mathRes = await engine.processRequest({
      input: 'Calculate (24 * 5) + sqrt(144)',
      snapshot: snap
    });
    expect(mathRes.classification.category).toBe('CALCULATION');
    expect(mathRes.reply).toContain('132');
    expect(mathRes.toolRecords[0]?.toolName).toBe('calculate_math');
    expect(mathRes.toolRecords[0]?.verified).toBe(true);

    const docsRes = await engine.processRequest({
      input: 'What 3D formats are supported in the lab?',
      snapshot: snap
    });
    expect(docsRes.classification.category).toBe('DOCUMENTATION');
    expect(docsRes.reply).toContain('.glb');
    expect(docsRes.reply).toContain('.obj');

    const inspectRes = await engine.processRequest({
      input: 'Inspect my current workspace',
      snapshot: snap
    });
    expect(inspectRes.classification.category).toBe('OBJECT_INSPECTION');
    expect(inspectRes.toolRecords[0]?.toolName).toBe('inspect_workspace');

    const diagRes = await engine.processRequest({
      input: 'Run network diagnostics and provider status',
      snapshot: snap
    });
    expect(diagRes.classification.category).toBe('DIAGNOSTICS');
    expect(diagRes.reply).toContain('LOCAL');
  });

  it('2. ConversationManager isolates sessions, compacts old turns cleanly, and clears active session', () => {
    const cm = new ConversationManager(8);
    const s1 = cm.getCurrentSessionId();
    for (let i = 1; i <= 10; i++) {
      cm.addTurn({ role: 'user', text: `Session 1 turn ${i}` });
    }
    expect(cm.getTurns(s1).length).toBe(8);
    expect(cm.summarizeSession(s1)?.summaryText).toContain('Earlier:');

    const s2 = cm.createSession('Imported Car Inspection');
    cm.addTurn({ role: 'user', text: 'Inspect imported sports car.' });
    expect(cm.getTurns(s2).length).toBe(1);
    expect(cm.getTurns(s1).length).toBe(8);
    expect(cm.listSessions().length).toBe(2);

    cm.clearCurrentSession();
    expect(cm.getTurns(s2).length).toBe(0);
    expect(cm.getTurns(s1).length).toBe(8);
  });

  it('3. Follow-up resolution preserves active conversation subjects and workspace model references', async () => {
    const cm = new ConversationManager();
    cm.addTurn({ role: 'user', text: 'I am building a JARVIS assistant.' });
    cm.addTurn({ role: 'assistant', text: 'Which subsystem would you like to inspect next?' });

    const follow1 = cm.resolveFollowUp('The voice system.', makeSnapshot());
    expect(follow1.isFollowUp).toBe(true);
    expect(follow1.resolvedReferences.some((r) => r.includes('JARVIS assistant'))).toBe(true);
    expect(follow1.inferredSubject).toContain('JARVIS assistant');

    const importedSnap = makeSnapshot({
      selectedObjectName: 'IMPORTED DRONE',
      selectedModelId: 'reconstructed_object',
      objectsSummary: [
        {
          id: 'imp-1',
          name: 'IMPORTED DRONE.GLB',
          modelId: 'reconstructed_object',
          vertexCount: 15200,
          faceCount: 10100,
          componentCount: 4,
          isLocked: false,
          isDisintegrated: false
        }
      ]
    });

    const follow2 = cm.resolveFollowUp('explain the imported model', importedSnap);
    expect(follow2.resolvedReferences.some((r) => r.includes('IMPORTED DRONE.GLB'))).toBe(true);

    const engine = new IntelligenceEngine();
    const res = await engine.processRequest({
      input: 'explain the imported model',
      snapshot: importedSnap
    });
    expect(res.reply).toContain('15200 vertices');
    expect(res.reply).toContain('4 component(s)');
  });

  it('4. MemoryManager enforces explicit consent, blocks secrets, and reports storage failures honestly', () => {
    const mm = new MemoryManager('test_mem_entries', 'test_mem_cfg');

    // Proposes candidate without saving silently
    const cand = mm.detectConsentCandidate('I prefer wireframe mode during structural reviews');
    expect(cand).not.toBeNull();
    expect(mm.getMemories().length).toBe(0);
    expect(mm.getPendingCandidates().length).toBe(1);

    // Frequent commands only propose candidate at 3rd execution, never save automatically
    expect(mm.recordCommandUsage('explode the model')).toBeNull();
    expect(mm.recordCommandUsage('explode the model')).toBeNull();
    const freqCand = mm.recordCommandUsage('explode the model');
    expect(freqCand?.category).toBe('FREQUENT_COMMAND');
    expect(mm.getMemories().length).toBe(0);

    // Explicit approval persists
    const approved = mm.approveCandidate(cand!.id);
    expect(approved.persistence.ok).toBe(true);
    expect(mm.getMemories().length).toBe(1);

    // Secrets are strictly rejected
    expect(containsSensitiveSecret('api key is sk-live-secret1234567890')).toBe(true);
    expect(mm.detectConsentCandidate('remember that my api key is AIzaSyDummySecret123456789')).toBeNull();
    const secretSave = mm.saveMemory({
      category: 'APP_CONFIG',
      key: 'Token',
      value: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
    });
    expect(secretSave.persistence.ok).toBe(false);

    // Storage failure is surfaced cleanly & reverts in-memory list
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const failedSave = mm.saveMemory({
      category: 'WORKING_CONTEXT',
      key: 'Next Step',
      value: 'Run turbine sweep'
    });
    expect(failedSave.persistence.ok).toBe(false);
    expect(failedSave.persistence.error).toContain('QuotaExceededError');
    expect(mm.getMemories().length).toBe(1);
  });

  it('5 & 6. Memory retrieval, editing, deletion, clear-all, and enable/disable toggle', () => {
    const mm = new MemoryManager('test_mem_2', 'test_cfg_2');
    const s1 = mm.saveMemory({
      category: 'PROJECT_INFO',
      key: 'Drone Chassis',
      value: 'Carbon fiber quadrotor frame with GLB telemetry'
    });
    const s2 = mm.saveMemory({
      category: 'USER_PREFERENCE',
      key: 'Color Theme',
      value: 'Cyan wireframe overlays'
    });

    const matches = mm.getRelevantMemories('quadrotor GLB frame', 2);
    expect(matches[0]?.id).toBe(s1.entry?.id);

    const updated = mm.updateMemory(s2.entry!.id, { value: 'Amber tactical wireframe' });
    expect(updated.persistence.ok).toBe(true);
    expect(updated.entry?.value).toBe('Amber tactical wireframe');

    const del = mm.deleteMemory(s1.entry!.id);
    expect(del.ok).toBe(true);
    expect(mm.getMemories().length).toBe(1);

    // Disable persistent memory
    mm.setEnabled(false);
    expect(mm.isEnabled()).toBe(false);
    const blocked = mm.saveMemory({
      category: 'WORKING_CONTEXT',
      key: 'Blocked',
      value: 'Should not save when disabled'
    });
    expect(blocked.persistence.ok).toBe(false);

    mm.setEnabled(true);
    expect(mm.clearAllMemories().ok).toBe(true);
    expect(mm.getMemories().length).toBe(0);
  });

  it('7. SuggestionEngine detects conflicts/context, suppresses during interaction, remembers rejections, and converts to tasks', async () => {
    const se = new SuggestionEngine();
    const lockedSnap = makeSnapshot({
      objectsSummary: [
        {
          id: 'obj-1',
          name: 'ARC REACTOR MK-VII',
          modelId: 'arc_reactor',
          componentCount: 3,
          isLocked: true,
          isDisintegrated: false
        }
      ]
    });

    // Suppressed during active pointer/gesture manipulation
    const suppressed = se.evaluateContext({
      snapshot: { ...lockedSnap, isInteracting: true },
      recentTurns: [{ id: 't1', sessionId: 's', role: 'user', text: 'rotate the model', timestamp: Date.now() }],
      status: 'RESPONDING'
    });
    expect(suppressed.length).toBe(0);

    // Surfaces relevant suggestions when idle/responding
    const active = se.evaluateContext({
      snapshot: lockedSnap,
      recentTurns: [{ id: 't1', sessionId: 's', role: 'user', text: 'rotate the model', timestamp: Date.now() }],
      status: 'RESPONDING'
    });
    expect(active.some((s) => s.title.includes('Lock'))).toBe(true);
    const lockSug = active.find((s) => s.title.includes('Lock'))!;

    // Rejecting suppresses future resurfacing of the same signature
    se.rejectSuggestion(lockSug.id);
    const afterReject = se.evaluateContext({
      snapshot: lockedSnap,
      recentTurns: [{ id: 't1', sessionId: 's', role: 'user', text: 'rotate the model', timestamp: Date.now() }],
      status: 'RESPONDING'
    });
    expect(afterReject.some((s) => s.signature === lockSug.signature)).toBe(false);

    // Save for later & convert to task
    const explodeSug = afterReject.find((s) => s.title.includes('Multi-Part'));
    expect(explodeSug).toBeDefined();
    se.saveForLater(explodeSug!.id);
    expect(se.getSavedSuggestions().length).toBe(1);

    const beforeTaskCount = automationEngine.getTasks().length;
    expect(se.convertToTask(explodeSug!.id)).toBe(true);
    expect(automationEngine.getTasks().length).toBe(beforeTaskCount + 1);
  });

  it('8. PlanningEngine creates constrained multi-approaches plans, enforces approval, and reports partial/completed outcomes', async () => {
    const pe = new PlanningEngine();
    const snap = makeSnapshot();
    const plan = pe.createPlanFromRequest('Prepare my project for demonstration', snap);

    expect(plan.constraints.length).toBeGreaterThan(0);
    expect(plan.approaches.length).toBe(2);
    expect(plan.steps.length).toBe(4);
    expect(plan.requiresApproval).toBe(true);
    expect(plan.status).toBe('AWAITING_APPROVAL');

    // Executing without approval keeps AWAITING_APPROVAL
    const blocked = await pe.executePlan(plan.id, { approved: false });
    expect(blocked.status).toBe('AWAITING_APPROVAL');

    // Without a WorkspaceToolHost, read-only steps succeed while host-mutating steps fail honestly -> PARTIAL
    const partial = await pe.executePlan(plan.id, { approved: true });
    expect(partial.status).toBe('PARTIAL');
    expect(partial.steps[0].status).toBe('COMPLETED');
    expect(partial.steps[2].status).toBe('FAILED');
    expect(pe.summarizePlanOutcome(partial)).toContain('PARTIAL');
  });

  it('9, 10 & 11. ToolRegistry validates inputs, blocks unknown/unsafe inputs, enforces permissions & approval gates, and verifies state', async () => {
    const reg = new ToolRegistry();

    // Unknown tool denied
    const unknown = await reg.executeTool('arbitrary_shell_exec', { cmd: 'rm -rf /' });
    expect(unknown.result.ok).toBe(false);
    expect(unknown.record.status).toBe('DENIED');

    // Safe math evaluator handles functions & rejects invalid/unsafe expressions
    expect(evaluateSafeMathExpression('2^3 + round(4.6)')).toBe(13);
    expect(() => evaluateSafeMathExpression('process.exit(1)')).toThrow();

    // Schema validation catches invalid enums & missing required fields
    const badEnum = await reg.executeTool('control_hologram_transform', {
      action: 'explode',
      explosionAmount: 5
    });
    expect(badEnum.result.ok).toBe(false);
    expect(badEnum.record.status).toBe('FAILED');

    // Consequential tool requires confirmation
    const unapprovedDelete = await reg.executeTool('delete_selected_hologram', {});
    expect(unapprovedDelete.result.ok).toBe(false);
    expect(unapprovedDelete.result.error).toBe('USER_CONFIRMATION_REQUIRED');
    expect(unapprovedDelete.record.status).toBe('PENDING_APPROVAL');

    // Attach host & test verified mutation + approval flow via IntelligenceEngine
    let explodedTo = 0;
    const deletedMock = vi.fn().mockResolvedValue(true);
    const mockHost: WorkspaceToolHost = {
      getContextSnapshot: () => makeSnapshot(),
      selectModel: () => true,
      setRenderMode: () => true,
      setExplosionAmount: (amt) => {
        explodedTo = amt;
        return true;
      },
      disintegrate: () => true,
      reconstruct: () => true,
      rotate360: () => true,
      frameModel: () => true,
      resetCamera: () => true,
      resetTransform: () => true,
      applyFormation: () => true,
      duplicateSelected: () => true,
      deleteSelected: deletedMock,
      selectComponent: () => true,
      isolateComponent: () => true,
      undo: () => true,
      redo: () => true,
      appendNote: () => true,
      exportNotes: async () => true
    };
    reg.setHost(mockHost);

    const execRes = await reg.executeTool('control_hologram_transform', {
      action: 'explode',
      explosionAmount: 0.75
    });
    expect(execRes.result.ok).toBe(true);
    expect(execRes.result.verified).toBe(true);
    expect(explodedTo).toBe(0.75);

    // IntelligenceEngine confirmation gate for delete_selected_hologram
    toolRegistry.setHost(mockHost);
    const engine = new IntelligenceEngine();
    const pendingRes = await engine.processRequest({
      input: 'Delete selected object from workspace',
      snapshot: makeSnapshot()
    });
    expect(pendingRes.status).toBe('AWAITING_APPROVAL');
    expect(pendingRes.pendingApproval?.toolName).toBe('delete_selected_hologram');
    expect(deletedMock).not.toHaveBeenCalled();

    const afterApproval = await engine.resolvePendingToolApproval(true);
    expect(deletedMock).toHaveBeenCalledTimes(1);
    expect(afterApproval?.status).toBe('RESPONDING');
  });

  it('12 & 14. External providers succeed with mocked HTTPS responses and report real errors on failure without fabricating replies', async () => {
    const engine = new IntelligenceEngine();
    const snap = makeSnapshot({ provider: 'GEMINI', hasProviderKey: true, modelName: 'gemini-4-hydrogen' });

    contextualAI.saveConfig({
      provider: 'GEMINI',
      apiKey: 'AIza-volatile-test-key',
      modelName: 'gemini-4-hydrogen'
    });

    const fetchOk = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'Verified titanium honeycomb response.' }] } }]
      })
    });
    vi.stubGlobal('fetch', fetchOk);

    const okRes = await engine.processRequest({
      input: 'What structural ribs would stabilize this turbine?',
      snapshot: snap
    });
    expect(okRes.isExternalModel).toBe(true);
    expect(okRes.reply).toContain('Verified titanium honeycomb');

    // Simulate HTTP 503 failure
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => JSON.stringify({ error: { message: 'Service temporarily overloaded' } })
      })
    );

    const failRes = await engine.processRequest({
      input: 'What alloy tolerance applies at 900K?',
      snapshot: snap
    });
    expect(failRes.isExternalModel).toBe(false);
    expect(failRes.status).toBe('ERROR');
    expect(failRes.reply).toContain('HTTP 503');
    expect(failRes.reply).toContain('No simulated external answer was fabricated');
  });

  it('13. Local voice commands take strict priority over IntelligenceEngine fallback & track command usage', async () => {
    const engine = new IntelligenceEngine();
    let localCommandCount = 0;
    const trackedUsage: string[] = [];

    speechService.registerCommands([
      {
        patterns: ['explode the model'],
        description: 'Explode model',
        category: 'MANIPULATION',
        action: () => {
          localCommandCount++;
          return true;
        },
        feedbackText: 'Exploding model.'
      }
    ]);
    speechService.setCommandExecutedCallback((_cmd, raw) => trackedUsage.push(raw));
    const spyProcess = vi.spyOn(engine, 'processRequest');
    speechService.setUnmatchedTranscriptHandler(async (transcript, source) => {
      const r = await engine.processRequest({ input: transcript, snapshot: makeSnapshot(), source });
      return r.reply;
    });

    speechService.handleTranscript('explode the model', 'VOICE');
    expect(localCommandCount).toBe(1);
    expect(trackedUsage).toEqual(['explode the model']);
    expect(spyProcess).not.toHaveBeenCalled();

    speechService.handleTranscript('Calculate 9 * 9', 'CONSOLE');
    await new Promise((r) => setTimeout(r, 10));
    expect(spyProcess).toHaveBeenCalledTimes(1);
  });

  it('15 & 16. Request cancellation, duplicate concurrent prevention, and IntelligenceStatus transitions work cleanly', async () => {
    const engine = new IntelligenceEngine();
    const observedStatuses: IntelligenceStatus[] = [];
    const unsub = engine.subscribe((s) => observedStatuses.push(s.status));

    contextualAI.saveConfig({
      provider: 'OPENAI',
      apiKey: 'sk-volatile-cancel-test',
      modelName: 'gpt-4o-mini'
    });

    // Hanging fetch respecting AbortSignal
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        });
      })
    );

    const snap = makeSnapshot({ provider: 'OPENAI', hasProviderKey: true });
    const inFlight = engine.processRequest({
      input: 'Analyze orbital containment harmonics',
      snapshot: snap
    });

    // Duplicate concurrent identical request is prevented
    const dupRes = await engine.processRequest({
      input: 'Analyze orbital containment harmonics',
      snapshot: snap
    });
    expect(dupRes.cancelled).toBe(true);
    expect(dupRes.reply).toContain('already in progress');

    // Explicit cancellation aborts in-flight fetch & returns to STANDBY
    expect(engine.cancelActiveRequest()).toBe(true);
    const finalRes = await inFlight;
    expect(finalRes.cancelled).toBe(true);
    expect(observedStatuses).toContain('UNDERSTANDING');
    expect(observedStatuses).toContain('ANALYZING');
    expect(observedStatuses[observedStatuses.length - 1]).toBe('STANDBY');

    unsub();
  });
});
