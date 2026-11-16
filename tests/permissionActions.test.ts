import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PermissionManager, permissionManager } from '../src/services/permissionManager';
import { FileAccessService, fileAccessService } from '../src/services/fileAccessService';
import {
  BrowserActionService,
  browserActionService,
  validateNavigationUrl
} from '../src/services/browserActionService';
import {
  WebSearchService,
  webSearchService,
  extractSearchIntent
} from '../src/services/webSearchService';
import { MusicService, musicService } from '../src/services/musicService';
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

function makeSnapshot(overrides: Partial<WorkspaceContextSnapshot> = {}): WorkspaceContextSnapshot {
  return {
    mode: 'WORKSPACE',
    selectedObjectId: 'obj-1',
    selectedObjectName: 'ARC REACTOR MK-VII',
    selectedModelId: 'arc_reactor',
    objectCount: 1,
    objectsSummary: [
      {
        id: 'obj-1',
        name: 'ARC REACTOR MK-VII',
        modelId: 'arc_reactor',
        vertexCount: 4200,
        faceCount: 2800,
        componentCount: 3,
        isLocked: false,
        isDisintegrated: false,
        dispersionPhase: 'COMPLETE',
        renderMode: 'HYBRID'
      }
    ],
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

function createFakeFile(name: string, content: string, type = 'text/plain', sizeOverride?: number): File {
  const blob = new Blob([content], { type });
  const file = new File([blob], name, { type });
  if (typeof sizeOverride === 'number') {
    Object.defineProperty(file, 'size', { value: sizeOverride });
  }
  return file;
}

describe('Phase 5 — JARVIS Permission-Based Real-World Action System', () => {
  beforeEach(() => {
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
  });

  afterEach(() => {
    musicService.reset();
    fileAccessService.clearSessionFiles();
    permissionManager.clearAll();
    toolRegistry.setHost(null);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('1. Permission approval works once and prevents reuse after single execution', () => {
    const pm = new PermissionManager();
    const req = pm.createRequest(
      {
        category: 'BROWSER_ACCESS',
        requestedAction: 'Open website in new browser tab',
        target: 'https://github.com/',
        reason: 'User asked to open GitHub',
        requestedScope: 'Open one browser tab'
      },
      1000
    );

    expect(req.status).toBe('AWAITING_APPROVAL');

    // Unapproved execution must fail
    const beforeApprove = pm.beginAuthorizedExecution(req.id, 'BROWSER_ACCESS', 'https://github.com/', 1100);
    expect(beforeApprove.authorized).toBe(false);
    expect(beforeApprove.status).toBe('AWAITING_APPROVAL');

    // Single approval
    const approved = pm.approveOnce(req.id, 1200);
    expect(approved?.status).toBe('APPROVED');

    // First consumption succeeds
    const exec1 = pm.beginAuthorizedExecution(req.id, 'BROWSER_ACCESS', 'https://github.com/', 1300);
    expect(exec1.authorized).toBe(true);
    expect(exec1.status).toBe('EXECUTING');

    pm.completeExecution(req.id, true, 'Opened GitHub tab.', undefined, 1400);
    expect(pm.getStatus(req.id, 1400)).toBe('COMPLETED');

    // Reusing the same token must be rejected
    const reuse = pm.beginAuthorizedExecution(req.id, 'BROWSER_ACCESS', 'https://github.com/', 1500);
    expect(reuse.authorized).toBe(false);
    expect(reuse.status).toBe('COMPLETED');
  });

  it('2. Permission denial blocks execution and records audit entry', async () => {
    const pm = new PermissionManager();
    const browserSvc = new BrowserActionService(pm);
    const { preview, permissionRequest } = browserSvc.requestOpenWebsitePermission('github');
    expect(preview.valid).toBe(true);
    expect(permissionRequest).toBeDefined();

    pm.deny(permissionRequest!.id, 'User declined opening GitHub.');
    expect(pm.getStatus(permissionRequest!.id)).toBe('DENIED');

    const navRes = browserSvc.openApprovedUrl(preview.normalizedUrl!, permissionRequest!.id);
    expect(navRes.ok).toBe(false);
    expect(navRes.openedInNewTab).toBe(false);
    expect((window.open as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();

    const audit = pm.getAuditHistory(10);
    expect(audit.some((a) => a.permissionId === permissionRequest!.id && a.decision === 'DENIED')).toBe(true);
  });

  it('3. Permission expiration prevents late approval or execution', () => {
    const pm = new PermissionManager();
    const req = pm.createRequest(
      {
        category: 'WEB_SEARCH',
        requestedAction: 'Search web',
        target: 'quantum computing',
        reason: 'Web search test',
        requestedScope: 'One search query',
        ttlMs: 1000
      },
      10_000
    );

    expect(pm.getStatus(req.id, 10_500)).toBe('AWAITING_APPROVAL');
    // Past TTL
    expect(pm.getStatus(req.id, 12_000)).toBe('EXPIRED');

    const lateApprove = pm.approveOnce(req.id, 12_100);
    expect(lateApprove?.status).toBe('EXPIRED');

    const lateExec = pm.beginAuthorizedExecution(req.id, 'WEB_SEARCH', 'quantum computing', 12_200);
    expect(lateExec.authorized).toBe(false);
    expect(lateExec.status).toBe('EXPIRED');
  });

  it('4. Permission cancellation cancels pending requests cleanly via manager and IntelligenceEngine', async () => {
    const engine = new IntelligenceEngine();
    const snap = makeSnapshot();

    const res = await engine.processRequest({
      input: 'Open GitHub',
      snapshot: snap
    });
    expect(res.pendingPermission).toBeDefined();
    expect(engine.getSnapshot().status).toBe('AWAITING_APPROVAL');

    const cancelled = engine.cancelActiveRequest();
    expect(cancelled).toBe(true);
    expect(engine.getSnapshot().pendingPermission).toBeNull();
    expect(engine.getSnapshot().status).toBe('STANDBY');
    expect(permissionManager.getStatus(res.pendingPermission!.id)).toBe('CANCELLED');
  });

  it('5. Wrong-target approval is rejected and logged in audit trail', () => {
    const pm = new PermissionManager();
    const req = pm.createRequest({
      category: 'BROWSER_ACCESS',
      requestedAction: 'Open website',
      target: 'https://github.com/',
      reason: 'Open GitHub',
      requestedScope: 'Single URL'
    });
    pm.approveOnce(req.id);

    // Attempt to execute a completely different target with that permission ID
    const mismatch = pm.beginAuthorizedExecution(req.id, 'BROWSER_ACCESS', 'https://evil.example.com/');
    expect(mismatch.authorized).toBe(false);
    expect(mismatch.status).toBe('FAILED');
    expect(mismatch.error).toMatch(/mismatch/i);

    // Category mismatch also rejected
    const req2 = pm.createRequest({
      category: 'WEB_SEARCH',
      requestedAction: 'Search',
      target: 'three.js',
      reason: 'Search',
      requestedScope: 'One search'
    });
    pm.approveOnce(req2.id);
    const catMismatch = pm.beginAuthorizedExecution(req2.id, 'FILE_ACCESS', 'three.js');
    expect(catMismatch.authorized).toBe(false);
    expect(catMismatch.status).toBe('FAILED');

    const audit = pm.getAuditHistory();
    expect(audit.some((a) => a.decision === 'REJECTED_TARGET_MISMATCH')).toBe(true);
  });

  it('6. File selection inspects metadata first and requires permission before reading text or handing off 3D models', async () => {
    const pm = new PermissionManager();
    const fileSvc = new FileAccessService(pm);
    const importedModels: File[] = [];
    fileSvc.setHostCallbacks({
      onImport3DModels: async (files) => {
        importedModels.push(...files);
      }
    });

    const textFile = createFakeFile('notes.md', '# Mark VII Notes\nReactor stable. Containment 99.8%.');
    const meta = fileSvc.registerSelectedFile(textFile);
    expect(meta.supported).toBe(true);
    expect(meta.kind).toBe('TEXT');
    expect(meta.name).toBe('notes.md');

    const { permissionRequest } = fileSvc.requestFileAccessPermission(meta.fileId);
    expect(permissionRequest).toBeDefined();

    // Before approval -> blocked
    const blocked = await fileSvc.openAuthorizedFile(meta.fileId, permissionRequest!.id);
    expect(blocked.ok).toBe(false);

    // After approval -> reads actual text content
    pm.approveOnce(permissionRequest!.id);
    const opened = await fileSvc.openAuthorizedFile(meta.fileId, permissionRequest!.id);
    expect(opened.ok).toBe(true);
    expect(opened.textContent).toContain('Reactor stable');

    // 3D Model handoff
    const glbFile = createFakeFile('reactor.glb', 'glTF-stub', 'model/gltf-binary');
    const glbMeta = fileSvc.registerSelectedFile(glbFile);
    expect(glbMeta.kind).toBe('MODEL_3D');
    const glbReq = fileSvc.requestFileAccessPermission(glbMeta.fileId).permissionRequest!;
    pm.approveOnce(glbReq.id);
    const glbRes = await fileSvc.openAuthorizedFile(glbMeta.fileId, glbReq.id);
    expect(glbRes.ok).toBe(true);
    expect(glbRes.handedOffToLab).toBe(true);
    expect(importedModels).toHaveLength(1);
    expect(importedModels[0].name).toBe('reactor.glb');
  });

  it('7. Unsupported, executable/blocked, and oversized files are handled cleanly', async () => {
    const pm = new PermissionManager();
    const fileSvc = new FileAccessService(pm);

    const exeFile = createFakeFile('installer.exe', 'MZ...');
    const exeMeta = fileSvc.registerSelectedFile(exeFile);
    expect(exeMeta.supported).toBe(false);
    expect(exeMeta.kind).toBe('BLOCKED');
    expect(fileSvc.requestFileAccessPermission(exeMeta.fileId).permissionRequest).toBeUndefined();

    const docxFile = createFakeFile('report.docx', 'PK...');
    const docxMeta = fileSvc.registerSelectedFile(docxFile);
    expect(docxMeta.supported).toBe(false);
    expect(docxMeta.kind).toBe('UNSUPPORTED');

    const hugeText = createFakeFile('huge.txt', 'a', 'text/plain', 25 * 1024 * 1024);
    const hugeMeta = fileSvc.registerSelectedFile(hugeText);
    expect(hugeMeta.supported).toBe(false);
    expect(hugeMeta.reasonIfUnsupported).toMatch(/exceeds/i);
  });

  it('8. Browser URL validation blocks dangerous schemes and opens approved HTTPS links safely', () => {
    expect(validateNavigationUrl('javascript:alert(1)').valid).toBe(false);
    expect(validateNavigationUrl('data:text/html,hi').valid).toBe(false);
    expect(validateNavigationUrl('file:///etc/passwd').valid).toBe(false);
    expect(validateNavigationUrl('http://insecure.example.com').valid).toBe(false);
    expect(validateNavigationUrl('https://user:secret@github.com').valid).toBe(false);

    const gh = validateNavigationUrl('github');
    expect(gh.valid).toBe(true);
    expect(gh.normalizedUrl).toBe('https://github.com/');

    const local = validateNavigationUrl('http://localhost:3000');
    expect(local.valid).toBe(true);

    const pm = new PermissionManager();
    const browserSvc = new BrowserActionService(pm);
    const { preview, permissionRequest } = browserSvc.requestOpenWebsitePermission('threejs');
    expect(preview.valid).toBe(true);
    pm.approveOnce(permissionRequest!.id);

    const navRes = browserSvc.openApprovedUrl(preview.normalizedUrl!, permissionRequest!.id);
    expect(navRes.ok).toBe(true);
    expect(navRes.openedInNewTab).toBe(true);
    expect(window.open).toHaveBeenCalledWith('https://threejs.org/docs/', '_blank', 'noopener,noreferrer');
  });

  it('9. Popup-blocking behavior is detected and reported honestly without lying', () => {
    vi.stubGlobal('window', {
      localStorage: createMemoryStorageMock(),
      navigator: { onLine: true },
      open: vi.fn(() => null)
    });

    const pm = new PermissionManager();
    const browserSvc = new BrowserActionService(pm);
    const { preview, permissionRequest } = browserSvc.requestOpenWebsitePermission('https://react.dev');
    pm.approveOnce(permissionRequest!.id);

    const navRes = browserSvc.openApprovedUrl(preview.normalizedUrl!, permissionRequest!.id);
    expect(navRes.ok).toBe(false);
    expect(navRes.openedInNewTab).toBe(false);
    expect(navRes.popupBlocked).toBe(true);
    expect(navRes.error).toBe('POPUP_BLOCKED');
    expect(pm.getStatus(permissionRequest!.id)).toBe('FAILED');
  });

  it('10. Search query extraction accurately extracts topics, providers, and flags ambiguity', () => {
    const q1 = extractSearchIntent('Search the web for quantum computing');
    expect(q1.ambiguous).toBe(false);
    expect(q1.query).toBe('quantum computing');
    expect(q1.provider).toBe('DUCKDUCKGO');

    const q2 = extractSearchIntent('Find documentation for Three.js');
    expect(q2.ambiguous).toBe(false);
    expect(q2.query.toLowerCase()).toContain('three.js');
    expect(q2.query.toLowerCase()).toContain('documentation');

    const q3 = extractSearchIntent('Look up fusion reactor on Wikipedia');
    expect(q3.ambiguous).toBe(false);
    expect(q3.provider).toBe('WIKIPEDIA');
    expect(q3.query).toBe('fusion reactor');

    const q4 = extractSearchIntent('Search the web');
    expect(q4.ambiguous).toBe(true);
    expect(q4.clarificationQuestion).toBeTruthy();
  });

  it('11. Web search respects user approval, returns structured source links, and supports cancellation', async () => {
    const pm = new PermissionManager();
    const searchSvc = new WebSearchService(pm);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        return new Response(
          JSON.stringify([
            'Three.js',
            ['Three.js'],
            ['Three.js is a cross-browser JavaScript library for animated 3D computer graphics.'],
            ['https://en.wikipedia.org/wiki/Three.js']
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      })
    );

    // Approved search succeeds with clickable verified links + distinction notice
    const perm = searchSvc.requestSearchPermission('Three.js', 'WIKIPEDIA');
    pm.approveOnce(perm.id);
    const res = await searchSvc.executeApprovedSearch('Three.js', perm.id, { provider: 'WIKIPEDIA' });
    expect(res.ok).toBe(true);
    expect(res.results.length).toBe(1);
    expect(res.results[0].url).toBe('https://en.wikipedia.org/wiki/Three.js');
    expect(res.distinctionNotice).toMatch(/external public web sources/i);

    // Pre-aborted cancellation cancels cleanly
    const perm2 = searchSvc.requestSearchPermission('orbital mechanics', 'DUCKDUCKGO');
    pm.approveOnce(perm2.id);
    const abortCtrl = new AbortController();
    abortCtrl.abort();
    const cancelledRes = await searchSvc.executeApprovedSearch('orbital mechanics', perm2.id, {
      signal: abortCtrl.signal
    });
    expect(cancelledRes.ok).toBe(false);
    expect(cancelledRes.cancelled).toBe(true);
    expect(pm.getStatus(perm2.id)).toBe('CANCELLED');
  });

  it('12. Ambiguous music request prompts for music source rather than guessing', async () => {
    const engine = new IntelligenceEngine();
    const res = await engine.processRequest({
      input: 'Play relaxing music',
      snapshot: makeSnapshot()
    });

    expect(res.interactivePrompt?.kind).toBe('MUSIC_SOURCE');
    expect(res.interactivePrompt?.musicChoices?.length).toBeGreaterThanOrEqual(4);
    expect(res.pendingPermission).toBeUndefined();
    expect(musicService.getState().isActualAudioPlaying).toBe(false);
  });

  it('13. Music playback accurately distinguishes local HTML5 Audio vs opening external music links', async () => {
    const fakePlay = vi.fn().mockResolvedValue(undefined);
    const fakePause = vi.fn();
    class MockAudio {
      src: string;
      volume = 1;
      duration = 120;
      currentTime = 0;
      ontimeupdate: (() => void) | null = null;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(url: string) {
        this.src = url;
      }
      play = fakePlay;
      pause = fakePause;
    }

    vi.stubGlobal('Audio', MockAudio as unknown as typeof Audio);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-audio-1');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const pm = new PermissionManager();
    const musicSvc = new MusicService(pm);
    const audioFile = createFakeFile('ambient.mp3', 'audio-bytes', 'audio/mpeg');

    // Local audio playback flow
    const localPerm = musicSvc.requestMusicPermission({
      sourceType: 'LOCAL_AUDIO',
      targetLabel: audioFile.name
    });
    pm.approveOnce(localPerm.id);
    const playState = await musicSvc.playApprovedLocalAudio(audioFile, localPerm.id);
    expect(playState.status).toBe('PLAYING');
    expect(playState.isActualAudioPlaying).toBe(true);

    expect(musicSvc.pause()).toBe(true);
    expect(musicSvc.getState().status).toBe('PAUSED');
    expect(musicSvc.getState().isActualAudioPlaying).toBe(false);

    expect(await musicSvc.resume()).toBe(true);
    expect(musicSvc.getState().status).toBe('PLAYING');

    expect(musicSvc.setVolume(0.4)).toBeCloseTo(0.4);
    expect(musicSvc.stop()).toBe(true);
    expect(musicSvc.getState().status).toBe('STOPPED');

    // External Spotify link NEVER lies that in-app audio is playing
    const spotifyPerm = musicSvc.requestMusicPermission({
      sourceType: 'SPOTIFY',
      targetLabel: 'synthwave focus'
    });
    pm.approveOnce(spotifyPerm.id);
    const spotifyState = musicSvc.openApprovedMusicServiceLink('SPOTIFY', 'synthwave focus', spotifyPerm.id);
    expect(spotifyState.status).toBe('OPENED_EXTERNAL_LINK');
    expect(spotifyState.isActualAudioPlaying).toBe(false);
    expect(spotifyState.sourceUrl).toContain('https://open.spotify.com/search/synthwave%20focus');

    // Autoplay policy block handled honestly
    fakePlay.mockRejectedValueOnce(new DOMException('Blocked by autoplay policy', 'NotAllowedError'));
    const blockedPerm = musicSvc.requestMusicPermission({
      sourceType: 'LOCAL_AUDIO',
      targetLabel: audioFile.name
    });
    pm.approveOnce(blockedPerm.id);
    const blockedState = await musicSvc.playApprovedLocalAudio(audioFile, blockedPerm.id);
    expect(blockedState.status).toBe('PAUSED');
    expect(blockedState.autoplayBlocked).toBe(true);
    expect(blockedState.isActualAudioPlaying).toBe(false);
  });

  it('14. Ambiguous voice/text requests and folder requests clarify cleanly without fabricating actions', async () => {
    const engine = new IntelligenceEngine();
    const snap = makeSnapshot();

    const newTab = await engine.processRequest({ input: 'Open a new tab', snapshot: snap });
    expect(newTab.interactivePrompt?.kind).toBe('AMBIGUOUS_CLARIFICATION');
    expect(newTab.pendingPermission).toBeUndefined();

    const folderReq = await engine.processRequest({ input: 'Open my project folder', snapshot: snap });
    expect(folderReq.interactivePrompt?.kind).toBe('FILE_PICKER');
    expect(folderReq.reply).toMatch(/browser security|select the specific file/i);

    const openFileReq = await engine.processRequest({ input: 'Open a file', snapshot: snap });
    expect(openFileReq.interactivePrompt?.kind).toBe('FILE_PICKER');

    const emptySearch = await engine.processRequest({ input: 'Search the web', snapshot: snap });
    expect(emptySearch.interactivePrompt?.kind).toBe('AMBIGUOUS_CLARIFICATION');
  });

  it('15. Duplicate action requests are prevented both at PermissionManager and IntelligenceEngine levels', async () => {
    const pm = new PermissionManager();
    const first = pm.createRequest({
      category: 'BROWSER_ACCESS',
      requestedAction: 'Open website in new browser tab',
      target: 'https://github.com/',
      reason: 'Open GitHub',
      requestedScope: 'Single tab'
    });
    const second = pm.createRequest({
      category: 'BROWSER_ACCESS',
      requestedAction: 'Open website in new browser tab',
      target: 'https://github.com/',
      reason: 'Open GitHub again',
      requestedScope: 'Single tab'
    });
    expect(second.id).toBe(first.id);
    expect(pm.getPendingRequests()).toHaveLength(1);

    const engine = new IntelligenceEngine();
    const snap = makeSnapshot();
    const p1 = engine.processRequest({ input: 'Open GitHub', snapshot: snap });
    const p2 = engine.processRequest({ input: 'Open GitHub', snapshot: snap });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.pendingPermission).toBeDefined();
    expect(r2.cancelled).toBe(true);
  });

  it('16. ToolRegistry Phase 5 tools enforce explicit permission checks and record verified execution', async () => {
    // 1) open_external_url without approval -> rejected
    const reqBrowser = browserActionService.requestOpenWebsitePermission('github');
    const unapprovedTool = await toolRegistry.executeTool(
      'open_external_url',
      { url: reqBrowser.preview.normalizedUrl!, permissionId: reqBrowser.permissionRequest!.id },
      { approvedByUser: true }
    );
    expect(unapprovedTool.result.ok).toBe(false);

    // Approve and execute -> verified
    permissionManager.approveOnce(reqBrowser.permissionRequest!.id);
    const approvedTool = await toolRegistry.executeTool(
      'open_external_url',
      { url: reqBrowser.preview.normalizedUrl!, permissionId: reqBrowser.permissionRequest!.id },
      { approvedByUser: true }
    );
    expect(approvedTool.result.ok).toBe(true);
    expect(approvedTool.result.verified).toBe(true);

    // 2) access_user_file via ToolRegistry
    const jsonFile = createFakeFile('config.json', '{"core":"MK-VII","power":3.2}', 'application/json');
    const meta = fileAccessService.registerSelectedFile(jsonFile);
    const filePerm = fileAccessService.requestFileAccessPermission(meta.fileId).permissionRequest!;
    permissionManager.approveOnce(filePerm.id);
    const fileTool = await toolRegistry.executeTool(
      'access_user_file',
      { fileId: meta.fileId, permissionId: filePerm.id },
      { approvedByUser: true }
    );
    expect(fileTool.result.ok).toBe(true);
    expect(fileTool.result.verified).toBe(true);

    // 3) control_music_playback rejects starting without permissionId
    const musicBlocked = await toolRegistry.executeTool(
      'control_music_playback',
      { action: 'OPEN_SERVICE', sourceType: 'YOUTUBE_MUSIC', query: 'ambient' },
      { approvedByUser: true }
    );
    expect(musicBlocked.result.ok).toBe(false);
    expect(musicBlocked.result.error).toBe('USER_CONFIRMATION_REQUIRED');
  });
});
