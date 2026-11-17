import {
  ApprovedFolderEntry,
  PermissionCapabilityId,
  PermissionDisplayState,
  PermissionGrantDecision,
  PermissionSecurityLevel,
  PersistentPermissionConfig
} from '../types/assistant';

const POLICY_STORAGE_KEY = 'jarvis_persistent_permissions_v1';
const POLICY_VERSION = 1;

export const PERMISSION_CAPABILITY_METADATA: Record<
  PermissionCapabilityId,
  {
    id: PermissionCapabilityId;
    name: string;
    shortTitle: string;
    description: string;
    levelSummary: string;
    defaultLevel: PermissionSecurityLevel;
    examples: string[];
  }
> = {
  APPLICATION_ACCESS: {
    id: 'APPLICATION_ACCESS',
    name: 'Application Access',
    shortTitle: 'Desktop Apps',
    description:
      'Launch approved desktop applications from the strict allowlist (Calculator, Notepad, Visual Studio Code, File Explorer, Chrome, Spotify).',
    levelSummary: 'Level 1 when enabled for allowlisted apps; terminal shells are always blocked.',
    defaultLevel: 'LEVEL_1_PREAPPROVED',
    examples: ['Calculator', 'Notepad', 'Visual Studio Code', 'File Explorer', 'Chrome']
  },
  BROWSER_ACCESS: {
    id: 'BROWSER_ACCESS',
    name: 'Browser & Web Search Access',
    shortTitle: 'Web Browser',
    description:
      'Open the default web browser, launch validated HTTP/HTTPS links, and run user-requested web searches.',
    levelSummary: 'Level 1 for validated links and web searches; credential URLs are blocked.',
    defaultLevel: 'LEVEL_1_PREAPPROVED',
    examples: ['Default browser', 'Approved HTTPS links', 'Web searches']
  },
  FOLDER_ACCESS: {
    id: 'FOLDER_ACCESS',
    name: 'Folder Access',
    shortTitle: 'Selected Folders',
    description:
      'Open explicitly selected folders and remember approved folder paths. Never grants unrestricted filesystem access.',
    levelSummary:
      'Level 1 for already-approved folders; Level 2 confirmation for newly picked folders; Level 3 always required for delete/modify/move.',
    defaultLevel: 'LEVEL_2_SESSION_CONFIRMATION',
    examples: ['User-selected project folders', 'Revocable per-path access']
  },
  MUSIC_ACCESS: {
    id: 'MUSIC_ACCESS',
    name: 'Music Access',
    shortTitle: 'Music & Audio',
    description:
      'Open approved music applications (such as Spotify) and play user-selected local audio tracks.',
    levelSummary:
      'Level 1 to open Spotify or play selected local tracks; playback state is reported honestly without simulated external controls.',
    defaultLevel: 'LEVEL_1_PREAPPROVED',
    examples: ['Open Spotify', 'Play selected local audio files']
  },
  CAMERA_ACCESS: {
    id: 'CAMERA_ACCESS',
    name: 'Camera Access',
    shortTitle: 'Optical Sensor',
    description:
      'Use webcam optical feed for MediaPipe 21-landmark hand tracking and 3D spatial gesture interaction.',
    levelSummary:
      'Subject to operating-system and browser camera permission prompts. Disabling keeps camera tracks closed.',
    defaultLevel: 'LEVEL_1_PREAPPROVED',
    examples: ['MediaPipe 21-landmark hand tracking', 'Spatial gesture control']
  },
  MICROPHONE_ACCESS: {
    id: 'MICROPHONE_ACCESS',
    name: 'Microphone Access',
    shortTitle: 'Voice Recognition',
    description:
      'Use microphone audio input for voice recognition and live vocal telemetry.',
    levelSummary:
      'Subject to operating-system and browser microphone permission prompts.',
    defaultLevel: 'LEVEL_1_PREAPPROVED',
    examples: ['Spoken JARVIS commands', 'Voice console live waveform']
  }
};

export const LEVEL_3_PROTECTED_OPERATIONS = new Set([
  'DELETE_FILE_OR_FOLDER',
  'DELETE_OBJECT',
  'MODIFY_OR_OVERWRITE_FILE',
  'MOVE_OR_RENAME_FILE',
  'FILE_WRITE',
  'INSTALL_SOFTWARE',
  'SHELL_EXEC',
  'SYSTEM_SETTINGS',
  'SEND_EXTERNAL_MESSAGE',
  'SUBMIT_FORM',
  'CLEAR_MEMORY'
]);

export type ActionPolicyEvaluation =
  | {
      outcome: 'ALLOW_PREAPPROVED';
      level: 'LEVEL_1_PREAPPROVED';
      capability: PermissionCapabilityId;
      reason: string;
    }
  | {
      outcome: 'REQUIRE_CONFIRMATION';
      level: PermissionSecurityLevel;
      capability: PermissionCapabilityId;
      reason: string;
    }
  | {
      outcome: 'BLOCKED';
      level: PermissionSecurityLevel;
      capability: PermissionCapabilityId;
      reason: string;
    };

export const ALL_CAPABILITY_IDS: PermissionCapabilityId[] = [
  'APPLICATION_ACCESS',
  'BROWSER_ACCESS',
  'FOLDER_ACCESS',
  'MUSIC_ACCESS',
  'CAMERA_ACCESS',
  'MICROPHONE_ACCESS'
];

function createDefaultConfig(): PersistentPermissionConfig {
  return {
    version: POLICY_VERSION,
    setupCompleted: false,
    setupCompletedAt: null,
    capabilities: {
      APPLICATION_ACCESS: { id: 'APPLICATION_ACCESS', decision: 'NOT_REQUESTED', updatedAt: null },
      BROWSER_ACCESS: { id: 'BROWSER_ACCESS', decision: 'NOT_REQUESTED', updatedAt: null },
      FOLDER_ACCESS: { id: 'FOLDER_ACCESS', decision: 'NOT_REQUESTED', updatedAt: null },
      MUSIC_ACCESS: { id: 'MUSIC_ACCESS', decision: 'NOT_REQUESTED', updatedAt: null },
      CAMERA_ACCESS: { id: 'CAMERA_ACCESS', decision: 'NOT_REQUESTED', updatedAt: null },
      MICROPHONE_ACCESS: { id: 'MICROPHONE_ACCESS', decision: 'NOT_REQUESTED', updatedAt: null }
    },
    allowedAppIds: {
      VS_CODE: true,
      NOTEPAD: true,
      CALCULATOR: true,
      EXPLORER: true,
      BROWSER: true,
      CHROME: true,
      SPOTIFY: true
    },
    approvedFolders: []
  };
}

function isValidDecision(val: unknown): val is PermissionGrantDecision {
  return val === 'NOT_REQUESTED' || val === 'GRANTED' || val === 'DENIED';
}

export function sanitizePersistentConfig(raw: unknown): PersistentPermissionConfig {
  const def = createDefaultConfig();
  if (!raw || typeof raw !== 'object') return def;

  const obj = raw as Record<string, unknown>;
  const capabilities = { ...def.capabilities };

  if (obj.capabilities && typeof obj.capabilities === 'object') {
    const rawCaps = obj.capabilities as Record<string, unknown>;
    for (const id of ALL_CAPABILITY_IDS) {
      const entry = rawCaps[id] as Record<string, unknown> | undefined;
      if (entry && isValidDecision(entry.decision)) {
        capabilities[id] = {
          id,
          decision: entry.decision,
          updatedAt:
            typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt)
              ? entry.updatedAt
              : null
        };
      }
    }
  }

  const allowedAppIds: Record<string, boolean> = { ...def.allowedAppIds };
  if (obj.allowedAppIds && typeof obj.allowedAppIds === 'object') {
    for (const [appId, flag] of Object.entries(obj.allowedAppIds as Record<string, unknown>)) {
      if (typeof flag === 'boolean') {
        allowedAppIds[appId.toUpperCase().replace(/[\s-]+/g, '_')] = flag;
      }
    }
  }

  const approvedFolders: ApprovedFolderEntry[] = [];
  const seenPaths = new Set<string>();
  if (Array.isArray(obj.approvedFolders)) {
    for (const item of obj.approvedFolders) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const cleanPath = typeof rec.path === 'string' ? rec.path.trim() : '';
      if (!cleanPath || /(^|[\\/])\.\.([\\/]|$)|%2e%2e/i.test(cleanPath) || cleanPath.includes('\0')) {
        continue;
      }
      if (seenPaths.has(cleanPath)) continue;
      seenPaths.add(cleanPath);
      const inferredName = cleanPath.split(/[\\/]/).filter(Boolean).pop() || cleanPath;
      approvedFolders.push({
        path: cleanPath,
        name: typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim() : inferredName,
        grantedAt:
          typeof rec.grantedAt === 'number' && Number.isFinite(rec.grantedAt)
            ? rec.grantedAt
            : Date.now()
      });
    }
  }

  return {
    version: POLICY_VERSION,
    setupCompleted: Boolean(obj.setupCompleted),
    setupCompletedAt:
      typeof obj.setupCompletedAt === 'number' && Number.isFinite(obj.setupCompletedAt)
        ? obj.setupCompletedAt
        : null,
    capabilities,
    allowedAppIds,
    approvedFolders
  };
}

export class PermissionPolicyService {
  private config: PersistentPermissionConfig;
  private listeners: Set<() => void> = new Set();
  private osStates: Partial<Record<PermissionCapabilityId, 'granted' | 'denied' | 'prompt' | 'unavailable'>> = {};
  private initializedFromHost = false;

  constructor() {
    this.config = this.loadFromBrowserStorage();
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((fn) => fn());
  }

  private isElectron(): boolean {
    return (
      typeof window !== 'undefined' &&
      Boolean(
        (window as unknown as { jarvisDesktop?: { isElectron?: boolean } }).jarvisDesktop?.isElectron
      )
    );
  }

  private loadFromBrowserStorage(): PersistentPermissionConfig {
    if (typeof window === 'undefined' || !window.localStorage) {
      return createDefaultConfig();
    }
    try {
      const raw = window.localStorage.getItem(POLICY_STORAGE_KEY);
      if (!raw) return createDefaultConfig();
      return sanitizePersistentConfig(JSON.parse(raw));
    } catch {
      return createDefaultConfig();
    }
  }

  private persistToBrowserStorage(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      window.localStorage.setItem(POLICY_STORAGE_KEY, JSON.stringify(this.config));
    } catch {
      // Ignore storage quota / private mode errors safely
    }
  }

  private async persistToHost(): Promise<void> {
    this.persistToBrowserStorage();

    if (typeof window === 'undefined') return;

    if (this.isElectron()) {
      const bridge = (window as unknown as {
        jarvisDesktop?: {
          savePermissionConfig?: (cfg: PersistentPermissionConfig) => Promise<{ ok: boolean; config?: PersistentPermissionConfig }>;
        };
      }).jarvisDesktop;
      if (bridge?.savePermissionConfig) {
        try {
          const res = await bridge.savePermissionConfig(this.getConfig());
          if (res?.ok && res.config) {
            this.config = sanitizePersistentConfig(res.config);
            this.persistToBrowserStorage();
          }
        } catch {
          // Keep validated in-memory/browser state if IPC fails
        }
      }
      return;
    }

    if (typeof fetch === 'function') {
      try {
        await fetch('/api/desktop/permissions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.config)
        });
      } catch {
        // Non-blocking in offline / unit test browser environments
      }
    }
  }

  public async initializeFromHost(): Promise<PersistentPermissionConfig> {
    if (this.initializedFromHost) {
      return this.getConfig();
    }
    this.initializedFromHost = true;

    if (typeof window !== 'undefined' && this.isElectron()) {
      const bridge = (window as unknown as {
        jarvisDesktop?: {
          getPermissionConfig?: () => Promise<{ ok: boolean; config?: PersistentPermissionConfig }>;
        };
      }).jarvisDesktop;
      if (bridge?.getPermissionConfig) {
        try {
          const res = await bridge.getPermissionConfig();
          if (res?.ok && res.config) {
            this.config = sanitizePersistentConfig(res.config);
            this.persistToBrowserStorage();
            this.notify();
            return this.getConfig();
          }
        } catch {
          // fallback to browser storage
        }
      }
    } else if (typeof fetch === 'function') {
      try {
        const res = await fetch('/api/desktop/permissions');
        if (res.ok) {
          const data = (await res.json()) as { ok?: boolean; config?: unknown };
          if (data?.ok && data.config) {
            const hostCfg = sanitizePersistentConfig(data.config);
            if (hostCfg.setupCompleted || hostCfg.approvedFolders.length > 0) {
              this.config = hostCfg;
              this.persistToBrowserStorage();
              this.notify();
            } else if (this.config.setupCompleted || this.config.approvedFolders.length > 0) {
              void this.persistToHost();
            }
          }
        }
      } catch {
        // Offline/test mode
      }
    }

    return this.getConfig();
  }

  public reloadFromStorage(): PersistentPermissionConfig {
    this.initializedFromHost = false;
    this.config = this.loadFromBrowserStorage();
    this.notify();
    return this.getConfig();
  }

  public getConfig(): PersistentPermissionConfig {
    return sanitizePersistentConfig(this.config);
  }

  public isSetupCompleted(): boolean {
    return this.config.setupCompleted;
  }

  public getCapabilityRecord(id: PermissionCapabilityId) {
    return { ...this.config.capabilities[id] };
  }

  public getCapabilityDecision(id: PermissionCapabilityId): PermissionGrantDecision {
    return this.config.capabilities[id]?.decision || 'NOT_REQUESTED';
  }

  public isAppAllowed(appId: string): boolean {
    const norm = appId.trim().toUpperCase().replace(/[\s-]+/g, '_');
    const explicit = this.config.allowedAppIds[norm];
    return explicit !== false;
  }

  public getApprovedFolders(): ApprovedFolderEntry[] {
    return this.config.approvedFolders.map((f) => ({ ...f }));
  }

  public isPathWithinApprovedFolders(targetPath: string): boolean {
    const clean = targetPath.trim();
    if (!clean) return false;
    return this.config.approvedFolders.some((f) => {
      const root = f.path.trim();
      return clean === root || clean.startsWith(`${root}/`) || clean.startsWith(`${root}\\`);
    });
  }

  public setObservedHardwareState(
    capability: 'CAMERA_ACCESS' | 'MICROPHONE_ACCESS',
    state: 'granted' | 'denied' | 'prompt' | 'unavailable'
  ): void {
    if (this.osStates[capability] !== state) {
      this.osStates[capability] = state;
      this.notify();
    }
  }

  public async refreshHardwarePermissionStates(): Promise<void> {
    if (typeof navigator === 'undefined') {
      this.osStates.CAMERA_ACCESS = 'unavailable';
      this.osStates.MICROPHONE_ACCESS = 'unavailable';
      this.notify();
      return;
    }

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      this.osStates.CAMERA_ACCESS = 'unavailable';
      this.osStates.MICROPHONE_ACCESS = 'unavailable';
    }

    if (navigator.permissions && typeof navigator.permissions.query === 'function') {
      try {
        const cam = await navigator.permissions.query({ name: 'camera' as PermissionName });
        this.osStates.CAMERA_ACCESS = cam.state;
      } catch {
        // leave current state
      }
      try {
        const mic = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        this.osStates.MICROPHONE_ACCESS = mic.state;
      } catch {
        // leave current state
      }
    }
    this.notify();
  }

  public getDisplayState(id: PermissionCapabilityId): PermissionDisplayState {
    const osState = this.osStates[id];
    const userDecision = this.getCapabilityDecision(id);

    if (osState === 'denied') {
      return 'BLOCKED_BY_OS_OR_BROWSER';
    }
    if (osState === 'unavailable') {
      return userDecision === 'DENIED' ? 'DENIED_BY_USER' : 'TEMPORARILY_UNAVAILABLE';
    }

    if (userDecision === 'GRANTED') return 'GRANTED_BY_USER';
    if (userDecision === 'DENIED') return 'DENIED_BY_USER';
    return 'NOT_YET_REQUESTED';
  }

  public setCapabilityDecision(
    id: PermissionCapabilityId,
    decision: PermissionGrantDecision,
    now = Date.now()
  ): void {
    this.config.capabilities[id] = {
      id,
      decision,
      updatedAt: decision === 'NOT_REQUESTED' ? null : now
    };
    void this.persistToHost();
    this.notify();
  }

  public setAppAllowed(appId: string, allowed: boolean): void {
    const norm = appId.trim().toUpperCase().replace(/[\s-]+/g, '_');
    this.config.allowedAppIds[norm] = allowed;
    void this.persistToHost();
    this.notify();
  }

  public addApprovedFolder(folderPath: string, folderName?: string, now = Date.now()): boolean {
    const clean = folderPath.trim();
    if (!clean || /(^|[\\/])\.\.([\\/]|$)|%2e%2e/i.test(clean) || clean.includes('\0')) {
      return false;
    }
    const name = folderName?.trim() || clean.split(/[\\/]/).filter(Boolean).pop() || clean;
    const existing = this.config.approvedFolders.find((f) => f.path === clean);
    if (!existing) {
      this.config.approvedFolders.push({ path: clean, name, grantedAt: now });
    }
    void this.persistToHost();
    this.notify();
    return true;
  }

  public async revokeApprovedFolder(folderPath: string): Promise<void> {
    const clean = folderPath.trim();
    this.config.approvedFolders = this.config.approvedFolders.filter((f) => f.path !== clean);

    if (typeof window !== 'undefined' && this.isElectron()) {
      const bridge = (window as unknown as {
        jarvisDesktop?: { revokeFolderPath?: (p: string) => Promise<{ ok: boolean }> };
      }).jarvisDesktop;
      if (bridge?.revokeFolderPath) {
        try {
          await bridge.revokeFolderPath(clean);
        } catch {
          // continue updating config
        }
      }
    }

    await this.persistToHost();
    this.notify();
  }

  public applySetupSelections(params: {
    capabilities: Partial<Record<PermissionCapabilityId, PermissionGrantDecision>>;
    allowedAppIds?: Record<string, boolean>;
    approvedFolders?: ApprovedFolderEntry[];
  }): PersistentPermissionConfig {
    const now = Date.now();
    for (const id of ALL_CAPABILITY_IDS) {
      const dec = params.capabilities[id];
      if (dec && isValidDecision(dec)) {
        this.config.capabilities[id] = {
          id,
          decision: dec,
          updatedAt: dec === 'NOT_REQUESTED' ? null : now
        };
      }
    }
    if (params.allowedAppIds) {
      for (const [appId, flag] of Object.entries(params.allowedAppIds)) {
        this.config.allowedAppIds[appId.toUpperCase().replace(/[\s-]+/g, '_')] = Boolean(flag);
      }
    }
    if (params.approvedFolders) {
      const sanitized = sanitizePersistentConfig({ approvedFolders: params.approvedFolders });
      this.config.approvedFolders = sanitized.approvedFolders;
    }
    this.config.setupCompleted = true;
    this.config.setupCompletedAt = now;
    void this.persistToHost();
    this.notify();
    return this.getConfig();
  }

  public completeSetupDeferred(): void {
    this.config.setupCompleted = true;
    this.config.setupCompletedAt = Date.now();
    void this.persistToHost();
    this.notify();
  }

  public async resetAllPermissions(clearSetupCompleted = false): Promise<void> {
    const fresh = createDefaultConfig();
    if (!clearSetupCompleted) {
      fresh.setupCompleted = true;
      fresh.setupCompletedAt = Date.now();
    }
    this.config = fresh;
    this.osStates = {};
    this.persistToBrowserStorage();

    if (typeof window !== 'undefined') {
      if (this.isElectron()) {
        const bridge = (window as unknown as {
          jarvisDesktop?: {
            resetPermissionConfig?: (clearSetup: boolean) => Promise<{ ok: boolean }>;
          };
        }).jarvisDesktop;
        try {
          await bridge?.resetPermissionConfig?.(clearSetupCompleted);
        } catch {
          // ignore
        }
      } else if (typeof fetch === 'function') {
        try {
          await fetch('/api/desktop/permissions/reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clearSetupCompleted })
          });
        } catch {
          // ignore
        }
      }
    }

    this.notify();
  }

  /**
   * Core Permission Decision Engine:
   * - Level 3 irreversible/consequential actions ALWAYS require APPROVE ONCE.
   * - Level 2 newly picked folders or unapproved file paths require session confirmation (unless capability is DENIED).
   * - Level 1 allowlisted actions execute seamlessly when capability is GRANTED, prompt when NOT_REQUESTED,
   *   and reject clearly when DENIED.
   */
  public evaluateActionPolicy(params: {
    capability: PermissionCapabilityId;
    operationType?: string;
    appId?: string;
    targetPath?: string;
    isNewlyPickedOrUnrecognized?: boolean;
  }): ActionPolicyEvaluation {
    const op = (params.operationType || '').trim().toUpperCase();
    if (LEVEL_3_PROTECTED_OPERATIONS.has(op)) {
      return {
        outcome: 'REQUIRE_CONFIRMATION',
        level: 'LEVEL_3_ALWAYS_CONFIRM',
        capability: params.capability,
        reason: `Sensitive Level 3 operation (${op}) always requires explicit APPROVE ONCE confirmation.`
      };
    }

    const decision = this.getCapabilityDecision(params.capability);

    if (decision === 'DENIED') {
      const capMeta = PERMISSION_CAPABILITY_METADATA[params.capability];
      return {
        outcome: 'BLOCKED',
        level: capMeta.defaultLevel,
        capability: params.capability,
        reason: `${capMeta.name} is currently disabled in JARVIS Permissions. Enable it in the Permissions tab or Setup Wizard to proceed.`
      };
    }

    if (params.capability === 'APPLICATION_ACCESS' && params.appId) {
      if (!this.isAppAllowed(params.appId)) {
        return {
          outcome: 'BLOCKED',
          level: 'LEVEL_1_PREAPPROVED',
          capability: 'APPLICATION_ACCESS',
          reason: `Application "${params.appId}" is disabled in JARVIS Application Access settings.`
        };
      }
    }

    if (params.capability === 'FOLDER_ACCESS') {
      if (params.isNewlyPickedOrUnrecognized) {
        return {
          outcome: 'REQUIRE_CONFIRMATION',
          level: 'LEVEL_2_SESSION_CONFIRMATION',
          capability: 'FOLDER_ACCESS',
          reason: 'Opening a newly selected or unrecognized folder requires explicit confirmation.'
        };
      }
      if (params.targetPath && !this.isPathWithinApprovedFolders(params.targetPath)) {
        return {
          outcome: 'REQUIRE_CONFIRMATION',
          level: 'LEVEL_2_SESSION_CONFIRMATION',
          capability: 'FOLDER_ACCESS',
          reason: `Folder "${params.targetPath}" is not yet in saved approved folders.`
        };
      }
      if (decision === 'GRANTED' && params.targetPath && this.isPathWithinApprovedFolders(params.targetPath)) {
        return {
          outcome: 'ALLOW_PREAPPROVED',
          level: 'LEVEL_1_PREAPPROVED',
          capability: 'FOLDER_ACCESS',
          reason: `Folder "${params.targetPath}" is persistently approved.`
        };
      }
      return {
        outcome: 'REQUIRE_CONFIRMATION',
        level: 'LEVEL_2_SESSION_CONFIRMATION',
        capability: 'FOLDER_ACCESS',
        reason: 'Folder Access has not yet been persistently enabled.'
      };
    }

    if (params.isNewlyPickedOrUnrecognized) {
      return {
        outcome: 'REQUIRE_CONFIRMATION',
        level: 'LEVEL_2_SESSION_CONFIRMATION',
        capability: params.capability,
        reason: 'New or unrecognized target requires explicit session confirmation.'
      };
    }

    if (decision === 'GRANTED') {
      return {
        outcome: 'ALLOW_PREAPPROVED',
        level: 'LEVEL_1_PREAPPROVED',
        capability: params.capability,
        reason: `${PERMISSION_CAPABILITY_METADATA[params.capability].name} is persistently enabled.`
      };
    }

    return {
      outcome: 'REQUIRE_CONFIRMATION',
      level: 'LEVEL_1_PREAPPROVED',
      capability: params.capability,
      reason: `${PERMISSION_CAPABILITY_METADATA[params.capability].name} has not yet been configured; requesting one-time approval.`
    };
  }
}

export const permissionPolicy = new PermissionPolicyService();
