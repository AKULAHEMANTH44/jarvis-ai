import { DevCommandTool, DevPlanStep, DevTaskPlan } from '../types/assistant';
import { devStudioService } from './devStudioService';

export interface DevPlanRunOptions {
  targetRelativePath?: string;
  generationPrompt?: string;
  testTool?: DevCommandTool;
  testArgs?: string[];
  /**
   * Optional explicit permission IDs granted by user for consequential steps.
   * Never forged automatically — if absent when reaching a requiresApproval step, the plan pauses in AWAITING_APPROVAL.
   */
  patchPermissionId?: string;
  commandPermissionId?: string;
}

export class DevPlannerService {
  private activePlan: DevTaskPlan | null = null;
  private history: DevTaskPlan[] = [];
  private listeners: Set<() => void> = new Set();
  private cancelledPlanIds: Set<string> = new Set();

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((fn) => fn());
  }

  public getActivePlan(): DevTaskPlan | null {
    return this.activePlan
      ? {
          ...this.activePlan,
          steps: this.activePlan.steps.map((s) => ({ ...s })),
          proposedPatchIds: [...this.activePlan.proposedPatchIds]
        }
      : null;
  }

  public getHistory(): DevTaskPlan[] {
    return this.history.map((p) => ({
      ...p,
      steps: p.steps.map((s) => ({ ...s })),
      proposedPatchIds: [...p.proposedPatchIds]
    }));
  }

  private computeProgress(steps: DevPlanStep[]): number {
    if (steps.length === 0) return 0;
    const finished = steps.filter(
      (s) => s.status === 'COMPLETED' || s.status === 'SKIPPED'
    ).length;
    return Math.round((finished / steps.length) * 100);
  }

  public createPlan(params: {
    projectPath: string;
    objective: string;
    includePatchStep?: boolean;
    includeTestStep?: boolean;
  }): DevTaskPlan {
    const cleanProject = params.projectPath.trim();
    const cleanObjective = params.objective.trim() || 'Inspect and improve project module';
    const includePatch = params.includePatchStep !== false;
    const includeTest = params.includeTestStep !== false;

    const steps: DevPlanStep[] = [
      {
        id: 'step-inspect',
        title: 'Inspect Project Workspace',
        description: `Scan structure, languages, frameworks, and config in "${cleanProject}".`,
        kind: 'INSPECT',
        requiresApproval: false,
        status: 'PENDING'
      },
      {
        id: 'step-analyze',
        title: 'Analyze Dependencies & Modules',
        description: 'Map entry points, imports, and bounded context excluding secret files.',
        kind: 'ANALYZE',
        dependsOn: ['step-inspect'],
        requiresApproval: false,
        status: 'PENDING'
      }
    ];

    if (includePatch) {
      steps.push(
        {
          id: 'step-propose',
          title: 'Generate Code & Diff Preview',
          description: `Prepare proposed diff for "${cleanObjective}".`,
          kind: 'PROPOSE_PATCH',
          dependsOn: ['step-analyze'],
          requiresApproval: false,
          status: 'PENDING'
        },
        {
          id: 'step-apply',
          title: 'Apply Approved Patch',
          description: 'Write reviewed changes with backup snapshot (requires CODE_PATCH approval).',
          kind: 'APPLY_PATCH',
          dependsOn: ['step-propose'],
          requiresApproval: true,
          status: 'PENDING'
        }
      );
    }

    if (includeTest) {
      steps.push({
        id: 'step-test',
        title: 'Run Approved Verification Tests',
        description: 'Execute allowlisted test suite in approved cwd (requires DEV_COMMAND approval).',
        kind: 'RUN_TESTS',
        dependsOn: includePatch ? ['step-apply'] : ['step-analyze'],
        requiresApproval: true,
        status: 'PENDING'
      });
    }

    steps.push({
      id: 'step-verify',
      title: 'Verify Outcomes & Report',
      description: 'Summarize verified changes and real command/test outputs.',
      kind: 'VERIFY',
      dependsOn: includeTest
        ? ['step-test']
        : includePatch
        ? ['step-apply']
        : ['step-analyze'],
      requiresApproval: false,
      status: 'PENDING'
    });

    const plan: DevTaskPlan = {
      id: `devplan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      objective: cleanObjective,
      projectPath: cleanProject,
      status: 'DRAFT',
      progressPercent: 0,
      steps,
      proposedPatchIds: [],
      createdAt: Date.now()
    };

    this.activePlan = plan;
    this.notify();
    return this.getActivePlan()!;
  }

  public cancelPlan(planId?: string): boolean {
    if (!this.activePlan) return false;
    if (planId && this.activePlan.id !== planId) return false;
    if (this.activePlan.status === 'COMPLETED' || this.activePlan.status === 'FAILED') {
      return false;
    }

    this.cancelledPlanIds.add(this.activePlan.id);
    this.activePlan.status = 'CANCELLED';
    for (const s of this.activePlan.steps) {
      if (s.status === 'PENDING' || s.status === 'RUNNING' || s.status === 'AWAITING_APPROVAL') {
        s.status = 'CANCELLED';
      }
    }
    this.activePlan.completedAt = Date.now();
    this.activePlan.verificationSummary = 'Plan cancelled by user.';
    this.archiveIfDone();
    this.notify();
    return true;
  }

  private archiveIfDone() {
    if (!this.activePlan) return;
    if (
      this.activePlan.status === 'COMPLETED' ||
      this.activePlan.status === 'FAILED' ||
      this.activePlan.status === 'CANCELLED'
    ) {
      const exists = this.history.some((h) => h.id === this.activePlan!.id);
      if (!exists) {
        this.history.unshift({
          ...this.activePlan,
          steps: this.activePlan.steps.map((s) => ({ ...s })),
          proposedPatchIds: [...this.activePlan.proposedPatchIds]
        });
        if (this.history.length > 25) {
          this.history = this.history.slice(0, 25);
        }
      }
    }
  }

  public async executePlan(planId: string, options: DevPlanRunOptions = {}): Promise<DevTaskPlan> {
    if (!this.activePlan || this.activePlan.id !== planId) {
      throw new Error(`Development plan "${planId}" not found.`);
    }

    const plan = this.activePlan;
    if (this.cancelledPlanIds.has(plan.id) || plan.status === 'CANCELLED') {
      return this.getActivePlan()!;
    }

    plan.status = 'RUNNING';
    this.notify();

    for (const step of plan.steps) {
      if (this.cancelledPlanIds.has(plan.id) || (plan.status as DevTaskPlan['status']) === 'CANCELLED') {
        step.status = 'CANCELLED';
        continue;
      }

      if (step.status === 'COMPLETED') {
        continue;
      }

      // Enforce declared step dependencies
      if (step.dependsOn && step.dependsOn.length > 0) {
        const failedDep = step.dependsOn.find((depId) => {
          const dep = plan.steps.find((s) => s.id === depId);
          return !dep || dep.status === 'FAILED' || dep.status === 'CANCELLED';
        });
        if (failedDep) {
          step.status = 'SKIPPED';
          step.error = `Skipped because dependency "${failedDep}" did not complete.`;
          continue;
        }
      }

      // Never bypass explicit permission on APPLY_PATCH or RUN_TESTS
      if (step.requiresApproval) {
        if (step.kind === 'APPLY_PATCH' && !options.patchPermissionId) {
          step.status = 'AWAITING_APPROVAL';
          plan.status = 'AWAITING_APPROVAL';
          plan.progressPercent = this.computeProgress(plan.steps);
          this.notify();
          return this.getActivePlan()!;
        }
        if (step.kind === 'RUN_TESTS' && !options.commandPermissionId) {
          step.status = 'AWAITING_APPROVAL';
          plan.status = 'AWAITING_APPROVAL';
          plan.progressPercent = this.computeProgress(plan.steps);
          this.notify();
          return this.getActivePlan()!;
        }
      }

      step.status = 'RUNNING';
      this.notify();

      try {
        if (step.kind === 'INSPECT') {
          const report = await devStudioService.inspectProject(plan.projectPath);
          if (!report.ok) {
            throw new Error(report.error || 'Project inspection failed.');
          }
          step.status = 'COMPLETED';
          step.outputSummary = `Scanned ${report.totalFilesScanned} file(s) across ${report.languages.map((l) => l.language).join(', ') || 'workspace'}.`;
        } else if (step.kind === 'ANALYZE') {
          const ctx = await devStudioService.buildSelectiveAIContext({
            projectPath: plan.projectPath,
            focusFiles: options.targetRelativePath ? [options.targetRelativePath] : undefined
          });
          step.status = 'COMPLETED';
          step.outputSummary = `Indexed ${ctx.includedFiles.length} file(s) (${ctx.totalChars} chars); excluded ${ctx.skippedSensitiveFiles.length} secret file(s).`;
        } else if (step.kind === 'PROPOSE_PATCH') {
          const gen = await devStudioService.generateCodeProposal({
            projectPath: plan.projectPath,
            prompt: options.generationPrompt || plan.objective,
            targetRelativePath: options.targetRelativePath
          });
          if (!gen.ok || !gen.patch) {
            throw new Error(gen.error || 'Code generation failed.');
          }
          plan.proposedPatchIds.push(gen.patch.id);
          step.status = 'COMPLETED';
          step.outputSummary = `Prepared diff preview for "${gen.patch.relativePath}" (+${gen.patch.preview.addedLines}/-${gen.patch.preview.removedLines}).`;
        } else if (step.kind === 'APPLY_PATCH') {
          const patchId = plan.proposedPatchIds[0];
          if (!patchId) {
            throw new Error('No proposed patch available to apply.');
          }
          const applied = await devStudioService.applyProposedPatch(
            patchId,
            options.patchPermissionId!,
            false
          );
          if (!applied.ok) {
            throw new Error(applied.error || 'Patch application rejected or failed.');
          }
          step.status = 'COMPLETED';
          step.outputSummary = `Applied approved patch to "${applied.patch?.relativePath}" with backup.`;
        } else if (step.kind === 'RUN_TESTS') {
          const tool = options.testTool || 'npm';
          const args = options.testArgs || ['test'];
          const cmdRes = await devStudioService.runApprovedCommand({
            projectPath: plan.projectPath,
            tool,
            args,
            permissionId: options.commandPermissionId!
          });
          if (!cmdRes.ok) {
            throw new Error(cmdRes.error || `Tests exited with code ${cmdRes.exitCode}.`);
          }
          step.status = 'COMPLETED';
          step.outputSummary = cmdRes.testReport?.summary || `Executed "${cmdRes.commandDisplay}" in ${cmdRes.durationMs} ms.`;
        } else if (step.kind === 'VERIFY') {
          const completedCount = plan.steps.filter((s) => s.status === 'COMPLETED').length;
          step.status = 'COMPLETED';
          step.outputSummary = `Verified ${completedCount} completed plan step(s) for "${plan.objective}".`;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        step.status = 'FAILED';
        step.error = msg;
        plan.status = 'FAILED';
        plan.completedAt = Date.now();
        plan.verificationSummary = `Plan halted at "${step.title}": ${msg}`;
        plan.progressPercent = this.computeProgress(plan.steps);
        this.archiveIfDone();
        this.notify();
        return this.getActivePlan()!;
      }

      plan.progressPercent = this.computeProgress(plan.steps);
      this.notify();
    }

    if (this.cancelledPlanIds.has(plan.id) || (plan.status as DevTaskPlan['status']) === 'CANCELLED') {
      plan.status = 'CANCELLED';
    } else {
      plan.status = 'COMPLETED';
      plan.completedAt = Date.now();
      plan.progressPercent = 100;
      plan.verificationSummary = `Completed all ${plan.steps.length} steps for "${plan.objective}".`;
    }

    this.archiveIfDone();
    this.notify();
    return this.getActivePlan()!;
  }
}

export const devPlannerService = new DevPlannerService();
