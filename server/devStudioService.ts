import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn, ChildProcess } from 'child_process';
import { desktopAutomationService, BLOCKED_FILE_EXTENSIONS } from './desktopAutomation.js';

export interface ProjectTreeNode {
  name: string;
  relativePath: string;
  fullPath: string;
  isDirectory: boolean;
  sizeBytes: number;
  extension: string;
  language?: string;
  isTestFile?: boolean;
  isEntryPoint?: boolean;
  isConfigFile?: boolean;
}

export interface ProjectDependencyInfo {
  name: string;
  version: string;
  scope: 'dependency' | 'devDependency' | 'python';
  role: string;
}

export interface ProjectWorkspaceReport {
  ok: boolean;
  projectPath: string;
  projectName: string;
  inspectedAt: number;
  languages: { language: string; fileCount: number }[];
  frameworks: string[];
  packageManagers: string[];
  testFrameworks: string[];
  configFiles: string[];
  entryPoints: string[];
  testFiles: string[];
  scripts: Record<string, string>;
  dependencies: ProjectDependencyInfo[];
  files: ProjectTreeNode[];
  directories: string[];
  totalFilesScanned: number;
  totalBytes: number;
  truncated: boolean;
  excludedSecretFiles: string[];
  error?: string;
}

export interface SourceFileAnalysis {
  ok: boolean;
  path: string;
  relativePath: string;
  name: string;
  language: string;
  lineCount: number;
  sizeBytes: number;
  content?: string;
  symbols: { kind: 'function' | 'class' | 'interface' | 'component' | 'export'; name: string; line: number }[];
  imports: string[];
  truncated?: boolean;
  error?: string;
}

export interface DiffLine {
  type: 'context' | 'add' | 'remove';
  oldLineNumber?: number;
  newLineNumber?: number;
  text: string;
}

export interface CodeDiffPreview {
  ok: boolean;
  filePath: string;
  relativePath: string;
  existed: boolean;
  overwriteWarning: boolean;
  addedLines: number;
  removedLines: number;
  unifiedDiff: string;
  lines: DiffLine[];
  validationWarnings: string[];
  originalHash: string;
  proposedContent: string;
  originalContent: string;
  error?: string;
}

export interface AppliedPatchBackup {
  patchId: string;
  filePath: string;
  relativePath: string;
  existedBefore: boolean;
  originalContent: string | null;
  backupFilePath: string;
  appliedAt: number;
  rolledBack: boolean;
  rolledBackAt?: number;
  summary: string;
}

export interface DevCommandRequest {
  projectPath: string;
  tool: 'npm' | 'npx' | 'node' | 'python' | 'pytest' | 'tsc' | 'git';
  args: string[];
  timeoutMs?: number;
}

export interface DevTestFailureDetail {
  testName: string;
  file?: string;
  message: string;
}

export interface DevTestInterpretation {
  framework: string;
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  durationText?: string;
  failures: DevTestFailureDetail[];
  summary: string;
}

export interface DevCommandExecutionResult {
  ok: boolean;
  taskId: string;
  commandDisplay: string;
  cwd: string;
  exitCode: number | null;
  signal?: string | null;
  cancelled?: boolean;
  timedOut?: boolean;
  truncatedOutput?: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
  testReport?: DevTestInterpretation;
  error?: string;
}

export interface DevToolAvailability {
  tool: string;
  available: boolean;
  version?: string;
}

const SKIPPED_SCAN_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.nuxt',
  'dist',
  'build',
  'out',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  '.pytest_cache',
  '.mypy_cache',
  'target'
]);

const SECRET_FILE_BASENAME_PATTERNS = [
  /^\.env($|\.)/i,
  /^secrets?(\..*)?\.json$/i,
  /^credentials?(\..*)?\.json$/i,
  /service[-_]?account.*\.json$/i,
  /^id_(rsa|ed25519|ecdsa|dsa)(\.pub)?$/i,
  /^\.(npmrc|pypirc|netrc|htpasswd|pgpass)$/i,
  /^kubeconfig$/i
];

const SECRET_EXTENSIONS = new Set(['pem', 'key', 'p12', 'pfx', 'jks', 'keystore', 'kdbx', 'crt', 'cer']);

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TypeScript (React)',
  js: 'JavaScript',
  jsx: 'JavaScript (React)',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  py: 'Python',
  rs: 'Rust',
  go: 'Go',
  java: 'Java',
  kt: 'Kotlin',
  cs: 'C#',
  cpp: 'C++',
  c: 'C',
  h: 'C/C++ Header',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  json: 'JSON',
  md: 'Markdown',
  yml: 'YAML',
  yaml: 'YAML',
  toml: 'TOML',
  sql: 'SQL',
  txt: 'Plain Text'
};

const KNOWN_DEP_ROLES: Record<string, string> = {
  react: 'UI component rendering library',
  'react-dom': 'React DOM renderer',
  vite: 'Frontend bundler and dev server',
  typescript: 'Static type checker and compiler',
  tailwindcss: 'Utility-first CSS styling framework',
  express: 'HTTP server and REST routing framework',
  three: '3D WebGL scene and mesh renderer',
  '@mediapipe/tasks-vision': 'Hand landmark tracking runtime',
  vitest: 'Unit and integration test runner',
  jest: 'JavaScript/TypeScript test framework',
  pytest: 'Python test runner',
  fastapi: 'Python async REST API framework',
  uvicorn: 'ASGI web server for FastAPI',
  flask: 'Python micro web framework',
  django: 'Full-featured Python web framework',
  '@google/genai': 'Gemini generative AI SDK',
  lucide: 'SVG icon library',
  'lucide-react': 'React SVG icon library',
  tsx: 'TypeScript Node execution runtime',
  electron: 'Desktop application shell runtime'
};

const ALLOWED_DEV_TOOLS = new Set(['npm', 'npx', 'node', 'python', 'pytest', 'tsc', 'git']);
const DANGEROUS_ARG_TOKENS = /[;&|`$<>\r\n\0]/;
const ALLOWED_NPM_SUBCOMMANDS = new Set(['test', 'run', 'ls', 'outdated', 'audit', '--version', '-v']);
const ALLOWED_NPM_RUN_SCRIPTS = new Set(['test', 'build', 'lint', 'typecheck', 'check']);
const ALLOWED_NPX_TOOLS = new Set(['vitest', 'tsc', 'eslint', 'prettier']);
const ALLOWED_GIT_SUBCOMMANDS = new Set(['status', 'diff', 'log', 'branch', '--version']);

const MAX_SCAN_FILES = 300;
const MAX_SCAN_DEPTH = 6;
const MAX_READ_FILE_BYTES = 512 * 1024;
const MAX_AI_CONTEXT_CHARS = 32_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_CMD_TIMEOUT_MS = 30_000;
const MAX_CMD_TIMEOUT_MS = 60_000;

function computeSimpleHash(content: string): string {
  let hash = 2166136261;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function isSecretOrSensitiveFile(filePath: string): boolean {
  const base = path.basename(filePath.trim());
  if (!base) return false;
  if (SECRET_FILE_BASENAME_PATTERNS.some((pat) => pat.test(base))) {
    return true;
  }
  const ext = path.extname(base).replace(/^\./, '').toLowerCase();
  if (SECRET_EXTENSIONS.has(ext)) {
    return true;
  }
  return false;
}

export function redactSecretsFromText(rawText: string): string {
  if (!rawText) return '';
  return rawText
    .replace(/(-----BEGIN [A-Z ]*PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----)/g, '$1\n[REDACTED_PRIVATE_KEY]\n$2')
    .replace(/\b(AIza[0-9A-Za-z_-]{20,})\b/g, '[REDACTED_GEMINI_KEY]')
    .replace(/\b(gsk_[0-9A-Za-z]{20,})\b/g, '[REDACTED_GROQ_KEY]')
    .replace(/\b(sk-[0-9A-Za-z_-]{20,})\b/g, '[REDACTED_API_KEY]')
    .replace(/\b(ghp_[0-9A-Za-z]{20,})\b/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{16,}/gi, '$1[REDACTED_TOKEN]')
    .replace(/\b([A-Z0-9_]{0,40}(?:API_KEY|SECRET|PASSWORD|TOKEN|PRIVATE_KEY)[A-Z0-9_]{0,20}\s*=\s*)([^\s\r\n"']+|"[^"]*"|'[^']*')/gi, '$1[REDACTED]');
}

export function buildLineDiff(originalContent: string, proposedContent: string, maxLines = 400): {
  lines: DiffLine[];
  addedLines: number;
  removedLines: number;
  unifiedDiff: string;
} {
  const oldLines = originalContent === '' ? [] : originalContent.split(/\r?\n/);
  const newLines = proposedContent === '' ? [] : proposedContent.split(/\r?\n/);

  // Compact Myers/LCS diff for readable line-level preview
  const m = oldLines.length;
  const n = newLines.length;
  const diffLines: DiffLine[] = [];

  if (m * n <= 160_000) {
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        if (oldLines[i] === newLines[j]) {
          dp[i][j] = dp[i + 1][j + 1] + 1;
        } else {
          dp[i][j] = dp[i + 1][j] >= dp[i][j + 1] ? dp[i + 1][j] : dp[i][j + 1];
        }
      }
    }

    let i = 0;
    let j = 0;
    while (i < m && j < n) {
      if (oldLines[i] === newLines[j]) {
        diffLines.push({ type: 'context', oldLineNumber: i + 1, newLineNumber: j + 1, text: oldLines[i] });
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        diffLines.push({ type: 'remove', oldLineNumber: i + 1, text: oldLines[i] });
        i++;
      } else {
        diffLines.push({ type: 'add', newLineNumber: j + 1, text: newLines[j] });
        j++;
      }
    }
    while (i < m) {
      diffLines.push({ type: 'remove', oldLineNumber: i + 1, text: oldLines[i] });
      i++;
    }
    while (j < n) {
      diffLines.push({ type: 'add', newLineNumber: j + 1, text: newLines[j] });
      j++;
    }
  } else {
    // Fallback linear diff for very large files
    oldLines.forEach((line, idx) => diffLines.push({ type: 'remove', oldLineNumber: idx + 1, text: line }));
    newLines.forEach((line, idx) => diffLines.push({ type: 'add', newLineNumber: idx + 1, text: line }));
  }

  const addedLines = diffLines.filter((l) => l.type === 'add').length;
  const removedLines = diffLines.filter((l) => l.type === 'remove').length;
  const trimmed = diffLines.slice(0, maxLines);

  const unifiedDiff = trimmed
    .map((l) => (l.type === 'add' ? `+ ${l.text}` : l.type === 'remove' ? `- ${l.text}` : `  ${l.text}`))
    .join('\n');

  return { lines: trimmed, addedLines, removedLines, unifiedDiff };
}

export function interpretTestOutput(tool: string, stdout: string, stderr: string, exitCode: number | null): DevTestInterpretation | undefined {
  const combined = `${stdout}\n${stderr}`;
  if (!combined.trim()) return undefined;

  const failures: DevTestFailureDetail[] = [];
  const failLines = combined.match(/^\s*(?:FAIL|×|FAILED)\s+.+$/gm) || [];
  for (const line of failLines.slice(0, 10)) {
    failures.push({
      testName: line.replace(/^\s*(?:FAIL|×|FAILED)\s+/, '').trim(),
      message: 'Reported failing test case in test runner output.'
    });
  }

  const vitestTestsLine = combined.match(/Tests\s+([^\r\n]+)/i)?.[1] || '';
  if (vitestTestsLine || combined.includes('vitest') || combined.includes('Test Files')) {
    const failed = vitestTestsLine.match(/(\d+)\s+failed/i)?.[1]
      ? parseInt(vitestTestsLine.match(/(\d+)\s+failed/i)![1], 10)
      : exitCode && exitCode !== 0
      ? Math.max(1, failures.length)
      : 0;
    const passed = vitestTestsLine.match(/(\d+)\s+passed/i)?.[1]
      ? parseInt(vitestTestsLine.match(/(\d+)\s+passed/i)![1], 10)
      : 0;
    const skipped = vitestTestsLine.match(/(\d+)\s+skipped/i)?.[1]
      ? parseInt(vitestTestsLine.match(/(\d+)\s+skipped/i)![1], 10)
      : 0;
    const totalMatch = vitestTestsLine.match(/\((\d+)\)/);
    const total = totalMatch ? parseInt(totalMatch[1], 10) : passed + failed + skipped;
    const durationMatch = combined.match(/Duration\s+([\d.]+m?s)/i);
    return {
      framework: 'Vitest',
      passed,
      failed,
      skipped,
      total,
      durationText: durationMatch?.[1],
      failures,
      summary: failed > 0
        ? `Vitest finished with ${failed} failing test(s) and ${passed} passing test(s).`
        : `Vitest passed ${passed}/${total || passed} test(s) cleanly.`
    };
  }

  const jestTestsMatch = combined.match(/Tests:\s+(?:(\d+)\s+failed,\s*)?(?:(\d+)\s+skipped,\s*)?(\d+)\s+passed,\s*(\d+)\s+total/i);
  if (jestTestsMatch) {
    const failed = jestTestsMatch[1] ? parseInt(jestTestsMatch[1], 10) : 0;
    const skipped = jestTestsMatch[2] ? parseInt(jestTestsMatch[2], 10) : 0;
    const passed = parseInt(jestTestsMatch[3], 10);
    const total = parseInt(jestTestsMatch[4], 10);
    return {
      framework: 'Jest',
      passed,
      failed,
      skipped,
      total,
      failures,
      summary: failed > 0
        ? `Jest reported ${failed} failing and ${passed} passing of ${total} tests.`
        : `Jest passed ${passed}/${total} tests.`
    };
  }

  const isPytest = tool === 'pytest' || /\b(?:passed|failed|skipped)\b.*\bin\s+[\d.]+s\b/i.test(combined) || combined.toLowerCase().includes('pytest');
  if (isPytest) {
    const passed = combined.match(/(\d+)\s+passed/i)?.[1] ? parseInt(combined.match(/(\d+)\s+passed/i)![1], 10) : 0;
    const failed = combined.match(/(\d+)\s+failed/i)?.[1]
      ? parseInt(combined.match(/(\d+)\s+failed/i)![1], 10)
      : exitCode && exitCode !== 0
      ? Math.max(1, failures.length)
      : 0;
    const skipped = combined.match(/(\d+)\s+skipped/i)?.[1] ? parseInt(combined.match(/(\d+)\s+skipped/i)![1], 10) : 0;
    const durationMatch = combined.match(/\bin\s+([\d.]+s)/i);
    const total = passed + failed + skipped;
    return {
      framework: 'pytest',
      passed,
      failed,
      skipped,
      total,
      durationText: durationMatch?.[1],
      failures,
      summary: failed > 0
        ? `pytest reported ${failed} failure(s) and ${passed} passing test(s).`
        : `pytest passed ${passed} test(s).`
    };
  }

  return undefined;
}

export class DevStudioService {
  private backups: Map<string, AppliedPatchBackup> = new Map();
  private runningProcesses: Map<string, { child: ChildProcess; cwd: string; cancelled: boolean }> = new Map();
  private activeProjectCommands: Set<string> = new Set();
  private backupRootDir: string;

  constructor(backupDir?: string) {
    this.backupRootDir = backupDir || path.join(os.tmpdir(), 'jarvis-devstudio-backups');
  }

  private ensureWithinApprovedAndProject(projectPath: string, targetPath?: string): {
    ok: boolean;
    normalizedProject?: string;
    normalizedTarget?: string;
    error?: string;
  } {
    const projVal = desktopAutomationService.validatePath(projectPath);
    if (!projVal.valid || !projVal.normalizedPath) {
      return { ok: false, error: projVal.error || 'Project folder is not within approved roots.' };
    }
    if (!fs.existsSync(projVal.normalizedPath) || !fs.statSync(projVal.normalizedPath).isDirectory()) {
      return { ok: false, error: `Approved project folder "${projVal.normalizedPath}" does not exist or is not a directory.` };
    }

    if (!targetPath) {
      return { ok: true, normalizedProject: projVal.normalizedPath };
    }

    const combined = path.isAbsolute(targetPath) ? targetPath : path.join(projVal.normalizedPath, targetPath);
    const targetVal = desktopAutomationService.validatePath(combined, { allowedRoot: projVal.normalizedPath });
    if (!targetVal.valid || !targetVal.normalizedPath) {
      return { ok: false, error: targetVal.error || 'Target file is outside the selected project folder.' };
    }

    return {
      ok: true,
      normalizedProject: projVal.normalizedPath,
      normalizedTarget: targetVal.normalizedPath
    };
  }

  /**
   * 1. Project Workspace Inspection
   */
  public inspectProjectWorkspace(projectPath: string): ProjectWorkspaceReport {
    const guard = this.ensureWithinApprovedAndProject(projectPath);
    if (!guard.ok || !guard.normalizedProject) {
      return {
        ok: false,
        projectPath,
        projectName: path.basename(String(projectPath || '')) || 'unknown',
        inspectedAt: Date.now(),
        languages: [],
        frameworks: [],
        packageManagers: [],
        testFrameworks: [],
        configFiles: [],
        entryPoints: [],
        testFiles: [],
        scripts: {},
        dependencies: [],
        files: [],
        directories: [],
        totalFilesScanned: 0,
        totalBytes: 0,
        truncated: false,
        excludedSecretFiles: [],
        error: guard.error
      };
    }

    const rootDir = guard.normalizedProject;
    const files: ProjectTreeNode[] = [];
    const directories: string[] = [];
    const excludedSecretFiles: string[] = [];
    const langCounts = new Map<string, number>();
    const configFiles: string[] = [];
    const entryPoints: string[] = [];
    const testFiles: string[] = [];
    let totalBytes = 0;
    let truncated = false;

    const walk = (dir: string, depth: number) => {
      if (depth > MAX_SCAN_DEPTH || files.length >= MAX_SCAN_FILES) {
        if (files.length >= MAX_SCAN_FILES) truncated = true;
        return;
      }

      let entries: string[] = [];
      try {
        entries = fs.readdirSync(dir).sort((a, b) => a.localeCompare(b));
      } catch {
        return;
      }

      for (const name of entries) {
        if (files.length >= MAX_SCAN_FILES) {
          truncated = true;
          return;
        }
        const fullPath = path.join(dir, name);
        const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/');

        let stat: fs.Stats;
        try {
          // Use lstatSync to detect and avoid following symlinks outside project boundaries
          const lstat = fs.lstatSync(fullPath);
          if (lstat.isSymbolicLink()) {
            const real = fs.realpathSync(fullPath);
            const rootPrefix = rootDir.endsWith(path.sep) ? rootDir : `${rootDir}${path.sep}`;
            if (real !== rootDir && !real.startsWith(rootPrefix)) {
              continue;
            }
          }
          stat = fs.statSync(fullPath);
        } catch {
          continue;
        }

        if (stat.isDirectory()) {
          if (SKIPPED_SCAN_DIRS.has(name)) continue;
          directories.push(relPath);
          walk(fullPath, depth + 1);
        } else {
          if (isSecretOrSensitiveFile(fullPath)) {
            excludedSecretFiles.push(relPath);
            continue;
          }

          const ext = path.extname(name).replace(/^\./, '').toLowerCase();
          const language = EXTENSION_LANGUAGE_MAP[ext];
          if (language) {
            langCounts.set(language, (langCounts.get(language) || 0) + 1);
          }

          const isTestFile =
            /(\.test\.|\.spec\.|_test\.py$|test_.*\.py$|\/tests?\/|__tests__)/i.test(relPath);
          const isConfigFile =
            /^(package\.json|tsconfig.*\.json|vite\.config\..*|pyproject\.toml|requirements\.txt|Dockerfile|docker-compose\.ya?ml|tailwind\.config\..*|postcss\.config\..*|\.eslintrc.*|vitest\.config\..*)$/i.test(
              name
            );
          const isEntryPoint =
            /^(src\/(main|App|index)\.(tsx?|jsx?)|index\.(ts|js|html)|server\.(ts|js)|main\.py|app\.py|manage\.py)$/i.test(
              relPath
            );

          if (isTestFile) testFiles.push(relPath);
          if (isConfigFile) configFiles.push(relPath);
          if (isEntryPoint) entryPoints.push(relPath);

          totalBytes += stat.size;
          files.push({
            name,
            relativePath: relPath,
            fullPath,
            isDirectory: false,
            sizeBytes: stat.size,
            extension: ext,
            language,
            isTestFile,
            isEntryPoint,
            isConfigFile
          });
        }
      }
    };

    walk(rootDir, 0);

    const frameworks = new Set<string>();
    const packageManagers = new Set<string>();
    const testFrameworks = new Set<string>();
    let scripts: Record<string, string> = {};
    const dependencies: ProjectDependencyInfo[] = [];

    if (fs.existsSync(path.join(rootDir, 'package-lock.json'))) packageManagers.add('npm');
    if (fs.existsSync(path.join(rootDir, 'bun.lock')) || fs.existsSync(path.join(rootDir, 'bun.lockb'))) packageManagers.add('bun');
    if (fs.existsSync(path.join(rootDir, 'pnpm-lock.yaml'))) packageManagers.add('pnpm');
    if (fs.existsSync(path.join(rootDir, 'yarn.lock'))) packageManagers.add('yarn');

    const pkgPath = path.join(rootDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      if (packageManagers.size === 0) packageManagers.add('npm');
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
          scripts?: Record<string, string>;
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        if (pkg.scripts && typeof pkg.scripts === 'object') {
          scripts = { ...pkg.scripts };
        }
        const inspectDeps = (deps: Record<string, string> | undefined, scope: 'dependency' | 'devDependency') => {
          if (!deps) return;
          for (const [depName, ver] of Object.entries(deps)) {
            dependencies.push({
              name: depName,
              version: String(ver),
              scope,
              role: KNOWN_DEP_ROLES[depName] || (scope === 'devDependency' ? 'Development / build tooling' : 'Runtime project dependency')
            });
            if (depName === 'react') frameworks.add('React');
            if (depName === 'vite') frameworks.add('Vite');
            if (depName === 'next') frameworks.add('Next.js');
            if (depName === 'express') frameworks.add('Express');
            if (depName === 'three') frameworks.add('Three.js');
            if (depName === 'tailwindcss') frameworks.add('Tailwind CSS');
            if (depName === 'electron') frameworks.add('Electron');
            if (depName === 'vitest') testFrameworks.add('Vitest');
            if (depName === 'jest') testFrameworks.add('Jest');
            if (depName === 'playwright' || depName === '@playwright/test') testFrameworks.add('Playwright');
          }
        };
        inspectDeps(pkg.dependencies, 'dependency');
        inspectDeps(pkg.devDependencies, 'devDependency');
      } catch {
        // Ignore malformed package.json safely
      }
    }

    const reqPath = path.join(rootDir, 'requirements.txt');
    if (fs.existsSync(reqPath)) {
      packageManagers.add('pip');
      try {
        const lines = fs.readFileSync(reqPath, 'utf8').split(/\r?\n/);
        for (const raw of lines) {
          const clean = raw.split('#')[0].trim();
          if (!clean) continue;
          const [pkgName, ver] = clean.split(/[=<>!~]+/);
          const normName = pkgName.trim().toLowerCase();
          if (!normName) continue;
          dependencies.push({
            name: pkgName.trim(),
            version: ver ? ver.trim() : '*',
            scope: 'python',
            role: KNOWN_DEP_ROLES[normName] || 'Python package dependency'
          });
          if (normName === 'fastapi') frameworks.add('FastAPI');
          if (normName === 'flask') frameworks.add('Flask');
          if (normName === 'django') frameworks.add('Django');
          if (normName === 'pytest') testFrameworks.add('pytest');
        }
      } catch {
        // ignore
      }
    }

    if (fs.existsSync(path.join(rootDir, 'pyproject.toml'))) {
      packageManagers.add('pip/pyproject');
    }

    if (testFiles.some((f) => f.endsWith('.py')) && !testFrameworks.has('pytest')) {
      testFrameworks.add('unittest / pytest');
    }

    const languages = Array.from(langCounts.entries())
      .map(([language, fileCount]) => ({ language, fileCount }))
      .sort((a, b) => b.fileCount - a.fileCount);

    return {
      ok: true,
      projectPath: rootDir,
      projectName: path.basename(rootDir) || rootDir,
      inspectedAt: Date.now(),
      languages,
      frameworks: Array.from(frameworks),
      packageManagers: Array.from(packageManagers),
      testFrameworks: Array.from(testFrameworks),
      configFiles,
      entryPoints,
      testFiles,
      scripts,
      dependencies,
      files,
      directories,
      totalFilesScanned: files.length,
      totalBytes,
      truncated,
      excludedSecretFiles
    };
  }

  /**
   * 2. Safe Source File Reading & Static Code Symbol Analysis
   */
  public readSourceFile(projectPath: string, filePath: string): SourceFileAnalysis {
    const guard = this.ensureWithinApprovedAndProject(projectPath, filePath);
    if (!guard.ok || !guard.normalizedProject || !guard.normalizedTarget) {
      return {
        ok: false,
        path: filePath,
        relativePath: filePath,
        name: path.basename(String(filePath || '')),
        language: 'Unknown',
        lineCount: 0,
        sizeBytes: 0,
        symbols: [],
        imports: [],
        error: guard.error
      };
    }

    const target = guard.normalizedTarget;
    const relPath = path.relative(guard.normalizedProject, target).replace(/\\/g, '/');

    if (isSecretOrSensitiveFile(target)) {
      return {
        ok: false,
        path: target,
        relativePath: relPath,
        name: path.basename(target),
        language: 'Restricted',
        lineCount: 0,
        sizeBytes: 0,
        symbols: [],
        imports: [],
        error: `SECRET_FILE_BLOCKED: "${relPath}" is a sensitive secret/credential file and is strictly excluded from AI reading.`
      };
    }

    const ext = path.extname(target).replace(/^\./, '').toLowerCase();
    if (BLOCKED_FILE_EXTENSIONS.has(ext)) {
      return {
        ok: false,
        path: target,
        relativePath: relPath,
        name: path.basename(target),
        language: 'Binary',
        lineCount: 0,
        sizeBytes: 0,
        symbols: [],
        imports: [],
        error: `Blocked reading binary/executable file (.${ext}).`
      };
    }

    if (!fs.existsSync(target)) {
      return {
        ok: false,
        path: target,
        relativePath: relPath,
        name: path.basename(target),
        language: EXTENSION_LANGUAGE_MAP[ext] || 'Plain Text',
        lineCount: 0,
        sizeBytes: 0,
        symbols: [],
        imports: [],
        error: 'Source file does not exist.'
      };
    }

    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      return {
        ok: false,
        path: target,
        relativePath: relPath,
        name: path.basename(target),
        language: 'Directory',
        lineCount: 0,
        sizeBytes: 0,
        symbols: [],
        imports: [],
        error: 'Target is a directory, not a source file.'
      };
    }

    if (stat.size > MAX_READ_FILE_BYTES) {
      return {
        ok: false,
        path: target,
        relativePath: relPath,
        name: path.basename(target),
        language: EXTENSION_LANGUAGE_MAP[ext] || 'Plain Text',
        lineCount: 0,
        sizeBytes: stat.size,
        symbols: [],
        imports: [],
        error: `File exceeds safe source reader limit (${stat.size} bytes > ${MAX_READ_FILE_BYTES} bytes).`
      };
    }

    const raw = fs.readFileSync(target, 'utf8');
    const truncated = raw.length > MAX_AI_CONTEXT_CHARS;
    const content = truncated ? raw.slice(0, MAX_AI_CONTEXT_CHARS) : raw;
    const lines = raw.split(/\r?\n/);

    const symbols: SourceFileAnalysis['symbols'] = [];
    const imports: string[] = [];

    lines.forEach((line, idx) => {
      const lineNum = idx + 1;
      const impMatch = line.match(/^\s*import\s+.*?\s+from\s+['"]([^'"]+)['"]/) ||
        line.match(/^\s*(?:from|import)\s+([a-zA-Z0-9_.-]+)/);
      if (impMatch?.[1]) {
        imports.push(impMatch[1]);
      }

      const fnMatch =
        line.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_$]+)/) ||
        line.match(/^\s*def\s+([a-zA-Z0-9_]+)/);
      if (fnMatch?.[1]) {
        symbols.push({ kind: 'function', name: fnMatch[1], line: lineNum });
      }

      const classMatch = line.match(/^\s*(?:export\s+)?class\s+([a-zA-Z0-9_$]+)/);
      if (classMatch?.[1]) {
        symbols.push({ kind: 'class', name: classMatch[1], line: lineNum });
      }

      const ifaceMatch = line.match(/^\s*(?:export\s+)?(?:interface|type)\s+([a-zA-Z0-9_$]+)/);
      if (ifaceMatch?.[1]) {
        symbols.push({ kind: 'interface', name: ifaceMatch[1], line: lineNum });
      }

      const compMatch = line.match(/^\s*export\s+const\s+([A-Z][a-zA-Z0-9_$]*)/);
      if (compMatch?.[1]) {
        symbols.push({ kind: 'component', name: compMatch[1], line: lineNum });
      }
    });

    return {
      ok: true,
      path: target,
      relativePath: relPath,
      name: path.basename(target),
      language: EXTENSION_LANGUAGE_MAP[ext] || 'Plain Text',
      lineCount: lines.length,
      sizeBytes: stat.size,
      content,
      symbols: symbols.slice(0, 80),
      imports: Array.from(new Set(imports)).slice(0, 60),
      truncated
    };
  }

  /**
   * 3. Patch Preview & Validation (Never writes to disk without explicit approval step)
   */
  public previewPatch(params: {
    projectPath: string;
    filePath: string;
    proposedContent: string;
  }): CodeDiffPreview {
    const guard = this.ensureWithinApprovedAndProject(params.projectPath, params.filePath);
    if (!guard.ok || !guard.normalizedProject || !guard.normalizedTarget) {
      return {
        ok: false,
        filePath: params.filePath,
        relativePath: params.filePath,
        existed: false,
        overwriteWarning: false,
        addedLines: 0,
        removedLines: 0,
        unifiedDiff: '',
        lines: [],
        validationWarnings: [],
        originalHash: '',
        proposedContent: '',
        originalContent: '',
        error: guard.error
      };
    }

    const target = guard.normalizedTarget;
    const relPath = path.relative(guard.normalizedProject, target).replace(/\\/g, '/');

    if (isSecretOrSensitiveFile(target)) {
      return {
        ok: false,
        filePath: target,
        relativePath: relPath,
        existed: false,
        overwriteWarning: false,
        addedLines: 0,
        removedLines: 0,
        unifiedDiff: '',
        lines: [],
        validationWarnings: [],
        originalHash: '',
        proposedContent: '',
        originalContent: '',
        error: `SECRET_FILE_BLOCKED: Refusing to modify sensitive secret file "${relPath}".`
      };
    }

    const ext = path.extname(target).replace(/^\./, '').toLowerCase();
    if (BLOCKED_FILE_EXTENSIONS.has(ext)) {
      return {
        ok: false,
        filePath: target,
        relativePath: relPath,
        existed: false,
        overwriteWarning: false,
        addedLines: 0,
        removedLines: 0,
        unifiedDiff: '',
        lines: [],
        validationWarnings: [],
        originalHash: '',
        proposedContent: '',
        originalContent: '',
        error: `BLOCKED_EXTENSION: Refusing to create or patch executable/binary extension (.${ext}).`
      };
    }

    const proposed = String(params.proposedContent ?? '');
    if (proposed.includes('\0')) {
      return {
        ok: false,
        filePath: target,
        relativePath: relPath,
        existed: false,
        overwriteWarning: false,
        addedLines: 0,
        removedLines: 0,
        unifiedDiff: '',
        lines: [],
        validationWarnings: [],
        originalHash: '',
        proposedContent: '',
        originalContent: '',
        error: 'INVALID_CONTENT: Proposed content contains null bytes.'
      };
    }

    const existed = fs.existsSync(target);
    const originalContent = existed ? fs.readFileSync(target, 'utf8') : '';
    const validationWarnings: string[] = [];

    if (!proposed.trim()) {
      validationWarnings.push('Proposed content is empty.');
    }
    if (ext === 'json') {
      try {
        JSON.parse(proposed);
      } catch (e: unknown) {
        validationWarnings.push(`JSON syntax warning: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const diff = buildLineDiff(originalContent, proposed);
    return {
      ok: true,
      filePath: target,
      relativePath: relPath,
      existed,
      overwriteWarning: existed,
      addedLines: diff.addedLines,
      removedLines: diff.removedLines,
      unifiedDiff: diff.unifiedDiff,
      lines: diff.lines,
      validationWarnings,
      originalHash: computeSimpleHash(originalContent),
      proposedContent: proposed,
      originalContent
    };
  }

  /**
   * 4. Apply Approved Patch with Automatic Backup & Rollback Snapshot
   */
  public applyPatch(params: {
    projectPath: string;
    filePath: string;
    proposedContent: string;
    overwrite?: boolean;
    expectedOriginalHash?: string;
    summary?: string;
  }): {
    ok: boolean;
    patchId?: string;
    filePath: string;
    relativePath: string;
    backupPath?: string;
    existedBefore: boolean;
    error?: string;
  } {
    const preview = this.previewPatch({
      projectPath: params.projectPath,
      filePath: params.filePath,
      proposedContent: params.proposedContent
    });

    if (!preview.ok) {
      return {
        ok: false,
        filePath: preview.filePath,
        relativePath: preview.relativePath,
        existedBefore: preview.existed,
        error: preview.error
      };
    }

    if (preview.existed && !params.overwrite) {
      return {
        ok: false,
        filePath: preview.filePath,
        relativePath: preview.relativePath,
        existedBefore: true,
        error: 'FILE_ALREADY_EXISTS: Overwrite confirmation flag is required before modifying an existing file.'
      };
    }

    if (params.expectedOriginalHash && params.expectedOriginalHash !== preview.originalHash) {
      return {
        ok: false,
        filePath: preview.filePath,
        relativePath: preview.relativePath,
        existedBefore: preview.existed,
        error: 'STALE_FILE_HASH: File content changed on disk since patch preview was generated. Re-preview before applying.'
      };
    }

    const jsonWarning = preview.validationWarnings.find((w) => w.startsWith('JSON syntax warning'));
    if (jsonWarning) {
      return {
        ok: false,
        filePath: preview.filePath,
        relativePath: preview.relativePath,
        existedBefore: preview.existed,
        error: `VALIDATION_FAILED: ${jsonWarning}`
      };
    }

    const patchId = `patch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const backupFilePath = path.join(this.backupRootDir, `${patchId}.bak.json`);

    try {
      fs.mkdirSync(path.dirname(backupFilePath), { recursive: true });
      const backupPayload: AppliedPatchBackup = {
        patchId,
        filePath: preview.filePath,
        relativePath: preview.relativePath,
        existedBefore: preview.existed,
        originalContent: preview.existed ? preview.originalContent : null,
        backupFilePath,
        appliedAt: Date.now(),
        rolledBack: false,
        summary: params.summary || (preview.existed ? `Patched ${preview.relativePath}` : `Created ${preview.relativePath}`)
      };
      fs.writeFileSync(backupFilePath, JSON.stringify(backupPayload, null, 2), { encoding: 'utf8', mode: 0o600 });

      fs.mkdirSync(path.dirname(preview.filePath), { recursive: true });
      fs.writeFileSync(preview.filePath, preview.proposedContent, { encoding: 'utf8', mode: 0o644 });

      this.backups.set(patchId, backupPayload);
      return {
        ok: true,
        patchId,
        filePath: preview.filePath,
        relativePath: preview.relativePath,
        backupPath: backupFilePath,
        existedBefore: preview.existed
      };
    } catch (err: unknown) {
      return {
        ok: false,
        filePath: preview.filePath,
        relativePath: preview.relativePath,
        existedBefore: preview.existed,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }

  /**
   * 5. Rollback an Applied Patch Safely
   */
  public rollbackPatch(patchId: string, projectPath?: string): {
    ok: boolean;
    patchId: string;
    filePath?: string;
    restoredAction?: 'RESTORED_ORIGINAL' | 'REMOVED_NEW_FILE';
    error?: string;
  } {
    let record = this.backups.get(patchId);
    if (!record) {
      const candidate = path.join(this.backupRootDir, `${path.basename(patchId)}.bak.json`);
      if (fs.existsSync(candidate)) {
        try {
          record = JSON.parse(fs.readFileSync(candidate, 'utf8')) as AppliedPatchBackup;
        } catch {
          record = undefined;
        }
      }
    }

    if (!record) {
      return { ok: false, patchId, error: `Backup record "${patchId}" not found.` };
    }
    if (record.rolledBack) {
      return { ok: false, patchId, filePath: record.filePath, error: 'Patch was already rolled back.' };
    }

    const checkPath = projectPath
      ? this.ensureWithinApprovedAndProject(projectPath, record.filePath)
      : desktopAutomationService.validatePath(record.filePath);

    if ('ok' in checkPath ? !checkPath.ok : !checkPath.valid) {
      return { ok: false, patchId, filePath: record.filePath, error: 'Rollback target is no longer within approved paths.' };
    }

    try {
      let restoredAction: 'RESTORED_ORIGINAL' | 'REMOVED_NEW_FILE';
      if (record.existedBefore && record.originalContent !== null) {
        fs.writeFileSync(record.filePath, record.originalContent, { encoding: 'utf8', mode: 0o644 });
        restoredAction = 'RESTORED_ORIGINAL';
      } else {
        if (fs.existsSync(record.filePath)) {
          fs.unlinkSync(record.filePath);
        }
        restoredAction = 'REMOVED_NEW_FILE';
      }

      record.rolledBack = true;
      record.rolledBackAt = Date.now();
      this.backups.set(patchId, record);
      if (fs.existsSync(record.backupFilePath)) {
        fs.writeFileSync(record.backupFilePath, JSON.stringify(record, null, 2), { encoding: 'utf8', mode: 0o600 });
      }

      return { ok: true, patchId, filePath: record.filePath, restoredAction };
    } catch (err: unknown) {
      return {
        ok: false,
        patchId,
        filePath: record.filePath,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }

  public getPatchBackups(): Omit<AppliedPatchBackup, 'originalContent'>[] {
    return Array.from(this.backups.values())
      .sort((a, b) => b.appliedAt - a.appliedAt)
      .map(({ originalContent: _omit, ...rest }) => ({ ...rest }));
  }

  /**
   * 6. Strict Command Validation + Execution inside Approved Project Root
   */
  public validateDevCommand(req: DevCommandRequest): {
    valid: boolean;
    executable?: string;
    args?: string[];
    cwd?: string;
    display?: string;
    error?: string;
  } {
    if (!req || typeof req !== 'object') {
      return { valid: false, error: 'Invalid command request payload.' };
    }

    const guard = this.ensureWithinApprovedAndProject(req.projectPath);
    if (!guard.ok || !guard.normalizedProject) {
      return { valid: false, error: guard.error || 'Working directory is outside approved project folders.' };
    }

    const tool = String(req.tool || '').trim().toLowerCase();
    if (!ALLOWED_DEV_TOOLS.has(tool)) {
      return {
        valid: false,
        error: `DISALLOWED_DEV_TOOL: "${req.tool}" is not in the development command allowlist (${Array.from(ALLOWED_DEV_TOOLS).join(', ')}).`
      };
    }

    const rawArgs = Array.isArray(req.args) ? req.args.map((a) => String(a).trim()).filter(Boolean) : [];
    for (const arg of rawArgs) {
      if (DANGEROUS_ARG_TOKENS.test(arg) || /(^|[\\/])\.\.([\\/]|$)/.test(arg)) {
        return {
          valid: false,
          error: `UNSAFE_ARGUMENT: Argument "${arg}" contains disallowed shell or traversal tokens.`
        };
      }
      if (/^(?:-e|--eval|-c|-enc|--exec)$/i.test(arg)) {
        return {
          valid: false,
          error: `DISALLOWED_INLINE_EVAL: Inline script evaluation flag "${arg}" is strictly blocked.`
        };
      }
    }

    if (tool === 'npm') {
      const sub = rawArgs[0]?.toLowerCase() || '';
      if (!ALLOWED_NPM_SUBCOMMANDS.has(sub)) {
        return { valid: false, error: `DISALLOWED_NPM_SUBCOMMAND: Only safe npm commands (test, run test/build/lint, ls, outdated, audit) are allowed.` };
      }
      if (sub === 'run') {
        const script = rawArgs[1]?.toLowerCase() || '';
        if (!ALLOWED_NPM_RUN_SCRIPTS.has(script)) {
          return { valid: false, error: `DISALLOWED_NPM_SCRIPT: Only allowlisted scripts (${Array.from(ALLOWED_NPM_RUN_SCRIPTS).join(', ')}) are permitted.` };
        }
      }
    } else if (tool === 'npx') {
      const targetTool = rawArgs[0]?.toLowerCase() || '';
      if (!ALLOWED_NPX_TOOLS.has(targetTool)) {
        return { valid: false, error: `DISALLOWED_NPX_TOOL: Only ${Array.from(ALLOWED_NPX_TOOLS).join(', ')} are allowed via npx.` };
      }
      if (targetTool === 'vitest' && rawArgs[1] && rawArgs[1].toLowerCase() !== 'run') {
        return { valid: false, error: 'vitest must be executed in single-pass "run" mode.' };
      }
    } else if (tool === 'node') {
      if (rawArgs.length !== 1 || (rawArgs[0] !== '--version' && rawArgs[0] !== '-v')) {
        return { valid: false, error: 'Direct node execution is restricted to "--version" / "-v" tool checks.' };
      }
    } else if (tool === 'python') {
      const allowedPy =
        (rawArgs.length === 1 && (rawArgs[0] === '--version' || rawArgs[0] === '-V')) ||
        (rawArgs[0] === '-m' && (rawArgs[1] === 'pytest' || rawArgs[1] === 'unittest'));
      if (!allowedPy) {
        return { valid: false, error: 'python execution is restricted to "-m pytest", "-m unittest", or "--version".' };
      }
    } else if (tool === 'tsc') {
      const allowedTsc = rawArgs.every((a) => a === '--noEmit' || a === '--version' || a === '-v' || a === '--pretty' || a === 'false');
      if (!allowedTsc) {
        return { valid: false, error: 'tsc is restricted to type-checking (--noEmit) or --version.' };
      }
    } else if (tool === 'git') {
      const sub = rawArgs[0]?.toLowerCase() || '';
      if (!ALLOWED_GIT_SUBCOMMANDS.has(sub)) {
        return { valid: false, error: 'git is restricted to read-only inspection (status, diff, log, branch, --version).' };
      }
    }

    const isWin = process.platform === 'win32';
    const executable =
      isWin && (tool === 'npm' || tool === 'npx' || tool === 'tsc')
        ? `${tool}.cmd`
        : tool;

    return {
      valid: true,
      executable,
      args: rawArgs,
      cwd: guard.normalizedProject,
      display: `${tool}${rawArgs.length ? ' ' + rawArgs.join(' ') : ''}`
    };
  }

  public async runApprovedCommand(
    req: DevCommandRequest & { taskId?: string }
  ): Promise<DevCommandExecutionResult> {
    const startedAt = Date.now();
    const taskId = req.taskId || `devcmd-${startedAt.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const val = this.validateDevCommand(req);

    if (!val.valid || !val.executable || !val.cwd || !val.display) {
      return {
        ok: false,
        taskId,
        commandDisplay: `${req.tool} ${(req.args || []).join(' ')}`.trim(),
        cwd: req.projectPath,
        exitCode: null,
        stdout: '',
        stderr: '',
        durationMs: 0,
        error: val.error || 'Command validation failed.'
      };
    }

    if (this.activeProjectCommands.has(val.cwd)) {
      return {
        ok: false,
        taskId,
        commandDisplay: val.display,
        cwd: val.cwd,
        exitCode: null,
        stdout: '',
        stderr: '',
        durationMs: 0,
        error: 'CONCURRENT_DEV_COMMAND_IN_PROGRESS: Another command is already running in this project workspace.'
      };
    }

    const timeoutMs = Math.min(Math.max(1000, req.timeoutMs || DEFAULT_CMD_TIMEOUT_MS), MAX_CMD_TIMEOUT_MS);
    this.activeProjectCommands.add(val.cwd);

    return new Promise((resolve) => {
      let stdoutBuf = '';
      let stderrBuf = '';
      let truncatedOutput = false;
      let timedOut = false;
      let settled = false;

      const appendChunk = (existing: string, chunk: Buffer | string): string => {
        if (Buffer.byteLength(existing, 'utf8') >= MAX_OUTPUT_BYTES) {
          truncatedOutput = true;
          return existing;
        }
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        const next = existing + text;
        if (Buffer.byteLength(next, 'utf8') > MAX_OUTPUT_BYTES) {
          truncatedOutput = true;
          return next.slice(0, MAX_OUTPUT_BYTES) + '\n[OUTPUT TRUNCATED: Exceeded 64KB limit]';
        }
        return next;
      };

      let child: ChildProcess;
      try {
        child = spawn(val.executable!, val.args || [], {
          cwd: val.cwd,
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            FORCE_COLOR: '0',
            CI: '1'
          }
        });
      } catch (err: unknown) {
        this.activeProjectCommands.delete(val.cwd!);
        resolve({
          ok: false,
          taskId,
          commandDisplay: val.display!,
          cwd: val.cwd!,
          exitCode: null,
          stdout: '',
          stderr: '',
          durationMs: Date.now() - startedAt,
          error: err instanceof Error ? err.message : String(err)
        });
        return;
      }

      const procRecord = { child, cwd: val.cwd!, cancelled: false };
      this.runningProcesses.set(taskId, procRecord);

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill('SIGTERM');
        } catch {
          // ignore
        }
      }, timeoutMs);

      const finish = (exitCode: number | null, signal: NodeJS.Signals | null, errMsg?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.runningProcesses.delete(taskId);
        this.activeProjectCommands.delete(val.cwd!);

        const cleanOut = redactSecretsFromText(stdoutBuf);
        const cleanErr = redactSecretsFromText(stderrBuf);
        const cancelled = procRecord.cancelled;
        const ok = !cancelled && !timedOut && !errMsg && exitCode === 0;
        const isTestRun =
          val.display!.includes('test') || val.display!.includes('vitest') || val.display!.includes('pytest');

        resolve({
          ok,
          taskId,
          commandDisplay: val.display!,
          cwd: val.cwd!,
          exitCode,
          signal,
          cancelled,
          timedOut,
          truncatedOutput,
          stdout: cleanOut,
          stderr: cleanErr,
          durationMs: Date.now() - startedAt,
          testReport: isTestRun ? interpretTestOutput(req.tool, cleanOut, cleanErr, exitCode) : undefined,
          error: errMsg || (cancelled ? 'Command execution cancelled by user.' : timedOut ? `Command timed out after ${timeoutMs}ms.` : undefined)
        });
      };

      child.stdout?.on('data', (chunk) => {
        stdoutBuf = appendChunk(stdoutBuf, chunk);
      });
      child.stderr?.on('data', (chunk) => {
        stderrBuf = appendChunk(stderrBuf, chunk);
      });
      child.on('error', (err: NodeJS.ErrnoException) => {
        finish(null, null, err.code === 'ENOENT' ? `Development tool "${val.executable}" was not found on PATH.` : err.message);
      });
      child.on('close', (code, sig) => {
        finish(code, sig);
      });
    });
  }

  public cancelCommand(taskId: string): boolean {
    const rec = this.runningProcesses.get(taskId);
    if (!rec) return false;
    rec.cancelled = true;
    try {
      rec.child.kill('SIGTERM');
    } catch {
      // ignore
    }
    return true;
  }

  public getRunningTaskIds(): string[] {
    return Array.from(this.runningProcesses.keys());
  }

  public async detectInstalledDevTools(): Promise<DevToolAvailability[]> {
    const tools = ['node', 'npm', 'npx', 'python', 'pytest', 'git'];
    const isWin = process.platform === 'win32';
    const results: DevToolAvailability[] = [];

    for (const tool of tools) {
      const exe = isWin && (tool === 'npm' || tool === 'npx') ? `${tool}.cmd` : tool;
      const version = await new Promise<string | undefined>((resolve) => {
        let out = '';
        let done = false;
        try {
          const child = spawn(exe, ['--version'], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
          const timer = setTimeout(() => {
            if (!done) {
              done = true;
              try {
                child.kill();
              } catch {
                // ignore
              }
              resolve(undefined);
            }
          }, 1500);
          child.stdout?.on('data', (d) => {
            out += d.toString();
          });
          child.on('error', () => {
            if (!done) {
              done = true;
              clearTimeout(timer);
              resolve(undefined);
            }
          });
          child.on('close', (code) => {
            if (!done) {
              done = true;
              clearTimeout(timer);
              resolve(code === 0 ? out.trim().split(/\r?\n/)[0] : undefined);
            }
          });
        } catch {
          if (!done) {
            done = true;
            resolve(undefined);
          }
        }
      });
      results.push({
        tool,
        available: Boolean(version),
        version
      });
    }
    return results;
  }
}

export const devStudioService = new DevStudioService(
  process.env.VITEST ? path.join(os.tmpdir(), `jarvis-devstudio-backups-test-${process.pid}`) : undefined
);
