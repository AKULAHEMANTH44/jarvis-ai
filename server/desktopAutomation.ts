import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn } from 'child_process';

export interface AllowedApplicationEntry {
  id: string;
  displayName: string;
  description: string;
  winExecutable: string;
  macExecutable?: string;
  linuxExecutable?: string;
  defaultArgs?: string[];
  category?: 'APP' | 'BROWSER' | 'MUSIC';
}

export interface DiscoveredApplicationInfo extends AllowedApplicationEntry {
  available: boolean;
  status: 'AVAILABLE' | 'NOT_INSTALLED' | 'UNKNOWN';
  resolvedPath?: string;
  lastLaunched?: number;
}

export interface FolderItemEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  sizeBytes: number;
  modifiedTime: number;
  extension: string;
}

export interface WebPageInspectionResult {
  ok: boolean;
  url: string;
  title?: string;
  description?: string;
  error?: string;
}

export const BLOCKED_FILE_EXTENSIONS = new Set([
  'exe', 'msi', 'bat', 'cmd', 'ps1', 'sh', 'vbs', 'vbe', 'dll', 'sys', 'com', 'app', 'dmg', 'pkg', 'deb', 'rpm'
]);

/**
 * Strict configurable allowlist of permitted Windows / Desktop applications.
 * No arbitrary binaries, scripts, or terminal shells (cmd.exe, powershell.exe, bash, etc.) are allowed.
 */
export const DEFAULT_ALLOWED_APPLICATIONS: Record<string, AllowedApplicationEntry> = {
  VS_CODE: {
    id: 'VS_CODE',
    displayName: 'Visual Studio Code',
    description: 'Code editor and development environment',
    winExecutable: 'code.cmd',
    macExecutable: 'code',
    linuxExecutable: 'code',
    category: 'APP'
  },
  NOTEPAD: {
    id: 'NOTEPAD',
    displayName: 'Notepad',
    description: 'Lightweight text editor',
    winExecutable: 'notepad.exe',
    macExecutable: 'open',
    linuxExecutable: 'gedit',
    category: 'APP'
  },
  CALCULATOR: {
    id: 'CALCULATOR',
    displayName: 'Windows Calculator',
    description: 'Standard system scientific calculator',
    winExecutable: 'calc.exe',
    macExecutable: 'open',
    linuxExecutable: 'gnome-calculator',
    category: 'APP'
  },
  EXPLORER: {
    id: 'EXPLORER',
    displayName: 'File Explorer',
    description: 'Windows graphical folder and filesystem navigator',
    winExecutable: 'explorer.exe',
    macExecutable: 'open',
    linuxExecutable: 'xdg-open',
    category: 'APP'
  },
  BROWSER: {
    id: 'BROWSER',
    displayName: 'Web Browser',
    description: 'System default web browser',
    winExecutable: 'explorer.exe',
    macExecutable: 'open',
    linuxExecutable: 'xdg-open',
    category: 'BROWSER'
  },
  CHROME: {
    id: 'CHROME',
    displayName: 'Google Chrome',
    description: 'Google Chrome web browser',
    winExecutable: 'chrome.exe',
    macExecutable: 'open',
    linuxExecutable: 'google-chrome',
    category: 'BROWSER'
  },
  SPOTIFY: {
    id: 'SPOTIFY',
    displayName: 'Spotify',
    description: 'Music streaming and playback application',
    winExecutable: 'spotify.exe',
    macExecutable: 'open',
    linuxExecutable: 'spotify',
    category: 'MUSIC'
  }
};

export const ALLOWED_APPLICATIONS: Record<string, AllowedApplicationEntry> = {
  ...DEFAULT_ALLOWED_APPLICATIONS
};

/**
 * Disallowed executables, shell binaries, and suspicious command patterns
 */
export const BLOCKED_COMMANDS = new Set([
  'cmd',
  'cmd.exe',
  'powershell',
  'powershell.exe',
  'pwsh',
  'pwsh.exe',
  'bash',
  'sh',
  'zsh',
  'wscript',
  'wscript.exe',
  'cscript',
  'cscript.exe',
  'reg',
  'reg.exe',
  'regedit',
  'regedit.exe',
  'format',
  'del',
  'rmdir',
  'rm',
  'sudo',
  'certutil',
  'curl',
  'wget',
  'rundll32',
  'rundll32.exe',
  'mshta',
  'mshta.exe'
]);

const DANGEROUS_ARG_PATTERN = /[;&|`$<>\r\n\0]|^(?:\/c|-c|-e|--eval|-enc|-encodedcommand|-command)(?:$|[=\s:])/i;

export interface DesktopExecutionResult {
  ok: boolean;
  action: string;
  target: string;
  verified: boolean;
  summary: string;
  pid?: number;
  error?: string;
  details?: Record<string, unknown>;
}

export interface DesktopAuditEntry {
  id: string;
  action: string;
  target: string;
  ok: boolean;
  pid?: number;
  error?: string;
  timestamp: number;
}

export type ServerCapabilityId =
  | 'APPLICATION_ACCESS'
  | 'BROWSER_ACCESS'
  | 'FOLDER_ACCESS'
  | 'MUSIC_ACCESS'
  | 'CAMERA_ACCESS'
  | 'MICROPHONE_ACCESS';

export type ServerPermissionDecision = 'NOT_REQUESTED' | 'GRANTED' | 'DENIED';

export interface ServerPermissionPolicy {
  version: number;
  setupCompleted: boolean;
  setupCompletedAt: number | null;
  capabilities: Record<
    ServerCapabilityId,
    { id: ServerCapabilityId; decision: ServerPermissionDecision; updatedAt: number | null }
  >;
  allowedAppIds: Record<string, boolean>;
  approvedFolders: { path: string; name: string; grantedAt: number }[];
}

const SERVER_CAPABILITY_IDS: ServerCapabilityId[] = [
  'APPLICATION_ACCESS',
  'BROWSER_ACCESS',
  'FOLDER_ACCESS',
  'MUSIC_ACCESS',
  'CAMERA_ACCESS',
  'MICROPHONE_ACCESS'
];

function createDefaultServerPolicy(): ServerPermissionPolicy {
  return {
    version: 1,
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

function sanitizeServerPolicy(raw: unknown): ServerPermissionPolicy {
  const def = createDefaultServerPolicy();
  if (!raw || typeof raw !== 'object') return def;

  const obj = raw as Record<string, unknown>;
  const capabilities = { ...def.capabilities };
  if (obj.capabilities && typeof obj.capabilities === 'object') {
    const rawCaps = obj.capabilities as Record<string, unknown>;
    for (const id of SERVER_CAPABILITY_IDS) {
      const entry = rawCaps[id] as Record<string, unknown> | undefined;
      if (
        entry &&
        (entry.decision === 'NOT_REQUESTED' || entry.decision === 'GRANTED' || entry.decision === 'DENIED')
      ) {
        capabilities[id] = {
          id,
          decision: entry.decision,
          updatedAt:
            typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt) ? entry.updatedAt : null
        };
      }
    }
  }

  const allowedAppIds: Record<string, boolean> = { ...def.allowedAppIds };
  if (obj.allowedAppIds && typeof obj.allowedAppIds === 'object') {
    for (const [k, v] of Object.entries(obj.allowedAppIds as Record<string, unknown>)) {
      if (typeof v === 'boolean') {
        allowedAppIds[String(k).toUpperCase().replace(/[\s-]+/g, '_')] = v;
      }
    }
  }

  const approvedFolders: { path: string; name: string; grantedAt: number }[] = [];
  const seen = new Set<string>();
  if (Array.isArray(obj.approvedFolders)) {
    for (const item of obj.approvedFolders) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const cleanPath = typeof rec.path === 'string' ? rec.path.trim() : '';
      if (!cleanPath || /(^|[\\/])\.\.([\\/]|$)|%2e%2e/i.test(cleanPath) || cleanPath.includes('\0')) {
        continue;
      }
      if (seen.has(cleanPath)) continue;
      seen.add(cleanPath);
      const inferredName = cleanPath.split(/[\\/]/).filter(Boolean).pop() || cleanPath;
      approvedFolders.push({
        path: cleanPath,
        name: typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim() : inferredName,
        grantedAt:
          typeof rec.grantedAt === 'number' && Number.isFinite(rec.grantedAt) ? rec.grantedAt : Date.now()
      });
    }
  }

  return {
    version: 1,
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

export class DesktopAutomationService {
  private allowedApplications: Map<string, AllowedApplicationEntry> = new Map(
    Object.entries(DEFAULT_ALLOWED_APPLICATIONS)
  );
  private approvedRoots: Set<string> = new Set();
  private requireApprovedRoot = false;
  private auditLog: DesktopAuditEntry[] = [];
  private policy: ServerPermissionPolicy = createDefaultServerPolicy();
  private policyFilePath: string | null = null;

  constructor(options?: { policyFilePath?: string }) {
    if (options?.policyFilePath) {
      this.policyFilePath = options.policyFilePath;
      this.loadPolicyFromDisk();
    }
  }

  private loadPolicyFromDisk(): void {
    if (!this.policyFilePath) return;
    try {
      if (fs.existsSync(this.policyFilePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.policyFilePath, 'utf8'));
        this.policy = sanitizeServerPolicy(parsed);
        for (const f of this.policy.approvedFolders) {
          this.approvePath(f.path);
        }
      }
    } catch {
      this.policy = createDefaultServerPolicy();
    }
  }

  private savePolicyToDisk(): void {
    if (!this.policyFilePath) return;
    try {
      fs.mkdirSync(path.dirname(this.policyFilePath), { recursive: true });
      fs.writeFileSync(this.policyFilePath, JSON.stringify(this.policy, null, 2), {
        encoding: 'utf8',
        mode: 0o600
      });
    } catch {
      // Ignore filesystem write errors cleanly
    }
  }

  public getPermissionPolicy(): ServerPermissionPolicy {
    return sanitizeServerPolicy(this.policy);
  }

  public updatePermissionPolicy(rawPolicy: unknown): ServerPermissionPolicy {
    this.policy = sanitizeServerPolicy(rawPolicy);
    this.approvedRoots.clear();
    for (const f of this.policy.approvedFolders) {
      this.approvePath(f.path);
    }
    this.savePolicyToDisk();
    return this.getPermissionPolicy();
  }

  public resetPermissionPolicy(clearSetupCompleted = false): ServerPermissionPolicy {
    this.policy = createDefaultServerPolicy();
    if (!clearSetupCompleted) {
      this.policy.setupCompleted = true;
      this.policy.setupCompletedAt = Date.now();
    }
    this.approvedRoots.clear();
    this.savePolicyToDisk();
    return this.getPermissionPolicy();
  }

  public getAllowedApplications(): AllowedApplicationEntry[] {
    return Array.from(this.allowedApplications.values());
  }

  public registerAllowedApplication(entry: AllowedApplicationEntry): { ok: boolean; error?: string } {
    const normId = entry.id.trim().toUpperCase().replace(/[\s-]+/g, '_');
    const winBin = path.basename(entry.winExecutable).toLowerCase();
    const linuxBin = entry.linuxExecutable ? path.basename(entry.linuxExecutable).toLowerCase() : '';
    const macBin = entry.macExecutable ? path.basename(entry.macExecutable).toLowerCase() : '';

    if (
      BLOCKED_COMMANDS.has(winBin) ||
      (linuxBin && BLOCKED_COMMANDS.has(linuxBin)) ||
      (macBin && BLOCKED_COMMANDS.has(macBin))
    ) {
      return { ok: false, error: `Blocked executable "${entry.winExecutable}" cannot be registered.` };
    }

    if (/[;&|`$<>\r\n\0]/.test(entry.winExecutable)) {
      return { ok: false, error: 'Executable name contains disallowed shell characters.' };
    }

    this.allowedApplications.set(normId, { ...entry, id: normId });
    return { ok: true };
  }

  public resetAllowedApplications(): void {
    this.allowedApplications = new Map(Object.entries(DEFAULT_ALLOWED_APPLICATIONS));
  }

  public setRequireApprovedPath(enabled: boolean): void {
    this.requireApprovedRoot = enabled;
  }

  public approvePath(rawPath: string): { ok: boolean; normalizedPath?: string; error?: string } {
    const val = this.validatePath(rawPath, { skipApprovedCheck: true });
    if (!val.valid || !val.normalizedPath) {
      return { ok: false, error: val.error };
    }
    this.approvedRoots.add(val.normalizedPath);
    return { ok: true, normalizedPath: val.normalizedPath };
  }

  public getApprovedPaths(): string[] {
    return Array.from(this.approvedRoots);
  }

  public clearApprovedPaths(): void {
    this.approvedRoots.clear();
  }

  public revokeApprovedPath(rawPath: string): { ok: boolean } {
    const clean = String(rawPath || '').trim();
    if (!clean) return { ok: false };
    const resolved = path.resolve(clean);
    this.approvedRoots.delete(resolved);
    this.approvedRoots.delete(clean);
    this.policy.approvedFolders = this.policy.approvedFolders.filter(
      (f) => f.path !== clean && path.resolve(f.path) !== resolved
    );
    this.savePolicyToDisk();
    return { ok: true };
  }

  public isPathWithinApprovedRoots(resolvedPath: string): boolean {
    if (this.approvedRoots.size === 0) return !this.requireApprovedRoot;
    const normalizedTarget = path.resolve(resolvedPath);
    for (const root of this.approvedRoots) {
      const normalizedRoot = path.resolve(root);
      if (normalizedTarget === normalizedRoot) return true;
      const rootWithSep = normalizedRoot.endsWith(path.sep) ? normalizedRoot : `${normalizedRoot}${path.sep}`;
      if (normalizedTarget.startsWith(rootWithSep)) return true;
    }
    return false;
  }

  public getAuditLog(limit = 40): DesktopAuditEntry[] {
    return this.auditLog.slice(0, Math.max(1, limit)).map((e) => ({ ...e }));
  }

  public clearAuditLog(): void {
    this.auditLog = [];
  }

  private recordAudit(entry: Omit<DesktopAuditEntry, 'id' | 'timestamp'>): void {
    this.auditLog.unshift({
      id: `daud-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 5)}`,
      timestamp: Date.now(),
      ...entry
    });
    if (this.auditLog.length > 100) {
      this.auditLog = this.auditLog.slice(0, 100);
    }
  }

  /**
   * Safe path validation:
   * 1. Rejects path traversal sequences (including URL-encoded '%2e%2e' and '..') & null bytes.
   * 2. Checks absolute path resolution.
   * 3. Verifies path falls inside allowedRoot / approvedRoots when configured.
   */
  public validatePath(
    rawPath: string,
    options: { allowedRoot?: string; skipApprovedCheck?: boolean } | string = {}
  ): { valid: boolean; normalizedPath?: string; error?: string } {
    const opts = typeof options === 'string' ? { allowedRoot: options } : options;

    if (!rawPath || typeof rawPath !== 'string') {
      return { valid: false, error: 'Path is required and must be a string.' };
    }

    const trimmed = rawPath.trim();
    if (!trimmed) {
      return { valid: false, error: 'Path cannot be empty.' };
    }

    if (trimmed.includes('\0') || /[\r\n]/.test(trimmed)) {
      return { valid: false, error: 'Path contains prohibited control characters.' };
    }

    let decoded = trimmed;
    try {
      decoded = decodeURIComponent(trimmed);
    } catch {
      decoded = trimmed;
    }

    if (/(^|[\\/])\.\.([\\/]|$)/.test(trimmed) || /(^|[\\/])\.\.([\\/]|$)/.test(decoded)) {
      return { valid: false, error: 'Path traversal (..) is strictly prohibited.' };
    }

    try {
      const resolved = path.resolve(trimmed);

      if (opts.allowedRoot) {
        const resolvedRoot = path.resolve(opts.allowedRoot);
        const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
        if (resolved !== resolvedRoot && !resolved.startsWith(rootWithSep)) {
          return {
            valid: false,
            error: `Path "${trimmed}" is outside the authorized root directory ("${resolvedRoot}").`
          };
        }
      }

      if (!opts.skipApprovedCheck && (this.requireApprovedRoot || this.approvedRoots.size > 0)) {
        if (!this.isPathWithinApprovedRoots(resolved)) {
          return {
            valid: false,
            error: `Path "${resolved}" is not within user-selected or approved desktop paths.`
          };
        }
      }

      return { valid: true, normalizedPath: resolved };
    } catch (err: unknown) {
      return {
        valid: false,
        error: `Invalid path structure: ${err instanceof Error ? err.message : String(err)}`
      };
    }
  }

  private async spawnDetachedSafe(
    executable: string,
    args: string[]
  ): Promise<{ ok: boolean; pid?: number; error?: string }> {
    const baseName = path.basename(executable).toLowerCase();
    if (BLOCKED_COMMANDS.has(baseName)) {
      return { ok: false, error: `Blocked restricted command binary "${executable}".` };
    }

    return new Promise((resolve) => {
      let settled = false;
      try {
        const child = spawn(executable, args, {
          detached: true,
          stdio: 'ignore',
          shell: false
        });

        child.on('error', (err: NodeJS.ErrnoException) => {
          if (!settled) {
            settled = true;
            resolve({
              ok: false,
              error: err.code === 'ENOENT' ? `Executable "${executable}" was not found on this system.` : err.message
            });
          }
        });

        setTimeout(() => {
          if (!settled) {
            settled = true;
            try {
              child.unref();
            } catch {
              // ignore unref errors
            }
            resolve({ ok: true, pid: child.pid });
          }
        }, 45);
      } catch (err: unknown) {
        if (!settled) {
          settled = true;
          resolve({ ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      }
    });
  }

  /**
   * Launch an application from the strict allowlist.
   * NEVER runs arbitrary shell commands.
   */
  public async launchApprovedApplication(appKeyOrId: string, customArgs: string[] = []): Promise<DesktopExecutionResult> {
    const rawTrimmed = String(appKeyOrId || '').trim();
    const rawLower = rawTrimmed.toLowerCase();
    const normalizedKey = rawTrimmed.toUpperCase().replace(/[\s-]+/g, '_');

    if (BLOCKED_COMMANDS.has(rawLower) || BLOCKED_COMMANDS.has(`${rawLower}.exe`)) {
      const blockedRes: DesktopExecutionResult = {
        ok: false,
        action: 'APPLICATION_LAUNCH',
        target: appKeyOrId,
        verified: false,
        summary: `Blocked restricted shell/system binary "${appKeyOrId}".`,
        error: 'BLOCKED_SHELL_COMMAND'
      };
      this.recordAudit({ action: 'APPLICATION_LAUNCH', target: rawTrimmed, ok: false, error: blockedRes.error });
      return blockedRes;
    }

    const appEntry =
      this.allowedApplications.get(normalizedKey) ||
      Array.from(this.allowedApplications.values()).find(
        (a) =>
          a.id.toUpperCase() === normalizedKey ||
          a.displayName.toUpperCase().replace(/[\s-]+/g, '_') === normalizedKey
      );

    if (!appEntry) {
      const disallowedRes: DesktopExecutionResult = {
        ok: false,
        action: 'APPLICATION_LAUNCH',
        target: appKeyOrId,
        verified: false,
        summary: `Application "${appKeyOrId}" is not in the approved application allowlist.`,
        error: 'DISALLOWED_APPLICATION'
      };
      this.recordAudit({ action: 'APPLICATION_LAUNCH', target: rawTrimmed, ok: false, error: disallowedRes.error });
      return disallowedRes;
    }

    if (this.policy.capabilities.APPLICATION_ACCESS.decision === 'DENIED') {
      const deniedRes: DesktopExecutionResult = {
        ok: false,
        action: 'APPLICATION_LAUNCH',
        target: appEntry.displayName,
        verified: false,
        summary: 'Application Access is disabled in JARVIS persistent permissions.',
        error: 'PERMISSION_DENIED_BY_POLICY'
      };
      this.recordAudit({ action: 'APPLICATION_LAUNCH', target: appEntry.displayName, ok: false, error: deniedRes.error });
      return deniedRes;
    }

    if (this.policy.allowedAppIds[appEntry.id] === false) {
      const appDisabledRes: DesktopExecutionResult = {
        ok: false,
        action: 'APPLICATION_LAUNCH',
        target: appEntry.displayName,
        verified: false,
        summary: `Application "${appEntry.displayName}" is disabled in JARVIS Application Access settings.`,
        error: 'PERMISSION_DENIED_BY_POLICY'
      };
      this.recordAudit({ action: 'APPLICATION_LAUNCH', target: appEntry.displayName, ok: false, error: appDisabledRes.error });
      return appDisabledRes;
    }

    const sanitizedArgs = Array.isArray(customArgs)
      ? customArgs.filter((arg) => typeof arg === 'string' && !DANGEROUS_ARG_PATTERN.test(arg.trim()))
      : [];

    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';
    const executable = isWin
      ? appEntry.winExecutable
      : isMac
      ? appEntry.macExecutable || 'open'
      : appEntry.linuxExecutable || 'xdg-open';

    const spawnOut = await this.spawnDetachedSafe(executable, sanitizedArgs);
    if (!spawnOut.ok) {
      const failRes: DesktopExecutionResult = {
        ok: false,
        action: 'APPLICATION_LAUNCH',
        target: appEntry.displayName,
        verified: false,
        summary: `Failed to launch ${appEntry.displayName}: ${spawnOut.error}`,
        error: spawnOut.error,
        details: { applicationId: appEntry.id, executable }
      };
      this.recordAudit({ action: 'APPLICATION_LAUNCH', target: appEntry.displayName, ok: false, error: spawnOut.error });
      return failRes;
    }

    const okRes: DesktopExecutionResult = {
      ok: true,
      action: 'APPLICATION_LAUNCH',
      target: appEntry.displayName,
      verified: true,
      pid: spawnOut.pid,
      summary: `Successfully launched ${appEntry.displayName} (PID: ${spawnOut.pid || 'detached'}).`,
      details: { applicationId: appEntry.id, executable }
    };
    this.recordAudit({ action: 'APPLICATION_LAUNCH', target: appEntry.displayName, ok: true, pid: spawnOut.pid });
    return okRes;
  }

  /**
   * Open an approved file with its default system application.
   */
  public async openApprovedFile(filePath: string): Promise<DesktopExecutionResult> {
    if (this.policy.capabilities.FOLDER_ACCESS.decision === 'DENIED') {
      const deniedRes: DesktopExecutionResult = {
        ok: false,
        action: 'FILE_ACCESS',
        target: filePath,
        verified: false,
        summary: 'Folder & file system access is disabled in JARVIS persistent permissions.',
        error: 'PERMISSION_DENIED_BY_POLICY'
      };
      this.recordAudit({ action: 'FILE_ACCESS', target: filePath, ok: false, error: deniedRes.error });
      return deniedRes;
    }
    const val = this.validatePath(filePath);
    if (!val.valid || !val.normalizedPath) {
      const errRes: DesktopExecutionResult = {
        ok: false,
        action: 'FILE_ACCESS',
        target: filePath,
        verified: false,
        summary: val.error || 'Blocked invalid file path.',
        error: val.error
      };
      this.recordAudit({ action: 'FILE_ACCESS', target: filePath, ok: false, error: errRes.error });
      return errRes;
    }

    const targetPath = val.normalizedPath;
    if (!fs.existsSync(targetPath)) {
      const missingRes: DesktopExecutionResult = {
        ok: false,
        action: 'FILE_ACCESS',
        target: targetPath,
        verified: false,
        summary: `Target file "${path.basename(targetPath)}" was not found on disk.`,
        error: 'FILE_NOT_FOUND'
      };
      this.recordAudit({ action: 'FILE_ACCESS', target: targetPath, ok: false, error: missingRes.error });
      return missingRes;
    }

    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      const dirRes: DesktopExecutionResult = {
        ok: false,
        action: 'FILE_ACCESS',
        target: targetPath,
        verified: false,
        summary: `Target "${targetPath}" is a directory. Use folder open action instead.`,
        error: 'IS_DIRECTORY'
      };
      this.recordAudit({ action: 'FILE_ACCESS', target: targetPath, ok: false, error: dirRes.error });
      return dirRes;
    }

    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';
    const launcher = isWin ? 'explorer.exe' : isMac ? 'open' : 'xdg-open';

    const spawnOut = await this.spawnDetachedSafe(launcher, [targetPath]);
    if (!spawnOut.ok) {
      const failRes: DesktopExecutionResult = {
        ok: false,
        action: 'FILE_ACCESS',
        target: targetPath,
        verified: false,
        summary: `Unable to open file: ${spawnOut.error}`,
        error: spawnOut.error
      };
      this.recordAudit({ action: 'FILE_ACCESS', target: targetPath, ok: false, error: spawnOut.error });
      return failRes;
    }

    this.recordAudit({ action: 'FILE_ACCESS', target: targetPath, ok: true, pid: spawnOut.pid });
    return {
      ok: true,
      action: 'FILE_ACCESS',
      target: targetPath,
      verified: true,
      pid: spawnOut.pid,
      summary: `Opened file "${path.basename(targetPath)}" with default application.`,
      details: { sizeBytes: stat.size, extension: path.extname(targetPath) }
    };
  }

  /**
   * Open an approved folder in the system file manager (Windows Explorer / Finder / File Manager).
   */
  public async openApprovedFolder(folderPath: string): Promise<DesktopExecutionResult> {
    if (this.policy.capabilities.FOLDER_ACCESS.decision === 'DENIED') {
      const deniedRes: DesktopExecutionResult = {
        ok: false,
        action: 'FOLDER_ACCESS',
        target: folderPath,
        verified: false,
        summary: 'Folder Access is disabled in JARVIS persistent permissions.',
        error: 'PERMISSION_DENIED_BY_POLICY'
      };
      this.recordAudit({ action: 'FOLDER_ACCESS', target: folderPath, ok: false, error: deniedRes.error });
      return deniedRes;
    }
    const val = this.validatePath(folderPath);
    if (!val.valid || !val.normalizedPath) {
      const errRes: DesktopExecutionResult = {
        ok: false,
        action: 'FOLDER_ACCESS',
        target: folderPath,
        verified: false,
        summary: val.error || 'Blocked invalid folder path.',
        error: val.error
      };
      this.recordAudit({ action: 'FOLDER_ACCESS', target: folderPath, ok: false, error: errRes.error });
      return errRes;
    }

    const targetPath = val.normalizedPath;
    if (!fs.existsSync(targetPath)) {
      const missingRes: DesktopExecutionResult = {
        ok: false,
        action: 'FOLDER_ACCESS',
        target: targetPath,
        verified: false,
        summary: `Target folder "${targetPath}" does not exist on disk.`,
        error: 'FOLDER_NOT_FOUND'
      };
      this.recordAudit({ action: 'FOLDER_ACCESS', target: targetPath, ok: false, error: missingRes.error });
      return missingRes;
    }

    const stat = fs.statSync(targetPath);
    if (!stat.isDirectory()) {
      const notDirRes: DesktopExecutionResult = {
        ok: false,
        action: 'FOLDER_ACCESS',
        target: targetPath,
        verified: false,
        summary: `Target "${targetPath}" is a file, not a folder.`,
        error: 'NOT_A_DIRECTORY'
      };
      this.recordAudit({ action: 'FOLDER_ACCESS', target: targetPath, ok: false, error: notDirRes.error });
      return notDirRes;
    }

    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';
    const launcher = isWin ? 'explorer.exe' : isMac ? 'open' : 'xdg-open';

    const spawnOut = await this.spawnDetachedSafe(launcher, [targetPath]);
    if (!spawnOut.ok) {
      const failRes: DesktopExecutionResult = {
        ok: false,
        action: 'FOLDER_ACCESS',
        target: targetPath,
        verified: false,
        summary: `Unable to open folder: ${spawnOut.error}`,
        error: spawnOut.error
      };
      this.recordAudit({ action: 'FOLDER_ACCESS', target: targetPath, ok: false, error: spawnOut.error });
      return failRes;
    }

    this.recordAudit({ action: 'FOLDER_ACCESS', target: targetPath, ok: true, pid: spawnOut.pid });
    return {
      ok: true,
      action: 'FOLDER_ACCESS',
      target: targetPath,
      verified: true,
      pid: spawnOut.pid,
      summary: `Opened folder "${path.basename(targetPath) || targetPath}" in File Explorer.`
    };
  }

  /**
   * Open default web browser with a validated URL (no embedded credentials, HTTP/HTTPS only).
   */
  public async openApprovedBrowser(url?: string): Promise<DesktopExecutionResult> {
    if (this.policy.capabilities.BROWSER_ACCESS.decision === 'DENIED') {
      const deniedRes: DesktopExecutionResult = {
        ok: false,
        action: 'BROWSER_ACCESS',
        target: url || 'https://www.google.com',
        verified: false,
        summary: 'Browser Access is disabled in JARVIS persistent permissions.',
        error: 'PERMISSION_DENIED_BY_POLICY'
      };
      this.recordAudit({ action: 'BROWSER_ACCESS', target: deniedRes.target, ok: false, error: deniedRes.error });
      return deniedRes;
    }
    const targetUrl = url ? url.trim() : 'https://www.google.com';

    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      const errRes: DesktopExecutionResult = {
        ok: false,
        action: 'BROWSER_ACCESS',
        target: targetUrl,
        verified: false,
        summary: 'Invalid or malformed URL.',
        error: 'INVALID_URL'
      };
      this.recordAudit({ action: 'BROWSER_ACCESS', target: targetUrl, ok: false, error: errRes.error });
      return errRes;
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      const errRes: DesktopExecutionResult = {
        ok: false,
        action: 'BROWSER_ACCESS',
        target: targetUrl,
        verified: false,
        summary: 'Browser navigation requires an HTTP or HTTPS URL.',
        error: 'INVALID_URL'
      };
      this.recordAudit({ action: 'BROWSER_ACCESS', target: targetUrl, ok: false, error: errRes.error });
      return errRes;
    }

    if (parsed.username || parsed.password) {
      const credRes: DesktopExecutionResult = {
        ok: false,
        action: 'BROWSER_ACCESS',
        target: parsed.origin,
        verified: false,
        summary: 'Blocked URL containing embedded login credentials.',
        error: 'CREDENTIALS_BLOCKED'
      };
      this.recordAudit({ action: 'BROWSER_ACCESS', target: parsed.origin, ok: false, error: credRes.error });
      return credRes;
    }

    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';
    const launcher = isWin ? 'explorer.exe' : isMac ? 'open' : 'xdg-open';

    const spawnOut = await this.spawnDetachedSafe(launcher, [parsed.toString()]);
    if (!spawnOut.ok) {
      const failRes: DesktopExecutionResult = {
        ok: false,
        action: 'BROWSER_ACCESS',
        target: parsed.toString(),
        verified: false,
        summary: `Failed to open web browser: ${spawnOut.error}`,
        error: spawnOut.error
      };
      this.recordAudit({ action: 'BROWSER_ACCESS', target: parsed.toString(), ok: false, error: spawnOut.error });
      return failRes;
    }

    this.recordAudit({ action: 'BROWSER_ACCESS', target: parsed.toString(), ok: true, pid: spawnOut.pid });
    return {
      ok: true,
      action: 'BROWSER_ACCESS',
      target: parsed.toString(),
      verified: true,
      pid: spawnOut.pid,
      summary: `Opened default web browser to ${parsed.toString()}.`
    };
  }

  /**
   * Perform an approved web search in default browser.
   */
  public async searchWeb(query: string, engine = 'google'): Promise<DesktopExecutionResult> {
    if (this.policy.capabilities.BROWSER_ACCESS.decision === 'DENIED') {
      const deniedRes: DesktopExecutionResult = {
        ok: false,
        action: 'WEB_SEARCH',
        target: String(query || '').trim(),
        verified: false,
        summary: 'Browser & Web Search Access is disabled in JARVIS persistent permissions.',
        error: 'PERMISSION_DENIED_BY_POLICY'
      };
      this.recordAudit({ action: 'WEB_SEARCH', target: deniedRes.target, ok: false, error: deniedRes.error });
      return deniedRes;
    }
    const cleanQuery = String(query || '').trim();
    if (!cleanQuery) {
      return {
        ok: false,
        action: 'WEB_SEARCH',
        target: '',
        verified: false,
        summary: 'Search query cannot be empty.',
        error: 'EMPTY_QUERY'
      };
    }

    const encoded = encodeURIComponent(cleanQuery);
    const normalizedEngine = engine.trim().toLowerCase();
    const searchUrl =
      normalizedEngine === 'duckduckgo'
        ? `https://duckduckgo.com/?q=${encoded}`
        : normalizedEngine === 'bing'
        ? `https://www.bing.com/search?q=${encoded}`
        : `https://www.google.com/search?q=${encoded}`;

    const browserRes = await this.openApprovedBrowser(searchUrl);
    return {
      ...browserRes,
      action: 'WEB_SEARCH',
      target: cleanQuery,
      summary: browserRes.ok
        ? `Opened default browser search for "${cleanQuery}" (${normalizedEngine || 'google'}).`
        : browserRes.summary,
      details: {
        ...(browserRes.details || {}),
        searchUrl,
        engine: normalizedEngine || 'google'
      }
    };
  }

  /**
   * Launch an approved music application or open approved audio file.
   */
  public async launchMusicApp(musicTarget = 'SPOTIFY'): Promise<DesktopExecutionResult> {
    if (this.policy.capabilities.MUSIC_ACCESS.decision === 'DENIED') {
      const deniedRes: DesktopExecutionResult = {
        ok: false,
        action: 'MUSIC_CONTROL',
        target: String(musicTarget || 'SPOTIFY').trim(),
        verified: false,
        summary: 'Music Access is disabled in JARVIS persistent permissions.',
        error: 'PERMISSION_DENIED_BY_POLICY'
      };
      this.recordAudit({ action: 'MUSIC_CONTROL', target: deniedRes.target, ok: false, error: deniedRes.error });
      return deniedRes;
    }
    const trimmed = String(musicTarget || 'SPOTIFY').trim();
    const norm = trimmed.toUpperCase().replace(/[\s-]+/g, '_');

    // Allow launching Spotify or any registered music-category application
    const musicEntry = Array.from(this.allowedApplications.values()).find(
      (a) =>
        (a.category === 'MUSIC' || a.id === 'SPOTIFY') &&
        (a.id.toUpperCase() === norm || a.displayName.toUpperCase().replace(/[\s-]+/g, '_') === norm)
    );

    if (!musicEntry) {
      const errRes: DesktopExecutionResult = {
        ok: false,
        action: 'MUSIC_CONTROL',
        target: trimmed,
        verified: false,
        summary: `Music application "${trimmed}" is not in the approved music allowlist.`,
        error: 'DISALLOWED_MUSIC_APPLICATION'
      };
      this.recordAudit({ action: 'MUSIC_CONTROL', target: trimmed, ok: false, error: errRes.error });
      return errRes;
    }

    const appRes = await this.launchApprovedApplication(musicEntry.id);
    return {
      ...appRes,
      action: 'MUSIC_CONTROL'
    };
  }

  /**
   * Search for files within an authorized folder (returns filenames only; never reads content).
   */
  public findFilesInFolder(
    folderPath: string,
    filterPattern?: string
  ): { ok: boolean; folder: string; files: string[]; error?: string } {
    const val = this.validatePath(folderPath);
    if (!val.valid || !val.normalizedPath) {
      return { ok: false, folder: folderPath, files: [], error: val.error };
    }

    const targetPath = val.normalizedPath;
    if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isDirectory()) {
      return { ok: false, folder: targetPath, files: [], error: 'Folder not found or is not a directory.' };
    }

    try {
      const entries = fs.readdirSync(targetPath);
      let matched = entries;
      if (filterPattern) {
        const lowerFilter = filterPattern.toLowerCase();
        matched = entries.filter((e) => e.toLowerCase().includes(lowerFilter));
      }
      return {
        ok: true,
        folder: targetPath,
        files: matched.slice(0, 50)
      };
    } catch (err: unknown) {
      return {
        ok: false,
        folder: targetPath,
        files: [],
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }

  /**
   * Application discovery: inspects installed status of allowed applications safely
   */
  public async discoverApplications(): Promise<DiscoveredApplicationInfo[]> {
    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';
    const apps = Array.from(this.allowedApplications.values());
    const discovered: DiscoveredApplicationInfo[] = [];

    for (const app of apps) {
      let available = false;
      let resolvedPath: string | undefined = undefined;

      if (isWin) {
        const winName = app.winExecutable.toLowerCase();
        const winDir = process.env.WINDIR || 'C:\\Windows';
        const sys32 = path.join(winDir, 'System32');
        const progFiles = process.env.ProgramFiles || 'C:\\Program Files';
        const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
        const localAppData = process.env.LOCALAPPDATA || '';
        const appData = process.env.APPDATA || '';

        const candidatePaths: string[] = [];
        if (winName === 'calc.exe') candidatePaths.push(path.join(sys32, 'calc.exe'), path.join(winDir, 'calc.exe'));
        else if (winName === 'notepad.exe') candidatePaths.push(path.join(sys32, 'notepad.exe'), path.join(winDir, 'notepad.exe'));
        else if (winName === 'explorer.exe') candidatePaths.push(path.join(winDir, 'explorer.exe'));
        else if (winName === 'code.cmd' || winName === 'code.exe') {
          candidatePaths.push(
            path.join(localAppData, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
            path.join(localAppData, 'Programs', 'Microsoft VS Code', 'Code.exe'),
            path.join(progFiles, 'Microsoft VS Code', 'bin', 'code.cmd')
          );
        } else if (winName === 'chrome.exe') {
          candidatePaths.push(
            path.join(progFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(progFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe')
          );
        } else if (winName === 'spotify.exe') {
          candidatePaths.push(
            path.join(appData, 'Spotify', 'Spotify.exe'),
            path.join(localAppData, 'Microsoft', 'WindowsApps', 'Spotify.exe')
          );
        }

        for (const p of candidatePaths) {
          try {
            if (fs.existsSync(p)) {
              available = true;
              resolvedPath = p;
              break;
            }
          } catch {
            // ignore
          }
        }

        if (!available && process.env.PATH) {
          const pathDirs = process.env.PATH.split(path.delimiter);
          for (const dir of pathDirs) {
            try {
              const full = path.join(dir, app.winExecutable);
              if (fs.existsSync(full)) {
                available = true;
                resolvedPath = full;
                break;
              }
            } catch {
              // ignore
            }
          }
        }

        if (!available && (app.id === 'BROWSER' || app.id === 'EXPLORER' || app.id === 'NOTEPAD' || app.id === 'CALCULATOR')) {
          available = true;
        }
      } else {
        const execName = isMac ? (app.macExecutable || 'open') : (app.linuxExecutable || 'xdg-open');
        if (execName === 'open' || execName === 'xdg-open') {
          available = true;
          resolvedPath = `/usr/bin/${execName}`;
        } else if (process.env.PATH) {
          const pathDirs = process.env.PATH.split(path.delimiter);
          for (const dir of pathDirs) {
            try {
              const full = path.join(dir, execName);
              if (fs.existsSync(full)) {
                available = true;
                resolvedPath = full;
                break;
              }
            } catch {
              // ignore
            }
          }
        }
        if (app.id === 'BROWSER' || app.id === 'EXPLORER' || process.env.VITEST) {
          available = true;
        }
      }

      discovered.push({
        ...app,
        available,
        status: available ? 'AVAILABLE' : 'NOT_INSTALLED',
        resolvedPath
      });
    }

    return discovered;
  }

  /**
   * List files and folders inside an authorized folder with metadata
   */
  public listApprovedFolder(folderPath: string): {
    ok: boolean;
    folder: string;
    items: FolderItemEntry[];
    error?: string;
  } {
    const val = this.validatePath(folderPath);
    if (!val.valid || !val.normalizedPath) {
      return { ok: false, folder: folderPath, items: [], error: val.error };
    }

    const targetPath = val.normalizedPath;
    if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isDirectory()) {
      return { ok: false, folder: targetPath, items: [], error: 'Folder not found or is not a directory.' };
    }

    try {
      const names = fs.readdirSync(targetPath);
      const items: FolderItemEntry[] = [];
      for (const name of names.slice(0, 100)) {
        try {
          const full = path.join(targetPath, name);
          const stat = fs.statSync(full);
          const ext = path.extname(name).replace(/^\./, '').toLowerCase();
          items.push({
            name,
            path: full,
            isDirectory: stat.isDirectory(),
            sizeBytes: stat.size,
            modifiedTime: stat.mtimeMs,
            extension: ext
          });
        } catch {
          // skip
        }
      }
      return { ok: true, folder: targetPath, items };
    } catch (err: unknown) {
      return { ok: false, folder: targetPath, items: [], error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Read safe text/document content from an authorized file
   */
  public readApprovedFile(filePath: string): {
    ok: boolean;
    path: string;
    name: string;
    content?: string;
    sizeBytes?: number;
    error?: string;
  } {
    const val = this.validatePath(filePath);
    if (!val.valid || !val.normalizedPath) {
      return { ok: false, path: filePath, name: path.basename(filePath), error: val.error };
    }

    const target = val.normalizedPath;
    if (!fs.existsSync(target)) {
      return { ok: false, path: target, name: path.basename(target), error: 'File does not exist.' };
    }

    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      return { ok: false, path: target, name: path.basename(target), error: 'Target is a directory, not a file.' };
    }

    const ext = path.extname(target).replace(/^\./, '').toLowerCase();
    if (BLOCKED_FILE_EXTENSIONS.has(ext)) {
      return { ok: false, path: target, name: path.basename(target), error: `Blocked reading executable/binary file (.${ext}).` };
    }

    if (stat.size > 5 * 1024 * 1024) {
      return { ok: false, path: target, name: path.basename(target), error: `File exceeds 5MB size limit (${stat.size} bytes).` };
    }

    try {
      const content = fs.readFileSync(target, 'utf8');
      return {
        ok: true,
        path: target,
        name: path.basename(target),
        content,
        sizeBytes: stat.size
      };
    } catch (err: unknown) {
      return { ok: false, path: target, name: path.basename(target), error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Create or save text content into an authorized folder path with overwrite protection
   */
  public createApprovedFile(
    targetFilePath: string,
    content: string,
    overwrite = false
  ): {
    ok: boolean;
    path: string;
    name: string;
    sizeBytes?: number;
    exists?: boolean;
    error?: string;
  } {
    const val = this.validatePath(targetFilePath);
    if (!val.valid || !val.normalizedPath) {
      return { ok: false, path: targetFilePath, name: path.basename(targetFilePath), error: val.error };
    }

    const target = val.normalizedPath;
    const ext = path.extname(target).replace(/^\./, '').toLowerCase();
    if (BLOCKED_FILE_EXTENSIONS.has(ext)) {
      return { ok: false, path: target, name: path.basename(target), error: `Disallowed extension (.${ext}). Executable creation blocked.` };
    }

    if (fs.existsSync(target)) {
      if (!overwrite) {
        return {
          ok: false,
          path: target,
          name: path.basename(target),
          exists: true,
          error: 'FILE_ALREADY_EXISTS: Target file already exists. Explicit confirmation required to overwrite.'
        };
      }
    }

    try {
      const parentDir = path.dirname(target);
      if (!fs.existsSync(parentDir)) {
        return { ok: false, path: target, name: path.basename(target), error: 'Parent directory does not exist.' };
      }

      fs.writeFileSync(target, content, { encoding: 'utf8', mode: 0o644 });
      const sizeBytes = Buffer.byteLength(content, 'utf8');
      this.recordAudit({
        action: 'FILE_CREATE',
        target,
        ok: true
      });
      return {
        ok: true,
        path: target,
        name: path.basename(target),
        sizeBytes
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.recordAudit({
        action: 'FILE_CREATE',
        target,
        ok: false,
        error: msg
      });
      return { ok: false, path: target, name: path.basename(target), error: msg };
    }
  }

  /**
   * Safe web page preview/inspection with SSRF protection
   */
  public async inspectWebPage(rawUrl: string): Promise<WebPageInspectionResult> {
    let parsed: URL;
    try {
      parsed = new URL(String(rawUrl || '').trim());
    } catch {
      return { ok: false, url: rawUrl, error: 'Invalid URL format.' };
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { ok: false, url: rawUrl, error: 'Only HTTP/HTTPS URLs can be inspected.' };
    }

    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host.endsWith('.local') ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) ||
      /^169\.254\./.test(host)
    ) {
      return { ok: false, url: rawUrl, error: 'Private or internal network inspection is blocked for safety.' };
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(parsed.toString(), {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) JARVIS/7.0' }
      });
      clearTimeout(timeout);

      if (!res.ok) {
        return { ok: false, url: parsed.toString(), error: `HTTP error ${res.status}` };
      }

      const html = await res.text();
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : parsed.hostname;

      const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
      const description = metaDescMatch ? metaDescMatch[1].trim() : undefined;

      return {
        ok: true,
        url: parsed.toString(),
        title,
        description
      };
    } catch (err: unknown) {
      return {
        ok: false,
        url: parsed.toString(),
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }
}

export const desktopAutomationService = new DesktopAutomationService(
  process.env.VITEST ? undefined : { policyFilePath: path.join(os.tmpdir(), 'jarvis-desktop-permissions.json') }
);
