import { BackendLLMStatusResponse } from '../types/assistant';
import { contextualAI } from './contextualAI';
import { devStudioService } from './devStudioService';
import { handTrackingService } from './handTracking';
import { permissionManager } from './permissionManager';
import { ALL_CAPABILITY_IDS, permissionPolicy } from './permissionPolicy';
import { speechService } from './speechService';

export type HealthCheckStatus = 'AVAILABLE' | 'UNAVAILABLE' | 'UNSUPPORTED' | 'UNTESTED';

export interface SubsystemHealthEntry {
  id:
    | 'BACKEND_API'
    | 'AI_PROVIDERS'
    | 'VOICE_ENGINE'
    | 'CAMERA_MEDIAPIPE'
    | 'HOLOGRAPHIC_3D'
    | 'DESKTOP_BRIDGE'
    | 'PERMISSIONS'
    | 'DEV_STUDIO';
  label: string;
  status: HealthCheckStatus;
  summary: string;
  detail: string;
  checkedAt: number | null;
}

export interface SystemHealthSnapshot {
  lastProbedAt: number | null;
  probing: boolean;
  overallStatus: 'READY' | 'DEGRADED' | 'LIMITED';
  subsystems: SubsystemHealthEntry[];
  backendStatus: BackendLLMStatusResponse | null;
}

export interface SystemHealthProbeOptions {
  hasActiveSceneManager?: boolean;
  probeBackend?: boolean;
}

function createInitialSubsystems(): SubsystemHealthEntry[] {
  return [
    {
      id: 'BACKEND_API',
      label: 'Express Backend API',
      status: 'UNTESTED',
      summary: 'Awaiting health check probe',
      detail: 'Probes /api/health to verify local Node/Express backend availability.',
      checkedAt: null
    },
    {
      id: 'AI_PROVIDERS',
      label: 'AI Providers (Gemini / Groq / Local)',
      status: 'UNTESTED',
      summary: 'Awaiting provider status check',
      detail: 'Checks configured server keys and local autonomous fallback.',
      checkedAt: null
    },
    {
      id: 'VOICE_ENGINE',
      label: 'Voice Recognition & Speech Synthesis',
      status: 'UNTESTED',
      summary: 'Awaiting Web Speech capability check',
      detail: 'Checks SpeechRecognition API, speechSynthesis, and MICROPHONE_ACCESS policy.',
      checkedAt: null
    },
    {
      id: 'CAMERA_MEDIAPIPE',
      label: 'Optical Camera & MediaPipe',
      status: 'UNTESTED',
      summary: 'Awaiting camera sensor check',
      detail: 'Checks navigator.mediaDevices, camera policy, and HandLandmarker status.',
      checkedAt: null
    },
    {
      id: 'HOLOGRAPHIC_3D',
      label: 'Three.js Holographic Renderer',
      status: 'UNTESTED',
      summary: 'Awaiting WebGL check',
      detail: 'Checks active scene instance or WebGL rendering capability.',
      checkedAt: null
    },
    {
      id: 'DESKTOP_BRIDGE',
      label: 'Desktop Control Bridge',
      status: 'UNTESTED',
      summary: 'Awaiting bridge mode probe',
      detail: 'Checks Electron preload IPC bridge vs local HTTP automation endpoint.',
      checkedAt: null
    },
    {
      id: 'PERMISSIONS',
      label: 'Permission & Security Policy',
      status: 'UNTESTED',
      summary: 'Inspecting local policy',
      detail: 'Tracks setup completion, persistent capability grants, and pending confirmations.',
      checkedAt: null
    },
    {
      id: 'DEV_STUDIO',
      label: 'AI Development Studio',
      status: 'UNTESTED',
      summary: 'Inspecting workspace & CLI tools',
      detail: 'Checks approved project folders and local development tool probes.',
      checkedAt: null
    }
  ];
}

function probeWebGLSupport(): { supported: boolean; detail: string } {
  if (typeof document === 'undefined') {
    return { supported: false, detail: 'DOM unavailable outside browser context.' };
  }
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (gl) {
      return { supported: true, detail: 'WebGL context available for Three.js rendering.' };
    }
    return { supported: false, detail: 'WebGL context unavailable in this environment.' };
  } catch {
    return { supported: false, detail: 'WebGL probe rejected by browser runtime.' };
  }
}

export class SystemHealthService {
  private snapshot: SystemHealthSnapshot = {
    lastProbedAt: null,
    probing: false,
    overallStatus: 'LIMITED',
    subsystems: createInitialSubsystems(),
    backendStatus: null
  };
  private listeners: Set<() => void> = new Set();

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((fn) => fn());
  }

  public getSnapshot(): SystemHealthSnapshot {
    return {
      ...this.snapshot,
      subsystems: this.snapshot.subsystems.map((s) => ({ ...s }))
    };
  }

  public async probeAll(options: SystemHealthProbeOptions = {}): Promise<SystemHealthSnapshot> {
    const { hasActiveSceneManager = false, probeBackend = true } = options;
    this.snapshot.probing = true;
    this.notify();

    const now = Date.now();
    const entries: SubsystemHealthEntry[] = [];
    let backendStatus: BackendLLMStatusResponse | null = null;
    let backendHealthy = false;

    // 1. Backend API (/api/health)
    if (!probeBackend || typeof fetch !== 'function') {
      entries.push({
        id: 'BACKEND_API',
        label: 'Express Backend API',
        status: typeof fetch !== 'function' ? 'UNSUPPORTED' : 'UNTESTED',
        summary: typeof fetch !== 'function' ? 'Fetch API unavailable' : 'Backend probe skipped',
        detail: 'Did not probe /api/health.',
        checkedAt: now
      });
    } else {
      try {
        const res = await fetch('/api/health');
        if (res.ok) {
          backendHealthy = true;
          entries.push({
            id: 'BACKEND_API',
            label: 'Express Backend API',
            status: 'AVAILABLE',
            summary: 'Backend online (HTTP 200)',
            detail: 'Express /api/health responded normally.',
            checkedAt: now
          });
        } else {
          entries.push({
            id: 'BACKEND_API',
            label: 'Express Backend API',
            status: 'UNAVAILABLE',
            summary: `Backend HTTP ${res.status}`,
            detail: '/api/health returned a non-OK status.',
            checkedAt: now
          });
        }
      } catch (err) {
        entries.push({
          id: 'BACKEND_API',
          label: 'Express Backend API',
          status: 'UNAVAILABLE',
          summary: 'Backend unreachable',
          detail: err instanceof Error ? err.message : 'Network error reaching /api/health.',
          checkedAt: now
        });
      }
    }

    // 2. AI Providers
    if (probeBackend && typeof fetch === 'function') {
      backendStatus = await contextualAI.getBackendStatus();
    } else {
      backendStatus = contextualAI.getCachedBackendStatus();
    }
    const geminiOk = backendStatus?.gemini?.status === 'connected';
    const groqOk = backendStatus?.groq?.status === 'connected';
    const volatileKey = contextualAI.hasApiKey();
    if (geminiOk || groqOk || volatileKey) {
      const activeNames: string[] = [];
      if (geminiOk) activeNames.push(`Gemini (${backendStatus?.gemini?.model || 'primary'})`);
      if (groqOk) activeNames.push(`Groq (${backendStatus?.groq?.model || 'fallback'})`);
      if (volatileKey) activeNames.push('Session Client Key');
      entries.push({
        id: 'AI_PROVIDERS',
        label: 'AI Providers (Gemini / Groq / Local)',
        status: 'AVAILABLE',
        summary: activeNames.join(' + '),
        detail: 'Cloud inference ready with JARVIS local autonomous intent fallback.',
        checkedAt: now
      });
    } else if (backendStatus) {
      entries.push({
        id: 'AI_PROVIDERS',
        label: 'AI Providers (Gemini / Groq / Local)',
        status: 'UNAVAILABLE',
        summary: 'No cloud API key configured (Local core active)',
        detail: 'Configure GEMINI_API_KEY or GROQ_API_KEY in server/.env for cloud LLM responses.',
        checkedAt: now
      });
    } else {
      entries.push({
        id: 'AI_PROVIDERS',
        label: 'AI Providers (Gemini / Groq / Local)',
        status: probeBackend ? 'UNAVAILABLE' : 'UNTESTED',
        summary: probeBackend ? 'Provider status endpoint unreachable' : 'Provider status untested',
        detail: 'Local deterministic command fallback remains active offline.',
        checkedAt: now
      });
    }

    // 3. Voice Recognition & Speech Synthesis
    const recSupported = speechService.isSpeechRecognitionSupported();
    const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
    const micPolicy = permissionPolicy.getCapabilityDecision('MICROPHONE_ACCESS');
    if (micPolicy === 'DENIED') {
      entries.push({
        id: 'VOICE_ENGINE',
        label: 'Voice Recognition & Speech Synthesis',
        status: 'UNAVAILABLE',
        summary: 'Disabled by MICROPHONE_ACCESS policy',
        detail: 'Enable Microphone Access in Permissions to use voice input; typed console stays active.',
        checkedAt: now
      });
    } else if (!recSupported && !ttsSupported) {
      entries.push({
        id: 'VOICE_ENGINE',
        label: 'Voice Recognition & Speech Synthesis',
        status: 'UNSUPPORTED',
        summary: 'Web Speech APIs unsupported in runtime',
        detail: 'Typed Vocal Console input works without browser SpeechRecognition.',
        checkedAt: now
      });
    } else if (!recSupported) {
      entries.push({
        id: 'VOICE_ENGINE',
        label: 'Voice Recognition & Speech Synthesis',
        status: 'UNSUPPORTED',
        summary: 'TTS ready; SpeechRecognition unsupported',
        detail: 'Use Chrome/Edge for mic dictation, or type commands in the Vocal Console.',
        checkedAt: now
      });
    } else {
      entries.push({
        id: 'VOICE_ENGINE',
        label: 'Voice Recognition & Speech Synthesis',
        status: 'AVAILABLE',
        summary: `Voice API ready (${speechService.getLifecycleState()})`,
        detail: ttsSupported
          ? 'SpeechRecognition and speechSynthesis available.'
          : 'SpeechRecognition available; speechSynthesis unavailable.',
        checkedAt: now
      });
    }

    // 4. Camera & MediaPipe
    const hasMediaDevices =
      typeof navigator !== 'undefined' &&
      Boolean(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');
    const camPolicy = permissionPolicy.getCapabilityDecision('CAMERA_ACCESS');
    const camPerm = handTrackingService.getPermissionStatus();
    if (!hasMediaDevices) {
      entries.push({
        id: 'CAMERA_MEDIAPIPE',
        label: 'Optical Camera & MediaPipe',
        status: 'UNSUPPORTED',
        summary: 'MediaDevices.getUserMedia unavailable',
        detail: 'Requires secure browser origin (HTTPS or localhost) with webcam support.',
        checkedAt: now
      });
    } else if (camPolicy === 'DENIED' || camPerm === 'denied') {
      entries.push({
        id: 'CAMERA_MEDIAPIPE',
        label: 'Optical Camera & MediaPipe',
        status: 'UNAVAILABLE',
        summary: camPolicy === 'DENIED' ? 'Disabled in JARVIS Permissions' : 'Denied by browser/OS',
        detail: handTrackingService.getLastError() || 'Allow Camera Access to activate MediaPipe tracking.',
        checkedAt: now
      });
    } else if (camPerm === 'unavailable' || camPerm === 'error') {
      entries.push({
        id: 'CAMERA_MEDIAPIPE',
        label: 'Optical Camera & MediaPipe',
        status: 'UNAVAILABLE',
        summary: camPerm === 'unavailable' ? 'No webcam detected' : 'Camera initialization error',
        detail: handTrackingService.getLastError() || 'Connect a camera or use mouse/gesture presets.',
        checkedAt: now
      });
    } else {
      entries.push({
        id: 'CAMERA_MEDIAPIPE',
        label: 'Optical Camera & MediaPipe',
        status: 'AVAILABLE',
        summary: handTrackingService.isTracking()
          ? `Tracking active (${handTrackingService.getFps()} FPS)`
          : `Ready (sensor ${camPerm})`,
        detail: 'MediaPipe HandLandmarker initializes lazily when camera sensor is toggled ON.',
        checkedAt: now
      });
    }

    // 5. Three.js 3D Holographic Renderer
    if (hasActiveSceneManager) {
      entries.push({
        id: 'HOLOGRAPHIC_3D',
        label: 'Three.js Holographic Renderer',
        status: 'AVAILABLE',
        summary: 'Active 3D Scene mounted',
        detail: 'WebGL renderer, HolographicHandMesh, RingGimbals, and spatial objects initialized.',
        checkedAt: now
      });
    } else {
      const glProbe = probeWebGLSupport();
      entries.push({
        id: 'HOLOGRAPHIC_3D',
        label: 'Three.js Holographic Renderer',
        status: glProbe.supported ? 'AVAILABLE' : 'UNSUPPORTED',
        summary: glProbe.supported ? 'WebGL supported' : 'WebGL unavailable',
        detail: glProbe.detail,
        checkedAt: now
      });
    }

    // 6. Desktop Bridge
    const hasElectron =
      typeof window !== 'undefined' &&
      Boolean((window as unknown as { jarvisDesktop?: { isElectron?: boolean } }).jarvisDesktop?.isElectron);
    let desktopReachable = hasElectron;
    let desktopSummary = hasElectron ? 'Electron Preload IPC Bridge active' : 'Browser HTTP Bridge';
    if (!hasElectron && probeBackend && typeof fetch === 'function') {
      try {
        const res = await fetch('/api/desktop/status');
        if (res.ok) {
          desktopReachable = true;
          desktopSummary = 'Local HTTP Desktop Service ready';
        }
      } catch {
        desktopReachable = false;
      }
    }
    entries.push({
      id: 'DESKTOP_BRIDGE',
      label: 'Desktop Control Bridge',
      status: hasElectron ? 'AVAILABLE' : backendHealthy || desktopReachable ? 'AVAILABLE' : 'UNAVAILABLE',
      summary: desktopSummary,
      detail: hasElectron
        ? 'Full Electron IPC desktop automation, file dialogs, and folder workspace access enabled.'
        : desktopReachable
        ? 'Running via Express desktop automation routes with allowlist and folder boundary enforcement.'
        : 'Desktop automation routes unreachable without running local server or Electron host.',
      checkedAt: now
    });

    // 7. Permissions & Policy
    const grantedCount = ALL_CAPABILITY_IDS.filter(
      (id) => permissionPolicy.getCapabilityDecision(id) === 'GRANTED'
    ).length;
    const deniedCount = ALL_CAPABILITY_IDS.filter(
      (id) => permissionPolicy.getCapabilityDecision(id) === 'DENIED'
    ).length;
    const pendingCount = permissionManager.getPendingRequests(now).length;
    entries.push({
      id: 'PERMISSIONS',
      label: 'Permission & Security Policy',
      status: 'AVAILABLE',
      summary: `${grantedCount} granted, ${deniedCount} denied${pendingCount ? `, ${pendingCount} pending` : ''}`,
      detail: `Setup ${permissionPolicy.isSetupCompleted() ? 'completed' : 'pending'}. ${permissionPolicy.getApprovedFolders().length} approved folder(s).`,
      checkedAt: now
    });

    // 8. AI Dev Studio
    const approvedFolderCount = permissionPolicy.getApprovedFolders().length;
    const tools = devStudioService.getDevTools();
    const availableToolCount = tools.filter((t) => t.available).length;
    entries.push({
      id: 'DEV_STUDIO',
      label: 'AI Development Studio',
      status: hasElectron || backendHealthy ? 'AVAILABLE' : 'UNAVAILABLE',
      summary:
        tools.length > 0
          ? `${approvedFolderCount} folder(s) · ${availableToolCount}/${tools.length} CLI tools`
          : `${approvedFolderCount} approved workspace folder(s)`,
      detail:
        hasElectron || backendHealthy
          ? 'Diff-preview enforcement, secret exclusion, and allowlisted dev tool runner active.'
          : 'Requires running local server or Electron host to inspect files and run checks.',
      checkedAt: now
    });

    const coreReady =
      entries.find((e) => e.id === 'HOLOGRAPHIC_3D')?.status === 'AVAILABLE' &&
      entries.find((e) => e.id === 'PERMISSIONS')?.status === 'AVAILABLE';
    const anyUnavailable = entries.some(
      (e) => e.id !== 'AI_PROVIDERS' && e.status === 'UNAVAILABLE'
    );

    const overallStatus: SystemHealthSnapshot['overallStatus'] = !coreReady
      ? 'LIMITED'
      : anyUnavailable
      ? 'DEGRADED'
      : 'READY';

    this.snapshot = {
      lastProbedAt: now,
      probing: false,
      overallStatus,
      subsystems: entries,
      backendStatus
    };
    this.notify();
    return this.getSnapshot();
  }
}

export const systemHealthService = new SystemHealthService();
