import {
  AIProviderConfig,
  AgentRole,
  AgentRunSnapshot,
  ExecutionPlan,
  PendingAttachment,
  WorkspaceContextSnapshot
} from '../types/assistant';
import { contextualAI } from './contextualAI';
import { conversationManager } from './conversationManager';
import { memoryManager } from './memoryManager';
import { planningEngine } from './planningEngine';

export interface AgentExecutionResult {
  ok: boolean;
  run: AgentRunSnapshot;
  reply: string;
  providerUsed: AIProviderConfig['provider'];
  isExternalModel: boolean;
  streamed: boolean;
  fallbackUsed: boolean;
  plan?: ExecutionPlan;
  aborted?: boolean;
  error?: string;
}

export interface AgentOrchestratorState {
  activeRun: AgentRunSnapshot | null;
  history: AgentRunSnapshot[];
}

function buildAttachmentContextSummary(attachments?: PendingAttachment[]): string {
  if (!attachments || attachments.length === 0) return '';
  return attachments
    .map((att, idx) => {
      if (att.kind === 'TEXT' && att.textContent) {
        const lineCount = att.textContent.split('\n').length;
        return `Attachment #${idx + 1}: "${att.name}" (${att.mimeType}, ${att.sizeFormatted}, ${lineCount} lines)\n<excerpt>\n${att.textContent.slice(0, 6000)}\n</excerpt>`;
      }
      if (att.kind === 'PDF') {
        return `Attachment #${idx + 1}: PDF "${att.name}" (${att.sizeFormatted})${att.textContent ? `\nExtracted text snippet:\n${att.textContent.slice(0, 4000)}` : ' [No extractable text stream found locally]'}`;
      }
      return `Attachment #${idx + 1}: Image "${att.name}" (${att.mimeType}, ${att.sizeFormatted})`;
    })
    .join('\n\n');
}

function analyzeAttachedCodeLocally(attachments?: PendingAttachment[]): string[] {
  const findings: string[] = [];
  if (!attachments) return findings;
  for (const att of attachments) {
    if (att.kind === 'TEXT' && att.textContent) {
      const lines = att.textContent.split('\n');
      const todoCount = lines.filter((l) => /\b(TODO|FIXME|HACK)\b/.test(l)).length;
      const consoleCount = lines.filter((l) => /\bconsole\.(log|debug|info)\b/.test(l)).length;
      const anyCount = (att.textContent.match(/:\s*any\b/g) || []).length;
      findings.push(
        `Scanned "${att.name}" (${lines.length} lines): ${todoCount} TODO/FIXME marker(s), ${consoleCount} console log statement(s), ${anyCount} explicit \`any\` type annotations.`
      );
    }
  }
  return findings;
}

export class AgentOrchestrator {
  private activeRun: AgentRunSnapshot | null = null;
  private history: AgentRunSnapshot[] = [];
  private listeners: Set<() => void> = new Set();

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((fn) => fn());
  }

  public getSnapshot(): AgentOrchestratorState {
    return {
      activeRun: this.activeRun ? { ...this.activeRun } : null,
      history: this.history.map((h) => ({ ...h }))
    };
  }

  private startRun(role: AgentRole, title: string, objective: string): AgentRunSnapshot {
    const run: AgentRunSnapshot = {
      id: `agent-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 5)}`,
      role,
      title,
      objective: objective.trim(),
      status: 'RUNNING',
      progressPercent: 15,
      currentStep: 'Initializing context and constraints...',
      startedAt: Date.now(),
      findings: [],
      uncertaintyNotes: []
    };
    this.activeRun = run;
    this.notify();
    return run;
  }

  private updateRun(patch: Partial<AgentRunSnapshot>) {
    if (!this.activeRun) return;
    this.activeRun = {
      ...this.activeRun,
      ...patch
    };
    this.notify();
  }

  private finishRun(status: AgentRunSnapshot['status'], extra: Partial<AgentRunSnapshot> = {}): AgentRunSnapshot {
    if (!this.activeRun) {
      const empty: AgentRunSnapshot = {
        id: `agent-none`,
        role: 'ANALYSIS',
        title: 'Agent Run',
        objective: '',
        status,
        progressPercent: 100,
        currentStep: status,
        startedAt: Date.now(),
        completedAt: Date.now(),
        ...extra
      };
      return empty;
    }
    const finalized: AgentRunSnapshot = {
      ...this.activeRun,
      ...extra,
      status,
      completedAt: Date.now(),
      progressPercent: status === 'COMPLETED' ? 100 : this.activeRun.progressPercent
    };
    this.activeRun = null;
    this.history.unshift(finalized);
    if (this.history.length > 15) {
      this.history = this.history.slice(0, 15);
    }
    this.notify();
    return { ...finalized };
  }

  public cancelActiveRun(): boolean {
    if (!this.activeRun || this.activeRun.status !== 'RUNNING') return false;
    this.finishRun('CANCELLED', {
      currentStep: 'Cancelled by user.',
      error: 'Execution cancelled before completion.'
    });
    return true;
  }

  public async runResearchAgent(params: {
    query: string;
    snapshot: WorkspaceContextSnapshot;
    attachments?: PendingAttachment[];
    signal?: AbortSignal;
    onChunk?: (delta: string, accumulated: string) => void;
  }): Promise<AgentExecutionResult> {
    const { query, snapshot, attachments, signal, onChunk } = params;
    this.startRun('RESEARCH', 'Research & Synthesis Agent', query);

    try {
      if (signal?.aborted) {
        const cancelledRun = this.finishRun('CANCELLED', { currentStep: 'Cancelled prior to execution.' });
        return {
          ok: false,
          run: cancelledRun,
          reply: 'Research agent run cancelled, sir.',
          providerUsed: snapshot.provider,
          isExternalModel: false,
          streamed: false,
          fallbackUsed: false,
          aborted: true
        };
      }

      this.updateRun({
        progressPercent: 35,
        currentStep: 'Gathering session memory and approved context...'
      });

      const relevantMemories = memoryManager.getRelevantMemories(query, 5);
      const sessionSummary = conversationManager.summarizeSession();
      const findings: string[] = [];
      const uncertaintyNotes: string[] = [
        'Live web search was not executed automatically because external browser/search actions require explicit WEB_SEARCH approval.'
      ];

      if (relevantMemories.length > 0) {
        findings.push(
          `Matched ${relevantMemories.length} approved memory entry(s): ${relevantMemories.map((m) => `${m.key}=${m.value}`).join('; ')}.`
        );
      }
      if (sessionSummary) {
        findings.push(`Session focus: ${sessionSummary.topic} (${sessionSummary.turnCount} turns).`);
      }

      const attachmentSummary = buildAttachmentContextSummary(attachments);
      if (attachments && attachments.length > 0) {
        findings.push(`Included ${attachments.length} user-provided attachment(s): ${attachments.map((a) => a.name).join(', ')}.`);
      }

      const canUseExternal =
        snapshot.provider === 'BACKEND' ||
        ((snapshot.provider === 'GEMINI' || snapshot.provider === 'GROQ') && !contextualAI.hasApiKey()) ||
        (snapshot.provider !== 'LOCAL' && contextualAI.hasApiKey());

      if (canUseExternal && snapshot.provider !== 'LOCAL') {
        this.updateRun({
          progressPercent: 65,
          currentStep: 'Streaming structured research synthesis...',
          findings,
          uncertaintyNotes
        });

        const systemPrompt = [
          'You are JARVIS Research Agent. Provide concise, structured findings, key trade-offs, and explicit uncertainty notes.',
          'Never invent web search results, file contents, or tool outputs you were not given.',
          `Verified Memory: ${relevantMemories.map((m) => `${m.key}=${m.value}`).join('; ') || 'None'}`,
          `Session Summary: ${sessionSummary?.summaryText || 'Fresh session'}`,
          `Uncertainty Notice: ${uncertaintyNotes.join(' ')}`
        ].join('\n');

        const userPrompt = attachmentSummary
          ? `${query}\n\nProvided Attachments:\n${attachmentSummary}`
          : query;

        const aiRes = await contextualAI.queryStreamingCompletion({
          messages: [
            ...conversationManager.buildModelMessages(systemPrompt, 8),
            { role: 'user', content: userPrompt }
          ],
          attachments,
          signal,
          onChunk: (delta, acc) => onChunk?.(delta, acc)
        });

        if (aiRes.aborted) {
          const abortedRun = this.finishRun('CANCELLED', { currentStep: 'Cancelled by user during synthesis.' });
          return {
            ok: false,
            run: abortedRun,
            reply: 'Research agent synthesis cancelled by user, sir.',
            providerUsed: aiRes.provider,
            isExternalModel: false,
            streamed: aiRes.streamed,
            fallbackUsed: Boolean(aiRes.fallbackTriggered),
            aborted: true
          };
        }

        if (aiRes.ok && aiRes.text) {
          const finalReply = `${aiRes.text}\n\nNote: ${uncertaintyNotes[0]} Say "Search web for ${query.slice(0, 60)}" if you would like an approved web lookup.`;
          const doneRun = this.finishRun('COMPLETED', {
            currentStep: 'Research synthesis complete.',
            findings: [...findings, `Synthesized via ${aiRes.provider}${aiRes.model ? ` (${aiRes.model})` : ''}.`],
            uncertaintyNotes
          });
          return {
            ok: true,
            run: doneRun,
            reply: finalReply,
            providerUsed: aiRes.provider,
            isExternalModel: true,
            streamed: aiRes.streamed,
            fallbackUsed: Boolean(aiRes.fallbackTriggered)
          };
        }

        uncertaintyNotes.push(`External AI unavailable: ${aiRes.error || 'Provider error'}.`);
      } else {
        uncertaintyNotes.push('Provider is set to LOCAL mode; external neural synthesis was skipped.');
      }

      const localReplyParts = [
        `Research Agent Brief for "${query}":`,
        findings.length > 0 ? `Context Findings:\n• ${findings.join('\n• ')}` : 'Context Findings: No prior saved memories matched this topic yet.',
        `Limitations & Verification:\n• ${uncertaintyNotes.join('\n• ')}`,
        `Recommended Next Action: Run "Search web for ${query.replace(/^research\s+/i, '').slice(0, 60)}" for an approved live web query.`
      ];

      const doneRun = this.finishRun('COMPLETED', {
        currentStep: 'Grounded local research brief compiled.',
        findings,
        uncertaintyNotes
      });

      return {
        ok: true,
        run: doneRun,
        reply: localReplyParts.join('\n\n'),
        providerUsed: 'LOCAL',
        isExternalModel: false,
        streamed: false,
        fallbackUsed: false
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Research agent encountered an unexpected error.';
      const failedRun = this.finishRun('FAILED', { currentStep: 'Failed.', error: msg });
      return {
        ok: false,
        run: failedRun,
        reply: `Research agent failed: ${msg}`,
        providerUsed: snapshot.provider,
        isExternalModel: false,
        streamed: false,
        fallbackUsed: false,
        error: msg
      };
    }
  }

  public async runCodingAgent(params: {
    prompt: string;
    snapshot: WorkspaceContextSnapshot;
    attachments?: PendingAttachment[];
    signal?: AbortSignal;
    onChunk?: (delta: string, accumulated: string) => void;
  }): Promise<AgentExecutionResult> {
    const { prompt, snapshot, attachments, signal, onChunk } = params;
    this.startRun('CODING', 'Coding & Verification Agent', prompt);

    try {
      this.updateRun({
        progressPercent: 30,
        currentStep: 'Inspecting attached code artifacts and workspace telemetry...'
      });

      const localFindings = analyzeAttachedCodeLocally(attachments);
      const findings = [
        ...localFindings,
        `Active workspace mode: ${snapshot.mode}, selected object: ${snapshot.selectedObjectName} (${snapshot.objectCount} total).`
      ];
      const uncertaintyNotes: string[] = [
        'Repository files not explicitly attached by the user are not read directly by this browser agent without approved file selection.'
      ];

      const attachmentSummary = buildAttachmentContextSummary(attachments);
      const canUseExternal =
        snapshot.provider === 'BACKEND' ||
        ((snapshot.provider === 'GEMINI' || snapshot.provider === 'GROQ') && !contextualAI.hasApiKey()) ||
        (snapshot.provider !== 'LOCAL' && contextualAI.hasApiKey());

      if (canUseExternal && snapshot.provider !== 'LOCAL') {
        this.updateRun({
          progressPercent: 65,
          currentStep: 'Streaming engineering analysis & verification steps...',
          findings,
          uncertaintyNotes
        });

        const systemPrompt = [
          'You are JARVIS Coding Agent, assisting with TypeScript, React, Three.js, Node/Express, and Vitest debugging.',
          'Provide concrete diagnostics, minimal safe diffs, and exact verification commands (`npx tsc --noEmit`, `npx vitest run`, `npm run build`).',
          'Never invent file contents or test results that were not observed.',
          `Local Static Scan: ${localFindings.join(' ') || 'No text code files attached.'}`
        ].join('\n');

        const userPrompt = attachmentSummary
          ? `${prompt}\n\nAttached Code / Files:\n${attachmentSummary}`
          : prompt;

        const aiRes = await contextualAI.queryStreamingCompletion({
          messages: [
            ...conversationManager.buildModelMessages(systemPrompt, 8),
            { role: 'user', content: userPrompt }
          ],
          attachments,
          signal,
          onChunk: (delta, acc) => onChunk?.(delta, acc)
        });

        if (aiRes.aborted) {
          const abortedRun = this.finishRun('CANCELLED', { currentStep: 'Cancelled by user.' });
          return {
            ok: false,
            run: abortedRun,
            reply: 'Coding agent request cancelled, sir.',
            providerUsed: aiRes.provider,
            isExternalModel: false,
            streamed: aiRes.streamed,
            fallbackUsed: Boolean(aiRes.fallbackTriggered),
            aborted: true
          };
        }

        if (aiRes.ok && aiRes.text) {
          const doneRun = this.finishRun('COMPLETED', {
            currentStep: 'Coding assistance completed.',
            findings,
            uncertaintyNotes
          });
          return {
            ok: true,
            run: doneRun,
            reply: aiRes.text,
            providerUsed: aiRes.provider,
            isExternalModel: true,
            streamed: aiRes.streamed,
            fallbackUsed: Boolean(aiRes.fallbackTriggered)
          };
        }

        uncertaintyNotes.push(`External LLM call unavailable: ${aiRes.error || 'Provider error'}.`);
      }

      const localReply = [
        `Coding Agent Diagnostics for "${prompt}":`,
        `Observations:\n• ${findings.join('\n• ')}`,
        `Recommended Verification Sequence:\n1. Type-check: npx tsc --noEmit\n2. Unit/Integration tests: npx vitest run\n3. Production bundle: npm run build`,
        `Notice: ${uncertaintyNotes.join(' ')} Attach relevant source files via the paperclip button for deeper code review or enable the Gemini/Groq backend.`
      ].join('\n\n');

      const doneRun = this.finishRun('COMPLETED', {
        currentStep: 'Local engineering checklist generated.',
        findings,
        uncertaintyNotes
      });

      return {
        ok: true,
        run: doneRun,
        reply: localReply,
        providerUsed: 'LOCAL',
        isExternalModel: false,
        streamed: false,
        fallbackUsed: false
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Coding agent failed.';
      const failedRun = this.finishRun('FAILED', { currentStep: 'Failed.', error: msg });
      return {
        ok: false,
        run: failedRun,
        reply: `Coding agent failed: ${msg}`,
        providerUsed: snapshot.provider,
        isExternalModel: false,
        streamed: false,
        fallbackUsed: false,
        error: msg
      };
    }
  }

  public async runAnalysisAgent(params: {
    prompt: string;
    snapshot: WorkspaceContextSnapshot;
    attachments?: PendingAttachment[];
    signal?: AbortSignal;
    onChunk?: (delta: string, accumulated: string) => void;
  }): Promise<AgentExecutionResult> {
    const { prompt, snapshot, attachments, signal, onChunk } = params;
    this.startRun('ANALYSIS', 'Multimodal & Workspace Analysis Agent', prompt);

    try {
      this.updateRun({
        progressPercent: 35,
        currentStep: 'Evaluating workspace state, memory, and attachments...'
      });

      const hasImages = Boolean(attachments?.some((a) => a.kind === 'IMAGE'));
      const sessionSummary = conversationManager.summarizeSession();
      const recentTurns = conversationManager.getRecentTurns(6);
      const memories = memoryManager.getMemories().slice(0, 6);
      const findings: string[] = [
        `Workspace: ${snapshot.objectCount} object(s), selected "${snapshot.selectedObjectName}" (${snapshot.renderMode} render mode).`,
        `Session: ${recentTurns.length} recent turn(s); approved memories: ${memories.length}.`
      ];
      const uncertaintyNotes: string[] = [];

      if (attachments && attachments.length > 0) {
        findings.push(
          `Attachments (${attachments.length}): ${attachments.map((a) => `${a.name} [${a.kind}, ${a.sizeFormatted}]`).join(', ')}.`
        );
      }

      const attachmentSummary = buildAttachmentContextSummary(attachments);
      const canUseExternal =
        snapshot.provider === 'BACKEND' ||
        ((snapshot.provider === 'GEMINI' || snapshot.provider === 'GROQ') && !contextualAI.hasApiKey()) ||
        (snapshot.provider !== 'LOCAL' && contextualAI.hasApiKey());

      if (canUseExternal && snapshot.provider !== 'LOCAL') {
        this.updateRun({
          progressPercent: 68,
          currentStep: hasImages ? 'Streaming multimodal visual & text analysis...' : 'Streaming structured analysis...',
          findings
        });

        const systemPrompt = [
          'You are JARVIS Analysis Agent. Summarize facts strictly grounded in workspace telemetry, conversation turns, memories, and provided attachments.',
          'Never invent pixel details for images if the active provider is text-only; state clearly what is observable.',
          `Workspace State: mode=${snapshot.mode}, selected=${snapshot.selectedObjectName}, objects=${snapshot.objectCount}, renderMode=${snapshot.renderMode}`,
          `Session Summary: ${sessionSummary?.summaryText || 'None'}`,
          `Approved Memories: ${memories.map((m) => `${m.category}:${m.key}=${m.value}`).join(' | ') || 'None'}`
        ].join('\n');

        const userPrompt = attachmentSummary
          ? `${prompt}\n\nProvided Attachments:\n${attachmentSummary}`
          : prompt;

        const aiRes = await contextualAI.queryStreamingCompletion({
          messages: [
            ...conversationManager.buildModelMessages(systemPrompt, 10),
            { role: 'user', content: userPrompt }
          ],
          attachments,
          signal,
          onChunk: (delta, acc) => onChunk?.(delta, acc)
        });

        if (aiRes.aborted) {
          const abortedRun = this.finishRun('CANCELLED', { currentStep: 'Cancelled by user.' });
          return {
            ok: false,
            run: abortedRun,
            reply: 'Analysis agent run cancelled, sir.',
            providerUsed: aiRes.provider,
            isExternalModel: false,
            streamed: aiRes.streamed,
            fallbackUsed: Boolean(aiRes.fallbackTriggered),
            aborted: true
          };
        }

        if (aiRes.ok && aiRes.text) {
          const doneRun = this.finishRun('COMPLETED', {
            currentStep: 'Analysis completed.',
            findings,
            uncertaintyNotes
          });
          return {
            ok: true,
            run: doneRun,
            reply: aiRes.text,
            providerUsed: aiRes.provider,
            isExternalModel: true,
            streamed: aiRes.streamed,
            fallbackUsed: Boolean(aiRes.fallbackTriggered)
          };
        }

        uncertaintyNotes.push(`External AI unavailable: ${aiRes.error || 'Provider error'}.`);
      }

      if (hasImages) {
        uncertaintyNotes.push(
          'Binary image pixels cannot be visually inspected in LOCAL mode without the multimodal Gemini backend; only file metadata is reported below.'
        );
      }

      const localSummaryLines = [
        `Analysis Brief for "${prompt}":`,
        `Verified Context:\n• ${findings.join('\n• ')}`,
        sessionSummary ? `Session History: ${sessionSummary.summaryText}` : '',
        attachmentSummary ? `Attachment Metadata / Extracted Text:\n${attachmentSummary.slice(0, 1400)}` : '',
        uncertaintyNotes.length > 0 ? `Limitations:\n• ${uncertaintyNotes.join('\n• ')}` : ''
      ].filter(Boolean);

      const doneRun = this.finishRun('COMPLETED', {
        currentStep: 'Grounded local analysis completed.',
        findings,
        uncertaintyNotes
      });

      return {
        ok: true,
        run: doneRun,
        reply: localSummaryLines.join('\n\n'),
        providerUsed: 'LOCAL',
        isExternalModel: false,
        streamed: false,
        fallbackUsed: false
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Analysis agent failed.';
      const failedRun = this.finishRun('FAILED', { currentStep: 'Failed.', error: msg });
      return {
        ok: false,
        run: failedRun,
        reply: `Analysis agent failed: ${msg}`,
        providerUsed: snapshot.provider,
        isExternalModel: false,
        streamed: false,
        fallbackUsed: false,
        error: msg
      };
    }
  }

  public async runWorkflowAgent(params: {
    objective: string;
    snapshot: WorkspaceContextSnapshot;
    signal?: AbortSignal;
  }): Promise<AgentExecutionResult> {
    const { objective, snapshot, signal } = params;
    this.startRun('WORKFLOW', 'Controlled Workflow Agent', objective);

    try {
      this.updateRun({
        progressPercent: 30,
        currentStep: 'Building dependency-aware execution plan...'
      });

      const plan = planningEngine.createPlanFromRequest(objective, snapshot);

      // Strictly enforce permission boundaries: never auto-execute plans that require confirmation
      if (plan.requiresApproval) {
        const pausedRun = this.finishRun('COMPLETED', {
          currentStep: 'Plan ready; awaiting explicit user approval.',
          findings: [
            `Generated ${plan.steps.length}-step plan requiring confirmation for ${plan.steps.filter((s) => s.requiresConfirmation).length} state-changing step(s).`
          ],
          uncertaintyNotes: ['Execution held cleanly until user reviews and clicks Approve & Execute.']
        });

        return {
          ok: true,
          run: pausedRun,
          plan,
          reply: `Structured ${plan.steps.length}-step workflow plan prepared for "${plan.objective}". Explicit user confirmation is required before executing state-changing steps.`,
          providerUsed: snapshot.provider,
          isExternalModel: false,
          streamed: false,
          fallbackUsed: false
        };
      }

      this.updateRun({
        progressPercent: 60,
        currentStep: `Executing ${plan.steps.length} read-only workflow step(s)...`
      });

      const executed = await planningEngine.executePlan(plan.id, { approved: false, signal });
      const summary = planningEngine.summarizePlanOutcome(executed);
      const doneRun = this.finishRun(
        executed.status === 'CANCELLED' ? 'CANCELLED' : executed.status === 'FAILED' ? 'FAILED' : 'COMPLETED',
        {
          currentStep: `Workflow finished (${executed.status}).`,
          findings: [summary]
        }
      );

      return {
        ok: executed.status !== 'FAILED',
        run: doneRun,
        plan: executed,
        reply: summary,
        providerUsed: snapshot.provider,
        isExternalModel: false,
        streamed: false,
        fallbackUsed: false,
        aborted: executed.status === 'CANCELLED'
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Workflow agent failed.';
      const failedRun = this.finishRun('FAILED', { currentStep: 'Failed.', error: msg });
      return {
        ok: false,
        run: failedRun,
        reply: `Workflow agent failed: ${msg}`,
        providerUsed: snapshot.provider,
        isExternalModel: false,
        streamed: false,
        fallbackUsed: false,
        error: msg
      };
    }
  }

  public clearHistory() {
    this.activeRun = null;
    this.history = [];
    this.notify();
  }
}

export const agentOrchestrator = new AgentOrchestrator();
