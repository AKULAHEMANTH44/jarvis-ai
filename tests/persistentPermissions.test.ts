import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('child_process', () => ({
  spawn: spawnMock
}));

import { DesktopAutomationService } from '../server/desktopAutomation';
import { permissionPolicy, sanitizePersistentConfig } from '../src/services/permissionPolicy';
import { permissionManager } from '../src/services/permissionManager';
import { desktopBridge } from '../src/services/desktopBridge';
import { IntelligenceEngine } from '../src/services/intelligenceEngine';
import { toolRegistry } from '../src/services/toolRegistry';
import { contextualAI } from '../src/services/contextualAI';
import { conversationManager } from '../src/services/conversationManager';
import { memoryManager } from '../src/services/memoryManager';
import { suggestionEngine } from '../src/services/suggestionEngine';
import { planningEngine } from '../src/services/planningEngine';
import { WorkspaceContextSnapshot } from '../src/types/assistant';

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

function makeHealthySpawnChild(pid = 7331) {
  const child = new EventEmitter() as EventEmitter & { pid: number; unref: () => void };
  child.pid = pid;
  child.unref = vi.fn();
  return child;
}

function makeSnapshot(): WorkspaceContextSnapshot {
  return {
    mode: 'WORKSPACE',
    selectedObjectId: 'obj-1',
    selectedObjectName: 'ARC REACTOR MK-VII',
    selectedModelId: 'arc_reactor',
    objectCount: 1,
    objectsSummary: [],
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
    isInteracting: false
  };
}

describe('Phase 7.1 — Persistent Permission & First-Run Setup System', () => {
  let tempRoot: string;
  let storageMock: ReturnType<typeof createMemoryStorageMock>;

  beforeEach(async () => {
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => makeHealthySpawnChild());

    storageMock = createMemoryStorageMock();
    vi.stubGlobal('window', {
      localStorage: storageMock,
      open: vi.fn(() => ({ closed: false }))
    });

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-phase71-'));

    contextualAI.saveConfig({
      provider: 'LOCAL',
      modelName: 'JARVIS Local Core MK-7',
      temperature: 0.35
    });
    contextualAI.clearApiKey();
    contextualAI.resetHistory();
    permissionManager.clearAll();
    await permissionPolicy.resetAllPermissions(true);
    desktopBridge.clearApprovedPaths();
    desktopBridge.clearActionAuditLog();
    conversationManager.resetAllSessions();
    memoryManager.clearAllMemories();
    suggestionEngine.clearAll();
    planningEngine.clearPlans();
    toolRegistry.clearActivityHistory();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // ignore temp cleanup errors
    }
  });

  it('starts in clean first-run state and persists selections across simulated restart', () => {
    expect(permissionPolicy.isSetupCompleted()).toBe(false);
    expect(permissionPolicy.getCapabilityDecision('APPLICATION_ACCESS')).toBe('NOT_REQUESTED');
    expect(permissionPolicy.getCapabilityDecision('FOLDER_ACCESS')).toBe('NOT_REQUESTED');

    const savedFolder = path.join(tempRoot, 'projects');
    fs.mkdirSync(savedFolder, { recursive: true });

    permissionPolicy.applySetupSelections({
      capabilities: {
        APPLICATION_ACCESS: 'GRANTED',
        BROWSER_ACCESS: 'GRANTED',
        FOLDER_ACCESS: 'GRANTED',
        MUSIC_ACCESS: 'DENIED',
        CAMERA_ACCESS: 'NOT_REQUESTED',
        MICROPHONE_ACCESS: 'GRANTED'
      },
      allowedAppIds: {
        CALCULATOR: true,
        NOTEPAD: false,
        VS_CODE: true
      },
      approvedFolders: [{ path: savedFolder, name: 'projects', grantedAt: 1700000000000 }]
    });

    expect(permissionPolicy.isSetupCompleted()).toBe(true);
    expect(storageMock.setItem).toHaveBeenCalled();

    // Simulate reload / app restart from storage
    const reloaded = permissionPolicy.reloadFromStorage();
    expect(reloaded.setupCompleted).toBe(true);
    expect(reloaded.capabilities.APPLICATION_ACCESS.decision).toBe('GRANTED');
    expect(reloaded.capabilities.MUSIC_ACCESS.decision).toBe('DENIED');
    expect(reloaded.capabilities.CAMERA_ACCESS.decision).toBe('NOT_REQUESTED');
    expect(reloaded.allowedAppIds.NOTEPAD).toBe(false);
    expect(reloaded.allowedAppIds.CALCULATOR).toBe(true);
    expect(reloaded.approvedFolders).toHaveLength(1);
    expect(reloaded.approvedFolders[0].path).toBe(savedFolder);
  });

  it('sanitizes corrupted JSON or path traversal entries cleanly', () => {
    storageMock.setItem('jarvis_persistent_permissions_v1', '{broken-json');
    const afterCorruption = permissionPolicy.reloadFromStorage();
    expect(afterCorruption.setupCompleted).toBe(false);
    expect(afterCorruption.capabilities.APPLICATION_ACCESS.decision).toBe('NOT_REQUESTED');

    const sanitized = sanitizePersistentConfig({
      setupCompleted: true,
      capabilities: {
        APPLICATION_ACCESS: { decision: 'INVALID_VAL' },
        BROWSER_ACCESS: { decision: 'GRANTED', updatedAt: 12345 }
      },
      approvedFolders: [
        { path: '../../etc/passwd', name: 'evil' },
        { path: '/safe/project\0null', name: 'nullbyte' },
        { path: path.join(tempRoot, 'valid'), name: 'valid', grantedAt: 5000 }
      ]
    });

    expect(sanitized.capabilities.APPLICATION_ACCESS.decision).toBe('NOT_REQUESTED');
    expect(sanitized.capabilities.BROWSER_ACCESS.decision).toBe('GRANTED');
    expect(sanitized.approvedFolders).toHaveLength(1);
    expect(sanitized.approvedFolders[0].name).toBe('valid');
  });

  it('accurately differentiates all 5 runtime display states including OS/browser blocks', () => {
    expect(permissionPolicy.getDisplayState('CAMERA_ACCESS')).toBe('NOT_YET_REQUESTED');

    permissionPolicy.setCapabilityDecision('CAMERA_ACCESS', 'GRANTED');
    expect(permissionPolicy.getDisplayState('CAMERA_ACCESS')).toBe('GRANTED_BY_USER');

    permissionPolicy.setObservedHardwareState('CAMERA_ACCESS', 'unavailable');
    expect(permissionPolicy.getDisplayState('CAMERA_ACCESS')).toBe('TEMPORARILY_UNAVAILABLE');

    permissionPolicy.setObservedHardwareState('CAMERA_ACCESS', 'denied');
    expect(permissionPolicy.getDisplayState('CAMERA_ACCESS')).toBe('BLOCKED_BY_OS_OR_BROWSER');

    permissionPolicy.setCapabilityDecision('CAMERA_ACCESS', 'DENIED');
    permissionPolicy.setObservedHardwareState('CAMERA_ACCESS', 'prompt');
    expect(permissionPolicy.getDisplayState('CAMERA_ACCESS')).toBe('DENIED_BY_USER');
  });

  it('persists backend policy with restrictive 0o600 permissions and enforces capability & app denials server-side', async () => {
    const policyFilePath = path.join(tempRoot, 'server-policy.json');
    const folderA = path.join(tempRoot, 'folder-a');
    fs.mkdirSync(folderA, { recursive: true });

    const service1 = new DesktopAutomationService({ policyFilePath });
    service1.updatePermissionPolicy({
      setupCompleted: true,
      capabilities: {
        APPLICATION_ACCESS: { id: 'APPLICATION_ACCESS', decision: 'GRANTED', updatedAt: Date.now() },
        BROWSER_ACCESS: { id: 'BROWSER_ACCESS', decision: 'DENIED', updatedAt: Date.now() },
        FOLDER_ACCESS: { id: 'FOLDER_ACCESS', decision: 'GRANTED', updatedAt: Date.now() },
        MUSIC_ACCESS: { id: 'MUSIC_ACCESS', decision: 'DENIED', updatedAt: Date.now() },
        CAMERA_ACCESS: { id: 'CAMERA_ACCESS', decision: 'NOT_REQUESTED', updatedAt: null },
        MICROPHONE_ACCESS: { id: 'MICROPHONE_ACCESS', decision: 'NOT_REQUESTED', updatedAt: null }
      },
      allowedAppIds: {
        CALCULATOR: true,
        NOTEPAD: false
      },
      approvedFolders: [{ path: folderA, name: 'folder-a', grantedAt: Date.now() }]
    });

    expect(fs.existsSync(policyFilePath)).toBe(true);
    if (process.platform !== 'win32') {
      const mode = fs.statSync(policyFilePath).mode & 0o777;
      expect(mode).toBe(0o600);
    }

    // Restart simulation with a fresh instance reading the same policy file
    const service2 = new DesktopAutomationService({ policyFilePath });
    const loadedPolicy = service2.getPermissionPolicy();
    expect(loadedPolicy.setupCompleted).toBe(true);
    expect(loadedPolicy.capabilities.BROWSER_ACCESS.decision).toBe('DENIED');
    expect(loadedPolicy.allowedAppIds.NOTEPAD).toBe(false);
    expect(service2.getApprovedPaths()).toContain(path.resolve(folderA));
    service2.setRequireApprovedPath(true);

    // Server refuses per-app disabled Notepad even if APPLICATION_ACCESS is GRANTED
    const deniedNotepad = await service2.launchApprovedApplication('NOTEPAD');
    expect(deniedNotepad.ok).toBe(false);
    expect(deniedNotepad.error).toBe('PERMISSION_DENIED_BY_POLICY');

    // Server allows enabled CALCULATOR
    const allowedCalc = await service2.launchApprovedApplication('CALCULATOR');
    expect(allowedCalc.ok).toBe(true);

    // Server allows saved folder before revocation
    const allowedFolder = await service2.openApprovedFolder(folderA);
    expect(allowedFolder.ok).toBe(true);

    // Server refuses DENIED BROWSER_ACCESS and MUSIC_ACCESS
    const deniedBrowser = await service2.openApprovedBrowser('https://github.com');
    expect(deniedBrowser.ok).toBe(false);
    expect(deniedBrowser.error).toBe('PERMISSION_DENIED_BY_POLICY');

    const deniedSearch = await service2.searchWeb('TypeScript handbook');
    expect(deniedSearch.ok).toBe(false);
    expect(deniedSearch.error).toBe('PERMISSION_DENIED_BY_POLICY');

    const deniedMusic = await service2.launchMusicApp('SPOTIFY');
    expect(deniedMusic.ok).toBe(false);
    expect(deniedMusic.error).toBe('PERMISSION_DENIED_BY_POLICY');

    // Revoke folder immediately blocks folder opening
    service2.revokeApprovedPath(folderA);
    const blockedFolder = await service2.openApprovedFolder(folderA);
    expect(blockedFolder.ok).toBe(false);
  });

  it('auto-executes Level 1 pre-approved commands seamlessly and blocks DENIED capabilities clearly', async () => {
    const serverAutomation = new DesktopAutomationService();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/desktop/launch-app') {
        const body = JSON.parse(String(init?.body || '{}'));
        const res = await serverAutomation.launchApprovedApplication(body.appId);
        return { ok: res.ok, status: res.ok ? 200 : 400, json: async () => res } as unknown as Response;
      }
      if (url === '/api/desktop/open-browser') {
        const body = JSON.parse(String(init?.body || '{}'));
        const res = await serverAutomation.openApprovedBrowser(body.url);
        return { ok: res.ok, status: res.ok ? 200 : 400, json: async () => res } as unknown as Response;
      }
      if (url === '/api/desktop/search-web') {
        const body = JSON.parse(String(init?.body || '{}'));
        const res = await serverAutomation.searchWeb(body.query);
        return { ok: res.ok, status: res.ok ? 200 : 400, json: async () => res } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const engine = new IntelligenceEngine();
    const snap = makeSnapshot();

    // Unconfigured ('NOT_REQUESTED'): Calculator still asks confirmation first
    const firstCalc = await engine.processRequest({ input: 'open calculator', snapshot: snap });
    expect(firstCalc.status).toBe('AWAITING_APPROVAL');
    expect(firstCalc.pendingPermission?.securityLevel).toBe('LEVEL_1_PREAPPROVED');

    // User clicks "Approve & Always Allow" -> executes Calculator AND grants APPLICATION_ACCESS persistently
    const afterGrant = await engine.grantAndApprovePendingPermission(firstCalc.pendingPermission!.id);
    expect(afterGrant?.status).toBe('RESPONDING');
    expect(permissionPolicy.getCapabilityDecision('APPLICATION_ACCESS')).toBe('GRANTED');

    // Subsequent allowlisted app (VS Code) runs seamlessly with zero prompt & POLICY_PREAPPROVED audit entry
    const vscodeRes = await engine.processRequest({ input: 'open vscode', snapshot: snap });
    expect(vscodeRes.status).toBe('RESPONDING');
    expect(vscodeRes.pendingPermission).toBeUndefined();
    const audit = permissionManager.getAuditHistory(10);
    expect(audit.some((a) => a.decision === 'POLICY_PREAPPROVED' && a.category === 'APPLICATION_LAUNCH')).toBe(true);

    // Explicitly revoke BROWSER_ACCESS -> blocked clearly with POLICY_BLOCKED audit entry
    permissionPolicy.setCapabilityDecision('BROWSER_ACCESS', 'DENIED');
    const blockedWeb = await engine.processRequest({ input: 'open github', snapshot: snap });
    expect(blockedWeb.status).toBe('ERROR');
    expect(blockedWeb.error).toBe('PERMISSION_DENIED_BY_POLICY');
    expect(permissionManager.getAuditHistory(10).some((a) => a.decision === 'POLICY_BLOCKED')).toBe(true);

    // Enable BROWSER_ACCESS -> search web runs without prompt
    permissionPolicy.setCapabilityDecision('BROWSER_ACCESS', 'GRANTED');
    const allowedSearch = await engine.processRequest({
      input: 'search for TypeScript handbooks',
      snapshot: snap
    });
    expect(allowedSearch.status).toBe('RESPONDING');
    expect(allowedSearch.pendingPermission).toBeUndefined();
  });

  it('enforces Level 2 session confirmation on newly picked folders and honors immediate folder revocation', async () => {
    const serverAutomation = new DesktopAutomationService();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/desktop/open-folder') {
          const body = JSON.parse(String(init?.body || '{}'));
          const res = await serverAutomation.openApprovedFolder(body.path);
          return { ok: res.ok, status: res.ok ? 200 : 400, json: async () => res } as unknown as Response;
        }
        return { ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response;
      })
    );

    const projectDir = path.join(tempRoot, 'workspace-alpha');
    fs.mkdirSync(projectDir, { recursive: true });
    serverAutomation.approvePath(projectDir);

    // Even when general FOLDER_ACCESS is GRANTED, a newly picked folder MUST ask confirmation
    permissionPolicy.setCapabilityDecision('FOLDER_ACCESS', 'GRANTED');
    const engine = new IntelligenceEngine();

    const promptRes = engine.handleUserPickedFolder({
      folderId: 'fld-test',
      name: 'workspace-alpha',
      path: projectDir,
      selectedAt: Date.now()
    });
    expect(promptRes.permissionRequest).toBeDefined();
    expect(promptRes.permissionRequest?.securityLevel).toBe('LEVEL_2_SESSION_CONFIRMATION');

    // Approve & Remember this folder persistently
    const approvedRes = await engine.grantAndApprovePendingPermission(promptRes.permissionRequest!.id);
    expect(approvedRes?.status).toBe('RESPONDING');
    expect(permissionPolicy.isPathWithinApprovedFolders(projectDir)).toBe(true);

    // Revoking folder immediately strips path approval
    await desktopBridge.revokeFolderPath(projectDir);
    expect(permissionPolicy.isPathWithinApprovedFolders(projectDir)).toBe(false);
    expect(desktopBridge.isPathApproved(projectDir)).toBe(false);
  });

  it('NEVER bypasses Level 3 irreversible/destructive operations even when all capabilities are GRANTED', async () => {
    permissionPolicy.applySetupSelections({
      capabilities: {
        APPLICATION_ACCESS: 'GRANTED',
        BROWSER_ACCESS: 'GRANTED',
        FOLDER_ACCESS: 'GRANTED',
        MUSIC_ACCESS: 'GRANTED',
        CAMERA_ACCESS: 'GRANTED',
        MICROPHONE_ACCESS: 'GRANTED'
      }
    });

    const engine = new IntelligenceEngine();
    const snap = makeSnapshot();

    // Policy decision engine guarantees Level 3 always prompts
    for (const op of [
      'DELETE_OBJECT',
      'DELETE_FILE_OR_FOLDER',
      'CLEAR_MEMORY',
      'FILE_WRITE',
      'MODIFY_OR_OVERWRITE_FILE',
      'MOVE_OR_RENAME_FILE',
      'INSTALL_SOFTWARE',
      'SHELL_EXEC',
      'SYSTEM_SETTINGS',
      'SEND_EXTERNAL_MESSAGE',
      'SUBMIT_FORM'
    ]) {
      const ev = permissionPolicy.evaluateActionPolicy({
        capability: 'FOLDER_ACCESS',
        operationType: op
      });
      expect(ev.outcome).toBe('REQUIRE_CONFIRMATION');
      expect(ev.level).toBe('LEVEL_3_ALWAYS_CONFIRM');
    }

    // Delete hologram object ALWAYS requires explicit confirmation (never pre-approved)
    const delRes = await engine.processRequest({
      input: 'delete selected object',
      snapshot: snap
    });
    expect(delRes.status).toBe('AWAITING_APPROVAL');
    expect(delRes.pendingApproval?.permissionLevel).toBe('CONSEQUENTIAL');
    expect(delRes.pendingApproval?.reason).toMatch(/Level 3/i);

    // Repeating delete selected object still requires explicit approval every time
    const secondDel = await engine.processRequest({
      input: 'delete selected object',
      snapshot: snap
    });
    expect(secondDel.status).toBe('AWAITING_APPROVAL');
    expect(secondDel.pendingApproval?.permissionLevel).toBe('CONSEQUENTIAL');
    expect(secondDel.pendingApproval?.reason).toMatch(/Level 3/i);

    // Clear persistent memory ALWAYS requires approval
    const clearMemRes = await engine.processRequest({
      input: 'clear memory',
      snapshot: snap
    });
    expect(clearMemRes.status).toBe('AWAITING_APPROVAL');
    expect(clearMemRes.pendingApproval?.permissionLevel).toBe('CONSEQUENTIAL');
    expect(clearMemRes.pendingApproval?.reason).toMatch(/Level 3/i);
  });

  it('configures Electron main process IPC and 0o600 permission store properly', () => {
    const mainSource = fs.readFileSync(path.join(process.cwd(), 'electron/main.cjs'), 'utf8');
    const preloadSource = fs.readFileSync(path.join(process.cwd(), 'electron/preload.cjs'), 'utf8');

    expect(mainSource).toContain('jarvis-permissions.json');
    expect(mainSource).toContain('mode: 0o600');
    expect(mainSource).toContain('jarvis:getPermissionConfig');
    expect(mainSource).toContain('jarvis:savePermissionConfig');
    expect(mainSource).toContain('jarvis:resetPermissionConfig');
    expect(mainSource).toContain('jarvis:revokeFolderPath');
    expect(mainSource).toContain('PERMISSION_DENIED_BY_POLICY');

    expect(preloadSource).toContain('getPermissionConfig');
    expect(preloadSource).toContain('savePermissionConfig');
    expect(preloadSource).toContain('resetPermissionConfig');
    expect(preloadSource).toContain('revokeFolderPath');
  });
});
