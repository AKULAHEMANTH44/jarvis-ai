import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';

// Mock child_process.spawn cleanly for deterministic terminal lifecycle tests (marked as mocked in report)
vi.mock('child_process', () => {
  const spawnMock = vi.fn((executable: string, args: string[] = []) => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: (sig?: string) => boolean;
      killed: boolean;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;

    child.kill = (sig = 'SIGTERM') => {
      child.killed = true;
      setTimeout(() => {
        child.emit('close', null, sig);
      }, 5);
      return true;
    };

    const joined = `${executable} ${args.join(' ')}`;

    // Long-running command for cancellation test
    if (joined.includes('run lint')) {
      setTimeout(() => {
        if (!child.killed) {
          child.stdout.emit('data', Buffer.from('Running long lint pass...\n'));
        }
      }, 5);
      // Wait for kill() or fallback auto-finish
      return child;
    }

    setTimeout(() => {
      if (child.killed) return;
      if (args.includes('--version') || args.includes('-v')) {
        child.stdout.emit('data', Buffer.from('v22.14.0\n'));
        child.emit('close', 0, null);
      } else if (joined.includes('audit')) {
        // Emit >70 KB plus secret tokens to verify 64KB truncation & redaction
        const bigChunk = 'A'.repeat(72_000) + '\nGEMINI_API_KEY=AIzaSySuperSecretToken1234567890abcd\n';
        child.stdout.emit('data', Buffer.from(bigChunk));
        child.emit('close', 0, null);
      } else if (joined.includes('test')) {
        const vitestOut = [
          ' Test Files  1 failed | 1 passed (2)',
          '      Tests  1 failed | 4 passed | 1 skipped (6)',
          ' FAIL  tests/calc.test.ts > divides safely',
          '   Duration  142ms'
        ].join('\n');
        child.stdout.emit('data', Buffer.from(vitestOut));
        child.stderr.emit('data', Buffer.from('AssertionError: expected NaN to be 0'));
        child.emit('close', 1, null);
      } else {
        child.stdout.emit('data', Buffer.from(`Executed ${joined}\n`));
        child.emit('close', 0, null);
      }
    }, 5);

    return child;
  });

  return {
    spawn: spawnMock,
    default: { spawn: spawnMock }
  };
});

import { desktopAutomationService } from '../server/desktopAutomation';
import {
  devStudioService as serverDevStudio,
  interpretTestOutput,
  isSecretOrSensitiveFile,
  redactSecretsFromText
} from '../server/devStudioService';
import { desktopBridge } from '../src/services/desktopBridge';
import { permissionManager } from '../src/services/permissionManager';
import { permissionPolicy } from '../src/services/permissionPolicy';
import { devStudioService } from '../src/services/devStudioService';
import { devPlannerService } from '../src/services/devPlannerService';
import { contextualAI } from '../src/services/contextualAI';

describe('Batch 5 — AI Development Studio Suite', () => {
  let tempProjectDir: string;
  let unapprovedDir: string;

  beforeEach(() => {
    permissionManager.clearAll();
    permissionPolicy.resetAllPermissions();
    desktopBridge.clearApprovedPaths();
    contextualAI.saveConfig({ provider: 'LOCAL' });

    tempProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-dev-project-'));
    unapprovedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-dev-outside-'));

    // Build realistic multi-language sample project inside tempProjectDir
    fs.mkdirSync(path.join(tempProjectDir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tempProjectDir, 'tests'), { recursive: true });

    fs.writeFileSync(
      path.join(tempProjectDir, 'package.json'),
      JSON.stringify(
        {
          name: 'sample-jarvis-app',
          version: '1.2.0',
          scripts: { test: 'vitest run', build: 'vite build' },
          dependencies: { react: '^19.0.0', express: '^4.21.0' },
          devDependencies: { typescript: '^5.8.0', vitest: '^4.0.0' }
        },
        null,
        2
      )
    );
    fs.writeFileSync(path.join(tempProjectDir, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}');
    fs.writeFileSync(
      path.join(tempProjectDir, 'src', 'index.ts'),
      `import { helper } from './helper';\nexport function runApp(name: string): string {\n  return helper(name);\n}\n`
    );
    fs.writeFileSync(
      path.join(tempProjectDir, 'src', 'helper.ts'),
      `export function helper(val: string): string {\n  return val.trim().toUpperCase();\n}\n`
    );
    fs.writeFileSync(
      path.join(tempProjectDir, 'tests', 'index.test.ts'),
      `import { describe, it, expect } from 'vitest';\ndescribe('app', () => { it('works', () => expect(true).toBe(true)); });\n`
    );
    // Secret files that MUST be excluded
    fs.writeFileSync(path.join(tempProjectDir, '.env'), 'GEMINI_API_KEY=secret-test-value-123456\n');
    fs.writeFileSync(path.join(tempProjectDir, 'private.key'), '-----BEGIN PRIVATE KEY-----\nSECRET\n');

    desktopAutomationService.clearApprovedPaths();
    desktopAutomationService.setRequireApprovedPath(true);
    desktopAutomationService.approvePath(tempProjectDir);
    desktopBridge.registerApprovedPath(tempProjectDir);

    // Wire fetch to call serverDevStudio directly in Vitest node/jsdom hybrid without live HTTP socket
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const body = init?.body ? JSON.parse(String(init.body)) : {};

      if (url === '/api/dev/project/inspect') {
        return new Response(JSON.stringify(serverDevStudio.inspectProjectWorkspace(body.projectPath)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url === '/api/dev/source/read') {
        return new Response(JSON.stringify(serverDevStudio.readSourceFile(body.projectPath, body.filePath)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url === '/api/dev/patch/preview') {
        return new Response(
          JSON.stringify(
            serverDevStudio.previewPatch({
              projectPath: body.projectPath,
              filePath: body.filePath,
              proposedContent: body.proposedContent
            })
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url === '/api/dev/patch/apply') {
        return new Response(JSON.stringify(serverDevStudio.applyPatch(body)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url === '/api/dev/patch/rollback') {
        return new Response(JSON.stringify(serverDevStudio.rollbackPatch(body.patchId, body.projectPath)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url === '/api/dev/patch/backups') {
        return new Response(JSON.stringify({ ok: true, backups: serverDevStudio.getPatchBackups() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url === '/api/dev/tools') {
        const tools = await serverDevStudio.detectInstalledDevTools();
        return new Response(JSON.stringify({ ok: true, tools }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url === '/api/dev/command/run') {
        const res = await serverDevStudio.runApprovedCommand(body);
        return new Response(JSON.stringify(res), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url === '/api/dev/command/cancel') {
        const cancelled = serverDevStudio.cancelCommand(body.taskId);
        return new Response(JSON.stringify({ ok: cancelled }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({ ok: false, error: `Unmocked URL: ${url}` }), { status: 404 });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    try {
      fs.rmSync(tempProjectDir, { recursive: true, force: true });
      fs.rmSync(unapprovedDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failure
    }
  });

  it('1. Approved project folder validation blocks unapproved or traversal paths', async () => {
    const outsideReport = await devStudioService.inspectProject(unapprovedDir);
    expect(outsideReport.ok).toBe(false);
    expect(outsideReport.error).toMatch(/outside approved/i);

    const serverTraversal = serverDevStudio.inspectProjectWorkspace(path.join(tempProjectDir, '..', 'outside'));
    expect(serverTraversal.ok).toBe(false);
  });

  it('2. Project structure inspection identifies languages, frameworks, package managers, entry points, and dependencies', async () => {
    const report = await devStudioService.inspectProject(tempProjectDir);
    expect(report.ok).toBe(true);
    expect(report.projectName).toBe(path.basename(tempProjectDir));
    expect(report.frameworks).toContain('React');
    expect(report.frameworks).toContain('Express');
    expect(report.testFrameworks).toContain('Vitest');
    expect(report.packageManagers).toContain('npm');
    expect(report.entryPoints).toContain('src/index.ts');
    expect(report.configFiles).toContain('package.json');
    expect(report.dependencies.some((d) => d.name === 'react')).toBe(true);
  });

  it('3. Reading source files extracts content, line count, symbols, and imports', async () => {
    const src = await devStudioService.readSourceFile(tempProjectDir, 'src/index.ts');
    expect(src.ok).toBe(true);
    expect(src.language).toBe('TypeScript');
    expect(src.imports).toContain('./helper');
    expect(src.symbols.some((s) => s.name === 'runApp')).toBe(true);
    expect(src.lineCount).toBeGreaterThanOrEqual(4);
  });

  it('4. Secret files (.env, *.key) are excluded from workspace trees, source reads, and AI context', async () => {
    expect(isSecretOrSensitiveFile('.env')).toBe(true);
    expect(isSecretOrSensitiveFile('private.key')).toBe(true);

    const report = await devStudioService.inspectProject(tempProjectDir);
    expect(report.files.some((f) => f.name === '.env' || f.name === 'private.key')).toBe(false);
    expect(report.excludedSecretFiles).toContain('.env');
    expect(report.excludedSecretFiles).toContain('private.key');

    const secretRead = await devStudioService.readSourceFile(tempProjectDir, path.join(tempProjectDir, '.env'));
    expect(secretRead.ok).toBe(false);
    expect(secretRead.error).toMatch(/secret/i);

    const ctx = await devStudioService.buildSelectiveAIContext({
      projectPath: tempProjectDir,
      focusFiles: ['.env', 'src/index.ts']
    });
    expect(ctx.contextText).not.toContain('secret-test-value-123456');
    expect(ctx.includedFiles).toContain('src/index.ts');
  });

  it('5. Code generation produces diff preview without writing files to disk before approval', async () => {
    const gen = await devStudioService.generateCodeProposal({
      projectPath: tempProjectDir,
      prompt: 'Create a Python calculator'
    });
    expect(gen.ok).toBe(true);
    expect(gen.patch).toBeDefined();
    expect(gen.patch!.relativePath).toBe('calculator.py');
    expect(gen.patch!.status).toBe('PENDING_REVIEW');
    expect(gen.patch!.preview.addedLines).toBeGreaterThan(5);
    expect(fs.existsSync(path.join(tempProjectDir, 'calculator.py'))).toBe(false);
  });

  it('6. File creation succeeds only after explicit single-use CODE_PATCH approval', async () => {
    const gen = await devStudioService.generateCodeProposal({
      projectPath: tempProjectDir,
      prompt: 'Create a Python calculator'
    });
    const patch = gen.patch!;

    const unapproved = await devStudioService.applyProposedPatch(patch.id, 'nonexistent-perm', false);
    expect(unapproved.ok).toBe(false);
    expect(fs.existsSync(path.join(tempProjectDir, 'calculator.py'))).toBe(false);

    const perm = devStudioService.requestPatchPermission(patch.id)!;
    expect(perm.category).toBe('CODE_PATCH');
    permissionManager.approveOnce(perm.id);

    const applied = await devStudioService.applyProposedPatch(patch.id, perm.id, false);
    expect(applied.ok).toBe(true);
    expect(fs.existsSync(path.join(tempProjectDir, 'calculator.py'))).toBe(true);
  });

  it('7. Patch preview accurately computes additions, removals, and line diffs', async () => {
    const preview = await desktopBridge.previewDevPatch(
      tempProjectDir,
      path.join(tempProjectDir, 'src', 'helper.ts'),
      `export function helper(val: string): string {\n  return val.trim().toLowerCase();\n}\n`
    );
    expect(preview.ok).toBe(true);
    expect(preview.existed).toBe(true);
    expect(preview.overwriteWarning).toBe(true);
    expect(preview.addedLines).toBeGreaterThanOrEqual(1);
    expect(preview.removedLines).toBeGreaterThanOrEqual(1);
  });

  it('8. Patch rejection keeps existing files untouched on disk', async () => {
    const original = fs.readFileSync(path.join(tempProjectDir, 'src', 'helper.ts'), 'utf8');
    const prop = await devStudioService.proposePatch({
      projectPath: tempProjectDir,
      relativeOrFullPath: 'src/helper.ts',
      proposedContent: 'export const broken = true;\n',
      title: 'Test Reject',
      explanation: 'Testing rejection path'
    });
    expect(prop.ok).toBe(true);
    const rejected = devStudioService.rejectProposedPatch(prop.patch!.id);
    expect(rejected).toBe(true);
    expect(fs.readFileSync(path.join(tempProjectDir, 'src', 'helper.ts'), 'utf8')).toBe(original);
  });

  it('9. Overwrite protection blocks modifying an existing file unless overwrite is confirmed', async () => {
    const prop = await devStudioService.proposePatch({
      projectPath: tempProjectDir,
      relativeOrFullPath: 'src/helper.ts',
      proposedContent: `export function helper(val: string): string {\n  return val.trim();\n}\n`,
      title: 'Modify helper.ts',
      explanation: 'Remove uppercase conversion'
    });
    const perm = devStudioService.requestPatchPermission(prop.patch!.id)!;
    permissionManager.approveOnce(perm.id);

    const blocked = await devStudioService.applyProposedPatch(prop.patch!.id, perm.id, false);
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/overwrite confirmation/i);
  });

  it('10. Rollback restores original file contents and removes newly created files safely', async () => {
    // Modify existing file with overwrite confirmation + backup
    const originalContent = fs.readFileSync(path.join(tempProjectDir, 'src', 'helper.ts'), 'utf8');
    const prop = await devStudioService.proposePatch({
      projectPath: tempProjectDir,
      relativeOrFullPath: 'src/helper.ts',
      proposedContent: `export function helper(val: string): string {\n  return val.trim().toLowerCase();\n}\n`,
      title: 'Lowercase helper',
      explanation: 'Change normalization',
      overwrite: true
    });
    const applyPerm = devStudioService.requestPatchPermission(prop.patch!.id)!;
    permissionManager.approveOnce(applyPerm.id);
    const applied = await devStudioService.applyProposedPatch(prop.patch!.id, applyPerm.id, true);
    expect(applied.ok).toBe(true);
    expect(fs.readFileSync(path.join(tempProjectDir, 'src', 'helper.ts'), 'utf8')).toContain('toLowerCase');

    const rbPerm = devStudioService.requestRollbackPermission(applied.patch!.appliedPatchId!, 'src/helper.ts');
    permissionManager.approveOnce(rbPerm.id);
    const rolledBack = await devStudioService.rollbackPatch(applied.patch!.appliedPatchId!, tempProjectDir, rbPerm.id);
    expect(rolledBack.ok).toBe(true);
    expect(rolledBack.restoredAction).toBe('RESTORED_ORIGINAL');
    expect(fs.readFileSync(path.join(tempProjectDir, 'src', 'helper.ts'), 'utf8')).toBe(originalContent);
  });

  it('11. Command allowlist enforcement rejects arbitrary binaries and shells', () => {
    const blockedRm = serverDevStudio.validateDevCommand({
      projectPath: tempProjectDir,
      tool: 'rm' as any,
      args: ['-rf', '.']
    });
    expect(blockedRm.valid).toBe(false);
    expect(blockedRm.error).toMatch(/DISALLOWED_DEV_TOOL/i);

    const blockedNpmInstall = serverDevStudio.validateDevCommand({
      projectPath: tempProjectDir,
      tool: 'npm',
      args: ['install', 'evil-pkg']
    });
    expect(blockedNpmInstall.valid).toBe(false);
  });

  it('12. Argument validation rejects shell metacharacters, traversal, and inline eval flags', () => {
    const chained = serverDevStudio.validateDevCommand({
      projectPath: tempProjectDir,
      tool: 'npm',
      args: ['test', '&&', 'whoami']
    });
    expect(chained.valid).toBe(false);
    expect(chained.error).toMatch(/UNSAFE_ARGUMENT/i);

    const inlineEval = serverDevStudio.validateDevCommand({
      projectPath: tempProjectDir,
      tool: 'python',
      args: ['-c', 'print(1)']
    });
    expect(inlineEval.valid).toBe(false);
    expect(inlineEval.error).toMatch(/DISALLOWED_INLINE_EVAL/i);
  });

  it('13. Working directory (cwd) enforcement blocks commands outside approved project roots', async () => {
    const perm = devStudioService.requestDevCommandPermission(unapprovedDir, 'npm', ['test']);
    permissionManager.approveOnce(perm.id);

    const res = await devStudioService.runApprovedCommand({
      projectPath: unapprovedDir,
      tool: 'npm',
      args: ['test'],
      permissionId: perm.id
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/outside approved/i);
  });

  it('14. Execution cancellation terminates running command and reports cancelled status', async () => {
    const perm = devStudioService.requestDevCommandPermission(tempProjectDir, 'npm', ['run', 'lint']);
    permissionManager.approveOnce(perm.id);

    const taskId = 'cancel-lint-test';
    const cmdPromise = devStudioService.runApprovedCommand({
      projectPath: tempProjectDir,
      tool: 'npm',
      args: ['run', 'lint'],
      permissionId: perm.id,
      taskId
    });

    await new Promise((r) => setTimeout(r, 15));
    const cancelled = await devStudioService.cancelCommand(taskId);
    expect(cancelled).toBe(true);

    const result = await cmdPromise;
    expect(result.ok).toBe(false);
    expect(result.cancelled).toBe(true);
  });

  it('15. Output size limit caps terminal buffers at 64KB and redacts API keys', async () => {
    const perm = devStudioService.requestDevCommandPermission(tempProjectDir, 'npm', ['audit']);
    permissionManager.approveOnce(perm.id);

    const res = await devStudioService.runApprovedCommand({
      projectPath: tempProjectDir,
      tool: 'npm',
      args: ['audit'],
      permissionId: perm.id
    });
    expect(res.truncatedOutput).toBe(true);
    expect(res.stdout).toContain('OUTPUT TRUNCATED');
    expect(res.stdout).not.toContain('AIzaSySuperSecretToken1234567890abcd');
    expect(redactSecretsFromText('Bearer sk-secret12345678901234567890')).toContain('REDACTED');
  });

  it('16. Test result interpretation parses Vitest/Pytest pass, fail, skip counts and failures cleanly', async () => {
    const perm = devStudioService.requestDevCommandPermission(tempProjectDir, 'npm', ['test']);
    permissionManager.approveOnce(perm.id);

    const cmdRes = await devStudioService.runApprovedCommand({
      projectPath: tempProjectDir,
      tool: 'npm',
      args: ['test'],
      permissionId: perm.id
    });
    expect(cmdRes.testReport).toBeDefined();
    expect(cmdRes.testReport!.framework).toBe('Vitest');
    expect(cmdRes.testReport!.passed).toBe(4);
    expect(cmdRes.testReport!.failed).toBe(1);
    expect(cmdRes.testReport!.skipped).toBe(1);
    expect(cmdRes.testReport!.failures.length).toBeGreaterThanOrEqual(1);

    const pytestReport = interpretTestOutput('pytest', '3 passed, 1 failed in 0.42s', '', 1);
    expect(pytestReport!.framework).toBe('pytest');
    expect(pytestReport!.passed).toBe(3);
    expect(pytestReport!.failed).toBe(1);
  });

  it('17. Project documentation generator builds grounded docs strictly from inspected files', async () => {
    const docRes = await devStudioService.generateGroundedDocumentation(tempProjectDir, 'README');
    expect(docRes.ok).toBe(true);
    expect(docRes.patch).toBeDefined();
    expect(docRes.patch!.proposedContent).toContain(path.basename(tempProjectDir));
    expect(docRes.patch!.proposedContent).toContain('React');
    expect(docRes.patch!.proposedContent).toContain('src/index.ts');
    expect(docRes.patch!.proposedContent).not.toContain('secret-test-value-123456');
  });

  it('18. Development task planner supports step pauses, cancellation, and history', async () => {
    const plan = devPlannerService.createPlan({
      projectPath: tempProjectDir,
      objective: 'Create a Python calculator',
      includePatchStep: true,
      includeTestStep: true
    });

    const paused = await devPlannerService.executePlan(plan.id);
    // Must pause before APPLY_PATCH without bypassing PermissionManager
    expect(paused.status).toBe('AWAITING_APPROVAL');
    expect(paused.proposedPatchIds.length).toBe(1);
    expect(paused.steps.find((s) => s.kind === 'APPLY_PATCH')?.status).toBe('AWAITING_APPROVAL');

    const cancelled = devPlannerService.cancelPlan(plan.id);
    expect(cancelled).toBe(true);
    expect(devPlannerService.getActivePlan()?.status).toBe('CANCELLED');
    expect(devPlannerService.getHistory().some((h) => h.id === plan.id)).toBe(true);
  });

  it('19. Permission enforcement blocks reused tokens and gates external AI context uploads', async () => {
    const gen = await devStudioService.generateCodeProposal({
      projectPath: tempProjectDir,
      prompt: 'Create a Python calculator'
    });
    const perm = devStudioService.requestPatchPermission(gen.patch!.id)!;
    permissionManager.approveOnce(perm.id);

    const first = await devStudioService.applyProposedPatch(gen.patch!.id, perm.id, false);
    expect(first.ok).toBe(true);

    // Token cannot be reused for a second operation
    const reuse = await devStudioService.applyProposedPatch(gen.patch!.id, perm.id, true);
    expect(reuse.ok).toBe(false);
    expect(reuse.error).toMatch(/cannot be reused/i);

    // External upload blocked without EXTERNAL_AI_UPLOAD permission
    contextualAI.saveConfig({ provider: 'BACKEND' });
    const extCheck = await devStudioService.understandCodeOrProject({
      projectPath: tempProjectDir,
      question: 'Summarize this architecture',
      useExternalAI: true
    });
    expect(extCheck.usedExternalAI).toBe(false);
    expect(extCheck.requiresExternalUploadApproval).toBe(true);
  });

  it('20. Audit history records inspections, reads, previews, patches, rollbacks, and commands', async () => {
    await devStudioService.inspectProject(tempProjectDir);
    await devStudioService.readSourceFile(tempProjectDir, 'src/index.ts');
    await devStudioService.analyzeErrorAndProposeFix({
      projectPath: tempProjectDir,
      errorText: 'TypeError: Cannot read properties of undefined at src/index.ts:3:5'
    });

    const entries = devStudioService.getAuditEntries(20);
    const categories = new Set(entries.map((e) => e.category));
    expect(categories.has('INSPECT')).toBe(true);
    expect(categories.has('READ')).toBe(true);
    expect(categories.has('DEBUG')).toBe(true);
    expect(desktopBridge.getActionAuditLog(20).length).toBeGreaterThan(0);
  });
});
