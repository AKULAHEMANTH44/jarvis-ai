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
  BLOCKED_COMMANDS,
  BLOCKED_FILE_EXTENSIONS
} from '../server/desktopAutomation';
import { desktopBridge } from '../src/services/desktopBridge';
import { desktopWorkflowService, DesktopWorkflow } from '../src/services/desktopWorkflowService';
import { IntelligenceEngine } from '../src/services/intelligenceEngine';
import { permissionManager } from '../src/services/permissionManager';
import { permissionPolicy } from '../src/services/permissionPolicy';
import { toolRegistry } from '../src/services/toolRegistry';
import { contextualAI } from '../src/services/contextualAI';
import { conversationManager } from '../src/services/conversationManager';
import { memoryManager } from '../src/services/memoryManager';
import { suggestionEngine } from '../src/services/suggestionEngine';
import { planningEngine } from '../src/services/planningEngine';
import { musicService } from '../src/services/musicService';
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

function makeHealthySpawnChild(pid = 9999) {
  const child = new EventEmitter() as EventEmitter & { pid: number; unref: () => void };
  child.pid = pid;
  child.unref = vi.fn();
  return child;
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

describe('JARVIS Batch 4 — Desktop Superpowers & Advanced Computer Control Suite', () => {
  let tempRoot: string;
  let testFile: string;
  let testSubDir: string;
  let serverAutomation: DesktopAutomationService;
  let engine: IntelligenceEngine;

  beforeEach(async () => {
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => makeHealthySpawnChild());

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-batch4-'));
    testFile = path.join(tempRoot, 'notes.txt');
    fs.writeFileSync(testFile, 'JARVIS Mission Notes line 1\nLine 2 details\nLine 3 conclusions', 'utf8');

    testSubDir = path.join(tempRoot, 'subfolder');
    fs.mkdirSync(testSubDir);
    fs.writeFileSync(path.join(testSubDir, 'inner.md'), '# Inner Document\nNested content.', 'utf8');

    const storage = createMemoryStorageMock();
    vi.stubGlobal('window', {
      localStorage: storage,
      navigator: { onLine: true },
      open: vi.fn(() => ({ closed: false }))
    });
    vi.stubGlobal('localStorage', storage);

    serverAutomation = new DesktopAutomationService();
    serverAutomation.setRequireApprovedPath(true);
    serverAutomation.approvePath(tempRoot);

    // Bridge local /api/desktop/* fetch calls to the real serverAutomation instance
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const body = init?.body ? JSON.parse(String(init.body)) : {};

        const jsonResp = (payload: unknown, status = 200) =>
          ({
            ok: status >= 200 && status < 300,
            status,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => payload,
            text: async () => JSON.stringify(payload)
          }) as Response;

        if (url === '/api/desktop/apps/discover') {
          const applications = await serverAutomation.discoverApplications();
          return jsonResp({ ok: true, applications });
        }
        if (url === '/api/desktop/launch') {
          const result = await serverAutomation.launchApprovedApplication(
            String(body.applicationId || ''),
            Array.isArray(body.args) ? body.args : []
          );
          return jsonResp(result, result.ok ? 200 : 400);
        }
        if (url === '/api/desktop/folder/list') {
          const result = serverAutomation.listApprovedFolder(String(body.folderPath || ''));
          return jsonResp(result, result.ok ? 200 : 400);
        }
        if (url === '/api/desktop/file/read') {
          const result = serverAutomation.readApprovedFile(String(body.filePath || ''));
          return jsonResp(result, result.ok ? 200 : 400);
        }
        if (url === '/api/desktop/file/create') {
          const result = serverAutomation.createApprovedFile(
            String(body.filePath || ''),
            String(body.content || ''),
            Boolean(body.overwrite)
          );
          return jsonResp(result, result.ok ? 200 : 400);
        }
        if (url === '/api/desktop/browser/inspect') {
          const result = await serverAutomation.inspectWebPage(String(body.url || ''));
          return jsonResp(result, result.ok ? 200 : 400);
        }
        if (url === '/api/desktop/music') {
          const result = await serverAutomation.launchMusicApp(String(body.musicTarget || 'SPOTIFY'));
          return jsonResp(result, result.ok ? 200 : 400);
        }

        return jsonResp({ ok: false, error: `Unhandled test URL: ${url}` }, 404);
      })
    );

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
    await permissionPolicy.resetAllPermissions(true);
    musicService.reset();

    desktopBridge.clearApprovedPaths();
    desktopBridge.clearActionAuditLog();
    desktopBridge.registerApprovedPath(tempRoot);
    desktopBridge.setSelectedFolder(tempRoot, 'tempRoot');
    desktopWorkflowService.clearAuditHistory();

    engine = new IntelligenceEngine();
  });

  afterEach(() => {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
    musicService.reset();
    permissionManager.clearAll();
    desktopBridge.clearApprovedPaths();
    desktopBridge.clearActionAuditLog();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // ==========================================
  // MODULE 1: APPLICATION INTELLIGENCE
  // ==========================================
  describe('Module 1: Application Intelligence', () => {
    it('discovers supported applications with availability, categories, and allowlist mappings', async () => {
      const apps = await serverAutomation.discoverApplications();
      expect(Array.isArray(apps)).toBe(true);
      expect(apps.length).toBeGreaterThanOrEqual(6);

      const appIds = apps.map((a) => a.id);
      expect(appIds).toContain('VS_CODE');
      expect(appIds).toContain('NOTEPAD');
      expect(appIds).toContain('CALCULATOR');
      expect(appIds).toContain('EXPLORER');
      expect(appIds).toContain('CHROME');
      expect(appIds).toContain('SPOTIFY');

      const notepad = apps.find((a) => a.id === 'NOTEPAD')!;
      expect(notepad.displayName).toBe('Notepad');
      expect(notepad.category).toBe('APP');
      expect(typeof notepad.available).toBe('boolean');
      expect(['AVAILABLE', 'NOT_INSTALLED', 'UNKNOWN']).toContain(notepad.status);
    });

    it('launches approved application without arbitrary shell commands (shell: false)', async () => {
      const res = await serverAutomation.launchApprovedApplication('NOTEPAD');
      expect(res.ok).toBe(true);
      expect(res.action).toBe('APPLICATION_LAUNCH');
      expect(spawnMock).toHaveBeenCalled();
      const spawnOpts = spawnMock.mock.calls[0][2];
      expect(spawnOpts.shell).toBe(false);
    });

    it('rejects unapproved or malicious shell executables', async () => {
      for (const blocked of BLOCKED_COMMANDS) {
        const res = await serverAutomation.launchApprovedApplication(blocked);
        expect(res.ok).toBe(false);
        expect(res.error).toBe('BLOCKED_SHELL_COMMAND');
      }

      const arbitrary = await serverAutomation.launchApprovedApplication('evil_custom_binary');
      expect(arbitrary.ok).toBe(false);
      expect(arbitrary.error).toBe('DISALLOWED_APPLICATION');
      expect(spawnMock).not.toHaveBeenCalled();
    });
  });

  // ==========================================
  // MODULE 2: ADVANCED FILE AND FOLDER ASSISTANCE
  // ==========================================
  describe('Module 2: Advanced File & Folder Assistance', () => {
    it('lists folder contents with rich metadata inside approved roots', () => {
      const res = serverAutomation.listApprovedFolder(tempRoot);
      expect(res.ok).toBe(true);
      expect(res.folder).toBe(path.resolve(tempRoot));
      expect(res.items.length).toBeGreaterThanOrEqual(2);

      const notesItem = res.items.find((i) => i.name === 'notes.txt');
      expect(notesItem).toBeDefined();
      expect(notesItem?.isDirectory).toBe(false);
      expect(notesItem?.extension).toBe('txt');
      expect(notesItem?.sizeBytes).toBeGreaterThan(0);

      const subFolderItem = res.items.find((i) => i.name === 'subfolder');
      expect(subFolderItem).toBeDefined();
      expect(subFolderItem?.isDirectory).toBe(true);
    });

    it('rejects directory traversal and non-approved folder listings', () => {
      const traversalPath = path.join(tempRoot, '..', '..', 'etc');
      const res = serverAutomation.listApprovedFolder(traversalPath);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/not within user-selected or approved/i);

      const explicitDotDot = serverAutomation.listApprovedFolder(`${tempRoot}/../etc`);
      expect(explicitDotDot.ok).toBe(false);
      expect(explicitDotDot.error).toMatch(/Path traversal/i);
    });

    it('reads supported safe text files safely', () => {
      const res = serverAutomation.readApprovedFile(testFile);
      expect(res.ok).toBe(true);
      expect(res.name).toBe('notes.txt');
      expect(res.content).toContain('JARVIS Mission Notes');
      expect(res.sizeBytes).toBeGreaterThan(0);
    });

    it('blocks reading files with dangerous executable extensions', () => {
      const exeFile = path.join(tempRoot, 'malicious.exe');
      fs.writeFileSync(exeFile, 'MZBINARYDATA', 'utf8');

      const res = serverAutomation.readApprovedFile(exeFile);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/Blocked reading executable/i);
    });

    it('creates new text files with overwrite protection and explicit approval', async () => {
      const newFilePath = path.join(tempRoot, 'new_document.txt');
      const content = 'Generated by JARVIS automated test.';

      const perm = permissionManager.createRequest({
        category: 'FILE_CREATE',
        requestedAction: 'Create document',
        target: newFilePath,
        reason: 'Test file creation',
        requestedScope: `Write to ${newFilePath}`
      });
      permissionManager.approveOnce(perm.id);

      const res = await desktopBridge.createApprovedDesktopFile(newFilePath, content, false, perm.id);
      expect(res.ok).toBe(true);
      expect(res.name).toBe('new_document.txt');
      expect(fs.existsSync(newFilePath)).toBe(true);
      expect(fs.readFileSync(newFilePath, 'utf8')).toBe(content);
    });

    it('enforces overwrite protection if file already exists', () => {
      const res = serverAutomation.createApprovedFile(testFile, 'New content', false);
      expect(res.ok).toBe(false);
      expect(res.exists).toBe(true);
      expect(res.error).toMatch(/FILE_ALREADY_EXISTS/);
    });

    it('allows overwrite only when overwrite flag is explicitly true', () => {
      const res = serverAutomation.createApprovedFile(testFile, 'Updated Content', true);
      expect(res.ok).toBe(true);
      expect(fs.readFileSync(testFile, 'utf8')).toBe('Updated Content');
    });

    it('blocks creating executable or dangerous file extensions', () => {
      for (const ext of BLOCKED_FILE_EXTENSIONS) {
        const dangerousPath = path.join(tempRoot, `script.${ext}`);
        const res = serverAutomation.createApprovedFile(dangerousPath, 'echo hacked', false);
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/Disallowed extension/i);
      }
    });
  });

  // ==========================================
  // MODULE 3: BROWSER ASSISTANT & SSRF PROTECTION
  // ==========================================
  describe('Module 3: Browser Assistant & SSRF Protection', () => {
    it('blocks SSRF targets: localhost, 127.0.0.1, 0.0.0.0, private RFC1918 subnets', async () => {
      const blockedUrls = [
        'http://localhost',
        'http://localhost:8080/secret',
        'http://127.0.0.1:3000',
        'http://0.0.0.0:5000',
        'http://10.0.0.1/admin',
        'http://172.16.1.1/internal',
        'http://192.168.1.1/router',
        'http://169.254.169.254/latest/meta-data',
        'http://server.local'
      ];

      for (const url of blockedUrls) {
        const res = await serverAutomation.inspectWebPage(url);
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/Private or internal network inspection is blocked/i);
      }
    });

    it('allows public HTTPS/HTTP domain inspections and extracts metadata & preview', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/html' }),
          text: async () =>
            '<html><head><title>Example Domain</title><meta name="description" content="Official illustrative example"></head><body><h1>Example Domain</h1><p>This domain is for illustrative examples in documents.</p></body></html>'
        })
      );

      const res = await serverAutomation.inspectWebPage('https://example.com');
      expect(res.ok).toBe(true);
      expect(res.status).toBe(200);
      expect(res.title).toBe('Example Domain');
      expect(res.description).toBe('Official illustrative example');
      expect(res.previewText).toContain('This domain is for illustrative examples');
    });
  });

  // ==========================================
  // MODULE 4: MUSIC AND MEDIA CONTROL
  // ==========================================
  describe('Module 4: Music & Media Control', () => {
    it('controls local audio state cleanly (pause, resume, stop, volume)', () => {
      musicService.setVolume(0.85);
      expect(musicService.getState().volume).toBe(0.85);

      const paused = musicService.pause();
      expect(typeof paused).toBe('boolean');

      musicService.stop();
      expect(musicService.getState().status).toBe('STOPPED');
    });

    it('launches Spotify app honestly into native desktop environment', async () => {
      const res = await serverAutomation.launchMusicApp('SPOTIFY');
      expect(res.ok).toBe(true);
      expect(res.target).toBe('Spotify');
      expect(spawnMock).toHaveBeenCalled();
    });
  });

  // ==========================================
  // MODULE 5: NATURAL LANGUAGE DESKTOP COMMANDS
  // ==========================================
  describe('Module 5: Natural Language Desktop Commands', () => {
    it('classifies application launch for "open VS Code" and "open Spotify"', () => {
      const snap = makeSnapshot();
      const vsCodeRes = engine.classifyIntent('open VS Code', snap, { isFollowUp: false, resolvedReferences: [] });
      expect(vsCodeRes.category).toBe('APPLICATION_LAUNCH');

      const spotifyRes = engine.classifyIntent('open Spotify', snap, { isFollowUp: false, resolvedReferences: [] });
      expect(spotifyRes.category).toBe('MUSIC_ACTION');

      const launchGenericSpotify = engine.classifyIntent('open Spotify', snap, { isFollowUp: false, resolvedReferences: [] });
      expect(['MUSIC_ACTION', 'APPLICATION_LAUNCH']).toContain(launchGenericSpotify.category);
    });

    it('asks clarifying question when request is ambiguous: "open my notes"', () => {
      const snap = makeSnapshot();
      const res = engine.classifyIntent('open my notes', snap, { isFollowUp: false, resolvedReferences: [] });
      expect(res.category).toBe('CLARIFICATION_NEEDED');
      expect(res.missingInformation[0]).toContain('Did you mean to open the file or browse its containing directory?');
    });

    it('classifies "find a file named notes.txt" as FILE_ACTION and searches authorized folder', async () => {
      const snap = makeSnapshot();
      const res = await engine.processRequest({
        input: 'find a file named notes.txt',
        snapshot: snap
      });
      expect(res.classification.category).toBe('FILE_ACTION');
      expect(res.reply).toContain('Found 1 matching item');
      expect(res.reply).toContain('notes.txt');
    });

    it('plans creation of text file: "create a text file named test.txt containing Hello"', async () => {
      const snap = makeSnapshot();
      const res = await engine.processRequest({
        input: 'create a text file named test.txt containing Hello World',
        snapshot: snap
      });
      expect(res.classification.category).toBe('FILE_ACTION');
      expect(res.status).toBe('AWAITING_APPROVAL');
      expect(res.reply).toContain('Plan: Create text file "test.txt"');
      expect(res.pendingPermission?.category).toBe('FILE_CREATE');
    });

    it('plans reading of authorized file: "read notes.txt"', async () => {
      const snap = makeSnapshot();
      const res = await engine.processRequest({
        input: 'read notes.txt',
        snapshot: snap
      });
      expect(res.classification.category).toBe('FILE_ACTION');
      expect(res.status).toBe('AWAITING_APPROVAL');
      expect(res.reply).toContain('Plan: Read content from');
      expect(res.pendingPermission?.category).toBe('FILE_ACCESS');
    });

    it('classifies and executes webpage inspection: "inspect this website https://example.com"', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const url = typeof input === 'string' ? input : input.toString();
          if (url === '/api/desktop/browser/inspect') {
            const payload = {
              ok: true,
              url: 'https://example.com/',
              status: 200,
              title: 'Mock Page',
              description: 'Mock Desc',
              previewText: 'Content'
            };
            return {
              ok: true,
              status: 200,
              json: async () => payload
            } as Response;
          }
          return { ok: false, status: 404, json: async () => ({}) } as Response;
        })
      );

      const snap = makeSnapshot();
      const res = await engine.processRequest({
        input: 'inspect this website https://example.com',
        snapshot: snap
      });
      expect(res.classification.category).toBe('BROWSER_ACTION');
      expect(res.reply).toContain('Web Page Inspection');
      expect(res.reply).toContain('Mock Page');
    });

    it('handles music playback pause command: "pause music"', async () => {
      const snap = makeSnapshot();
      const res = await engine.processRequest({
        input: 'pause music',
        snapshot: snap
      });
      expect(res.classification.category).toBe('MUSIC_ACTION');
      expect(res.reply).toMatch(/paused|no active/i);
    });
  });

  // ==========================================
  // MODULE 6: ACTION APPROVAL CENTER
  // ==========================================
  describe('Module 6: Action Approval Center', () => {
    it('enforces single-use approval token lifecycle', async () => {
      const perm = permissionManager.createRequest({
        category: 'APPLICATION_LAUNCH',
        requestedAction: 'Launch Calculator',
        target: 'CALCULATOR',
        reason: 'Math test',
        requestedScope: 'Single-use launch of CALCULATOR'
      });
      permissionManager.approveOnce(perm.id);

      // First use succeeds
      const first = await desktopBridge.launchApplication('CALCULATOR', perm.id);
      expect(first.ok).toBe(true);

      // Reusing token fails immediately
      const second = await desktopBridge.launchApplication('CALCULATOR', perm.id);
      expect(second.ok).toBe(false);
      expect(second.error).toMatch(/cannot be reused/i);
    });

    it('respects DENIED action and halts execution', async () => {
      const perm = permissionManager.createRequest({
        category: 'APPLICATION_LAUNCH',
        requestedAction: 'Launch Calculator',
        target: 'CALCULATOR',
        reason: 'Math test',
        requestedScope: 'Single-use launch of CALCULATOR'
      });
      permissionManager.deny(perm.id);

      const res = await desktopBridge.launchApplication('CALCULATOR', perm.id);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/denied by user/i);
      expect(spawnMock).not.toHaveBeenCalled();
    });
  });

  // ==========================================
  // MODULE 7: MULTI-STEP WORKFLOWS
  // ==========================================
  describe('Module 7: Multi-Step Workflows', () => {
    it('executes sequential workflow with progress tracking and step status', async () => {
      const workflow = desktopWorkflowService.createProjectFileSummaryWorkflow(
        'tempRoot',
        'notes.txt',
        'generated_summary.txt'
      );

      const ok = await desktopWorkflowService.runWorkflow(workflow);
      expect(ok).toBe(true);

      const active = desktopWorkflowService.getActiveWorkflow();
      expect(active?.status).toBe('COMPLETED');
      expect(active?.progressPercent).toBe(100);
      expect(active?.steps.every((s) => s.status === 'COMPLETED')).toBe(true);

      const summaryPath = path.join(tempRoot, 'generated_summary.txt');
      expect(fs.existsSync(summaryPath)).toBe(true);
      expect(fs.readFileSync(summaryPath, 'utf8')).toContain('JARVIS WORKFLOW BRIEF');

      const audits = desktopWorkflowService.getAuditHistory();
      expect(audits.length).toBeGreaterThan(0);
      expect(audits[0].status).toBe('COMPLETED');
    });

    it('cancels active workflow immediately when requested', async () => {
      const id = 'test-cancel-wf';
      let stepRan = false;

      const wf: Omit<DesktopWorkflow, 'currentStepIndex' | 'status' | 'progressPercent'> = {
        id,
        title: 'Cancellable Workflow',
        description: 'Workflow meant to be cancelled',
        context: {},
        steps: [
          {
            id: 'st-1',
            name: 'Step 1',
            description: 'First action',
            status: 'PENDING',
            action: async () => {
              stepRan = true;
              return { ok: true, summary: 'Done 1' };
            }
          },
          {
            id: 'st-2',
            name: 'Step 2',
            description: 'Second action',
            status: 'PENDING',
            action: async () => {
              desktopWorkflowService.cancelCurrentWorkflow();
              return { ok: true, summary: 'Done 2' };
            }
          },
          {
            id: 'st-3',
            name: 'Step 3',
            description: 'Third action',
            status: 'PENDING',
            action: async () => {
              return { ok: true, summary: 'Should not run' };
            }
          }
        ]
      };

      const result = await desktopWorkflowService.runWorkflow(wf);
      expect(result).toBe(false);
      expect(stepRan).toBe(true);
      expect(desktopWorkflowService.getActiveWorkflow()?.status).toBe('CANCELLED');
    });
  });

  // ==========================================
  // MODULE 9: SECURITY & RESOURCE MANAGEMENT
  // ==========================================
  describe('Module 9: Security & Resource Management', () => {
    it('strictly denies arbitrary commands and direct shell scripts', async () => {
      const malicious = [
        'rm -rf /',
        'cmd.exe',
        'powershell.exe',
        'bash',
        'regedit.exe'
      ];

      for (const cmd of malicious) {
        const res = await serverAutomation.launchApprovedApplication(cmd);
        expect(res.ok).toBe(false);
        expect(['BLOCKED_SHELL_COMMAND', 'DISALLOWED_APPLICATION']).toContain(res.error);
      }
      expect(spawnMock).not.toHaveBeenCalled();
    });

    it('records all desktop executions in audit history', async () => {
      await serverAutomation.launchApprovedApplication('CALCULATOR');
      const auditLog = serverAutomation.getAuditLog();
      expect(auditLog.length).toBeGreaterThan(0);
      expect(auditLog[0].target).toBe('Windows Calculator');
      expect(auditLog[0].ok).toBe(true);
    });

    it('blocks symbolic-link escapes outside approved folders', () => {
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-outside-'));
      const secretFile = path.join(outsideDir, 'secret.txt');
      fs.writeFileSync(secretFile, 'TOP SECRET OUTSIDE ROOT', 'utf8');

      const symlinkDir = path.join(tempRoot, 'escape-link');
      try {
        fs.symlinkSync(outsideDir, symlinkDir, 'dir');
      } catch {
        // Fallback if symlink privileges unavailable in environment
        fs.rmSync(outsideDir, { recursive: true, force: true });
        return;
      }

      const escapedRead = serverAutomation.readApprovedFile(path.join(symlinkDir, 'secret.txt'));
      expect(escapedRead.ok).toBe(false);
      expect(escapedRead.error).toMatch(/not within user-selected or approved/i);

      fs.rmSync(outsideDir, { recursive: true, force: true });
    });

    it('rejects embedded credentials and non-HTTP URLs during webpage inspection', async () => {
      const credRes = await serverAutomation.inspectWebPage('https://admin:secret@example.com/private');
      expect(credRes.ok).toBe(false);
      expect(credRes.error).toMatch(/embedded credentials/i);

      const fileRes = await serverAutomation.inspectWebPage('file:///etc/passwd');
      expect(fileRes.ok).toBe(false);
      expect(fileRes.error).toMatch(/Only HTTP\/HTTPS/i);
    });

    it('handles invalid inputs and missing paths gracefully without throwing', async () => {
      expect(serverAutomation.validatePath('').valid).toBe(false);
      expect(serverAutomation.validatePath('   ').valid).toBe(false);
      expect(serverAutomation.readApprovedFile(path.join(tempRoot, 'does_not_exist.txt')).ok).toBe(false);
      expect(serverAutomation.listApprovedFolder(testFile).ok).toBe(false);
      expect((await serverAutomation.searchWeb('   ')).ok).toBe(false);
    });

    it('prevents concurrent duplicate application launches for the same app', async () => {
      const [first, second] = await Promise.all([
        serverAutomation.launchApprovedApplication('NOTEPAD'),
        serverAutomation.launchApprovedApplication('NOTEPAD')
      ]);

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(false);
      expect(second.error).toBe('CONCURRENT_LAUNCH_IN_PROGRESS');
    });

    it('enforces Electron IPC sender validation, contextIsolation, sandbox, and extension blocks', () => {
      const electronMainPath = path.resolve(process.cwd(), 'electron', 'main.cjs');
      const mainSource = fs.readFileSync(electronMainPath, 'utf8');

      expect(mainSource).toContain('contextIsolation: true');
      expect(mainSource).toContain('nodeIntegration: false');
      expect(mainSource).toContain('sandbox: true');
      expect(mainSource).toContain('isTrustedSender(event)');
      expect(mainSource).toContain('UNTRUSTED_IPC_SENDER');
      expect(mainSource).toContain('BLOCKED_FILE_EXTENSIONS');
      expect(mainSource).toContain('fs.realpathSync');
    });
  });
});
