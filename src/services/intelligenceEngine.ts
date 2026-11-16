import {
  AIProviderConfig,
  AISuggestion,
  ExecutionPlan,
  IntelligenceRequestResult,
  IntelligenceStatus,
  IntentCategory,
  IntentClassification,
  PendingToolApproval,
  ToolActivityRecord,
  WorkspaceContextSnapshot
} from '../types/assistant';
import { contextualAI } from './contextualAI';
import { conversationManager, FollowUpResolution } from './conversationManager';
import { memoryManager } from './memoryManager';
import { planningEngine } from './planningEngine';
import { suggestionEngine } from './suggestionEngine';
import { toolRegistry } from './toolRegistry';

export interface IntelligenceStateSnapshot {
  status: IntelligenceStatus;
  activitySummary: string;
  activeRequestId: string | null;
  lastError: string | null;
  lastProviderUsed: AIProviderConfig['provider'];
  lastResult: IntelligenceRequestResult | null;
  pendingApproval: PendingToolApproval | null;
  latestPlan: ExecutionPlan | null;
  activeSuggestions: AISuggestion[];
}

export class IntelligenceEngine {
  private status: IntelligenceStatus = 'STANDBY';
  private activitySummary: string = 'Intelligence Brain standing by.';
  private activeAbortController: AbortController | null = null;
  private activeRequestId: string | null = null;
  private activeRequestFingerprint: string | null = null;
  private lastError: string | null = null;
  private lastResult: IntelligenceRequestResult | null = null;
  private pendingApproval: PendingToolApproval | null = null;
  private listeners: Set<(snapshot: IntelligenceStateSnapshot) => void> = new Set();

  public subscribe(listener: (snapshot: IntelligenceStateSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  public getSnapshot(): IntelligenceStateSnapshot {
    const cfg = contextualAI.getConfig();
    return {
      status: this.status,
      activitySummary: this.activitySummary,
      activeRequestId: this.activeRequestId,
      lastError: this.lastError,
      lastProviderUsed: cfg.provider,
      lastResult: this.lastResult,
      pendingApproval: this.pendingApproval ? { ...this.pendingApproval } : null,
      latestPlan: planningEngine.getLatestPlan(),
      activeSuggestions: suggestionEngine.getActiveSuggestions()
    };
  }

  private setStatus(status: IntelligenceStatus, activitySummary: string) {
    this.status = status;
    this.activitySummary = activitySummary;
    this.emit();
  }

  private emit() {
    const snap = this.getSnapshot();
    this.listeners.forEach((fn) => fn(snap));
  }

  public setListeningState(listening: boolean) {
    if (this.activeRequestId) return;
    if (listening) {
      this.setStatus('LISTENING', 'Microphone active; awaiting spoken or typed request.');
    } else if (this.status === 'LISTENING') {
      this.setStatus('STANDBY', 'Intelligence Brain standing by.');
    }
  }

  public cancelActiveRequest(): boolean {
    if (!this.activeAbortController) return false;
    this.activeAbortController.abort();
    this.activeAbortController = null;
    this.activeRequestId = null;
    this.activeRequestFingerprint = null;
    this.setStatus('STANDBY', 'Active AI request cancelled by user.');
    return true;
  }

  public classifyIntent(
    rawInput: string,
    snapshot: WorkspaceContextSnapshot,
    followUp: FollowUpResolution
  ): IntentClassification {
    const text = rawInput.trim();
    const lower = text.toLowerCase();
    const missingInformation: string[] = [];

    // 1. Calculation detection
    const mathCandidate = this.extractMathExpression(text);
    if (mathCandidate) {
      return {
        category: 'CALCULATION',
        confidence: 0.94,
        summary: `Evaluate mathematical expression: ${mathCandidate}`,
        requiresTool: true,
        requiresPlan: false,
        missingInformation,
        resolvedReferences: followUp.resolvedReferences
      };
    }

    // 2. Multi-step planning detection
    if (
      /\b(prepare my project|prepare.*demo|demonstration|multi[- ]step|workflow|create a plan|plan how|step[- ]by[- ]step|full audit)\b/i.test(
        lower
      )
    ) {
      return {
        category: 'MULTI_STEP_PLAN',
        confidence: 0.92,
        summary: `Decompose complex objective into verified steps: "${text.slice(0, 60)}"`,
        requiresTool: true,
        requiresPlan: true,
        missingInformation,
        resolvedReferences: followUp.resolvedReferences
      };
    }

    // 3. Clarification needed on ambiguous component isolation/selection
    if (/\b(isolate component|select component|highlight part)\b/i.test(lower)) {
      const selected = snapshot.objectsSummary.find((o) => o.id === snapshot.selectedObjectId);
      const hasComps = (selected?.components?.length || 0) > 0;
      const matchesExistingComp = selected?.components?.some((c) =>
        lower.includes(c.name.toLowerCase()) || lower.includes(c.id.toLowerCase())
      );
      if (!matchesExistingComp) {
        missingInformation.push(
          hasComps
            ? `Specify which component to target (${selected!.components!.map((c) => c.name).slice(0, 5).join(', ')}).`
            : 'Current object does not expose named sub-components.'
        );
        return {
          category: 'CLARIFICATION_NEEDED',
          confidence: 0.88,
          summary: 'Missing target component identifier.',
          requiresTool: true,
          requiresPlan: false,
          missingInformation,
          resolvedReferences: followUp.resolvedReferences
        };
      }
    }

    // 4. Diagnostics (network/hardware/provider)
    if (
      /\b(network diagnostics|provider status|hardware telemetry|connectivity|check api|ai status)\b/i.test(
        lower
      )
    ) {
      return {
        category: 'DIAGNOSTICS',
        confidence: 0.9,
        summary: 'Run local hardware, network, and AI provider diagnostics.',
        requiresTool: true,
        requiresPlan: false,
        missingInformation,
        resolvedReferences: followUp.resolvedReferences
      };
    }

    // 5. Documentation & help
    if (
      /\b(what\s+(?:\w+\s+)?formats|supported\s+(?:files|formats)|formats\s+are\s+supported|shortcuts|how do i|documentation|what gestures|what can you do|help me use)\b/i.test(
        lower
      )
    ) {
      return {
        category: 'DOCUMENTATION',
        confidence: 0.89,
        summary: 'Retrieve documented capabilities and control reference.',
        requiresTool: true,
        requiresPlan: false,
        missingInformation,
        resolvedReferences: followUp.resolvedReferences
      };
    }

    // 6. Workspace or Model inspection
    if (
      /\b(inspect|explain|describe|analyze|how many vertices|what model|imported model|components|current workspace|what is loaded)\b/i.test(
        lower
      )
    ) {
      return {
        category: 'OBJECT_INSPECTION',
        confidence: 0.9,
        summary: 'Inspect workspace or selected/imported 3D model state.',
        requiresTool: true,
        requiresPlan: false,
        missingInformation,
        resolvedReferences: followUp.resolvedReferences
      };
    }

    // 7. Memory queries / clearing
    if (
      /\b(what do you remember|show memory|saved memories|clear memory|forget everything)\b/i.test(
        lower
      )
    ) {
      return {
        category: 'MEMORY_MANAGEMENT',
        confidence: 0.9,
        summary: 'Inspect or manage user-controlled persistent memory.',
        requiresTool: true,
        requiresPlan: false,
        missingInformation,
        resolvedReferences: followUp.resolvedReferences
      };
    }

    // 8. Controlled Workspace Action (consequential or natural-language mutation)
    if (
      /\b(delete|remove object|de-materialize|export note|save notes|duplicate|clone|wireframe|point cloud|solid holo|hybrid mode)\b/i.test(
        lower
      )
    ) {
      return {
        category: 'WORKSPACE_ACTION',
        confidence: 0.88,
        summary: 'Execute controlled workspace tool action with verification.',
        requiresTool: true,
        requiresPlan: false,
        missingInformation,
        resolvedReferences: followUp.resolvedReferences
      };
    }

    return {
      category: 'CONVERSATIONAL_QA',
      confidence: 0.8,
      summary: followUp.isFollowUp
        ? `Contextual follow-up (${followUp.inferredSubject || 'active topic'})`
        : 'Conversational engineering or general assistant query.',
      requiresTool: false,
      requiresPlan: false,
      missingInformation,
      resolvedReferences: followUp.resolvedReferences
    };
  }

  private extractMathExpression(input: string): string | null {
    const trimmed = input.trim();
    const explicit = trimmed.match(/^(?:calculate|compute|evaluate|math|what is)\s+(.+)$/i);
    const candidate = (explicit ? explicit[1] : trimmed).replace(/\?$/, '').trim();
    if (/^[0-9+\-*/^%().,\s]+$|^(?:sqrt|sin|cos|tan|log|ln|abs|round|floor|ceil|min|max|pi|e|[0-9+\-*/^%().,\s])+$/i.test(candidate)) {
      if (/[+\-*/^%]|\b(?:sqrt|sin|cos|tan|log|ln|abs)\b/i.test(candidate) && /\d/.test(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  public async processRequest(params: {
    input: string;
    snapshot: WorkspaceContextSnapshot;
    source?: 'VOICE' | 'CONSOLE';
  }): Promise<IntelligenceRequestResult> {
    const rawInput = params.input.trim();
    const source = params.source || 'CONSOLE';
    const cfg = contextualAI.getConfig();

    if (!rawInput) {
      return {
        id: `req-${Date.now()}`,
        input: '',
        reply: 'No request text supplied.',
        status: 'ERROR',
        classification: {
          category: 'CLARIFICATION_NEEDED',
          confidence: 1,
          summary: 'Empty input.',
          requiresTool: false,
          requiresPlan: false,
          missingInformation: ['Provide a spoken or typed request.'],
          resolvedReferences: []
        },
        providerUsed: cfg.provider,
        isExternalModel: false,
        toolRecords: [],
        activitySummary: 'Empty input ignored.',
        error: 'Empty input.'
      };
    }

    const fingerprint = rawInput.toLowerCase();
    if (this.activeRequestId && this.activeRequestFingerprint === fingerprint) {
      return {
        id: this.activeRequestId,
        input: rawInput,
        reply: 'A matching request is already in progress.',
        status: this.status,
        classification: {
          category: 'CONVERSATIONAL_QA',
          confidence: 1,
          summary: 'Duplicate concurrent request prevented.',
          requiresTool: false,
          requiresPlan: false,
          missingInformation: [],
          resolvedReferences: []
        },
        providerUsed: cfg.provider,
        isExternalModel: false,
        toolRecords: [],
        activitySummary: 'Prevented duplicate concurrent request.',
        cancelled: true
      };
    }

    // Cancel any previous superseded in-flight request cleanly
    if (this.activeAbortController) {
      this.activeAbortController.abort();
    }

    const controller = new AbortController();
    const reqId = `req-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 5)}`;
    this.activeAbortController = controller;
    this.activeRequestId = reqId;
    this.activeRequestFingerprint = fingerprint;
    this.lastError = null;

    const toolRecords: ToolActivityRecord[] = [];

    try {
      this.setStatus('UNDERSTANDING', `Understanding request: "${rawInput.slice(0, 48)}"`);

      const followUp = conversationManager.resolveFollowUp(rawInput, params.snapshot);
      const classification = this.classifyIntent(rawInput, params.snapshot, followUp);

      conversationManager.addTurn({
        role: 'user',
        text: rawInput,
        intent: classification.category,
        resolvedSubject: followUp.inferredSubject,
        source
      });

      // Check consent-gated memory candidate without silently saving secrets
      const memoryCandidate = memoryManager.detectConsentCandidate(rawInput) || undefined;

      this.setStatus('ANALYZING', classification.summary);

      // 1. Clarification Needed
      if (classification.category === 'CLARIFICATION_NEEDED') {
        const reply = `I need a quick clarification before proceeding: ${classification.missingInformation.join(' ')}`;
        conversationManager.addTurn({ role: 'assistant', text: reply, intent: classification.category });
        return this.finishResult({
          id: reqId,
          input: rawInput,
          reply,
          status: 'RESPONDING',
          classification,
          providerUsed: 'LOCAL',
          isExternalModel: false,
          toolRecords,
          memoryCandidate,
          snapshot: params.snapshot
        });
      }

      // 2. Multi-Step Plan
      if (classification.category === 'MULTI_STEP_PLAN') {
        this.setStatus('PLANNING', `Constructing structured execution plan for "${rawInput.slice(0, 40)}"`);
        const plan = planningEngine.createPlanFromRequest(rawInput, params.snapshot);
        if (plan.requiresApproval) {
          const reply =
            `Plan prepared for "${plan.objective}" (${plan.steps.length} steps). ` +
            `Recommended approach: ${plan.approaches[0]?.label || 'Structured Plan'}. ` +
            `Explicit approval is required in the Plan panel before executing workspace-modifying steps.`;
          conversationManager.addTurn({
            role: 'assistant',
            text: reply,
            intent: 'MULTI_STEP_PLAN'
          });
          this.setStatus('AWAITING_APPROVAL', `Awaiting approval for plan: ${plan.objective}`);
          return this.finishResult({
            id: reqId,
            input: rawInput,
            reply,
            status: 'AWAITING_APPROVAL',
            classification,
            providerUsed: cfg.provider,
            isExternalModel: false,
            toolRecords,
            plan,
            memoryCandidate,
            snapshot: params.snapshot,
            preserveStatus: true
          });
        }

        const executedPlan = await planningEngine.executePlan(plan.id, {
          approved: true,
          signal: controller.signal
        });
        const reply = planningEngine.summarizePlanOutcome(executedPlan);
        conversationManager.addTurn({
          role: 'assistant',
          text: reply,
          intent: 'MULTI_STEP_PLAN'
        });
        return this.finishResult({
          id: reqId,
          input: rawInput,
          reply,
          status: 'RESPONDING',
          classification,
          providerUsed: 'LOCAL',
          isExternalModel: false,
          toolRecords,
          plan: executedPlan,
          memoryCandidate,
          snapshot: params.snapshot
        });
      }

      // 3. Execute grounded Read-Only or Controlled Tools based on intent
      let groundedToolSummary = '';

      if (classification.category === 'CALCULATION') {
        this.setStatus('EXECUTING', 'Evaluating mathematical expression safely.');
        const expr = this.extractMathExpression(rawInput)!;
        const { result, record } = await toolRegistry.executeTool('calculate_math', { expression: expr });
        toolRecords.push(record);
        this.setStatus('VERIFYING', 'Verifying arithmetic result.');
        const reply = result.ok
          ? `Calculation verified: ${result.summary}.`
          : `Unable to compute "${expr}": ${result.error}`;
        conversationManager.addTurn({
          role: 'assistant',
          text: reply,
          intent: 'CALCULATION',
          toolNames: ['calculate_math']
        });
        return this.finishResult({
          id: reqId,
          input: rawInput,
          reply,
          status: result.ok ? 'RESPONDING' : 'ERROR',
          classification,
          providerUsed: 'LOCAL',
          isExternalModel: false,
          toolRecords,
          memoryCandidate,
          snapshot: params.snapshot,
          error: result.ok ? undefined : result.error
        });
      }

      if (classification.category === 'DIAGNOSTICS') {
        this.setStatus('EXECUTING', 'Running network, hardware, and provider diagnostics.');
        const { result, record } = await toolRegistry.executeTool(
          'network_and_hardware_diagnostics',
          {},
          { snapshot: params.snapshot }
        );
        toolRecords.push(record);
        this.setStatus('VERIFYING', 'Verifying telemetry report.');
        conversationManager.addTurn({
          role: 'assistant',
          text: result.summary,
          intent: 'DIAGNOSTICS',
          toolNames: ['network_and_hardware_diagnostics']
        });
        return this.finishResult({
          id: reqId,
          input: rawInput,
          reply: result.summary,
          status: 'RESPONDING',
          classification,
          providerUsed: 'LOCAL',
          isExternalModel: false,
          toolRecords,
          memoryCandidate,
          snapshot: params.snapshot
        });
      }

      if (classification.category === 'DOCUMENTATION') {
        this.setStatus('EXECUTING', 'Searching built-in JARVIS documentation.');
        const { result, record } = await toolRegistry.executeTool('lookup_documentation', { topic: rawInput });
        toolRecords.push(record);
        groundedToolSummary = result.summary;
      }

      if (classification.category === 'OBJECT_INSPECTION') {
        this.setStatus('EXECUTING', 'Inspecting active workspace and 3D model geometry.');
        const lower = rawInput.toLowerCase();
        const preferImported =
          lower.includes('import') ||
          lower.includes('uploaded') ||
          params.snapshot.objectsSummary.some((o) => o.modelId === 'reconstructed_object');

        const toolName = lower.includes('workspace') && !lower.includes('model')
          ? 'inspect_workspace'
          : 'inspect_selected_model';
        const { result, record } = await toolRegistry.executeTool(
          toolName,
          toolName === 'inspect_workspace' ? { includeComponents: true } : { preferImported },
          { snapshot: params.snapshot }
        );
        toolRecords.push(record);
        groundedToolSummary = result.summary;
      }

      if (classification.category === 'MEMORY_MANAGEMENT') {
        const lower = rawInput.toLowerCase();
        if (lower.includes('clear memory') || lower.includes('forget everything')) {
          const pending: PendingToolApproval = {
            id: `apr-${Date.now().toString(36)}`,
            toolName: 'clear_persistent_memory',
            args: {},
            reason: 'Clearing all saved persistent user memories cannot be undone.',
            permissionLevel: 'CONSEQUENTIAL'
          };
          this.pendingApproval = pending;
          const reply = 'Explicit confirmation required before clearing all persistent memories.';
          conversationManager.addTurn({ role: 'assistant', text: reply, intent: 'MEMORY_MANAGEMENT' });
          this.setStatus('AWAITING_APPROVAL', 'Awaiting confirmation to clear persistent memory.');
          return this.finishResult({
            id: reqId,
            input: rawInput,
            reply,
            status: 'AWAITING_APPROVAL',
            classification,
            providerUsed: 'LOCAL',
            isExternalModel: false,
            toolRecords,
            pendingApproval: pending,
            memoryCandidate,
            snapshot: params.snapshot,
            preserveStatus: true
          });
        }

        const { result, record } = await toolRegistry.executeTool('retrieve_context_and_memory', {
          query: rawInput
        });
        toolRecords.push(record);
        const memories = memoryManager.getMemories();
        const reply =
          memories.length === 0
            ? 'No persistent memories are currently stored (you can add or approve memories in the Memory tab).'
            : `Stored user-approved memories (${memories.length}): ${memories
                .slice(0, 5)
                .map((m) => `[${m.category}] ${m.key}: ${m.value}`)
                .join('; ')}.`;
        conversationManager.addTurn({
          role: 'assistant',
          text: reply,
          intent: 'MEMORY_MANAGEMENT',
          toolNames: ['retrieve_context_and_memory']
        });
        return this.finishResult({
          id: reqId,
          input: rawInput,
          reply,
          status: 'RESPONDING',
          classification,
          providerUsed: 'LOCAL',
          isExternalModel: false,
          toolRecords,
          memoryCandidate,
          snapshot: params.snapshot
        });
      }

      if (classification.category === 'WORKSPACE_ACTION') {
        const mapped = this.mapWorkspaceToolAction(rawInput);
        if (mapped) {
          const toolDef = toolRegistry.getTool(mapped.toolName);
          if (toolDef?.requiresConfirmation) {
            const pending: PendingToolApproval = {
              id: `apr-${Date.now().toString(36)}`,
              toolName: mapped.toolName,
              args: mapped.args,
              reason: `Consequential tool "${mapped.toolName}" requires your explicit confirmation.`,
              permissionLevel: toolDef.permissionLevel
            };
            this.pendingApproval = pending;
            const reply = `Confirmation required before executing "${mapped.toolName}". Use the approval prompt in the Intelligence HUD.`;
            conversationManager.addTurn({ role: 'assistant', text: reply, intent: 'WORKSPACE_ACTION' });
            this.setStatus('AWAITING_APPROVAL', `Awaiting user approval for ${mapped.toolName}`);
            return this.finishResult({
              id: reqId,
              input: rawInput,
              reply,
              status: 'AWAITING_APPROVAL',
              classification,
              providerUsed: 'LOCAL',
              isExternalModel: false,
              toolRecords,
              pendingApproval: pending,
              memoryCandidate,
              snapshot: params.snapshot,
              preserveStatus: true
            });
          }

          this.setStatus('EXECUTING', `Executing tool ${mapped.toolName}...`);
          const { result, record } = await toolRegistry.executeTool(mapped.toolName, mapped.args, {
            approvedByUser: true
          });
          toolRecords.push(record);
          this.setStatus('VERIFYING', `Verifying ${mapped.toolName} result...`);
          const reply = result.ok
            ? `${result.summary} (Verified)`
            : `Action could not be completed: ${result.summary}`;
          conversationManager.addTurn({
            role: 'assistant',
            text: reply,
            intent: 'WORKSPACE_ACTION',
            toolNames: [mapped.toolName]
          });
          return this.finishResult({
            id: reqId,
            input: rawInput,
            reply,
            status: result.ok ? 'RESPONDING' : 'ERROR',
            classification,
            providerUsed: 'LOCAL',
            isExternalModel: false,
            toolRecords,
            memoryCandidate,
            snapshot: params.snapshot,
            error: result.ok ? undefined : result.error
          });
        }
      }

      // 4. External AI Provider Reasoning (when configured with session key) or Grounded LOCAL Reasoning
      if (cfg.provider !== 'LOCAL' && contextualAI.hasApiKey()) {
        this.setStatus('ANALYZING', `Querying ${cfg.provider} (${cfg.modelName}) with session context...`);
        const systemPrompt = this.buildSystemPrompt(params.snapshot, rawInput, groundedToolSummary);
        const messages = conversationManager.buildModelMessages(systemPrompt, 12);

        const extRes = await contextualAI.queryStructuredCompletion({
          messages,
          signal: controller.signal,
          timeoutMs: 18000
        });

        if (extRes.aborted || controller.signal.aborted) {
          return this.finishResult({
            id: reqId,
            input: rawInput,
            reply: 'Request cancelled.',
            status: 'STANDBY',
            classification,
            providerUsed: cfg.provider,
            isExternalModel: false,
            toolRecords,
            memoryCandidate,
            snapshot: params.snapshot,
            cancelled: true
          });
        }

        if (extRes.ok && extRes.text) {
          this.setStatus('VERIFYING', 'Validating external model response against verified context.');
          conversationManager.addTurn({
            role: 'assistant',
            text: extRes.text,
            intent: classification.category,
            toolNames: toolRecords.map((r) => r.toolName)
          });
          return this.finishResult({
            id: reqId,
            input: rawInput,
            reply: extRes.text,
            status: 'RESPONDING',
            classification,
            providerUsed: cfg.provider,
            isExternalModel: true,
            toolRecords,
            memoryCandidate,
            snapshot: params.snapshot
          });
        }

        // External call failed -> honestly report provider failure + provide grounded local context if available
        const failureMsg = extRes.error || `${cfg.provider} request failed.`;
        this.lastError = failureMsg;
        const honestFallback = groundedToolSummary
          ? `${failureMsg} Grounded local inspection report: ${groundedToolSummary}`
          : `${failureMsg} (No simulated external answer was fabricated. Switch to LOCAL mode or verify your session key/network.)`;

        conversationManager.addTurn({
          role: 'assistant',
          text: honestFallback,
          intent: classification.category,
          toolNames: toolRecords.map((r) => r.toolName)
        });
        this.setStatus('ERROR', failureMsg);
        return this.finishResult({
          id: reqId,
          input: rawInput,
          reply: honestFallback,
          status: 'ERROR',
          classification,
          providerUsed: cfg.provider,
          isExternalModel: false,
          toolRecords,
          memoryCandidate,
          snapshot: params.snapshot,
          error: failureMsg,
          preserveStatus: true
        });
      }

      // 5. LOCAL Mode Grounded Response (no external key configured)
      this.setStatus('VERIFYING', 'Synthesizing grounded LOCAL intelligence response.');
      const localReply = this.buildGroundedLocalReply({
        rawInput,
        followUp,
        classification,
        snapshot: params.snapshot,
        groundedToolSummary
      });

      conversationManager.addTurn({
        role: 'assistant',
        text: localReply,
        intent: classification.category,
        toolNames: toolRecords.map((r) => r.toolName)
      });

      return this.finishResult({
        id: reqId,
        input: rawInput,
        reply: localReply,
        status: 'RESPONDING',
        classification,
        providerUsed: 'LOCAL',
        isExternalModel: false,
        toolRecords,
        memoryCandidate,
        snapshot: params.snapshot
      });
    } finally {
      if (this.activeRequestId === reqId) {
        this.activeAbortController = null;
        this.activeRequestId = null;
        this.activeRequestFingerprint = null;
      }
    }
  }

  public async resolvePendingToolApproval(approved: boolean): Promise<IntelligenceRequestResult | null> {
    const pending = this.pendingApproval;
    if (!pending) return null;
    this.pendingApproval = null;

    if (!approved) {
      const reply = `Cancelled consequential action "${pending.toolName}" per user decision.`;
      conversationManager.addTurn({ role: 'assistant', text: reply, intent: 'WORKSPACE_ACTION' });
      this.setStatus('STANDBY', reply);
      return this.lastResult;
    }

    this.setStatus('EXECUTING', `Executing approved tool "${pending.toolName}"...`);
    const { result, record } = await toolRegistry.executeTool(pending.toolName, pending.args, {
      approvedByUser: true
    });
    this.setStatus('VERIFYING', `Verified outcome for ${pending.toolName}.`);
    const reply = result.ok ? result.summary : `Tool "${pending.toolName}" did not complete: ${result.summary}`;
    conversationManager.addTurn({
      role: 'assistant',
      text: reply,
      intent: 'WORKSPACE_ACTION',
      toolNames: [pending.toolName]
    });

    const updated: IntelligenceRequestResult = {
      id: `apr-res-${Date.now().toString(36)}`,
      input: pending.toolName,
      reply,
      status: result.ok ? 'RESPONDING' : 'ERROR',
      classification: {
        category: 'WORKSPACE_ACTION',
        confidence: 1,
        summary: `Resolved approval for ${pending.toolName}`,
        requiresTool: true,
        requiresPlan: false,
        missingInformation: [],
        resolvedReferences: []
      },
      providerUsed: contextualAI.getConfig().provider,
      isExternalModel: false,
      toolRecords: [record],
      activitySummary: reply,
      error: result.ok ? undefined : result.error
    };
    this.lastResult = updated;
    this.setStatus(result.ok ? 'STANDBY' : 'ERROR', reply);
    return updated;
  }

  public async approveAndExecutePlan(planId: string): Promise<ExecutionPlan> {
    this.setStatus('EXECUTING', `Executing approved multi-step plan (${planId})...`);
    const controller = new AbortController();
    this.activeAbortController = controller;
    try {
      const plan = await planningEngine.executePlan(planId, {
        approved: true,
        signal: controller.signal
      });
      this.setStatus('VERIFYING', 'Verifying executed plan step outcomes...');
      const summary = planningEngine.summarizePlanOutcome(plan);
      conversationManager.addTurn({ role: 'assistant', text: summary, intent: 'MULTI_STEP_PLAN' });
      this.setStatus(plan.status === 'FAILED' ? 'ERROR' : 'STANDBY', summary);
      return plan;
    } finally {
      this.activeAbortController = null;
      this.emit();
    }
  }

  public refreshSuggestions(snapshot: WorkspaceContextSnapshot) {
    const active = suggestionEngine.evaluateContext({
      snapshot,
      recentTurns: conversationManager.getRecentTurns(6),
      status: this.status
    });
    if (active.length > 0 && this.status === 'STANDBY') {
      this.emit();
    }
  }

  private mapWorkspaceToolAction(
    rawInput: string
  ): { toolName: string; args: Record<string, unknown> } | null {
    const lower = rawInput.toLowerCase();
    if (/\b(delete|remove object|de-materialize)\b/i.test(lower)) {
      return { toolName: 'delete_selected_hologram', args: {} };
    }
    if (/\b(export note|save notes)\b/i.test(lower)) {
      return { toolName: 'export_workspace_notes', args: {} };
    }
    if (/\b(duplicate|clone)\b/i.test(lower)) {
      return { toolName: 'control_hologram_transform', args: { action: 'duplicate_selected' } };
    }
    if (/\bwireframe\b/i.test(lower)) {
      return { toolName: 'control_hologram_transform', args: { action: 'set_render_mode', renderMode: 'WIREFRAME' } };
    }
    if (/\bpoint cloud\b/i.test(lower)) {
      return { toolName: 'control_hologram_transform', args: { action: 'set_render_mode', renderMode: 'POINT_CLOUD' } };
    }
    if (/\bsolid\b/i.test(lower)) {
      return { toolName: 'control_hologram_transform', args: { action: 'set_render_mode', renderMode: 'SOLID_HOLO' } };
    }
    if (/\bhybrid\b/i.test(lower)) {
      return { toolName: 'control_hologram_transform', args: { action: 'set_render_mode', renderMode: 'HYBRID' } };
    }
    return null;
  }

  private buildSystemPrompt(
    snapshot: WorkspaceContextSnapshot,
    userInput: string,
    groundedToolSummary: string
  ): string {
    const approvedMemory = memoryManager.formatMemoryContext(userInput);
    const sessionSummary = conversationManager.summarizeSession();

    return [
      'You are J.A.R.V.I.S., a technical spatial intelligence assistant inside an interactive 3D holographic laboratory.',
      'Be concise, direct, and grounded strictly in verified facts. Never claim to be conscious or sentient, and never claim a tool or action ran unless verified in the context below.',
      `Current Workspace Snapshot: Mode=${snapshot.mode}, Objects=${snapshot.objectCount}, Selected="${snapshot.selectedObjectName}" (${snapshot.selectedModelId}), RenderMode=${snapshot.renderMode}, Explosion=${Math.round(snapshot.explosionAmount * 100)}%, Dispersion=${Math.round(snapshot.dispersionAmount * 100)}%, Camera=${snapshot.isCameraActive ? 'ON' : 'OFF'}, Voice=${snapshot.isVoiceActive ? 'ON' : 'OFF'}.`,
      `Approved User Memories:\n${approvedMemory}`,
      sessionSummary ? `Current Session Summary: ${sessionSummary.summaryText}` : '',
      groundedToolSummary ? `Verified Tool Output (this turn): ${groundedToolSummary}` : ''
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private buildGroundedLocalReply(params: {
    rawInput: string;
    followUp: FollowUpResolution;
    classification: IntentClassification;
    snapshot: WorkspaceContextSnapshot;
    groundedToolSummary: string;
  }): string {
    const { rawInput, followUp, classification, snapshot, groundedToolSummary } = params;
    const cfg = contextualAI.getConfig();

    if (groundedToolSummary) {
      return groundedToolSummary;
    }

    // Handle multi-turn follow-up coherently in LOCAL mode (e.g., "The voice system." after "I am building a JARVIS assistant.")
    if (followUp.isFollowUp && followUp.inferredSubject) {
      const memories = memoryManager.getRelevantMemories(followUp.inferredSubject, 2);
      const memSuffix =
        memories.length > 0 ? ` Relevant saved context: ${memories.map((m) => `${m.key}: ${m.value}`).join('; ')}.` : '';
      return `Understood — continuing within context "${followUp.inferredSubject}". Regarding ${rawInput.replace(/[.?]+$/, '')}, we can inspect related workspace modules, design a multi-step plan, or verify existing controls.${memSuffix}`;
    }

    // Project kickoff / clarifying prompt (e.g. "I am building a JARVIS assistant.")
    if (/\b(i am building|we are building|working on|developing)\b/i.test(rawInput)) {
      const subj = followUp.inferredSubject || 'your system';
      return `Understood — tracking active focus on ${subj} for this session. Which subsystem or task would you like to inspect, plan, or verify next?`;
    }

    // Local deterministic intent parser for command/courtesy phrases
    const localIntent = contextualAI.parseLocalIntent(rawInput, snapshot.selectedObjectName);
    if (localIntent.intent !== 'GENERAL_CHAT') {
      return localIntent.reply;
    }

    const providerNote =
      cfg.provider === 'LOCAL'
        ? 'Currently operating in offline LOCAL mode.'
        : `Provider ${cfg.provider} has no volatile session API key configured, so LOCAL grounding is active.`;

    return `Received regarding "${snapshot.selectedObjectName}" (${classification.summary}). ${providerNote} Try workspace inspection ("inspect workspace"), math ("calculate 48 * 12"), documentation ("what formats are supported"), or open-ended reasoning once a provider key is supplied.`;
  }

  private finishResult(params: {
    id: string;
    input: string;
    reply: string;
    status: IntelligenceStatus;
    classification: IntentClassification;
    providerUsed: AIProviderConfig['provider'];
    isExternalModel: boolean;
    toolRecords: ToolActivityRecord[];
    plan?: ExecutionPlan;
    pendingApproval?: PendingToolApproval;
    memoryCandidate?: IntelligenceRequestResult['memoryCandidate'];
    snapshot: WorkspaceContextSnapshot;
    cancelled?: boolean;
    error?: string;
    preserveStatus?: boolean;
  }): IntelligenceRequestResult {
    const activeSuggestions = suggestionEngine.evaluateContext({
      snapshot: params.snapshot,
      recentTurns: conversationManager.getRecentTurns(6),
      status: params.status
    });

    const summary = params.error
      ? params.error
      : params.toolRecords.length > 0
      ? `Verified ${params.toolRecords.map((r) => r.toolName).join(', ')}.`
      : params.classification.summary;

    const result: IntelligenceRequestResult = {
      id: params.id,
      input: params.input,
      reply: params.reply,
      status: params.status,
      classification: params.classification,
      providerUsed: params.providerUsed,
      isExternalModel: params.isExternalModel,
      toolRecords: params.toolRecords,
      plan: params.plan,
      pendingApproval: params.pendingApproval,
      memoryCandidate: params.memoryCandidate,
      activitySummary: summary,
      cancelled: params.cancelled,
      error: params.error
    };

    this.lastResult = result;
    if (!params.preserveStatus) {
      const nextStatus: IntelligenceStatus =
        activeSuggestions.length > 0 && params.status === 'RESPONDING' ? 'SUGGESTING' : 'STANDBY';
      this.setStatus(nextStatus, summary);
    } else {
      this.emit();
    }
    return result;
  }
}

export const intelligenceEngine = new IntelligenceEngine();
