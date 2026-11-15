import { AutomationTask, AutomationStatus, AutomationStep } from '../types/assistant';
import { audioService } from './soundFx';

export type TaskListener = (tasks: AutomationTask[]) => void;

class AutomationEngine {
  private tasks: AutomationTask[] = [];
  private listeners: Set<TaskListener> = new Set();
  private isProcessing: boolean = false;

  public subscribe(listener: TaskListener): () => void {
    this.listeners.add(listener);
    listener([...this.tasks]);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach(fn => fn([...this.tasks]));
  }

  public getTasks(): AutomationTask[] {
    return [...this.tasks];
  }

  public createTask(
    title: string,
    intent: string,
    stepDescriptions: { description: string; action: () => Promise<void> | void }[],
    requiredPermissions: string[] = []
  ): AutomationTask {
    const id = `task-${Math.random().toString(36).substring(2, 7)}`;
    const steps: AutomationStep[] = stepDescriptions.map((s, idx) => ({
      id: `${id}-step-${idx + 1}`,
      description: s.description,
      status: 'PENDING',
      action: s.action
    }));

    const task: AutomationTask = {
      id,
      title,
      intent,
      steps,
      currentStepIndex: 0,
      status: requiredPermissions.length > 0 ? 'WAITING_CONFIRMATION' : 'QUEUED',
      requiredPermissions,
      progressPercent: 0,
      createdAt: Date.now()
    };

    this.tasks.unshift(task);
    this.notify();

    if (task.status === 'QUEUED') {
      this.processQueue();
    }
    return task;
  }

  public confirmTask(id: string) {
    const task = this.tasks.find(t => t.id === id);
    if (task && task.status === 'WAITING_CONFIRMATION') {
      task.status = 'QUEUED';
      this.notify();
      this.processQueue();
    }
  }

  public cancelTask(id: string) {
    const task = this.tasks.find(t => t.id === id);
    if (task) {
      task.status = 'CANCELLED';
      this.notify();
    }
  }

  public clearCompleted() {
    this.tasks = this.tasks.filter(t => t.status === 'RUNNING' || t.status === 'QUEUED' || t.status === 'WAITING_CONFIRMATION');
    this.notify();
  }

  private async processQueue() {
    if (this.isProcessing) return;
    const nextTask = this.tasks.find(t => t.status === 'QUEUED');
    if (!nextTask) return;

    this.isProcessing = true;
    nextTask.status = 'RUNNING';
    audioService.playChirp(1400);
    this.notify();

    try {
      for (let i = 0; i < nextTask.steps.length; i++) {
        nextTask.currentStepIndex = i;
        const step = nextTask.steps[i];
        step.status = 'EXECUTING';
        nextTask.progressPercent = Math.round((i / nextTask.steps.length) * 100);
        this.notify();

        // Brief delay for cinematic realism
        await new Promise(r => setTimeout(r, 650));
        await step.action();

        step.status = 'DONE';
        nextTask.progressPercent = Math.round(((i + 1) / nextTask.steps.length) * 100);
        this.notify();
      }

      nextTask.status = 'COMPLETED';
      nextTask.result = 'All task sequence steps executed successfully.';
      audioService.playActivationWhoosh();
    } catch (err: unknown) {
      nextTask.status = 'FAILED';
      nextTask.error = err instanceof Error ? err.message : 'Unknown execution failure';
      audioService.playChirp(600);
    } finally {
      this.isProcessing = false;
      this.notify();
      this.processQueue();
    }
  }
}

export const automationEngine = new AutomationEngine();
