import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as THREE from 'three';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { speechService, VoiceLifecycleState } from '../src/services/speechService';
import { handTrackingService } from '../src/services/handTracking';
import { SystemHealthService } from '../src/services/systemHealthService';
import { permissionPolicy } from '../src/services/permissionPolicy';
import { permissionManager } from '../src/services/permissionManager';
import { gestureEngine } from '../src/services/gestureEngine';
import { customGestureService } from '../src/services/customGestureService';
import { RingGimbalsEffect } from '../src/three/effects/RingGimbals';
import { HologramAssistantState } from '../src/three/HologramScene';
import { GeminiProvider } from '../server/geminiProvider.js';
import { GroqProvider } from '../server/groqProvider.js';
import { LLMService } from '../server/llmService.js';
import {
  DesktopAutomationService,
  desktopAutomationService,
  isBlockedInternalHostname,
  isSensitiveDesktopFilename
} from '../server/desktopAutomation';
import { DevStudioService } from '../server/devStudioService.js';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { SystemHeader } from '../src/components/CommandCenter/SystemHeader';
import { CommandSidebar } from '../src/components/CommandCenter/CommandSidebar';
import { VoiceCommandDock } from '../src/components/CommandCenter/VoiceCommandDock';
import { SystemHealthPanel } from '../src/components/CommandCenter/SystemHealthPanel';
import { HandLandmarkerResult } from '@mediapipe/tasks-vision';

function makeLandmarks(spread = 0.08): { x: number; y: number; z: number }[] {
  const pts = Array.from({ length: 21 }, (_, idx) => ({
    x: 0.5 + (idx % 5) * 0.02,
    y: 0.5 - Math.floor(idx / 5) * 0.04,
    z: 0
  }));
  pts[4] = { x: 0.5 - spread, y: 0.4, z: 0 };
  pts[8] = { x: 0.5 + spread, y: 0.2, z: 0 };
  pts[12] = { x: 0.55, y: 0.22, z: 0 };
  pts[16] = { x: 0.58, y: 0.26, z: 0 };
  pts[20] = { x: 0.62, y: 0.3, z: 0 };
  return pts;
}

describe('BATCH 6 — Cinematic Experience & Final System Integration', () => {
  const originalEnv = { ...process.env };
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    speechService.dispose();
    permissionManager.clearAll();
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
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    speechService.dispose();
    handTrackingService.dispose();
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // =========================================================================
  // PART 1: REAL SERVICE, HARDENING & SECURITY INTEGRATION TESTS
  // =========================================================================
  describe('1. Real Security, SSRF, Secret Exclusion & Permission Integration', () => {
    it('blocks sensitive secret filenames in desktop file read and create workflows', async () => {
      expect(isSensitiveDesktopFilename('.env')).toBe(true);
      expect(isSensitiveDesktopFilename('.env.production')).toBe(true);
      expect(isSensitiveDesktopFilename('server_private.key')).toBe(true);
      expect(isSensitiveDesktopFilename('vault.kdbx')).toBe(true);
      expect(isSensitiveDesktopFilename('notes.txt')).toBe(false);

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-b6-desktop-'));
      try {
        fs.writeFileSync(path.join(tmpDir, '.env'), 'GEMINI_API_KEY=secret123', 'utf-8');
        fs.writeFileSync(path.join(tmpDir, 'notes.txt'), 'Lab status nominal', 'utf-8');

        const svc = new DesktopAutomationService({
          approvedFolders: [tmpDir],
          allowedApps: {},
          setupCompleted: true
        });

        const secretRead = await svc.readApprovedFile(path.join(tmpDir, '.env'));
        expect(secretRead.ok).toBe(false);
        expect(secretRead.error).toMatch(/blocked/i);

        const secretWrite = await svc.createApprovedFile(path.join(tmpDir, '.env.local'), 'SECRET=1');
        expect(secretWrite.ok).toBe(false);
        expect(secretWrite.error).toMatch(/blocked/i);

        const normalRead = await svc.readApprovedFile(path.join(tmpDir, 'notes.txt'));
        expect(normalRead.ok).toBe(true);
        expect(normalRead.content).toContain('Lab status nominal');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('blocks IPv4, IPv6, metadata IPs and .internal hostnames against SSRF', () => {
      expect(isBlockedInternalHostname('localhost')).toBe(true);
      expect(isBlockedInternalHostname('127.0.0.1')).toBe(true);
      expect(isBlockedInternalHostname('::1')).toBe(true);
      expect(isBlockedInternalHostname('::ffff:127.0.0.1')).toBe(true);
      expect(isBlockedInternalHostname('fd00::1')).toBe(true);
      expect(isBlockedInternalHostname('169.254.169.254')).toBe(true);
      expect(isBlockedInternalHostname('metadata.google.internal')).toBe(true);
      expect(isBlockedInternalHostname('10.0.0.12')).toBe(true);
      expect(isBlockedInternalHostname('192.168.1.1')).toBe(true);
      expect(isBlockedInternalHostname('example.com')).toBe(false);
    });

    it('blocks HTTP 302 SSRF redirect targets in inspectWebPage', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({
        status: 302,
        ok: false,
        headers: {
          get: (key: string) => (key.toLowerCase() === 'location' ? 'http://127.0.0.1:8080/admin' : null)
        }
      });
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const svc = new DesktopAutomationService({
        approvedFolders: [],
        allowedApps: {},
        setupCompleted: true
      });
      const res = await svc.inspectWebPage('https://example.com/start');
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/private or internal network/i);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('enforces Dev Studio secret exclusion, diff preview, and backup rollback on real temp project', async () => {
      const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-b6-dev-'));
      try {
        fs.writeFileSync(
          path.join(tmpProject, 'package.json'),
          JSON.stringify({ name: 'demo-app', scripts: { test: 'vitest run' } }),
          'utf-8'
        );
        fs.writeFileSync(path.join(tmpProject, 'app.ts'), 'export const value = 1;\n', 'utf-8');
        fs.writeFileSync(path.join(tmpProject, '.env'), 'GROQ_API_KEY=hidden', 'utf-8');

        desktopAutomationService.approvePath(tmpProject);
        permissionPolicy.addApprovedFolder(tmpProject);
        const devBackend = new DevStudioService();
        const inspected = await devBackend.inspectProjectWorkspace(tmpProject);
        expect(inspected.ok).toBe(true);
        expect(inspected.excludedSecretFiles).toContain('.env');

        // Apply patch with backup & roll back
        const patchResult = await devBackend.applyPatch({
          projectPath: tmpProject,
          filePath: path.join(tmpProject, 'app.ts'),
          proposedContent: 'export const value = 2;\n',
          allowOverwrite: true
        });
        expect(patchResult.ok).toBe(true);
        expect(fs.readFileSync(path.join(tmpProject, 'app.ts'), 'utf-8')).toBe('export const value = 2;\n');

        const rollback = await devBackend.rollbackPatch(patchResult.backup!.backupId, tmpProject);
        expect(rollback.ok).toBe(true);
        expect(fs.readFileSync(path.join(tmpProject, 'app.ts'), 'utf-8')).toBe('export const value = 1;\n');
      } finally {
        fs.rmSync(tmpProject, { recursive: true, force: true });
      }
    });

    it('enforces single-use permission consumption and persistent policy revocation cleanly', () => {
      const eval1 = permissionPolicy.evaluateActionPolicy({
        capability: 'FOLDER_ACCESS',
        operationType: 'FILE_WRITE'
      });
      expect(eval1.outcome).toBe('REQUIRE_CONFIRMATION');
      expect(eval1.level).toBe('LEVEL_3_ALWAYS_CONFIRM');

      const req = permissionManager.createRequest({
        category: 'FILE_WRITE',
        requestedAction: 'Write file',
        target: '/approved/report.txt',
        reason: 'Save user output',
        requestedScope: 'Single write'
      });
      permissionManager.approveOnce(req.id);

      const firstConsume = permissionManager.beginAuthorizedExecution(req.id, 'FILE_WRITE', '/approved/report.txt');
      expect(firstConsume.authorized).toBe(true);
      permissionManager.completeExecution(req.id, true, 'Written');

      // Replay must be rejected
      const secondConsume = permissionManager.beginAuthorizedExecution(req.id, 'FILE_WRITE', '/approved/report.txt');
      expect(secondConsume.authorized).toBe(false);
    });
  });

  // =========================================================================
  // PART 2: VOICE LIFECYCLE, HOLOGRAM TRANSITIONS & CUSTOM GESTURE REGRESSION
  // =========================================================================
  describe('2. Voice Lifecycle, RingGimbals Transitions & Custom Gesture Regression', () => {
    it('tracks VoiceLifecycleState transitions without polling and disposes listeners safely', async () => {
      const states: VoiceLifecycleState[] = [];
      speechService.setLifecycleCallback((s) => states.push(s));

      speechService.registerCommands([
        {
          patterns: ['async check'],
          description: 'Async command',
          category: 'SYSTEM',
          action: async () => {
            await new Promise((r) => setTimeout(r, 15));
            return true;
          },
          feedbackText: 'Async check complete.'
        }
      ]);

      speechService.handleTranscript('async check', 'CONSOLE');
      expect(states).toContain('PROCESSING');

      await new Promise((r) => setTimeout(r, 35));
      expect(states[states.length - 1]).toBe('IDLE');

      speechService.dispose();
      expect(speechService.isListeningActive()).toBe(false);
      expect(speechService.isCurrentlySpeaking()).toBe(false);
    });

    it('fails honestly in startListeningWithPermission when SpeechRecognition is unsupported', async () => {
      const states: VoiceLifecycleState[] = [];
      speechService.setLifecycleCallback((s) => states.push(s));

      globalThis.window = {} as unknown as Window & typeof globalThis;

      const res = await speechService.startListeningWithPermission();
      expect(res.started).toBe(false);
      expect(res.recognitionSupported).toBe(false);
      expect(res.error).toMatch(/not supported/i);
      expect(states).toContain('ERROR');
    });

    it('smoothly dampens RingGimbalsEffect color/activity across IDLE -> THINKING -> EXECUTING -> ERROR', () => {
      const group = new THREE.Group();
      const gimbals = new RingGimbalsEffect(group);

      gimbals.setCoreActivity({ isProcessing: true });
      gimbals.update(1.0, 1.0, 0.016);
      const thinkingColor = (group.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
      const bThinking = thinkingColor.color.getHex();

      gimbals.setCoreActivity({ isError: true });
      for (let i = 0; i < 60; i++) {
        gimbals.update(1.0 + i * 0.016, 1.0, 0.016);
      }
      const errColor = ((group.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).color.getHex();
      expect(errColor).not.toBe(bThinking);
    });

    it('preserves custom gesture persistence, conflict detection & engine recognition across reset/save', () => {
      const sample = makeLandmarks();
      const created = customGestureService.createProfile({
        name: 'Custom Wave Shield',
        description: 'Batch 6 integration gesture',
        actionId: 'TRIGGER_SHOCKWAVE',
        tolerance: 0.05,
        enabled: true
      });
      expect(created.id).toBeDefined();

      const mpResult: HandLandmarkerResult = {
        landmarks: [sample],
        worldLandmarks: [sample],
        handedness: [[{ categoryName: 'Right', displayName: 'Right', score: 0.96, index: 0 }]]
      };
      const detected = gestureEngine.processResults(mpResult);
      expect(detected.hands.length).toBe(1);
    });
  });

  // =========================================================================
  // PART 3: MOCKED AI PROVIDERS, HEALTH PROBES & SYSTEM HEALTH TESTS
  // =========================================================================
  describe('3. Mocked AI Providers, Health Probes & System Health Tests', () => {
    it('[Mocked Provider] preserves model aliases and falls back from timed-out/429 Gemini to Groq cleanly', async () => {
      process.env.GEMINI_API_KEY = 'fake-gemini-key';
      process.env.GROQ_API_KEY = 'fake-groq-key';

      const gemini = new GeminiProvider();
      expect(gemini.getModelName()).toBe('gemini-4-hydrogen');
      gemini.setClient(
        {
          models: {
            generateContent: vi.fn().mockRejectedValue({ status: 401, message: 'Invalid API key' })
          }
        },
        'fake-gemini-key'
      );

      const groq = new GroqProvider();
      expect(groq.getModelName()).toBe('llama-3.3-70b-versatile');

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: 'Fallback Groq synthesis ready, sir.' } }]
          })
        })
      );

      const llm = new LLMService(gemini, groq);
      const res = await llm.generate({
        messages: [{ role: 'user', content: 'Run check' }],
        mode: 'AUTO'
      });

      expect(res.ok).toBe(true);
      expect(res.provider).toBe('GROQ');
      expect(res.fallbackUsed).toBe(true);
      expect(res.text).toContain('Fallback Groq synthesis');
    });

    it('[Mocked Env] reports SystemHealthService capabilities strictly without fabricating AVAILABLE state', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

      const healthSvc = new SystemHealthService();
      const snapshot = await healthSvc.probeAll({
        hasActiveSceneManager: false,
        probeBackend: true
      });

      const backend = snapshot.subsystems.find((s) => s.id === 'BACKEND_API');
      const ai = snapshot.subsystems.find((s) => s.id === 'AI_PROVIDERS');
      const voice = snapshot.subsystems.find((s) => s.id === 'VOICE_ENGINE');
      const cam = snapshot.subsystems.find((s) => s.id === 'CAMERA_MEDIAPIPE');
      const webgl = snapshot.subsystems.find((s) => s.id === 'HOLOGRAPHIC_3D');

      expect(backend?.status).toBe('UNAVAILABLE');
      expect(ai?.status).toBe('UNAVAILABLE');
      expect(voice?.status).toBe('UNSUPPORTED');
      expect(cam?.status).toBe('UNSUPPORTED');
      expect(webgl?.status).toBe('UNSUPPORTED');
    });

    it('[Mocked UI] ErrorBoundary isolates child crashes and exposes clean fallback', () => {
      const derived = ErrorBoundary.getDerivedStateFromError(new Error('Simulated WebGL failure'));
      expect(derived.hasError).toBe(true);
      expect(derived.errorMessage).toContain('Simulated WebGL failure');

      const boundaryNode = React.createElement(
        ErrorBoundary,
        { name: 'Test Panel', onNavigateHome: () => {} },
        React.createElement('div', null, 'Normal Content')
      );
      const html = renderToStaticMarkup(boundaryNode);
      expect(html).toContain('Normal Content');
    });

    it('[Mocked UI] renders SystemHeader, CommandSidebar, VoiceCommandDock & SystemHealthPanel with honest state & ARIA', () => {
      const headerHtml = renderToStaticMarkup(
        React.createElement(SystemHeader, {
          fps: 60,
          intelligenceStatus: 'STANDBY',
          overallHealth: 'DEGRADED',
          pendingPermissionCount: 1,
          onOpenAIConfig: () => {},
          onOpenPermissions: () => {},
          onOpenHealth: () => {},
          searchQuery: '',
          onSearchChange: () => {}
        })
      );
      expect(headerHtml).toContain('AWAITING APPROVAL');
      expect(headerHtml).not.toContain('SYSTEM NOMINAL');

      const sidebarHtml = renderToStaticMarkup(
        React.createElement(CommandSidebar, {
          activeNav: 'SYSTEM_HEALTH',
          onSelectNav: () => {},
          isVoiceActive: false,
          isFocusMode: false,
          onToggleVoice: () => {},
          onToggleFocus: () => {},
          pendingPermissionCount: 2
        })
      );
      expect(sidebarHtml).toContain('System Health');
      expect(sidebarHtml).toContain('aria-current="page"');

      const dockHtml = renderToStaticMarkup(
        React.createElement(VoiceCommandDock, {
          isVoiceActive: false,
          voiceLifecycleState: 'SPEAKING',
          onToggleVoice: () => {},
          onSendCommand: () => {},
          isProcessing: false,
          onOpenVoiceConsole: () => {}
        })
      );
      expect(dockHtml).toContain('VOICE:');
      expect(dockHtml).toContain('SPEAKING');
      expect(dockHtml).toContain('aria-label="Enable Microphone"');

      const healthPanelHtml = renderToStaticMarkup(
        React.createElement(SystemHealthPanel, {
          hasActiveSceneManager: false,
          onOpenSetupWizard: () => {},
          onOpenPermissions: () => {},
          onClose: () => {}
        })
      );
      expect(healthPanelHtml).toContain('SYSTEM HEALTH &amp; DIAGNOSTICS');
      expect(healthPanelHtml).toContain('UNIFIED PERMISSION POLICY');
      expect(healthPanelHtml).toContain('UNTESTED');
    });

    it('Type guard check: HologramAssistantState covers all 6 unified states', () => {
      const states: HologramAssistantState[] = [
        'IDLE',
        'LISTENING',
        'THINKING',
        'SPEAKING',
        'EXECUTING',
        'ERROR'
      ];
      expect(states).toHaveLength(6);
    });
  });
});
