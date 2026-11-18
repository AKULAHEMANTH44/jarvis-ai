import {
  ToolActivityRecord,
  ToolDefinition,
  ToolInputSchema,
  ToolResult,
  WorkspaceContextSnapshot
} from '../types/assistant';
import { HologramModelId, HologramRenderMode, LayoutFormation } from '../types/hologram';
import { conversationManager } from './conversationManager';
import { memoryManager } from './memoryManager';
import { desktopBridge } from './desktopBridge';
import { permissionManager } from './permissionManager';
import { fileAccessService } from './fileAccessService';
import { browserActionService, validateNavigationUrl } from './browserActionService';
import { webSearchService, extractSearchIntent } from './webSearchService';
import { musicService } from './musicService';
import { desktopWorkflowService } from './desktopWorkflowService';
import { MusicSourceType, WebSearchProviderId } from '../types/assistant';

export interface WorkspaceToolHost {
  getContextSnapshot: () => WorkspaceContextSnapshot;
  selectModel: (modelId: HologramModelId) => boolean;
  setRenderMode: (mode: HologramRenderMode) => boolean;
  setExplosionAmount: (amount: number) => boolean;
  disintegrate: () => boolean;
  reconstruct: () => boolean;
  rotate360: () => boolean;
  frameModel: () => boolean;
  resetCamera: () => boolean;
  resetTransform: () => boolean;
  applyFormation: (formation: LayoutFormation) => boolean;
  duplicateSelected: () => boolean;
  deleteSelected: () => Promise<boolean> | boolean;
  selectComponent: (componentId: string | null) => boolean;
  isolateComponent: (componentId: string | null) => boolean;
  undo: () => boolean;
  redo: () => boolean;
  appendNote: (text: string) => boolean;
  exportNotes: () => Promise<boolean>;
  toggleCamera?: () => Promise<boolean> | boolean;
  openDrawer?: (drawer: 'GESTURE' | 'MODELS' | 'LAB' | 'TELEMETRY' | 'CONFIG' | 'TASKS' | 'VOICE' | 'BRAIN') => boolean;
  import3DModelFiles?: (files: File[]) => Promise<void> | void;
}

const VALID_MODELS: HologramModelId[] = [
  'vision_sphere',
  'arc_reactor',
  'quantum_tesseract',
  'ironman_armor',
  'planetary_defense',
  'molecular_dna',
  'carbon_buckyball',
  'hologram_datachart',
  'sports_car',
  'cyber_motorcycle',
  'holo_smartphone',
  'quantum_workstation',
  'jet_turbine_engine',
  'stark_skyscraper',
  'industrial_robot_arm',
  'planetary_gearbox',
  'atom_orbital_model',
  'reconstructed_object'
];

const VALID_RENDER_MODES: HologramRenderMode[] = ['SOLID_HOLO', 'WIREFRAME', 'POINT_CLOUD', 'HYBRID'];
const VALID_FORMATIONS: LayoutFormation[] = ['FREE', 'SINGLE', 'GRID', 'ORBIT', 'LINE'];

const DOCS_KNOWLEDGE: { topic: string; keywords: string[]; answer: string }[] = [
  {
    topic: '3D Model Formats & Object Lab',
    keywords: ['glb', 'gltf', 'obj', 'stl', 'import', 'drag', 'drop', 'model', 'lab', 'upload'],
    answer:
      'Object Lab supports .glb, .gltf (with companion .bin/textures), .obj (preserving o/g component groups), and ASCII/binary .stl files via file picker or viewport drag-and-drop. Includes SOLID_HOLO, WIREFRAME, POINT_CLOUD, and HYBRID modes, radial exploded view, component highlight/selection/isolation, disintegration/reconstruction, and Fit Model camera framing.'
  },
  {
    topic: 'Undo / Redo & Keyboard Shortcuts',
    keywords: ['undo', 'redo', 'ctrl+z', 'ctrl+y', 'shortcut', 'history', 'escape', 'key'],
    answer:
      'Ctrl+Z / Cmd+Z undoes and Ctrl+Y / Ctrl+Shift+Z redoes pointer drags, wheel scaling, Lab sliders, formations, locking, render modes, explosion, dispersion, disintegration/reconstruction, and component selection/isolation. Escape closes active HUD drawers or exits Focus mode.'
  },
  {
    topic: 'Hand Gesture Controls',
    keywords: ['gesture', 'hand', 'mediapipe', 'camera', 'pinch', 'palm', 'fist', 'swipe', 'webcam'],
    answer:
      'MediaPipe 21-landmark hand tracking supports: Open Palm (wake/unfreeze), Closed Fist (freeze), Pinch & Move (grab/translate), Double Pinch (toggle explode), Move Hand / Wrist Roll (rotate), Two-Hand Spread/Close (dispersion/scale), Two-Finger Point (3D laser reticle), Push Forward (shockwave), Pull Back (reconstruct/reset), and Quick Swipe (cycle models).'
  },
  {
    topic: 'AI Providers & Key Handling',
    keywords: ['ai', 'provider', 'gemini', 'openai', 'anthropic', 'claude', 'local', 'api key', 'security'],
    answer:
      'Supports LOCAL on-device reasoning plus external HTTPS/localhost providers (Gemini, OpenAI, Anthropic). Because this app runs as a client-side Vite SPA without a backend secret vault, any entered API key is held only in volatile JavaScript RAM for the active session and is never written to localStorage or disk.'
  },
  {
    topic: 'Voice & Memory Controls',
    keywords: ['voice', 'speech', 'memory', 'remember', 'plan', 'suggestion', 'mic'],
    answer:
      'Local deterministic voice commands always execute first with TTS synthesis and self-echo suppression. Unmatched natural-language utterances route to the Intelligence Engine with multi-turn session context, user-consented memory, multi-step planning, and permission-gated tools.'
  }
];

// Safe recursive-descent math evaluator (no eval / Function)
export function evaluateSafeMathExpression(expression: string): number {
  const cleaned = expression.trim();
  if (!cleaned || cleaned.length > 160) {
    throw new Error('Expression must be between 1 and 160 characters.');
  }

  let pos = 0;
  const skipWs = () => {
    while (pos < cleaned.length && /\s/.test(cleaned[pos])) pos++;
  };

  const parseIdentifier = (): string => {
    const start = pos;
    while (pos < cleaned.length && /[a-zA-Z0-9_]/.test(cleaned[pos])) pos++;
    return cleaned.slice(start, pos).toLowerCase();
  };

  const parseNumber = (): number => {
    const start = pos;
    let seenDot = false;
    while (pos < cleaned.length) {
      const ch = cleaned[pos];
      if (ch >= '0' && ch <= '9') {
        pos++;
      } else if (ch === '.' && !seenDot) {
        seenDot = true;
        pos++;
      } else {
        break;
      }
    }
    const raw = cleaned.slice(start, pos);
    const val = Number(raw);
    if (!raw || !Number.isFinite(val)) {
      throw new Error(`Invalid numeric literal near "${cleaned.slice(start, start + 8)}".`);
    }
    return val;
  };

  const parsePrimary = (): number => {
    skipWs();
    if (pos >= cleaned.length) throw new Error('Unexpected end of expression.');
    const ch = cleaned[pos];

    if (ch === '(') {
      pos++;
      const val = parseExpr();
      skipWs();
      if (cleaned[pos] !== ')') throw new Error('Missing closing parenthesis.');
      pos++;
      return val;
    }

    if (ch === '+') {
      pos++;
      return parsePrimary();
    }
    if (ch === '-') {
      pos++;
      return -parsePrimary();
    }

    if ((ch >= '0' && ch <= '9') || ch === '.') {
      return parseNumber();
    }

    if (/[a-zA-Z_]/.test(ch)) {
      const ident = parseIdentifier();
      if (ident === 'pi') return Math.PI;
      if (ident === 'e') return Math.E;

      skipWs();
      if (cleaned[pos] !== '(') {
        throw new Error(`Unknown identifier "${ident}".`);
      }
      pos++;
      const args: number[] = [];
      skipWs();
      if (cleaned[pos] !== ')') {
        args.push(parseExpr());
        skipWs();
        while (cleaned[pos] === ',') {
          pos++;
          args.push(parseExpr());
          skipWs();
        }
      }
      if (cleaned[pos] !== ')') {
        throw new Error(`Missing closing parenthesis for ${ident}().`);
      }
      pos++;

      switch (ident) {
        case 'sqrt':
          if (args.length !== 1 || args[0] < 0) throw new Error('sqrt requires 1 non-negative argument.');
          return Math.sqrt(args[0]);
        case 'abs':
          if (args.length !== 1) throw new Error('abs requires 1 argument.');
          return Math.abs(args[0]);
        case 'sin':
          if (args.length !== 1) throw new Error('sin requires 1 argument.');
          return Math.sin(args[0]);
        case 'cos':
          if (args.length !== 1) throw new Error('cos requires 1 argument.');
          return Math.cos(args[0]);
        case 'tan':
          if (args.length !== 1) throw new Error('tan requires 1 argument.');
          return Math.tan(args[0]);
        case 'log':
          if (args.length !== 1 || args[0] <= 0) throw new Error('log requires 1 positive argument.');
          return Math.log10(args[0]);
        case 'ln':
          if (args.length !== 1 || args[0] <= 0) throw new Error('ln requires 1 positive argument.');
          return Math.log(args[0]);
        case 'round':
          if (args.length !== 1) throw new Error('round requires 1 argument.');
          return Math.round(args[0]);
        case 'floor':
          if (args.length !== 1) throw new Error('floor requires 1 argument.');
          return Math.floor(args[0]);
        case 'ceil':
          if (args.length !== 1) throw new Error('ceil requires 1 argument.');
          return Math.ceil(args[0]);
        case 'min':
          if (args.length < 1) throw new Error('min requires at least 1 argument.');
          return Math.min(...args);
        case 'max':
          if (args.length < 1) throw new Error('max requires at least 1 argument.');
          return Math.max(...args);
        default:
          throw new Error(`Unsupported math function "${ident}".`);
      }
    }

    throw new Error(`Unexpected token "${ch}" in expression.`);
  };

  const parsePower = (): number => {
    const base = parsePrimary();
    skipWs();
    if (cleaned[pos] === '^') {
      pos++;
      const exp = parsePower();
      return Math.pow(base, exp);
    }
    return base;
  };

  const parseTerm = (): number => {
    let val = parsePower();
    while (true) {
      skipWs();
      const ch = cleaned[pos];
      if (ch === '*') {
        pos++;
        val *= parsePower();
      } else if (ch === '/') {
        pos++;
        const denom = parsePower();
        if (denom === 0) throw new Error('Division by zero.');
        val /= denom;
      } else if (ch === '%') {
        pos++;
        const denom = parsePower();
        if (denom === 0) throw new Error('Modulo by zero.');
        val %= denom;
      } else {
        break;
      }
    }
    return val;
  };

  const parseExpr = (): number => {
    let val = parseTerm();
    while (true) {
      skipWs();
      const ch = cleaned[pos];
      if (ch === '+') {
        pos++;
        val += parseTerm();
      } else if (ch === '-') {
        pos++;
        val -= parseTerm();
      } else {
        break;
      }
    }
    return val;
  };

  const result = parseExpr();
  skipWs();
  if (pos < cleaned.length) {
    throw new Error(`Unexpected trailing character "${cleaned[pos]}".`);
  }
  if (!Number.isFinite(result)) {
    throw new Error('Calculation overflowed finite numeric bounds.');
  }
  return result;
}

export function validateToolInput(
  schema: ToolInputSchema,
  args: Record<string, unknown>
): { valid: boolean; error?: string } {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { valid: false, error: 'Tool input must be a JSON object.' };
  }

  for (const reqKey of schema.required || []) {
    const v = args[reqKey];
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
      return { valid: false, error: `Missing required tool parameter "${reqKey}".` };
    }
  }

  for (const [key, prop] of Object.entries(schema.properties)) {
    const val = args[key];
    if (val === undefined) {
      if (prop.required) {
        return { valid: false, error: `Missing required tool parameter "${key}".` };
      }
      continue;
    }

    if (prop.type === 'array') {
      if (!Array.isArray(val)) {
        return { valid: false, error: `Parameter "${key}" must be an array.` };
      }
    } else if (typeof val !== prop.type) {
      return { valid: false, error: `Parameter "${key}" must be of type ${prop.type}.` };
    }

    if (prop.type === 'number' && typeof val === 'number') {
      if (!Number.isFinite(val)) {
        return { valid: false, error: `Parameter "${key}" must be a finite number.` };
      }
      if (prop.min !== undefined && val < prop.min) {
        return { valid: false, error: `Parameter "${key}" must be >= ${prop.min}.` };
      }
      if (prop.max !== undefined && val > prop.max) {
        return { valid: false, error: `Parameter "${key}" must be <= ${prop.max}.` };
      }
    }

    if (prop.enum && typeof val === 'string' && !prop.enum.includes(val)) {
      return {
        valid: false,
        error: `Parameter "${key}" must be one of: ${prop.enum.join(', ')}.`
      };
    }
  }

  return { valid: true };
}

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private activityHistory: ToolActivityRecord[] = [];
  private listeners: Set<() => void> = new Set();
  private host: WorkspaceToolHost | null = null;
  private transientSnapshot: WorkspaceContextSnapshot | null = null;

  constructor() {
    this.registerBuiltinTools();
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((fn) => fn());
  }

  public setHost(host: WorkspaceToolHost | null) {
    this.host = host;
  }

  public getHost(): WorkspaceToolHost | null {
    return this.host;
  }

  public registerTool(tool: ToolDefinition) {
    this.tools.set(tool.name, tool);
  }

  public listTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  public getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  public getActivityHistory(limit = 30): ToolActivityRecord[] {
    return this.activityHistory.slice(0, Math.max(1, limit)).map((r) => ({ ...r }));
  }

  public clearActivityHistory() {
    this.activityHistory = [];
    this.notify();
  }

  private recordActivity(rec: ToolActivityRecord) {
    this.activityHistory.unshift(rec);
    if (this.activityHistory.length > 60) {
      this.activityHistory = this.activityHistory.slice(0, 60);
    }
    this.notify();
  }

  public async executeTool(
    toolName: string,
    args: Record<string, unknown> = {},
    options: {
      approvedByUser?: boolean;
      allowConsequential?: boolean;
      snapshot?: WorkspaceContextSnapshot;
    } = {}
  ): Promise<{ result: ToolResult; record: ToolActivityRecord }> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      const result: ToolResult = {
        ok: false,
        verified: false,
        summary: `Unknown or unpermitted tool "${toolName}". Execution blocked.`,
        error: `Tool "${toolName}" is not registered in the controlled registry.`
      };
      const record: ToolActivityRecord = {
        id: `tool-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 5)}`,
        toolName,
        args,
        permissionLevel: 'CONSEQUENTIAL',
        approvedByUser: false,
        status: 'DENIED',
        verified: false,
        summary: result.summary,
        error: result.error,
        timestamp: Date.now()
      };
      this.recordActivity(record);
      return { result, record };
    }

    const validation = validateToolInput(tool.inputSchema, args);
    if (!validation.valid) {
      const result: ToolResult = {
        ok: false,
        verified: false,
        summary: validation.error || 'Tool input validation failed.',
        error: validation.error
      };
      const record: ToolActivityRecord = {
        id: `tool-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 5)}`,
        toolName,
        args,
        permissionLevel: tool.permissionLevel,
        approvedByUser: Boolean(options.approvedByUser),
        status: 'FAILED',
        verified: false,
        summary: result.summary,
        error: result.error,
        timestamp: Date.now()
      };
      this.recordActivity(record);
      return { result, record };
    }

    if (tool.requiresConfirmation && !options.approvedByUser) {
      const status = options.allowConsequential === false ? 'DENIED' : 'PENDING_APPROVAL';
      const result: ToolResult = {
        ok: false,
        verified: false,
        summary: `Explicit user confirmation is required before running "${tool.name}".`,
        error: 'USER_CONFIRMATION_REQUIRED'
      };
      const record: ToolActivityRecord = {
        id: `tool-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 5)}`,
        toolName,
        args,
        permissionLevel: tool.permissionLevel,
        approvedByUser: false,
        status,
        verified: false,
        summary: result.summary,
        error: result.error,
        timestamp: Date.now()
      };
      this.recordActivity(record);
      return { result, record };
    }

    const prevTransient = this.transientSnapshot;
    if (options.snapshot) {
      this.transientSnapshot = options.snapshot;
    }

    try {
      const execResult = await tool.execute(args);
      let verified = execResult.ok ? execResult.verified : false;
      if (execResult.ok && tool.verify) {
        verified = Boolean(await tool.verify(args, execResult));
      }

      const finalResult: ToolResult = {
        ...execResult,
        verified,
        verificationDetail:
          execResult.verificationDetail ||
          (verified ? 'Post-execution state verified.' : 'Post-execution verification did not confirm change.')
      };

      const record: ToolActivityRecord = {
        id: `tool-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 5)}`,
        toolName,
        args,
        permissionLevel: tool.permissionLevel,
        approvedByUser: Boolean(options.approvedByUser || !tool.requiresConfirmation),
        status: finalResult.ok ? 'EXECUTED' : 'FAILED',
        verified: finalResult.verified,
        summary: finalResult.summary,
        error: finalResult.error,
        timestamp: Date.now()
      };
      this.recordActivity(record);
      return { result: finalResult, record };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Tool execution error.';
      const result: ToolResult = {
        ok: false,
        verified: false,
        summary: `Tool "${tool.name}" failed: ${msg}`,
        error: msg
      };
      const record: ToolActivityRecord = {
        id: `tool-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 5)}`,
        toolName,
        args,
        permissionLevel: tool.permissionLevel,
        approvedByUser: Boolean(options.approvedByUser),
        status: 'FAILED',
        verified: false,
        summary: result.summary,
        error: msg,
        timestamp: Date.now()
      };
      this.recordActivity(record);
      return { result, record };
    } finally {
      this.transientSnapshot = prevTransient;
    }
  }

  private getSnapshotOrFallback(): WorkspaceContextSnapshot {
    if (this.host) {
      return this.host.getContextSnapshot();
    }
    if (this.transientSnapshot) {
      return this.transientSnapshot;
    }
    return {
      mode: 'WORKSPACE',
      selectedObjectId: null,
      selectedObjectName: 'VISION 1.2 CORE',
      selectedModelId: 'vision_sphere',
      objectCount: 0,
      objectsSummary: [],
      renderMode: 'HYBRID',
      explosionAmount: 0,
      dispersionAmount: 0,
      isCameraActive: false,
      isVoiceActive: false,
      hasLabError: false,
      provider: 'LOCAL',
      hasProviderKey: false,
      modelName: 'JARVIS Local Core MK-7',
      notesPreview: ''
    };
  }

  private registerBuiltinTools() {
    this.registerTool({
      name: 'inspect_workspace',
      description:
        'Inspect active 3D spatial workspace state, loaded objects, camera/voice sensors, and configured AI provider (without secrets).',
      permissionLevel: 'READ_ONLY',
      requiresConfirmation: false,
      inputSchema: {
        type: 'object',
        properties: {
          includeComponents: {
            type: 'boolean',
            description: 'Include sub-component lists when available.'
          }
        }
      },
      execute: (args) => {
        const snap = this.getSnapshotOrFallback();
        const includeComps = args.includeComponents !== false;
        const objects = snap.objectsSummary.map((o) => ({
          id: o.id,
          name: o.name,
          modelId: o.modelId,
          vertexCount: o.vertexCount,
          faceCount: o.faceCount,
          componentCount: o.componentCount,
          isLocked: o.isLocked,
          isDisintegrated: o.isDisintegrated,
          renderMode: o.renderMode,
          ...(includeComps && o.components ? { components: o.components } : {})
        }));
        return {
          ok: true,
          verified: true,
          summary: `Workspace (${snap.mode}) has ${snap.objectCount} active 3D entity(ies). Selected: ${snap.selectedObjectName} [${snap.renderMode}, explosion ${Math.round(snap.explosionAmount * 100)}%, dispersion ${Math.round(snap.dispersionAmount * 100)}%].`,
          data: {
            mode: snap.mode,
            objectCount: snap.objectCount,
            selectedObjectName: snap.selectedObjectName,
            selectedModelId: snap.selectedModelId,
            renderMode: snap.renderMode,
            explosionAmount: snap.explosionAmount,
            dispersionAmount: snap.dispersionAmount,
            isCameraActive: snap.isCameraActive,
            isVoiceActive: snap.isVoiceActive,
            provider: snap.provider,
            hasProviderKey: snap.hasProviderKey,
            objects
          }
        };
      }
    });

    this.registerTool({
      name: 'inspect_selected_model',
      description: 'Inspect geometry metrics, components, render mode, and disintegration status of the selected or imported 3D model.',
      permissionLevel: 'READ_ONLY',
      requiresConfirmation: false,
      inputSchema: {
        type: 'object',
        properties: {
          preferImported: {
            type: 'boolean',
            description: 'Prefer inspecting an imported/reconstructed model if present in workspace.'
          }
        }
      },
      execute: (args) => {
        const snap = this.getSnapshotOrFallback();
        const target =
          (args.preferImported
            ? snap.objectsSummary.find((o) => o.modelId === 'reconstructed_object')
            : undefined) ||
          snap.objectsSummary.find((o) => o.id === snap.selectedObjectId) ||
          snap.objectsSummary[0];

        if (!target) {
          return {
            ok: false,
            verified: false,
            summary: 'No active 3D model found in workspace.',
            error: 'Workspace contains zero spatial objects.'
          };
        }

        const compNames = target.components?.map((c) => c.name).slice(0, 12) || [];
        return {
          ok: true,
          verified: true,
          summary: `Model "${target.name}" (${target.modelId}) has ${target.vertexCount ?? 0} vertices, ${target.faceCount ?? 0} faces, ${target.componentCount ?? compNames.length} component(s), render mode ${target.renderMode || snap.renderMode}${target.isDisintegrated ? ', currently DISINTEGRATED' : ''}.`,
          data: {
            model: target,
            componentNames: compNames
          }
        };
      }
    });

    this.registerTool({
      name: 'retrieve_context_and_memory',
      description: 'Retrieve current session conversation summary and user-approved persistent memories matching a query.',
      permissionLevel: 'READ_ONLY',
      requiresConfirmation: false,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search topic or keywords.' }
        },
        required: ['query']
      },
      execute: (args) => {
        const query = String(args.query || '');
        const summary = conversationManager.summarizeSession();
        const memories = memoryManager.getRelevantMemories(query, 6);
        return {
          ok: true,
          verified: true,
          summary: `Retrieved ${memories.length} approved memory entry(ies) and session summary (${summary?.turnCount ?? 0} turns).`,
          data: {
            sessionSummary: summary,
            memories
          }
        };
      }
    });

    this.registerTool({
      name: 'calculate_math',
      description: 'Safely evaluate arithmetic or scientific math expressions (+, -, *, /, ^, %, sqrt, sin, cos, tan, log, ln, round, min, max, pi, e).',
      permissionLevel: 'READ_ONLY',
      requiresConfirmation: false,
      inputSchema: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'Math expression to evaluate safely.' }
        },
        required: ['expression']
      },
      execute: (args) => {
        const expr = String(args.expression || '');
        const value = evaluateSafeMathExpression(expr);
        return {
          ok: true,
          verified: Number.isFinite(value),
          summary: `${expr} = ${value}`,
          data: { expression: expr, value }
        };
      }
    });

    this.registerTool({
      name: 'lookup_documentation',
      description: 'Search JARVIS capabilities, supported 3D formats, keyboard shortcuts, voice commands, gestures, and AI security architecture.',
      permissionLevel: 'READ_ONLY',
      requiresConfirmation: false,
      inputSchema: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'Documentation topic or keyword.' }
        },
        required: ['topic']
      },
      execute: (args) => {
        const q = String(args.topic || '').toLowerCase();
        const matches = DOCS_KNOWLEDGE.filter(
          (doc) =>
            doc.topic.toLowerCase().includes(q) ||
            doc.keywords.some((kw) => q.includes(kw) || kw.includes(q))
        );
        const selected = matches.length > 0 ? matches : DOCS_KNOWLEDGE;
        return {
          ok: true,
          verified: true,
          summary: selected.map((d) => `${d.topic}: ${d.answer}`).join(' | '),
          data: { topics: selected }
        };
      }
    });

    this.registerTool({
      name: 'network_and_hardware_diagnostics',
      description: 'Inspect browser online connectivity, hardware concurrency/memory/battery telemetry, and AI provider readiness without exposing secrets.',
      permissionLevel: 'READ_ONLY',
      requiresConfirmation: false,
      inputSchema: {
        type: 'object',
        properties: {}
      },
      execute: async () => {
        const hw = await desktopBridge.getHardwareTelemetry();
        const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
        const snap = this.getSnapshotOrFallback();
        return {
          ok: true,
          verified: true,
          summary: `Network ${online ? 'ONLINE' : 'OFFLINE'}${hw.networkLatencyMs ? ` (RTT ${hw.networkLatencyMs} ms)` : ''}; CPU estimate ${hw.cpuLoad ?? 'N/A'}%; Provider ${snap.provider} (${snap.hasProviderKey ? 'session key loaded' : 'local/no external key'}).`,
          data: {
            online,
            telemetry: hw,
            provider: snap.provider,
            hasProviderKey: snap.hasProviderKey,
            modelName: snap.modelName,
            cameraActive: snap.isCameraActive,
            voiceActive: snap.isVoiceActive
          }
        };
      }
    });

    this.registerTool({
      name: 'control_hologram_transform',
      description: 'Control Holographic Object Lab actions (explode, collapse, reconstruct, disintegrate, rotate360, frame_model, reset_camera, reset_transform, set_render_mode, select_model, set_formation, duplicate_selected, undo, redo).',
      permissionLevel: 'WORKSPACE_MUTATION',
      requiresConfirmation: false,
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: 'Object Lab control operation to execute.',
            enum: [
              'explode',
              'collapse',
              'reconstruct',
              'disintegrate',
              'rotate360',
              'frame_model',
              'reset_camera',
              'reset_transform',
              'set_render_mode',
              'select_model',
              'set_formation',
              'duplicate_selected',
              'select_component',
              'isolate_component',
              'undo',
              'redo'
            ]
          },
          renderMode: {
            type: 'string',
            description: 'Render mode when action is set_render_mode.',
            enum: VALID_RENDER_MODES
          },
          modelId: {
            type: 'string',
            description: 'Hologram model ID when action is select_model.',
            enum: VALID_MODELS
          },
          formation: {
            type: 'string',
            description: 'Spatial layout formation when action is set_formation.',
            enum: VALID_FORMATIONS
          },
          explosionAmount: {
            type: 'number',
            description: 'Optional explosion amount between 0 and 1.',
            min: 0,
            max: 1
          },
          componentId: {
            type: 'string',
            description: 'Component ID for select_component or isolate_component.'
          }
        },
        required: ['action']
      },
      execute: (args) => {
        if (!this.host) {
          return {
            ok: false,
            verified: false,
            summary: 'Workspace host unavailable outside active 3D scene.',
            error: 'No WorkspaceToolHost attached.'
          };
        }
        const action = String(args.action);
        let ok = false;

        switch (action) {
          case 'explode':
            ok = this.host.setExplosionAmount(
              typeof args.explosionAmount === 'number' ? args.explosionAmount : 1.0
            );
            break;
          case 'collapse':
            ok = this.host.setExplosionAmount(0.0);
            break;
          case 'reconstruct':
            ok = this.host.reconstruct();
            break;
          case 'disintegrate':
            ok = this.host.disintegrate();
            break;
          case 'rotate360':
            ok = this.host.rotate360();
            break;
          case 'frame_model':
            ok = this.host.frameModel();
            break;
          case 'reset_camera':
            ok = this.host.resetCamera();
            break;
          case 'reset_transform':
            ok = this.host.resetTransform();
            break;
          case 'set_render_mode':
            if (!args.renderMode || !VALID_RENDER_MODES.includes(args.renderMode as HologramRenderMode)) {
              return { ok: false, verified: false, summary: 'Valid renderMode required.', error: 'Missing renderMode' };
            }
            ok = this.host.setRenderMode(args.renderMode as HologramRenderMode);
            break;
          case 'select_model':
            if (!args.modelId || !VALID_MODELS.includes(args.modelId as HologramModelId)) {
              return { ok: false, verified: false, summary: 'Valid modelId required.', error: 'Missing modelId' };
            }
            ok = this.host.selectModel(args.modelId as HologramModelId);
            break;
          case 'set_formation':
            if (!args.formation || !VALID_FORMATIONS.includes(args.formation as LayoutFormation)) {
              return { ok: false, verified: false, summary: 'Valid formation required.', error: 'Missing formation' };
            }
            ok = this.host.applyFormation(args.formation as LayoutFormation);
            break;
          case 'duplicate_selected':
            ok = this.host.duplicateSelected();
            break;
          case 'select_component':
            ok = this.host.selectComponent(typeof args.componentId === 'string' ? args.componentId : null);
            break;
          case 'isolate_component':
            ok = this.host.isolateComponent(typeof args.componentId === 'string' ? args.componentId : null);
            break;
          case 'undo':
            ok = this.host.undo();
            break;
          case 'redo':
            ok = this.host.redo();
            break;
        }

        return {
          ok,
          verified: ok,
          summary: ok
            ? `Executed Object Lab action "${action}".`
            : `Object Lab action "${action}" could not complete (object may be locked or unavailable).`,
          error: ok ? undefined : `Action "${action}" returned false.`
        };
      }
    });

    this.registerTool({
      name: 'append_workspace_note',
      description: 'Append a verified entry to the Mission Memorandum / Workspace Notes panel.',
      permissionLevel: 'WORKSPACE_MUTATION',
      requiresConfirmation: false,
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Note text to append.' }
        },
        required: ['text']
      },
      execute: (args) => {
        if (!this.host) {
          return { ok: false, verified: false, summary: 'Workspace host unavailable.', error: 'No host.' };
        }
        const ok = this.host.appendNote(String(args.text));
        return {
          ok,
          verified: ok,
          summary: ok ? 'Appended entry to workspace mission notes.' : 'Failed to append note.'
        };
      }
    });

    this.registerTool({
      name: 'delete_selected_hologram',
      description: 'Consequential action: Remove the currently selected 3D hologram from the workspace. Requires explicit user approval.',
      permissionLevel: 'CONSEQUENTIAL',
      requiresConfirmation: true,
      inputSchema: {
        type: 'object',
        properties: {}
      },
      execute: async () => {
        if (!this.host) {
          return { ok: false, verified: false, summary: 'Workspace host unavailable.', error: 'No host.' };
        }
        const ok = await this.host.deleteSelected();
        return {
          ok,
          verified: ok,
          summary: ok
            ? 'Selected hologram deleted with authorization.'
            : 'Deletion was cancelled or declined.'
        };
      }
    });

    this.registerTool({
      name: 'export_workspace_notes',
      description: 'Consequential action: Export workspace mission notes to an authorized local file.',
      permissionLevel: 'CONSEQUENTIAL',
      requiresConfirmation: true,
      inputSchema: {
        type: 'object',
        properties: {}
      },
      execute: async () => {
        if (!this.host) {
          return { ok: false, verified: false, summary: 'Workspace host unavailable.', error: 'No host.' };
        }
        const ok = await this.host.exportNotes();
        return {
          ok,
          verified: ok,
          summary: ok
            ? 'Exported workspace notes via authorized local save picker.'
            : 'File export cancelled or unavailable.'
        };
      }
    });

    this.registerTool({
      name: 'clear_persistent_memory',
      description: 'Consequential action: Clear all saved user-controlled persistent memories. Requires explicit confirmation.',
      permissionLevel: 'CONSEQUENTIAL',
      requiresConfirmation: true,
      inputSchema: {
        type: 'object',
        properties: {}
      },
      execute: () => {
        const res = memoryManager.clearAllMemories();
        return {
          ok: res.ok,
          verified: res.ok,
          summary: res.ok ? 'Cleared all persistent user memories.' : `Memory clear failed: ${res.error}`,
          error: res.error
        };
      }
    });

    // =========================================================================
    // Phase 5 — Permission-Gated Real-World Action Tools
    // =========================================================================

    this.registerTool({
      name: 'access_user_file',
      description: 'Open or read a user-selected file after explicit FILE_ACCESS permission approval.',
      permissionLevel: 'CONSEQUENTIAL',
      requiresConfirmation: true,
      inputSchema: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: 'Session file identifier selected by the user.' },
          permissionId: { type: 'string', description: 'Single-use approved FILE_ACCESS permission ID.' }
        },
        required: ['fileId', 'permissionId']
      },
      execute: async (args) => {
        const fileId = String(args.fileId || '');
        const permissionId = String(args.permissionId || '');
        const res = await fileAccessService.openAuthorizedFile(fileId, permissionId);
        return {
          ok: res.ok,
          verified: res.ok,
          summary: res.summary || res.error || 'Unable to open selected file.',
          data: { fileResult: res },
          error: res.error
        };
      }
    });

    this.registerTool({
      name: 'open_external_url',
      description: 'Open a validated HTTPS website in a new browser tab after explicit BROWSER_ACCESS approval.',
      permissionLevel: 'CONSEQUENTIAL',
      requiresConfirmation: true,
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Validated HTTPS URL to open.' },
          permissionId: { type: 'string', description: 'Single-use approved BROWSER_ACCESS permission ID.' }
        },
        required: ['url', 'permissionId']
      },
      execute: (args) => {
        const rawUrl = String(args.url || '');
        const permissionId = String(args.permissionId || '');
        const preview = validateNavigationUrl(rawUrl);
        if (!preview.valid || !preview.normalizedUrl) {
          return {
            ok: false,
            verified: false,
            summary: preview.error || 'Blocked invalid URL.',
            error: preview.error
          };
        }
        const nav = browserActionService.openApprovedUrl(preview.normalizedUrl, permissionId, 'BROWSER_ACCESS');
        return {
          ok: nav.ok,
          verified: nav.ok && nav.openedInNewTab,
          summary: nav.summary,
          data: { browserAction: nav },
          error: nav.error
        };
      }
    });

    this.registerTool({
      name: 'search_web',
      description: 'Execute a user-approved web search query via public HTTPS endpoints or browser search tab.',
      permissionLevel: 'CONSEQUENTIAL',
      requiresConfirmation: true,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Extracted search query string.' },
          provider: {
            type: 'string',
            description: 'Search provider destination.',
            enum: ['DUCKDUCKGO', 'WIKIPEDIA', 'GOOGLE', 'MDN', 'GITHUB']
          },
          permissionId: { type: 'string', description: 'Single-use approved WEB_SEARCH permission ID.' },
          openInBrowserFallback: {
            type: 'boolean',
            description: 'Open approved query in browser tab if API returns zero results.'
          }
        },
        required: ['query', 'permissionId']
      },
      execute: async (args) => {
        const intent = extractSearchIntent(String(args.query || ''));
        const cleanQuery = intent.query || String(args.query || '').trim();
        const permissionId = String(args.permissionId || '');
        const provider = (args.provider as WebSearchProviderId | undefined) || 'DUCKDUCKGO';
        const searchRes = await webSearchService.executeApprovedSearch(cleanQuery, permissionId, {
          provider,
          openInBrowserFallback: Boolean(args.openInBrowserFallback)
        });
        return {
          ok: searchRes.ok,
          verified: searchRes.ok && (searchRes.results.length > 0 || Boolean(searchRes.openedInBrowser)),
          summary: searchRes.ok
            ? searchRes.sourceSummary || `Search completed for "${searchRes.query}" via ${searchRes.provider}.`
            : searchRes.error || 'Unable to complete web search.',
          data: { searchResult: searchRes },
          error: searchRes.error
        };
      }
    });

    this.registerTool({
      name: 'control_music_playback',
      description: 'Play user-approved local audio or open an official music service link; pause, resume, stop, or adjust volume.',
      permissionLevel: 'CONSEQUENTIAL',
      requiresConfirmation: true,
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: 'Music operation to execute.',
            enum: ['PLAY_LOCAL', 'OPEN_SERVICE', 'PAUSE', 'RESUME', 'STOP', 'SET_VOLUME']
          },
          fileId: { type: 'string', description: 'Selected local audio file ID.' },
          sourceType: {
            type: 'string',
            description: 'Music service source type.',
            enum: ['LOCAL_AUDIO', 'SPOTIFY', 'YOUTUBE_MUSIC', 'SOUNDCLOUD', 'YOUTUBE']
          },
          query: { type: 'string', description: 'Requested song, artist, or genre query.' },
          volume: { type: 'number', description: 'Volume between 0 and 1.', min: 0, max: 1 },
          permissionId: { type: 'string', description: 'Approved MUSIC_PLAYBACK permission ID when starting playback or opening external service.' }
        },
        required: ['action']
      },
      execute: async (args) => {
        const action = String(args.action || '');
        if (action === 'PAUSE') {
          const ok = musicService.pause();
          const st = musicService.getState();
          return {
            ok,
            verified: ok,
            summary: st.statusMessage,
            data: { musicState: st },
            error: ok ? undefined : 'No active local audio track to pause.'
          };
        }
        if (action === 'RESUME') {
          const ok = await musicService.resume();
          const st = musicService.getState();
          return {
            ok,
            verified: ok,
            summary: st.statusMessage,
            data: { musicState: st },
            error: ok ? undefined : st.error || 'Unable to resume audio.'
          };
        }
        if (action === 'STOP') {
          const ok = musicService.stop();
          const st = musicService.getState();
          return {
            ok,
            verified: true,
            summary: st.statusMessage,
            data: { musicState: st }
          };
        }
        if (action === 'SET_VOLUME') {
          const vol = musicService.setVolume(Number(args.volume ?? 0.75));
          const st = musicService.getState();
          return {
            ok: true,
            verified: Math.abs(st.volume - vol) < 0.01,
            summary: st.statusMessage,
            data: { musicState: st }
          };
        }

        const permissionId = String(args.permissionId || '');
        if (!permissionId) {
          return {
            ok: false,
            verified: false,
            summary: 'Explicit MUSIC_PLAYBACK permission is required before starting music playback or opening a service link.',
            error: 'USER_CONFIRMATION_REQUIRED'
          };
        }

        if (action === 'PLAY_LOCAL') {
          const fileId = String(args.fileId || '');
          const file = fileAccessService.getRawFile(fileId);
          if (!file) {
            permissionManager.completeExecution(permissionId, false, 'Audio file unavailable.', 'MISSING_FILE');
            return { ok: false, verified: false, summary: 'Selected local audio file was not found.', error: 'MISSING_FILE' };
          }
          const st = await musicService.playApprovedLocalAudio(file, permissionId);
          const ok = st.status === 'PLAYING' || (st.status === 'PAUSED' && Boolean(st.autoplayBlocked));
          return {
            ok,
            verified: ok,
            summary: st.statusMessage,
            data: { musicState: st },
            error: st.error
          };
        }

        if (action === 'OPEN_SERVICE') {
          const sourceType = (args.sourceType as MusicSourceType | undefined) || 'SPOTIFY';
          if (sourceType === 'LOCAL_AUDIO' || sourceType === 'DIRECT_STREAM') {
            return {
              ok: false,
              verified: false,
              summary: 'Specify SPOTIFY, YOUTUBE_MUSIC, SOUNDCLOUD, or YOUTUBE for external service links.',
              error: 'INVALID_SOURCE_TYPE'
            };
          }
          const st = musicService.openApprovedMusicServiceLink(
            sourceType,
            String(args.query || ''),
            permissionId
          );
          const ok = st.status === 'OPENED_EXTERNAL_LINK';
          return {
            ok,
            verified: ok,
            summary: st.statusMessage,
            data: { musicState: st },
            error: st.error
          };
        }

        return { ok: false, verified: false, summary: `Unknown music action "${action}".`, error: 'UNKNOWN_ACTION' };
      }
    });

    // =========================================================================
    // Phase 7 — Windows Desktop Automation & Application Tools
    // =========================================================================

    this.registerTool({
      name: 'launch_desktop_application',
      description: 'Launch an approved Windows/Desktop application (VS_CODE, NOTEPAD, CALCULATOR, EXPLORER, BROWSER, CHROME, SPOTIFY) after explicit APPLICATION_LAUNCH permission.',
      permissionLevel: 'CONSEQUENTIAL',
      requiresConfirmation: true,
      inputSchema: {
        type: 'object',
        properties: {
          applicationId: {
            type: 'string',
            description: 'Application identifier (VS_CODE, NOTEPAD, CALCULATOR, EXPLORER, BROWSER, CHROME, SPOTIFY).'
          },
          permissionId: {
            type: 'string',
            description: 'Approved APPLICATION_LAUNCH permission ID.'
          },
          args: {
            type: 'array',
            description: 'Optional safe command line arguments.'
          }
        },
        required: ['applicationId', 'permissionId']
      },
      execute: async (args) => {
        const appId = String(args.applicationId || '');
        const permissionId = String(args.permissionId || '');
        const customArgs = Array.isArray(args.args) ? (args.args as string[]) : [];
        const res = await desktopBridge.launchApplication(appId, permissionId, customArgs);
        return {
          ok: res.ok,
          verified: res.verified,
          summary: res.summary,
          data: { desktopResult: res },
          error: res.error
        };
      }
    });

    this.registerTool({
      name: 'open_desktop_folder',
      description: 'Open a verified local directory/folder in Windows Explorer after explicit FOLDER_ACCESS permission.',
      permissionLevel: 'CONSEQUENTIAL',
      requiresConfirmation: true,
      inputSchema: {
        type: 'object',
        properties: {
          folderPath: { type: 'string', description: 'Validated path to folder.' },
          permissionId: { type: 'string', description: 'Approved FOLDER_ACCESS permission ID.' }
        },
        required: ['folderPath', 'permissionId']
      },
      execute: async (args) => {
        const folderPath = String(args.folderPath || '');
        const permissionId = String(args.permissionId || '');
        const res = await desktopBridge.openFolder(folderPath, permissionId);
        return {
          ok: res.ok,
          verified: res.verified,
          summary: res.summary,
          data: { desktopResult: res },
          error: res.error
        };
      }
    });

    this.registerTool({
      name: 'open_desktop_file_system',
      description: 'Open a verified file on the local filesystem using its default application after explicit FILE_ACCESS permission.',
      permissionLevel: 'CONSEQUENTIAL',
      requiresConfirmation: true,
      inputSchema: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Validated path to file.' },
          permissionId: { type: 'string', description: 'Approved FILE_ACCESS permission ID.' }
        },
        required: ['filePath', 'permissionId']
      },
      execute: async (args) => {
        const filePath = String(args.filePath || '');
        const permissionId = String(args.permissionId || '');
        const res = await desktopBridge.openFile(filePath, permissionId);
        return {
          ok: res.ok,
          verified: res.verified,
          summary: res.summary,
          data: { desktopResult: res },
          error: res.error
        };
      }
    });

    this.registerTool({
      name: 'open_desktop_browser',
      description: 'Open default web browser with a validated URL after explicit BROWSER_ACCESS permission.',
      permissionLevel: 'CONSEQUENTIAL',
      requiresConfirmation: true,
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Validated HTTP/HTTPS URL.' },
          permissionId: { type: 'string', description: 'Approved BROWSER_ACCESS permission ID.' }
        },
        required: ['url', 'permissionId']
      },
      execute: async (args) => {
        const url = String(args.url || '');
        const permissionId = String(args.permissionId || '');
        const res = await desktopBridge.openBrowser(url, permissionId);
        return {
          ok: res.ok,
          verified: res.verified,
          summary: res.summary,
          data: { desktopResult: res },
          error: res.error
        };
      }
    });

    this.registerTool({
      name: 'desktop_web_search',
      description: 'Search the web in default browser with validated query after explicit WEB_SEARCH permission.',
      permissionLevel: 'CONSEQUENTIAL',
      requiresConfirmation: true,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search terms.' },
          permissionId: { type: 'string', description: 'Approved WEB_SEARCH permission ID.' },
          engine: { type: 'string', description: 'Search engine (google, duckduckgo, bing).' }
        },
        required: ['query', 'permissionId']
      },
      execute: async (args) => {
        const query = String(args.query || '');
        const permissionId = String(args.permissionId || '');
        const engine = String(args.engine || 'google');
        const res = await desktopBridge.searchWeb(query, permissionId, engine);
        return {
          ok: res.ok,
          verified: res.verified,
          summary: res.summary,
          data: { desktopResult: res },
          error: res.error
        };
      }
    });

    this.registerTool({
      name: 'launch_desktop_music',
      description: 'Launch Spotify or authorized desktop music player after explicit MUSIC_CONTROL permission.',
      permissionLevel: 'CONSEQUENTIAL',
      requiresConfirmation: true,
      inputSchema: {
        type: 'object',
        properties: {
          musicTarget: { type: 'string', description: 'Music app or service target (e.g. Spotify).' },
          permissionId: { type: 'string', description: 'Approved MUSIC_CONTROL permission ID.' }
        },
        required: ['musicTarget', 'permissionId']
      },
      execute: async (args) => {
        const musicTarget = String(args.musicTarget || 'Spotify');
        const permissionId = String(args.permissionId || '');
        const res = await desktopBridge.launchMusic(musicTarget, permissionId);
        return {
          ok: res.ok,
          verified: res.verified,
          summary: res.summary,
          data: { desktopResult: res },
          error: res.error
        };
      }
    });

    this.registerTool({
      name: 'find_folder_files',
      description: 'Search and inspect file names inside an authorized directory path.',
      permissionLevel: 'READ_ONLY',
      requiresConfirmation: false,
      inputSchema: {
        type: 'object',
        properties: {
          folderPath: { type: 'string', description: 'Directory path to inspect.' },
          filterPattern: { type: 'string', description: 'Optional filename filter substring.' }
        },
        required: ['folderPath']
      },
      execute: async (args) => {
        const folderPath = String(args.folderPath || '');
        const filterPattern = args.filterPattern ? String(args.filterPattern) : undefined;
        const res = await desktopBridge.findFilesInFolder(folderPath, filterPattern);
        return {
          ok: res.ok,
          verified: res.ok,
          summary: res.ok
            ? `Found ${res.files.length} file(s) in "${res.folder}".`
            : res.error || 'Unable to inspect folder.',
          data: { searchResult: res },
          error: res.error
        };
      }
    });

    this.registerTool({
      name: 'discover_desktop_applications',
      description: 'Discover all supported desktop applications and their installation/availability status.',
      permissionLevel: 'READ_ONLY',
      requiresConfirmation: false,
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      },
      execute: async () => {
        const apps = await desktopBridge.discoverApplications();
        const availableCount = apps.filter((a) => a.available).length;
        return {
          ok: true,
          verified: true,
          summary: `Discovered ${apps.length} supported applications (${availableCount} available on this system).`,
          data: { applications: apps }
        };
      }
    });

    this.registerTool({
      name: 'list_desktop_folder_contents',
      description: 'List all files and subdirectories with sizes, extensions, and timestamps inside an authorized folder.',
      permissionLevel: 'READ_ONLY',
      requiresConfirmation: false,
      inputSchema: {
        type: 'object',
        properties: {
          folderPath: { type: 'string', description: 'Directory path to list.' }
        },
        required: ['folderPath']
      },
      execute: async (args) => {
        const folderPath = String(args.folderPath || '');
        const res = await desktopBridge.listFilesInFolder(folderPath);
        return {
          ok: res.ok,
          verified: res.ok,
          summary: res.ok
            ? `Listed ${res.items.length} item(s) inside "${res.folder}".`
            : res.error || 'Failed listing folder.',
          data: { folderListing: res },
          error: res.error
        };
      }
    });

    this.registerTool({
      name: 'read_desktop_file',
      description: 'Read safe text or document contents from an authorized desktop file path.',
      permissionLevel: 'READ_ONLY',
      requiresConfirmation: false,
      inputSchema: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'File path to read.' },
          permissionId: { type: 'string', description: 'Optional approval token if required.' }
        },
        required: ['filePath']
      },
      execute: async (args) => {
        const filePath = String(args.filePath || '');
        const permissionId = args.permissionId ? String(args.permissionId) : undefined;
        const res = await desktopBridge.readApprovedDesktopFile(filePath, permissionId);
        return {
          ok: res.ok,
          verified: res.ok,
          summary: res.ok
            ? `Read "${res.name}" (${res.sizeBytes || 0} bytes).`
            : res.error || 'Failed reading desktop file.',
          data: { fileRead: res },
          error: res.error
        };
      }
    });

    this.registerTool({
      name: 'create_desktop_text_file',
      description: 'Create a new text or markdown file inside an authorized folder path with overwrite protection.',
      permissionLevel: 'CONSEQUENTIAL',
      requiresConfirmation: true,
      inputSchema: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Target destination file path.' },
          content: { type: 'string', description: 'Text or code content to write.' },
          overwrite: { type: 'boolean', description: 'Explicitly permit overwriting an existing file.' },
          permissionId: { type: 'string', description: 'Approved FILE_CREATE permission ID.' }
        },
        required: ['filePath', 'content', 'permissionId']
      },
      execute: async (args) => {
        const filePath = String(args.filePath || '');
        const content = String(args.content || '');
        const overwrite = Boolean(args.overwrite);
        const permissionId = String(args.permissionId || '');
        const res = await desktopBridge.createApprovedDesktopFile(filePath, content, overwrite, permissionId);
        return {
          ok: res.ok,
          verified: res.ok,
          summary: res.ok
            ? `Successfully created "${res.name}" (${res.sizeBytes || 0} bytes).`
            : res.error || 'Failed creating desktop file.',
          data: { fileCreated: res },
          error: res.error
        };
      }
    });

    this.registerTool({
      name: 'inspect_web_page',
      description: 'Inspect public title and meta summary of an approved HTTP/HTTPS website safely.',
      permissionLevel: 'READ_ONLY',
      requiresConfirmation: false,
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Target website URL.' }
        },
        required: ['url']
      },
      execute: async (args) => {
        const url = String(args.url || '');
        const res = await desktopBridge.inspectWebPage(url);
        return {
          ok: res.ok,
          verified: res.ok,
          summary: res.ok
            ? `Inspected "${res.title || res.url}"`
            : res.error || 'Failed inspecting webpage.',
          data: { pageInspection: res },
          error: res.error
        };
      }
    });

    this.registerTool({
      name: 'run_desktop_workflow',
      description: 'Run a structured sequential multi-step desktop workflow with progress tracking.',
      permissionLevel: 'CONSEQUENTIAL',
      requiresConfirmation: true,
      inputSchema: {
        type: 'object',
        properties: {
          folderName: { type: 'string', description: 'Approved project folder name.' },
          fileName: { type: 'string', description: 'Target file name to inspect and summarize.' },
          saveFileName: { type: 'string', description: 'Name of the summary output file.' }
        },
        required: ['folderName', 'fileName']
      },
      execute: async (args) => {
        const folderName = String(args.folderName || '');
        const fileName = String(args.fileName || '');
        const saveFileName = args.saveFileName ? String(args.saveFileName) : 'summary.txt';

        const workflow = desktopWorkflowService.createProjectFileSummaryWorkflow(folderName, fileName, saveFileName);
        const ok = await desktopWorkflowService.runWorkflow(workflow);
        return {
          ok,
          verified: ok,
          summary: ok
            ? `Multi-step workflow "${workflow.title}" completed successfully.`
            : 'Workflow stopped or cancelled before full completion.',
          data: { workflowResult: desktopWorkflowService.getActiveWorkflow() }
        };
      }
    });
  }
}

export const toolRegistry = new ToolRegistry();
