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
import { musicService } from '../src/services/musicService';
import { WorkspaceContextSnapshot } from '../src/types/assistant';

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

  beforeEach(() => {
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => makeHealthySpawnChild());

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-batch4-'));
    testFile = path.join(tempRoot, 'notes.txt');
    fs.writeFileSync(testFile, 'JARVIS Mission Notes line 1\nLine 2 details\nLine 3 conclusions', 'utf8');

    testSubDir = path.join(tempRoot, 'subfolder');
    fs.mkdirSync(testSubDir);
    fs.writeFileSync(path.join(testSubDir, 'inner.md'), '# Inner Document\nNested content.', 'utf8');

    serverAutomation = new DesktopAutomationService();
    serverAutomation.registerApprovedDirectory(tempRoot);
    desktopBridge.registerApprovedPath(tempRoot);
    desktopBridge.setSelectedFolder(tempRoot, 'tempRoot');

    engine = new IntelligenceEngine();
  });

  afterEach(() => {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
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

      // Check structure
      const notepad = apps.find((a) => a.id === 'NOTEPAD')!;
      expect(notepad.name).toBe('Notepad');
      expect(notepad.category).toBe('PRODUCTIVITY');
      expect(typeof notepad.available).toBe('boolean');
    });

    it('launches approved application without arbitrary shell commands (shell: false)', async () => {
      const perm = permissionManager.createRequest({
        category: 'APPLICATION_LAUNCH',
        requestedAction: 'Launch Notepad',
        target: 'NOTEPAD',
        reason: 'User test'
      });
      permissionManager.approveRequest(perm.id, 'ONCE');

      const res = await serverAutomation.launchApplication('NOTEPAD', perm.id);
      expect(res.ok).toBe(true);
      expect(res.action).toBe('APPLICATION_LAUNCH');
      expect(spawnMock).toHaveBeenCalled();
      const spawnOpts = spawnMock.mock.calls[0][2];
      expect(spawnOpts.shell).toBe(false);
    });

    it('rejects unapproved or malicious shell executables', async () => {
      for (const blocked of BLOCKED_COMMANDS) {
        const perm = permissionManager.createRequest({
          category: 'APPLICATION_LAUNCH',
          requestedAction: `Launch ${blocked}`,
          target: blocked,
          reason: 'Exploit attempt'
        });
        permissionManager.approveRequest(perm.id, 'ONCE');

        const res = await serverAutomation.launchApplication(blocked, perm.id);
        expect(res.ok).toBe(false);
        expect(res.error).toBe('APPLICATION_NOT_ALLOWLISTED');
      }
    });
  });

  // ==========================================
  // MODULE 2: ADVANCED FILE AND FOLDER ASSISTANCE
  // ==========================================
  describe('Module 2: Advanced File & Folder Assistance', () => {
    it('lists folder contents with rich metadata inside approved roots', async () => {
      const res = await serverAutomation.listApprovedFolder(tempRoot);
      expect(res.ok).toBe(true);
      expect(res.folder).toBe(tempRoot);
      expect(res.items.length).toBeGreaterThanOrEqual(2);

      const notesItem = res.items.find((i) => i.name === 'notes.txt');
      expect(notesItem).toBeDefined();
      expect(notesItem?.isDirectory).toBe(false);
      expect(notesItem?.extension).toBe('.txt');
      expect(notesItem?.sizeBytes).toBeGreaterThan(0);

      const subFolderItem = res.items.find((i) => i.name === 'subfolder');
      expect(subFolderItem).toBeDefined();
      expect(subFolderItem?.isDirectory).toBe(true);
    });

    it('rejects directory traversal and non-approved folder listings', async () => {
      const traversalPath = path.join(tempRoot, '..', '..', 'etc');
      const res = await serverAutomation.listApprovedFolder(traversalPath);
      expect(res.ok).toBe(false);
      expect(res.error).toBe('FOLDER_NOT_APPROVED');
    });

    it('reads supported safe text files and returns line counts', async () => {
      const res = await serverAutomation.readApprovedFile(testFile);
      expect(res.ok).toBe(true);
      expect(res.name).toBe('notes.txt');
      expect(res.lineCount).toBe(3);
      expect(res.content).toContain('JARVIS Mission Notes');
    });

    it('blocks reading files with dangerous executable extensions', async () => {
      const exeFile = path.join(tempRoot, 'malicious.exe');
      fs.writeFileSync(exeFile, 'MZBINARYDATA', 'utf8');

      const res = await serverAutomation.readApprovedFile(exeFile);
      expect(res.ok).toBe(false);
      expect(res.error).toBe('BLOCKED_FILE_TYPE');
    });

    it('creates new text files with explicit user approval and single-use token', async () => {
      const newFilePath = path.join(tempRoot, 'new_document.txt');
      const content = 'Generated by JARVIS automated test.';

      const perm = permissionManager.createRequest({
        category: 'FILE_CREATE',
        requestedAction: 'Create document',
        target: newFilePath,
        reason: 'Test file creation'
      });
      permissionManager.approveRequest(perm.id, 'ONCE');

      const res = await serverAutomation.createApprovedFile(newFilePath, content, false, perm.id);
      expect(res.ok).toBe(true);
      expect(res.name).toBe('new_document.txt');
      expect(fs.existsSync(newFilePath)).toBe(true);
      expect(fs.readFileSync(newFilePath, 'utf8')).toBe(content);
    });

    it('enforces overwrite protection if file already exists', async () => {
      const perm = permissionManager.createRequest({
        category: 'FILE_CREATE',
        requestedAction: 'Overwrite existing file',
        target: testFile,
        reason: 'Test overwrite protection'
      });
      permissionManager.approveRequest(perm.id, 'ONCE');

      // Attempt to write without overwrite=true
      const res = await serverAutomation.createApprovedFile(testFile, 'New content', false, perm.id);
      expect(res.ok).toBe(false);
      expect(res.error).toBe('FILE_ALREADY_EXISTS');
    });

    it('allows overwrite only when overwrite flag is explicitly true', async () => {
      const perm = permissionManager.createRequest({
        category: 'FILE_CREATE',
        requestedAction: 'Overwrite existing file',
        target: testFile,
        reason: 'Test explicit overwrite'
      });
      permissionManager.approveRequest(perm.id, 'ONCE');

      const res = await serverAutomation.createApprovedFile(testFile, 'Updated Content', true, perm.id);
      expect(res.ok).toBe(true);
      expect(fs.readFileSync(testFile, 'utf8')).toBe('Updated Content');
    });

    it('blocks creating executable or dangerous file extensions', async () => {
      for (const ext of BLOCKED_FILE_EXTENSIONS) {
        const dangerousPath = path.join(tempRoot, `script${ext}`);
        const perm = permissionManager.createRequest({
          category: 'FILE_CREATE',
          requestedAction: `Create ${ext}`,
          target: dangerousPath,
          reason: 'Exploit attempt'
        });
        permissionManager.approveRequest(perm.id, 'ONCE');

        const res = await serverAutomation.createApprovedFile(dangerousPath, 'echo hacked', false, perm.id);
        expect(res.ok).toBe(false);
        expect(res.error).toBe('BLOCKED_FILE_TYPE');
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
        expect(res.error).toBe('BLOCKED_DESTINATION_SSRF');
      }
    });

    it('allows public HTTPS/HTTP domain inspections', async () => {
      // Mock global fetch for public web inspection
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (header: string) => (header.toLowerCase() === 'content-type' ? 'text/html' : null)
        },
        text: () =>
          Promise.resolve(
            '<html><head><title>Example Domain</title><meta name="description" content="Official illustrative example"></head><body><h1>Example Domain</h1><p>This domain is for illustrative examples in documents.</p></body></html>'
          )
      }) as unknown as typeof fetch;

      try {
        const res = await serverAutomation.inspectWebPage('https://example.com');
        expect(res.ok).toBe(true);
        expect(res.title).toBe('Example Domain');
        expect(res.description).toBe('Official illustrative example');
        expect(res.previewText).toContain('This domain is for illustrative examples');
      } finally {
        global.fetch = originalFetch;
      }
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
      expect(res.target).toBe('SPOTIFY');
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
      expect(spotifyRes.category).toBe('APPLICATION_LAUNCH');
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
        rawInput: 'find a file named notes.txt',
        snapshot: snap
      });
      expect(res.classification.category).toBe('FILE_ACTION');
      expect(res.reply).toContain('Found 1 matching item');
      expect(res.reply).toContain('notes.txt');
    });

    it('plans creation of text file: "create a text file named test.txt containing Hello"', async () => {
      const snap = makeSnapshot();
      const res = await engine.processRequest({
        rawInput: 'create a text file named test.txt containing Hello World',
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
        rawInput: 'read notes.txt',
        snapshot: snap
      });
      expect(res.classification.category).toBe('FILE_ACTION');
      expect(res.status).toBe('AWAITING_APPROVAL');
      expect(res.reply).toContain('Plan: Read content from');
      expect(res.pendingPermission?.category).toBe('FILE_ACCESS');
    });

    it('classifies and executes webpage inspection: "inspect this website https://example.com"', async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (h: string) => (h.toLowerCase() === 'content-type' ? 'text/html' : null)
        },
        text: () => Promise.resolve('<html><head><title>Mock Page</title></head><body>Content</body></html>')
      }) as unknown as typeof fetch;

      try {
        const snap = makeSnapshot();
        const res = await engine.processRequest({
          rawInput: 'inspect this website https://example.com',
          snapshot: snap
        });
        expect(res.classification.category).toBe('BROWSER_ACTION');
        expect(res.reply).toContain('Web Page Inspection');
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('handles music playback pause command: "pause music"', async () => {
      const snap = makeSnapshot();
      const res = await engine.processRequest({
        rawInput: 'pause music',
        snapshot: snap
      });
      expect(res.classification.category).toBe('MUSIC_ACTION');
      expect(res.reply).toContain('Paused');
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
        reason: 'Math test'
      });
      permissionManager.approveRequest(perm.id, 'ONCE');

      // First use succeeds
      const first = await serverAutomation.launchApplication('CALCULATOR', perm.id);
      expect(first.ok).toBe(true);

      // Reusing token fails immediately
      const second = await serverAutomation.launchApplication('CALCULATOR', perm.id);
      expect(second.ok).toBe(false);
      expect(second.error).toBe('UNAUTHORIZED_ACTION');
    });

    it('respects DENIED action and halts execution', async () => {
      const perm = permissionManager.createRequest({
        category: 'APPLICATION_LAUNCH',
        requestedAction: 'Launch Calculator',
        target: 'CALCULATOR',
        reason: 'Math test'
      });
      permissionManager.denyRequest(perm.id);

      const res = await serverAutomation.launchApplication('CALCULATOR', perm.id);
      expect(res.ok).toBe(false);
      expect(res.error).toBe('UNAUTHORIZED_ACTION');
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

      // Verify audit history was saved
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
              // Trigger cancellation while inside step 2
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
        'cmd.exe /c calc',
        'powershell -ExecutionPolicy Bypass -Command "Write-Host test"',
        'bash -c "whoami"',
        'regedit.exe'
      ];

      for (const cmd of malicious) {
        const perm = permissionManager.createRequest({
          category: 'APPLICATION_LAUNCH',
          requestedAction: 'Execute',
          target: cmd,
          reason: 'Injection test'
        });
        permissionManager.approveRequest(perm.id, 'ONCE');

        const res = await serverAutomation.launchApplication(cmd, perm.id);
        expect(res.ok).toBe(false);
        expect(res.error).toBe('APPLICATION_NOT_ALLOWLISTED');
      }
    });

    it('records all desktop executions in persistent audit history', async () => {
      const perm = permissionManager.createRequest({
        category: 'APPLICATION_LAUNCH',
        requestedAction: 'Launch Calculator',
        target: 'CALCULATOR',
        reason: 'Audit verification'
      });
      permissionManager.approveRequest(perm.id, 'ONCE');

      await serverAutomation.launchApplication('CALCULATOR', perm.id);
      const auditLog = serverAutomation.getAuditLog();
      expect(auditLog.length).toBeGreaterThan(0);
      expect(auditLog[auditLog.length - 1].target).toBe('CALCULATOR');
      expect(auditLog[auditLog.length - 1].success).toBe(true);
    });
  });
});
