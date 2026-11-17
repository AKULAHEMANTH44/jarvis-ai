import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('child_process', () => ({
  spawn: spawnMock
}));

import {
  DesktopAutomationService,
  BLOCKED_COMMANDS
} from '../server/desktopAutomation';
import { DesktopBridgeService } from '../src/services/desktopBridge';
import { IntelligenceEngine } from '../src/services/intelligenceEngine';
import { permissionManager } from '../src/services/permissionManager';
import { toolRegistry } from '../src/services/toolRegistry';
import { contextualAI } from '../src/services/contextualAI';
import { conversationManager } from '../src/services/conversationManager';
import { memoryManager } from '../src/services/memoryManager';
import { suggestionEngine } from '../src/services/suggestionEngine';
import { planningEngine } from '../src/services/planningEngine';
import { fileAccessService } from '../src/services/fileAccessService';
import { musicService } from '../src/services/musicService';
import { desktopBridge } from '../src/services/desktopBridge';
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

function makeSnapshot(overrides: Partial<WorkspaceContextSnapshot> = {}): WorkspaceContextSnapshot {
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
    isInteracting: false,
    ...overrides
  };
}

function makeHealthySpawnChild(pid = 4242) {
  const child = new EventEmitter() as EventEmitter & { pid: number; unref: () => void };
  child.pid = pid;
  child.unref = vi.fn();
  return child;
}

function makeFailingSpawnChild(code: string, message: string) {
  const child = new EventEmitter() as EventEmitter & { pid?: number; unref: () => void };
  child.unref = vi.fn();
  queueMicrotask(() => {
    const err = new Error(message) as NodeJS.ErrnoException;
    err.code = code;
    child.emit('error', err);
  });
  return child;
}

describe('Phase 7 — Desktop Automation & Secure Permission System (Mocked Process Spawn / Bridge)', () => {
  let tempRoot: string;
  let tempFile: string;
  let serverAutomation: DesktopAutomationService;

  beforeEach(() => {
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => makeHealthySpawnChild());

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-phase7-'));
    tempFile = path.join(tempRoot, 'mission-brief.txt');
    fs.writeFileSync(tempFile, 'TOP_SECRET_FILE_CONTENT_DO_NOT_LOG', 'utf8');

    serverAutomation = new DesktopAutomationService();

    const storage = createMemoryStorageMock();
    vi.stubGlobal('window', {
      localStorage: storage,
      navigator: { onLine: true },
      open: vi.fn(() => ({ closed: false }))
    });
    vi.stubGlobal('localStorage', storage);

    contextualAI.saveConfig({
      provider: 'LOCAL',
      modelName: 'JARVIS Local Core MK-7',
      temperature: 0.35
    });
    contextualAI.clearApiKey();
    contextualAI.resetHistory();
    conversationManager.resetAllSessions();
    memoryManager.clearAllMemories();
    suggestionEngine.clearAll();
    planningEngine.clearPlans();
    toolRegistry.clearActivityHistory();
    toolRegistry.setHost(null);
    permissionManager.clearAll();
    fileAccessService.clearSessionFiles();
    fileAccessService.setHostCallbacks({});
    musicService.reset();
    desktopBridge.clearApprovedPaths();
    desktopBridge.clearActionAuditLog();
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    musicService.reset();
    fileAccessService.clearSessionFiles();
    permissionManager.clearAll();
    desktopBridge.clearApprovedPaths();
    desktopBridge.clearActionAuditLog();
    toolRegistry.setHost(null);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // ---------------------------------------------------------------------------
  // 1. Server DesktopAutomationService Allowlist, Validation & Security
  // ---------------------------------------------------------------------------

  it('launches approved allowlist applications with shell: false and records audit metadata', async () => {
    const res = await serverAutomation.launchApprovedApplication('VS_CODE');
    expect(res.ok).toBe(true);
    expect(res.verified).toBe(true);
    expect(res.action).toBe('APPLICATION_LAUNCH');
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [, args, options] = spawnMock.mock.calls[0];
    expect(args).toEqual([]);
    expect(options).toMatchObject({ shell: false, detached: true, stdio: 'ignore' });

    const calc = await serverAutomation.launchApprovedApplication('Calculator');
    expect(calc.ok).toBe(true);
    expect(calc.target).toBe('Windows Calculator');

    const chrome = await serverAutomation.launchApprovedApplication('CHROME');
    expect(chrome.ok).toBe(true);
    expect(chrome.target).toBe('Google Chrome');

    const audit = serverAutomation.getAuditLog();
    expect(audit.length).toBe(3);
    expect(audit[0].ok).toBe(true);
  });

  it('blocks shell binaries and unlisted applications without ever spawning processes', async () => {
    for (const bad of ['cmd', 'cmd.exe', 'powershell.exe', 'bash', 'regedit', 'mshta.exe']) {
      expect(BLOCKED_COMMANDS.has(bad)).toBe(true);
      const res = await serverAutomation.launchApprovedApplication(bad);
      expect(res.ok).toBe(false);
      expect(res.error).toBe('BLOCKED_SHELL_COMMAND');
    }

    const unlisted = await serverAutomation.launchApprovedApplication('ArbitraryCustomBinary');
    expect(unlisted.ok).toBe(false);
    expect(unlisted.error).toBe('DISALLOWED_APPLICATION');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('rejects dangerous CLI arguments such as --eval, /c, or shell metacharacters', async () => {
    const res = await serverAutomation.launchApprovedApplication('VS_CODE', [
      '--eval=process.exit()',
      '-c',
      'foo; rm -rf /',
      '--new-window'
    ]);
    expect(res.ok).toBe(true);
    const [, passedArgs] = spawnMock.mock.calls[0];
    expect(passedArgs).toEqual(['--new-window']);
  });

  it('supports configurable application allowlist registration while blocking shells', () => {
    const rejected = serverAutomation.registerAllowedApplication({
      id: 'CUSTOM_SHELL',
      displayName: 'Custom Shell',
      description: 'Unsafe shell wrapper',
      winExecutable: 'powershell.exe'
    });
    expect(rejected.ok).toBe(false);

    const added = serverAutomation.registerAllowedApplication({
      id: 'OBSIDIAN',
      displayName: 'Obsidian',
      description: 'Markdown knowledge workspace',
      winExecutable: 'Obsidian.exe',
      linuxExecutable: 'obsidian',
      category: 'APP'
    });
    expect(added.ok).toBe(true);
    expect(serverAutomation.getAllowedApplications().some((a) => a.id === 'OBSIDIAN')).toBe(true);

    serverAutomation.resetAllowedApplications();
    expect(serverAutomation.getAllowedApplications().some((a) => a.id === 'OBSIDIAN')).toBe(false);
  });

  it('blocks path traversal (including %2e%2e), null bytes, wrong target type, and unapproved roots', async () => {
    const traversal = serverAutomation.validatePath('/tmp/project/../../etc/passwd');
    expect(traversal.valid).toBe(false);

    const encodedTraversal = serverAutomation.validatePath('/tmp/project/%2e%2e/secret.txt');
    expect(encodedTraversal.valid).toBe(false);

    const nullByte = serverAutomation.validatePath('/tmp/test\0.txt');
    expect(nullByte.valid).toBe(false);

    // Enforce strict approved root scoping
    serverAutomation.setRequireApprovedPath(true);
    const unapprovedOpen = await serverAutomation.openApprovedFile(tempFile);
    expect(unapprovedOpen.ok).toBe(false);
    expect(unapprovedOpen.error).toMatch(/not within user-selected or approved desktop paths/i);

    // Approve folder root and verify child file & folder access succeed
    serverAutomation.approvePath(tempRoot);
    const openFileRes = await serverAutomation.openApprovedFile(tempFile);
    expect(openFileRes.ok).toBe(true);
    expect(openFileRes.target).toBe(path.resolve(tempFile));

    const openFolderRes = await serverAutomation.openApprovedFolder(tempRoot);
    expect(openFolderRes.ok).toBe(true);
    expect(openFolderRes.target).toBe(path.resolve(tempRoot));

    // Trying to open a file as a folder or folder as a file fails clearly
    const fileAsFolder = await serverAutomation.openApprovedFolder(tempFile);
    expect(fileAsFolder.ok).toBe(false);
    expect(fileAsFolder.error).toBe('NOT_A_DIRECTORY');

    const folderAsFile = await serverAutomation.openApprovedFile(tempRoot);
    expect(folderAsFile.ok).toBe(false);
    expect(folderAsFile.error).toBe('IS_DIRECTORY');

    // Audit log stores metadata only — never file contents
    const serializedAudit = JSON.stringify(serverAutomation.getAuditLog());
    expect(serializedAudit).not.toContain('TOP_SECRET_FILE_CONTENT_DO_NOT_LOG');
  });

  it('handles missing executables (ENOENT spawn error) gracefully without throwing', async () => {
    spawnMock.mockImplementationOnce(() =>
      makeFailingSpawnChild('ENOENT', 'spawn nonexistent_exe ENOENT')
    );

    const res = await serverAutomation.launchApprovedApplication('NOTEPAD');
    expect(res.ok).toBe(false);
    expect(res.verified).toBe(false);
    expect(res.error).toMatch(/was not found on this system/i);
  });

  it('blocks unsafe browser URLs, embedded credentials, and unapproved music apps', async () => {
    const jsUrl = await serverAutomation.openApprovedBrowser('javascript:alert(1)');
    expect(jsUrl.ok).toBe(false);
    expect(jsUrl.error).toBe('INVALID_URL');

    const credUrl = await serverAutomation.openApprovedBrowser('https://user:secretpass@example.com');
    expect(credUrl.ok).toBe(false);
    expect(credUrl.error).toBe('CREDENTIALS_BLOCKED');

    const validSearch = await serverAutomation.searchWeb('React documentation');
    expect(validSearch.ok).toBe(true);
    expect(validSearch.action).toBe('WEB_SEARCH');
    expect(validSearch.details?.searchUrl).toBe('https://www.google.com/search?q=React%20documentation');

    const unapprovedMusic = await serverAutomation.launchMusicApp('RANDOM_PLAYER');
    expect(unapprovedMusic.ok).toBe(false);
    expect(unapprovedMusic.error).toBe('DISALLOWED_MUSIC_APPLICATION');

    const spotifyRes = await serverAutomation.launchMusicApp('SPOTIFY');
    expect(spotifyRes.ok).toBe(true);
    expect(spotifyRes.action).toBe('MUSIC_CONTROL');
  });

  // ---------------------------------------------------------------------------
  // 2. DesktopBridge Client Service & Malformed / HTTP Error Handling
  // ---------------------------------------------------------------------------

  it('DesktopBridge handles approved backend responses, malformed JSON, and Electron IPC cleanly', async () => {
    const bridge = new DesktopBridgeService();

    // Unapproved direct call without valid permissionId must be blocked
    const unpermitted = await bridge.launchApplication('CALCULATOR', 'perm-nonexistent');
    expect(unpermitted.ok).toBe(false);

    // Issue single-use permission token and approve once
    const perm = permissionManager.createRequest({
      category: 'APPLICATION_LAUNCH',
      requestedAction: 'Launch Windows Calculator',
      target: 'CALCULATOR',
      reason: 'Unit test application launch',
      requestedScope: 'Single-use launch of CALCULATOR'
    });
    permissionManager.approveOnce(perm.id);

    const payload = {
      ok: true,
      action: 'APPLICATION_LAUNCH',
      target: 'Windows Calculator',
      verified: true,
      summary: 'Launched Windows Calculator cleanly.'
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => payload,
      text: async () => JSON.stringify(payload)
    }));
    vi.stubGlobal('fetch', fetchMock);

    const okRes = await bridge.launchApplication('CALCULATOR', perm.id);
    expect(okRes.ok).toBe(true);
    expect(okRes.verified).toBe(true);
    expect(bridge.getActionAuditLog().length).toBeGreaterThanOrEqual(1);

    // Malformed non-JSON HTTP 502 error handled gracefully
    const perm2 = permissionManager.createRequest({
      category: 'APPLICATION_LAUNCH',
      requestedAction: 'Launch VS Code',
      target: 'VS_CODE',
      reason: 'Unit test HTTP 502 handling',
      requestedScope: 'Single-use launch of VS_CODE'
    });
    permissionManager.approveOnce(perm2.id);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 502,
        json: async () => {
          throw new SyntaxError('Unexpected token B');
        },
        text: async () => 'Bad Gateway HTML'
      }))
    );
    const errRes = await bridge.launchApplication('VS_CODE', perm2.id);
    expect(errRes.ok).toBe(false);
    expect(errRes.verified).toBe(false);
    expect(errRes.error).toBe('HTTP_502');

    // Electron native folder picker mock
    const selectFolderMock = vi.fn(async () => ({
      ok: true,
      cancelled: false,
      path: 'C:\\Users\\Stark\\Projects\\jarvis-ai',
      name: 'jarvis-ai'
    }));
    vi.stubGlobal('window', {
      localStorage: createMemoryStorageMock(),
      navigator: { onLine: true },
      jarvisDesktop: {
        isElectron: true,
        platform: 'win32',
        launchApp: vi.fn(async () => ({
          ok: true,
          action: 'APPLICATION_LAUNCH',
          target: 'Visual Studio Code',
          verified: true,
          summary: 'Electron launched VS Code.'
        })),
        openFile: vi.fn(),
        openFolder: vi.fn(),
        openBrowser: vi.fn(),
        searchWeb: vi.fn(),
        launchMusic: vi.fn(),
        selectFile: vi.fn(),
        selectFolder: selectFolderMock,
        getSystemStatus: vi.fn()
      }
    });

    const picked = await bridge.pickFolder();
    expect(picked.cancelled).toBe(false);
    expect(picked.folder?.path).toBe('C:\\Users\\Stark\\Projects\\jarvis-ai');
    expect(bridge.getSelectedFolder()?.name).toBe('jarvis-ai');
    expect(bridge.isPathApproved('C:\\Users\\Stark\\Projects\\jarvis-ai\\package.json')).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 3. End-to-End Phase 7 IntelligenceEngine Permission Pipeline
  // ---------------------------------------------------------------------------

  it('executes approved desktop application launch ("JARVIS, open Visual Studio Code.") only once after explicit approval', async () => {
    const payload = {
      ok: true,
      action: 'APPLICATION_LAUNCH',
      target: 'Visual Studio Code',
      verified: true,
      summary: 'Launched Visual Studio Code (PID 4242).'
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => payload,
      text: async () => JSON.stringify(payload)
    }));
    vi.stubGlobal('fetch', fetchMock);

    const engine = new IntelligenceEngine();
    const res = await engine.processRequest({
      input: 'JARVIS, open Visual Studio Code.',
      snapshot: makeSnapshot(),
      source: 'VOICE'
    });

    expect(res.status).toBe('AWAITING_APPROVAL');
    expect(res.pendingPermission?.category).toBe('APPLICATION_LAUNCH');
    expect(res.pendingPermission?.target).toBe('VS_CODE');
    expect(fetchMock).not.toHaveBeenCalled();

    const approved = await engine.resolvePendingPermission('APPROVE_ONCE', res.pendingPermission!.id);
    expect(approved?.status).toBe('RESPONDING');
    expect(approved?.toolRecords[0]?.status).toBe('EXECUTED');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/desktop/launch');

    // Replay / reuse of consumed token must be rejected
    await engine.resolvePendingPermission('APPROVE_ONCE', res.pendingPermission!.id);
    expect(engine.getSnapshot().status).toBe('ERROR');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never executes desktop launch when denied or cancelled ("JARVIS, open Calculator.")', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const engine = new IntelligenceEngine();

    // Deny branch
    const req1 = await engine.processRequest({
      input: 'JARVIS, open Calculator.',
      snapshot: makeSnapshot(),
      source: 'VOICE'
    });
    expect(req1.pendingPermission?.target).toBe('CALCULATOR');

    await engine.resolvePendingPermission('DENY', req1.pendingPermission!.id);
    expect(engine.getSnapshot().status).toBe('STANDBY');
    expect(engine.getSnapshot().pendingPermission).toBeNull();
    expect(conversationManager.getRecentTurns(1)[0]?.text).toMatch(/denied/i);
    expect(fetchMock).not.toHaveBeenCalled();

    // Cancel branch
    const req2 = await engine.processRequest({
      input: 'JARVIS, open Notepad.',
      snapshot: makeSnapshot(),
      source: 'TEXT'
    });
    expect(req2.pendingPermission?.target).toBe('NOTEPAD');

    await engine.resolvePendingPermission('CANCEL', req2.pendingPermission!.id);
    expect(engine.getSnapshot().status).toBe('STANDBY');
    expect(engine.getSnapshot().pendingPermission).toBeNull();
    expect(conversationManager.getRecentTurns(1)[0]?.text).toMatch(/cancel/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects blocked shell commands ("open cmd.exe") at intent classification and permission time', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const engine = new IntelligenceEngine();
    const res = await engine.processRequest({
      input: 'JARVIS, open cmd.exe',
      snapshot: makeSnapshot(),
      source: 'TEXT'
    });

    expect(res.status).toBe('ERROR');
    expect(res.pendingPermission).toBeUndefined();
    expect(res.error).toBe('BLOCKED_SHELL_COMMAND');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('opens user-selected project folder via picker flow ("JARVIS, open my selected project folder.") with single-use approval', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const payload = {
        ok: true,
        action: url.includes('paths/approve') ? 'PATH_APPROVE' : 'FOLDER_ACCESS',
        target: 'C:\\Projects\\jarvis-ai',
        verified: true,
        summary: 'Opened folder C:\\Projects\\jarvis-ai in File Explorer.'
      };
      return {
        ok: true,
        status: 200,
        json: async () => payload,
        text: async () => JSON.stringify(payload)
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const engine = new IntelligenceEngine();

    // Before a folder is selected, JARVIS offers picker instead of guessing a path
    const initial = await engine.processRequest({
      input: 'JARVIS, open my selected project folder.',
      snapshot: makeSnapshot(),
      source: 'VOICE'
    });
    expect(initial.interactivePrompt?.kind).toBe('FILE_PICKER');
    expect(initial.interactivePrompt?.allowFolderSelection).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    // User picks a project folder -> creates FOLDER_ACCESS permission card (no auto-execution!)
    const pickedRes = engine.handleUserPickedFolder({
      folderId: 'fld-test-1',
      name: 'jarvis-ai',
      path: 'C:\\Projects\\jarvis-ai',
      selectedAt: Date.now()
    });
    expect(pickedRes.permissionRequest?.category).toBe('FOLDER_ACCESS');
    expect(pickedRes.permissionRequest?.target).toBe('C:\\Projects\\jarvis-ai');
    expect(fetchMock).not.toHaveBeenCalled();

    // Approve once -> opens folder
    const exec = await engine.resolvePendingPermission('APPROVE_ONCE', pickedRes.permissionRequest!.id);
    expect(exec?.status).toBe('RESPONDING');
    expect(exec?.toolRecords[0]?.status).toBe('EXECUTED');
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/desktop/folder/open')).toBe(true);
  });

  it('requires explicit confirmation for "JARVIS, open Spotify." and "JARVIS, play my selected music." cleanly', async () => {
    const payload = {
      ok: true,
      action: 'MUSIC_CONTROL',
      target: 'Spotify',
      verified: true,
      summary: 'Launched Spotify cleanly.'
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => payload,
      text: async () => JSON.stringify(payload)
    }));
    vi.stubGlobal('fetch', fetchMock);

    const engine = new IntelligenceEngine();

    // "JARVIS, open Spotify."
    const spotifyReq = await engine.processRequest({
      input: 'JARVIS, open Spotify.',
      snapshot: makeSnapshot(),
      source: 'VOICE'
    });
    expect(spotifyReq.status).toBe('AWAITING_APPROVAL');
    expect(spotifyReq.pendingPermission?.category).toBe('MUSIC_CONTROL');
    expect(spotifyReq.pendingPermission?.target).toBe('SPOTIFY');
    expect(fetchMock).not.toHaveBeenCalled();

    const spotifyOk = await engine.resolvePendingPermission('APPROVE_ONCE', spotifyReq.pendingPermission!.id);
    expect(spotifyOk?.status).toBe('RESPONDING');
    expect(spotifyOk?.toolRecords[0]?.status).toBe('EXECUTED');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/desktop/music');

    // "JARVIS, play my selected music." when no track picked yet -> offers file picker cleanly
    const musicNoTrack = await engine.processRequest({
      input: 'JARVIS, play my selected music.',
      snapshot: makeSnapshot(),
      source: 'VOICE'
    });
    expect(musicNoTrack.interactivePrompt?.kind).toBe('FILE_PICKER');
    expect(musicNoTrack.interactivePrompt?.requestedAction).toMatch(/audio/i);
  });

  it('asks clarifying question on ambiguous application request and routes Electron web search cleanly', async () => {
    const engine = new IntelligenceEngine();
    const ambiguous = await engine.processRequest({
      input: 'open an application',
      snapshot: makeSnapshot(),
      source: 'TEXT'
    });
    expect(ambiguous.interactivePrompt?.kind).toBe('AMBIGUOUS_CLARIFICATION');
    expect(ambiguous.pendingPermission).toBeUndefined();

    // Electron web search routing
    const searchWebIpcMock = vi.fn(async () => ({
      ok: true,
      action: 'WEB_SEARCH',
      target: 'React documentation',
      verified: true,
      summary: 'Opened default browser search for "React documentation".'
    }));
    vi.stubGlobal('window', {
      localStorage: createMemoryStorageMock(),
      navigator: { onLine: true },
      jarvisDesktop: {
        isElectron: true,
        platform: 'win32',
        launchApp: vi.fn(),
        openFile: vi.fn(),
        openFolder: vi.fn(),
        openBrowser: vi.fn(),
        searchWeb: searchWebIpcMock,
        launchMusic: vi.fn(),
        selectFile: vi.fn(),
        selectFolder: vi.fn(),
        getSystemStatus: vi.fn()
      }
    });

    const searchReq = await engine.processRequest({
      input: 'JARVIS, search the web for React documentation.',
      snapshot: makeSnapshot(),
      source: 'VOICE'
    });
    expect(searchReq.status).toBe('AWAITING_APPROVAL');
    expect(searchReq.pendingPermission?.category).toBe('WEB_SEARCH');
    expect(searchWebIpcMock).not.toHaveBeenCalled();

    const searchExec = await engine.resolvePendingPermission('APPROVE_ONCE', searchReq.pendingPermission!.id);
    expect(searchExec?.status).toBe('RESPONDING');
    expect(searchExec?.toolRecords[0]?.status).toBe('EXECUTED');
    expect(searchWebIpcMock).toHaveBeenCalledWith('React documentation', 'google');
  });
});
