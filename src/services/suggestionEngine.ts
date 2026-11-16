import {
  AISuggestion,
  ConversationTurn,
  IntelligenceStatus,
  WorkspaceContextSnapshot
} from '../types/assistant';
import { toolRegistry } from './toolRegistry';
import { automationEngine } from './automationEngine';

export class SuggestionEngine {
  private suggestions: AISuggestion[] = [];
  private rejectedSignatures: Set<string> = new Set();
  private listeners: Set<() => void> = new Set();

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((fn) => fn());
  }

  public getSuggestions(): AISuggestion[] {
    return this.suggestions.map((s) => ({ ...s }));
  }

  public getActiveSuggestions(): AISuggestion[] {
    return this.suggestions.filter((s) => s.status === 'ACTIVE').map((s) => ({ ...s }));
  }

  public getSavedSuggestions(): AISuggestion[] {
    return this.suggestions.filter((s) => s.status === 'SAVED').map((s) => ({ ...s }));
  }

  public shouldSuppressProactiveSurface(
    status: IntelligenceStatus,
    snapshot: WorkspaceContextSnapshot
  ): boolean {
    if (snapshot.isInteracting) return true;
    return (
      status === 'STANDBY' ||
      status === 'UNDERSTANDING' ||
      status === 'ANALYZING' ||
      status === 'PLANNING' ||
      status === 'AWAITING_APPROVAL' ||
      status === 'EXECUTING' ||
      status === 'VERIFYING'
    );
  }

  public evaluateContext(params: {
    snapshot: WorkspaceContextSnapshot;
    recentTurns: ConversationTurn[];
    status: IntelligenceStatus;
  }): AISuggestion[] {
    const { snapshot, recentTurns, status } = params;
    if (this.shouldSuppressProactiveSurface(status, snapshot)) {
      return this.getActiveSuggestions();
    }

    const candidates: Omit<AISuggestion, 'id' | 'createdAt' | 'status'>[] = [];
    const selectedObj =
      snapshot.objectsSummary.find((o) => o.id === snapshot.selectedObjectId) ||
      snapshot.objectsSummary[0];
    const lastUserTurn = [...recentTurns].reverse().find((t) => t.role === 'user');
    const lastUserLower = lastUserTurn?.text.toLowerCase() || '';

    // 1. Conflict Detection: user asked to move/rotate/explode/transform while object is locked
    if (
      selectedObj?.isLocked &&
      /\b(move|translate|rotate|scale|resize|reset)\b/i.test(lastUserLower)
    ) {
      candidates.push({
        signature: `conflict-locked-${selectedObj.id}`,
        title: 'Transform Blocked by Lock Constraint',
        explanation: `"${selectedObj.name}" is currently locked against spatial transforms.`,
        reason: 'Requested manipulation conflicts with object lock state.',
        priority: 'HIGH',
        recommendedAction: 'Unlock the object in the Spatial Matrix / Rig before transforming.',
        relatedTool: 'inspect_selected_model',
        toolArgs: { preferImported: false }
      });
    }

    // 2. Lab import error diagnosis
    if (snapshot.hasLabError && snapshot.labError) {
      candidates.push({
        signature: `lab-error-${snapshot.labError.slice(0, 40)}`,
        title: 'Resolve 3D Model Import Issue',
        explanation: `The Object Lab reported: ${snapshot.labError}`,
        reason: 'Recent 3D asset import or reconstruction failed.',
        priority: 'HIGH',
        recommendedAction: 'Review supported GLB/GLTF (+bin/textures), OBJ, and STL requirements.',
        relatedTool: 'lookup_documentation',
        toolArgs: { topic: 'glb gltf obj stl import' }
      });
    }

    // 3. Disintegrated model recovery reminder
    if (selectedObj?.isDisintegrated || snapshot.dispersionAmount >= 0.85) {
      candidates.push({
        signature: `disintegrated-${selectedObj?.id || 'selected'}`,
        title: 'Reconstruct Dispersed Hologram',
        explanation: `"${snapshot.selectedObjectName}" is currently disintegrated into particles.`,
        reason: 'High dispersion state active; original geometry is preserved and ready to reassemble.',
        priority: 'MEDIUM',
        recommendedAction: 'Reconstruct particles back into exact original geometry.',
        relatedTool: 'control_hologram_transform',
        toolArgs: { action: 'reconstruct' }
      });
    }

    // 4. Multi-part model inspection suggestion
    if (
      selectedObj &&
      (selectedObj.componentCount || 0) >= 2 &&
      snapshot.explosionAmount < 0.05 &&
      !selectedObj.isDisintegrated
    ) {
      candidates.push({
        signature: `multi-part-explode-${selectedObj.id}`,
        title: 'Inspect Multi-Part Assembly Layers',
        explanation: `"${selectedObj.name}" contains ${selectedObj.componentCount} distinct components that can be inspected radially.`,
        reason: 'Multi-mesh assembly detected in assembled view.',
        priority: 'MEDIUM',
        recommendedAction: 'Engage Exploded View and frame the assembly.',
        relatedTool: 'control_hologram_transform',
        toolArgs: { action: 'explode', explosionAmount: 0.85 }
      });
    }

    // 5. Verification / Test reminder after code or workflow discussions
    if (/\b(code|changed|updated|edited|refactor|implement|bug|fix)\b/i.test(lastUserLower)) {
      candidates.push({
        signature: `verify-checks-${lastUserTurn?.id || 'session'}`,
        title: 'Run Post-Change Verification Checks',
        explanation:
          'Add a verification reminder to run TypeScript (`npx tsc --noEmit`), Vitest (`npx vitest run`), and Vite build.',
        reason: 'Recent conversation indicates code or implementation changes.',
        priority: 'MEDIUM',
        recommendedAction: 'Append verification checklist to Mission Memorandum notes.',
        relatedTool: 'append_workspace_note',
        toolArgs: {
          text: `[Verification Reminder] Run: npx tsc --noEmit && npx vitest run && npm run build`
        }
      });
    }

    // 6. Missing external API key configuration notice
    if (snapshot.provider !== 'LOCAL' && !snapshot.hasProviderKey) {
      candidates.push({
        signature: `missing-key-${snapshot.provider}`,
        title: `${snapshot.provider} Session Key Not Loaded`,
        explanation: `Provider is set to ${snapshot.provider}, but no volatile session API key is entered yet.`,
        reason: 'External AI requests will fall back to LOCAL deterministic reasoning until a key is supplied or provider is switched to LOCAL.',
        priority: 'MEDIUM',
        recommendedAction: 'Run provider diagnostics or open AI Config.',
        relatedTool: 'network_and_hardware_diagnostics',
        toolArgs: {}
      });
    }

    // 7. Multi-object layout efficiency
    if (snapshot.objectCount >= 3) {
      candidates.push({
        signature: `layout-grid-${snapshot.objectCount}`,
        title: 'Organize Multi-Object Spatial Grid',
        explanation: `${snapshot.objectCount} objects are active simultaneously; a planar GRID formation avoids visual overlap.`,
        reason: 'Multiple spatial instances detected in workspace.',
        priority: 'LOW',
        recommendedAction: 'Arrange all unlocked objects into a clean spatial grid.',
        relatedTool: 'control_hologram_transform',
        toolArgs: { action: 'set_formation', formation: 'GRID' }
      });
    }

    let added = false;
    for (const cand of candidates) {
      const exists = this.suggestions.some(
        (s) =>
          s.signature === cand.signature &&
          (s.status === 'ACTIVE' || s.status === 'SAVED' || s.status === 'CONVERTED')
      );
      if (exists || this.rejectedSignatures.has(cand.signature)) continue;

      this.suggestions.unshift({
        ...cand,
        id: `sug-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
        status: 'ACTIVE',
        createdAt: Date.now()
      });
      added = true;
    }

    // Keep list bounded cleanly (max 6 active at once)
    let activeCount = 0;
    this.suggestions = this.suggestions.filter((s) => {
      if (s.status !== 'ACTIVE') return true;
      activeCount++;
      return activeCount <= 6;
    });

    if (added) {
      this.notify();
    }
    return this.getActiveSuggestions();
  }

  public async acceptSuggestion(id: string): Promise<{ ok: boolean; message: string }> {
    const sug = this.suggestions.find((s) => s.id === id);
    if (!sug) return { ok: false, message: 'Suggestion not found.' };

    if (sug.relatedTool) {
      const { result } = await toolRegistry.executeTool(sug.relatedTool, sug.toolArgs || {}, {
        approvedByUser: true
      });
      sug.status = result.ok ? 'ACCEPTED' : sug.status;
      this.notify();
      return { ok: result.ok, message: result.summary };
    }

    sug.status = 'ACCEPTED';
    this.notify();
    return { ok: true, message: `Accepted suggestion: ${sug.title}` };
  }

  public rejectSuggestion(id: string) {
    const sug = this.suggestions.find((s) => s.id === id);
    if (!sug) return;
    sug.status = 'REJECTED';
    this.rejectedSignatures.add(sug.signature);
    this.notify();
  }

  public saveForLater(id: string) {
    const sug = this.suggestions.find((s) => s.id === id);
    if (!sug) return;
    sug.status = 'SAVED';
    this.notify();
  }

  public convertToTask(id: string): boolean {
    const sug = this.suggestions.find((s) => s.id === id);
    if (!sug) return false;

    automationEngine.createTask(
      sug.title,
      sug.recommendedAction,
      [
        {
          description: sug.recommendedAction,
          action: async () => {
            if (sug.relatedTool) {
              await toolRegistry.executeTool(sug.relatedTool, sug.toolArgs || {}, {
                approvedByUser: true
              });
            }
          }
        }
      ],
      []
    );
    sug.status = 'CONVERTED';
    this.notify();
    return true;
  }

  public clearAll() {
    this.suggestions = [];
    this.rejectedSignatures.clear();
    this.notify();
  }
}

export const suggestionEngine = new SuggestionEngine();
