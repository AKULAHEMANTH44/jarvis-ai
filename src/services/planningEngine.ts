import {
  ExecutionPlan,
  PlanApproach,
  PlanStep,
  WorkspaceContextSnapshot
} from '../types/assistant';
import { toolRegistry } from './toolRegistry';
import { automationEngine } from './automationEngine';

export class PlanningEngine {
  private plans: ExecutionPlan[] = [];
  private listeners: Set<() => void> = new Set();

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((fn) => fn());
  }

  public getPlans(): ExecutionPlan[] {
    return this.plans.map((p) => ({
      ...p,
      constraints: [...p.constraints],
      missingInfo: [...p.missingInfo],
      approaches: p.approaches.map((a) => ({ ...a })),
      steps: p.steps.map((s) => ({
        ...s,
        dependsOn: s.dependsOn ? [...s.dependsOn] : undefined
      }))
    }));
  }

  public getLatestPlan(): ExecutionPlan | null {
    return this.plans.length > 0 ? this.getPlans()[0] : null;
  }

  public getExecutionHistory(): ExecutionPlan[] {
    return this.getPlans().filter((p) =>
      p.status === 'COMPLETED' ||
      p.status === 'PARTIAL' ||
      p.status === 'FAILED' ||
      p.status === 'CANCELLED'
    );
  }

  public createPlanFromRequest(
    objective: string,
    snapshot: WorkspaceContextSnapshot
  ): ExecutionPlan {
    const cleanObjective = objective.trim();
    const lower = cleanObjective.toLowerCase();
    const constraints: string[] = [
      'Browser sandbox permits only registered workspace/documentation/diagnostic tools (no arbitrary shell commands or unrestricted filesystem access).'
    ];
    const missingInfo: string[] = [];
    const approaches: PlanApproach[] = [];
    const steps: PlanStep[] = [];

    const selectedLocked = snapshot.objectsSummary.find((o) => o.id === snapshot.selectedObjectId)?.isLocked;
    if (selectedLocked) {
      constraints.push(`Selected object "${snapshot.selectedObjectName}" is locked against spatial transforms.`);
    }
    if (snapshot.provider !== 'LOCAL' && snapshot.provider !== 'BACKEND' && !snapshot.hasProviderKey) {
      constraints.push(
        `Provider ${snapshot.provider} has no volatile session API key; external LLM synthesis unavailable until key is provided or BACKEND/LOCAL mode is selected.`
      );
    }

    if (/\b(demonstration|demo|present|showcase|prepare my project)\b/i.test(lower)) {
      approaches.push(
        {
          id: 'demo-inspect-first',
          label: 'Audit-First Demo Readiness (Recommended)',
          tradeoff: 'Inspects workspace, checks sensors/network, frames model, and logs verification checklist.',
          recommended: true
        },
        {
          id: 'demo-cinematic-only',
          label: 'Quick Visual Reset Only',
          tradeoff: 'Faster framing & reset, skips sensor/telemetry verification and checklist.',
          recommended: false
        }
      );

      steps.push(
        {
          id: 'step-1',
          title: 'Inspect Active Workspace & Models',
          description: 'Inventory loaded 3D holograms, render mode, and lock/disintegration states.',
          toolName: 'inspect_workspace',
          toolArgs: { includeComponents: true },
          requiresConfirmation: false,
          status: 'PENDING',
          agentRole: 'ANALYSIS'
        },
        {
          id: 'step-2',
          title: 'Verify Hardware & Provider Readiness',
          description: 'Check online connectivity, telemetry, camera/voice status, and active AI provider.',
          toolName: 'network_and_hardware_diagnostics',
          toolArgs: {},
          requiresConfirmation: false,
          dependsOn: ['step-1'],
          maxRetries: 1,
          status: 'PENDING',
          agentRole: 'WORKFLOW'
        },
        {
          id: 'step-3',
          title: snapshot.dispersionAmount >= 0.85 ? 'Reconstruct Dispersed Model' : 'Frame Selected Hologram',
          description:
            snapshot.dispersionAmount >= 0.85
              ? 'Reassemble dispersed specimen back into clean geometry before demo.'
              : 'Adaptively frame the primary holographic model for presentation.',
          toolName: 'control_hologram_transform',
          toolArgs: { action: snapshot.dispersionAmount >= 0.85 ? 'reconstruct' : 'frame_model' },
          requiresConfirmation: true,
          dependsOn: ['step-2'],
          status: 'PENDING',
          agentRole: 'WORKFLOW'
        },
        {
          id: 'step-4',
          title: 'Record Pre-Demo Verification Checklist',
          description: 'Append a verification checklist (tsc, vitest, build, live camera/mic check) to Mission Notes.',
          toolName: 'append_workspace_note',
          toolArgs: {
            text: `[Demo Prep] Verified workspace (${snapshot.objectCount} objects). Manual check reminder: run tsc/vitest/build & test camera/mic.`
          },
          requiresConfirmation: true,
          dependsOn: ['step-1'],
          status: 'PENDING',
          agentRole: 'WORKFLOW'
        }
      );
    } else if (/\b(inspect|analyze|audit|explain).*(model|assembly|component|parts)\b/i.test(lower)) {
      approaches.push(
        {
          id: 'model-full-breakdown',
          label: 'Exploded Radial Component Audit (Recommended)',
          tradeoff: 'Inspects geometry stats, opens exploded assembly view, and frames camera.',
          recommended: true
        },
        {
          id: 'model-readonly',
          label: 'Non-Destructive Telemetry Only',
          tradeoff: 'Reads vertex/face/component metadata without modifying current view.',
          recommended: false
        }
      );

      steps.push(
        {
          id: 'step-1',
          title: 'Inspect Model Geometry & Parts',
          description: 'Read vertex/face counts and component hierarchy from active or imported model.',
          toolName: 'inspect_selected_model',
          toolArgs: { preferImported: lower.includes('import') },
          requiresConfirmation: false,
          maxRetries: 1,
          status: 'PENDING',
          agentRole: 'ANALYSIS'
        },
        {
          id: 'step-2',
          title: 'Engage Exploded Engineering View',
          description: 'Separate structural components radially for clear visual inspection.',
          toolName: 'control_hologram_transform',
          toolArgs: { action: 'explode', explosionAmount: 0.9 },
          requiresConfirmation: true,
          dependsOn: ['step-1'],
          status: 'PENDING',
          agentRole: 'WORKFLOW'
        },
        {
          id: 'step-3',
          title: 'Frame Camera to Assembly',
          description: 'Center and fit camera bounds around the active assembly.',
          toolName: 'control_hologram_transform',
          toolArgs: { action: 'frame_model' },
          requiresConfirmation: false,
          dependsOn: ['step-2'],
          status: 'PENDING',
          agentRole: 'WORKFLOW'
        }
      );
    } else if (/\b(research|investigate|deep dive|code|debug|refactor|review|compare)\b/i.test(lower)) {
      const isCoding = /\b(code|debug|refactor|review|test|typescript|vitest)\b/i.test(lower);
      approaches.push(
        {
          id: 'grounded-agent-pipeline',
          label: `${isCoding ? 'Coding & Verification' : 'Research & Synthesis'} Pipeline (Recommended)`,
          tradeoff: 'Inspects context, retrieves session memory, and checks runtime telemetry before synthesis.',
          recommended: true
        },
        {
          id: 'memory-only-check',
          label: 'Session Context Recall Only',
          tradeoff: 'Faster read-only recall of prior notes and approved memories without external lookups.',
          recommended: false
        }
      );

      steps.push(
        {
          id: 'step-1',
          title: 'Retrieve Relevant Session Context & Memory',
          description: 'Pull approved memories and recent turns linked to the current objective.',
          toolName: 'retrieve_context_and_memory',
          toolArgs: { query: cleanObjective },
          requiresConfirmation: false,
          maxRetries: 1,
          status: 'PENDING',
          agentRole: isCoding ? 'CODING' : 'RESEARCH'
        },
        {
          id: 'step-2',
          title: 'Gather Workspace & Component Telemetry',
          description: 'Read current workspace models, render state, and active constraints.',
          toolName: 'inspect_workspace',
          toolArgs: { includeComponents: true },
          requiresConfirmation: false,
          dependsOn: ['step-1'],
          status: 'PENDING',
          agentRole: 'ANALYSIS'
        },
        {
          id: 'step-3',
          title: 'Check Provider & Runtime Diagnostics',
          description: 'Confirm provider health and runtime readiness for grounded synthesis.',
          toolName: 'network_and_hardware_diagnostics',
          toolArgs: {},
          requiresConfirmation: false,
          dependsOn: ['step-1'],
          status: 'PENDING',
          agentRole: 'WORKFLOW'
        }
      );
    } else {
      // Generic multi-step workflow plan
      approaches.push(
        {
          id: 'structured-tool-plan',
          label: 'Context Inspection + Validated Action (Recommended)',
          tradeoff: 'Verifies current workspace and memory context before mutating state.',
          recommended: true
        },
        {
          id: 'advisory-only',
          label: 'Read-Only Advisory',
          tradeoff: 'Reports current state and requirements without mutating workspace.',
          recommended: false
        }
      );

      steps.push(
        {
          id: 'step-1',
          title: 'Gather Workspace & Context Snapshot',
          description: 'Inspect active holographic state and approved session/memory context.',
          toolName: 'inspect_workspace',
          toolArgs: { includeComponents: true },
          requiresConfirmation: false,
          maxRetries: 1,
          status: 'PENDING',
          agentRole: 'ANALYSIS'
        },
        {
          id: 'step-2',
          title: 'Retrieve Relevant Session Context & Memory',
          description: 'Fetch approved memories and conversation history related to this objective.',
          toolName: 'retrieve_context_and_memory',
          toolArgs: { query: cleanObjective },
          requiresConfirmation: false,
          dependsOn: ['step-1'],
          status: 'PENDING',
          agentRole: 'RESEARCH'
        }
      );

      if (/\b(explode|disassemble)\b/i.test(lower)) {
        steps.push({
          id: 'step-3',
          title: 'Explode Selected Model',
          description: 'Apply exploded assembly separation.',
          toolName: 'control_hologram_transform',
          toolArgs: { action: 'explode', explosionAmount: 1.0 },
          requiresConfirmation: true,
          dependsOn: ['step-1'],
          status: 'PENDING',
          agentRole: 'WORKFLOW'
        });
      }
      if (/\b(reconstruct|reassemble)\b/i.test(lower)) {
        steps.push({
          id: `step-${steps.length + 1}`,
          title: 'Reconstruct Selected Model',
          description: 'Reassemble particles to exact original geometry.',
          toolName: 'control_hologram_transform',
          toolArgs: { action: 'reconstruct' },
          requiresConfirmation: true,
          dependsOn: ['step-1'],
          status: 'PENDING',
          agentRole: 'WORKFLOW'
        });
      }
      if (/\b(export|save note)\b/i.test(lower)) {
        steps.push({
          id: `step-${steps.length + 1}`,
          title: 'Export Authorized Notes',
          description: 'Prompt native save dialog for mission notes export.',
          toolName: 'export_workspace_notes',
          toolArgs: {},
          requiresConfirmation: true,
          dependsOn: ['step-2'],
          status: 'PENDING',
          agentRole: 'WORKFLOW'
        });
      }
      if (/\b(diagnostic|health|check)\b/i.test(lower)) {
        steps.push({
          id: `step-${steps.length + 1}`,
          title: 'Run Network & Hardware Diagnostics',
          description: 'Verify browser connectivity and provider status.',
          toolName: 'network_and_hardware_diagnostics',
          toolArgs: {},
          requiresConfirmation: false,
          dependsOn: ['step-1'],
          status: 'PENDING',
          agentRole: 'WORKFLOW'
        });
      }

      if (cleanObjective.split(/\s+/).length < 3) {
        missingInfo.push('Objective is brief; specify target model, layout, or export output if needed.');
      }
    }

    const requiresApproval = steps.some((s) => s.requiresConfirmation);
    const plan: ExecutionPlan = {
      id: `plan-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 5)}`,
      objective: cleanObjective,
      constraints,
      missingInfo,
      approaches,
      steps,
      status: requiresApproval ? 'AWAITING_APPROVAL' : 'DRAFT',
      requiresApproval,
      createdAt: Date.now()
    };

    this.plans.unshift(plan);
    if (this.plans.length > 12) {
      this.plans = this.plans.slice(0, 12);
    }
    this.notify();
    return this.getPlans().find((p) => p.id === plan.id)!;
  }

  public async executePlan(
    planId: string,
    options: { approved?: boolean; signal?: AbortSignal } = {}
  ): Promise<ExecutionPlan> {
    const plan = this.plans.find((p) => p.id === planId);
    if (!plan) {
      throw new Error(`Execution plan "${planId}" not found.`);
    }

    if (plan.requiresApproval && !options.approved) {
      plan.status = 'AWAITING_APPROVAL';
      this.notify();
      return this.getPlans().find((p) => p.id === plan.id)!;
    }

    plan.status = 'EXECUTING';
    this.notify();

    let completedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      if (options.signal?.aborted) {
        step.status = 'SKIPPED';
        step.verificationNote = 'Skipped due to user cancellation.';
        for (let j = i + 1; j < plan.steps.length; j++) {
          plan.steps[j].status = 'SKIPPED';
          plan.steps[j].verificationNote = 'Skipped due to cancellation.';
        }
        plan.status = 'CANCELLED';
        plan.completedAt = Date.now();
        this.notify();
        return this.getPlans().find((p) => p.id === plan.id)!;
      }

      // Enforce prerequisite step dependency graph
      if (step.dependsOn && step.dependsOn.length > 0) {
        const failedDeps = step.dependsOn.filter((depId) => {
          const dep = plan.steps.find((s) => s.id === depId);
          return dep && (dep.status === 'FAILED' || dep.status === 'SKIPPED');
        });
        if (failedDeps.length > 0) {
          step.status = 'SKIPPED';
          step.verificationNote = `Skipped: prerequisite step(s) incomplete (${failedDeps.join(', ')}).`;
          this.notify();
          continue;
        }
      }

      if (!step.toolName) {
        step.status = 'SKIPPED';
        step.verificationNote = 'Manual verification step; requires user execution.';
        continue;
      }

      step.status = 'RUNNING';
      step.retryCount = 0;
      this.notify();

      const toolDef = toolRegistry.getTool(step.toolName);
      const maxRetries = !toolDef?.requiresConfirmation
        ? Math.min(2, Math.max(0, step.maxRetries ?? 1))
        : 0;

      let attempt = 0;
      let execOutcome = await toolRegistry.executeTool(step.toolName, step.toolArgs || {}, {
        approvedByUser: Boolean(options.approved)
      });

      while (
        !(execOutcome.result.ok && execOutcome.result.verified) &&
        attempt < maxRetries &&
        !options.signal?.aborted &&
        execOutcome.result.error !== 'USER_CONFIRMATION_REQUIRED' &&
        execOutcome.record.status !== 'DENIED'
      ) {
        attempt++;
        step.retryCount = attempt;
        this.notify();
        execOutcome = await toolRegistry.executeTool(step.toolName, step.toolArgs || {}, {
          approvedByUser: Boolean(options.approved)
        });
      }

      const { result } = execOutcome;
      if (result.ok && result.verified) {
        step.status = 'COMPLETED';
        const retrySuffix = attempt > 0 ? ` [Recovered after ${attempt} retry]` : '';
        step.verificationNote = `${result.summary} (${result.verificationDetail || 'Verified'})${retrySuffix}`;
        completedCount++;
      } else {
        step.status = 'FAILED';
        step.error = result.error || result.summary;
        step.verificationNote = `Not completed: ${result.summary}`;
        failedCount++;
      }
      this.notify();
    }

    plan.completedAt = Date.now();
    if (failedCount === 0 && completedCount === plan.steps.length) {
      plan.status = 'COMPLETED';
    } else if (completedCount > 0) {
      plan.status = 'PARTIAL';
    } else {
      plan.status = 'FAILED';
    }
    this.notify();

    return this.getPlans().find((p) => p.id === plan.id)!;
  }

  public cancelPlan(planId: string): boolean {
    const plan = this.plans.find((p) => p.id === planId);
    if (!plan) return false;
    plan.status = 'CANCELLED';
    plan.steps.forEach((s) => {
      if (s.status === 'PENDING' || s.status === 'RUNNING') {
        s.status = 'SKIPPED';
        s.verificationNote = 'Cancelled by user.';
      }
    });
    plan.completedAt = Date.now();
    this.notify();
    return true;
  }

  public sendPlanToTaskQueue(planId: string): boolean {
    const plan = this.plans.find((p) => p.id === planId);
    if (!plan) return false;

    const toolSteps = plan.steps
      .filter((s) => Boolean(s.toolName))
      .map((s) => ({
        description: s.title,
        action: async () => {
          if (s.toolName) {
            await toolRegistry.executeTool(s.toolName, s.toolArgs || {}, {
              approvedByUser: true
            });
          }
        }
      }));

    if (toolSteps.length === 0) return false;

    automationEngine.createTask(
      `AI Plan: ${plan.objective.slice(0, 42)}`,
      plan.objective,
      toolSteps,
      plan.requiresApproval ? ['PLAN_EXECUTION_APPROVAL'] : []
    );
    return true;
  }

  public summarizePlanOutcome(plan: ExecutionPlan): string {
    const completed = plan.steps.filter((s) => s.status === 'COMPLETED').map((s) => s.title);
    const incomplete = plan.steps
      .filter((s) => s.status !== 'COMPLETED')
      .map((s) => `${s.title} (${s.status}${s.error ? `: ${s.error}` : ''})`);

    const parts: string[] = [`Plan [${plan.status}] for "${plan.objective}".`];
    if (completed.length > 0) {
      parts.push(`Verified completed (${completed.length}): ${completed.join('; ')}.`);
    }
    if (incomplete.length > 0) {
      parts.push(`Incomplete/Pending (${incomplete.length}): ${incomplete.join('; ')}.`);
    }
    return parts.join(' ');
  }

  public clearPlans() {
    this.plans = [];
    this.notify();
  }
}

export const planningEngine = new PlanningEngine();
