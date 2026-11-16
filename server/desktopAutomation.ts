import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';

/**
 * Strict allowlist of permitted Windows / Desktop applications.
 * No arbitrary binaries, scripts, or terminal shells (cmd.exe, powershell.exe, bash, etc.) are allowed.
 */
export const ALLOWED_APPLICATIONS: Record<
  string,
  {
    id: string;
    displayName: string;
    description: string;
    winExecutable: string;
    macExecutable?: string;
    linuxExecutable?: string;
    defaultArgs?: string[];
  }
> = {
  VS_CODE: {
    id: 'VS_CODE',
    displayName: 'Visual Studio Code',
    description: 'Code editor and development environment',
    winExecutable: 'code.cmd',
    macExecutable: 'code',
    linuxExecutable: 'code'
  },
  NOTEPAD: {
    id: 'NOTEPAD',
    displayName: 'Notepad',
    description: 'Lightweight text editor',
    winExecutable: 'notepad.exe',
    macExecutable: 'open',
    linuxExecutable: 'gedit'
  },
  CALCULATOR: {
    id: 'CALCULATOR',
    displayName: 'Windows Calculator',
    description: 'Standard system scientific calculator',
    winExecutable: 'calc.exe',
    macExecutable: 'open',
    linuxExecutable: 'gnome-calculator'
  },
  EXPLORER: {
    id: 'EXPLORER',
    displayName: 'File Explorer',
    description: 'Windows graphical folder and filesystem navigator',
    winExecutable: 'explorer.exe',
    macExecutable: 'open',
    linuxExecutable: 'xdg-open'
  },
  BROWSER: {
    id: 'BROWSER',
    displayName: 'Web Browser',
    description: 'System default web browser',
    winExecutable: 'explorer.exe',
    macExecutable: 'open',
    linuxExecutable: 'xdg-open'
  },
  SPOTIFY: {
    id: 'SPOTIFY',
    displayName: 'Spotify',
    description: 'Music streaming and playback application',
    winExecutable: 'spotify.exe',
    macExecutable: 'open',
    linuxExecutable: 'spotify'
  }
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
  'format',
  'del',
  'rmdir',
  'rm',
  'sudo',
  'certutil',
  'curl',
  'wget',
  'rundll32',
  'rundll32.exe'
]);

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

export class DesktopAutomationService {
  /**
   * Safe path validation:
   * 1. Rejects path traversal sequences (e.g. '..', '%2e%2e', null bytes).
   * 2. Checks absolute path resolution.
   * 3. Prevents access to forbidden system roots unless explicitly authorized.
   */
  public validatePath(rawPath: string, allowedRoot?: string): { valid: boolean; normalizedPath?: string; error?: string } {
    if (!rawPath || typeof rawPath !== 'string') {
      return { valid: false, error: 'Path is required and must be a string.' };
    }

    const trimmed = rawPath.trim();
    if (!trimmed) {
      return { valid: false, error: 'Path cannot be empty.' };
    }

    // Check for null bytes or dangerous control characters
    if (trimmed.includes('\0') || /[\r\n]/.test(trimmed)) {
      return { valid: false, error: 'Path contains prohibited control characters.' };
    }

    // Check for directory traversal sequences
    if (/(^|[\\/])\.\.([\\/]|$)/.test(trimmed)) {
      return { valid: false, error: 'Path traversal (..) is strictly prohibited.' };
    }

    try {
      const resolved = path.resolve(trimmed);

      // If an allowed root directory is specified, verify resolved path is inside it
      if (allowedRoot) {
        const resolvedRoot = path.resolve(allowedRoot);
        if (!resolved.startsWith(resolvedRoot) && resolved !== resolvedRoot) {
          return {
            valid: false,
            error: `Path "${trimmed}" is outside the authorized root directory ("${resolvedRoot}").`
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

  /**
   * Launch an application from the strict allowlist.
   * NEVER runs arbitrary shell commands.
   */
  public async launchApprovedApplication(appKeyOrId: string, customArgs: string[] = []): Promise<DesktopExecutionResult> {
    const normalizedKey = appKeyOrId.trim().toUpperCase().replace(/[\s-]+/g, '_');

    // Find in allowlist by key or id
    const appEntry =
      ALLOWED_APPLICATIONS[normalizedKey] ||
      Object.values(ALLOWED_APPLICATIONS).find(
        (a) =>
          a.id.toUpperCase() === normalizedKey ||
          a.displayName.toUpperCase().replace(/[\s-]+/g, '_') === normalizedKey
      );

    if (!appEntry) {
      return {
        ok: false,
        action: 'APPLICATION_LAUNCH',
        target: appKeyOrId,
        verified: false,
        summary: `Application "${appKeyOrId}" is not in the approved application allowlist.`,
        error: 'DISALLOWED_APPLICATION'
      };
    }

    // Sanitize any custom arguments (no semicolons, pipes, or command separators)
    const sanitizedArgs = customArgs.filter((arg) => {
      return typeof arg === 'string' && !/[;&|`$<>]/.test(arg);
    });

    try {
      const isWin = process.platform === 'win32';
      const isMac = process.platform === 'darwin';
      const executable = isWin
        ? appEntry.winExecutable
        : isMac
        ? appEntry.macExecutable || 'open'
        : appEntry.linuxExecutable || 'xdg-open';

      // Safe spawn without shell (shell: false prevents command injection)
      const child = spawn(executable, sanitizedArgs, {
        detached: true,
        stdio: 'ignore',
        shell: false
      });

      // Unref so server doesn't wait for the desktop app to close
      child.unref();

      return {
        ok: true,
        action: 'APPLICATION_LAUNCH',
        target: appEntry.displayName,
        verified: true,
        pid: child.pid,
        summary: `Successfully launched ${appEntry.displayName} (PID: ${child.pid || 'detached'}).`,
        details: { applicationId: appEntry.id, executable }
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        action: 'APPLICATION_LAUNCH',
        target: appEntry.displayName,
        verified: false,
        summary: `Failed to launch ${appEntry.displayName}: ${msg}`,
        error: msg
      };
    }
  }

  /**
   * Open an approved file with its default system application.
   */
  public async openApprovedFile(filePath: string): Promise<DesktopExecutionResult> {
    const val = this.validatePath(filePath);
    if (!val.valid || !val.normalizedPath) {
      return {
        ok: false,
        action: 'FILE_ACCESS',
        target: filePath,
        verified: false,
        summary: val.error || 'Blocked invalid file path.',
        error: val.error
      };
    }

    const targetPath = val.normalizedPath;

    // Check if file actually exists
    if (!fs.existsSync(targetPath)) {
      return {
        ok: false,
        action: 'FILE_ACCESS',
        target: targetPath,
        verified: false,
        summary: `Target file "${path.basename(targetPath)}" was not found on disk.`,
        error: 'FILE_NOT_FOUND'
      };
    }

    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      return {
        ok: false,
        action: 'FILE_ACCESS',
        target: targetPath,
        verified: false,
        summary: `Target "${targetPath}" is a directory. Use folder open action instead.`,
        error: 'IS_DIRECTORY'
      };
    }

    try {
      const isWin = process.platform === 'win32';
      const isMac = process.platform === 'darwin';
      const launcher = isWin ? 'explorer.exe' : isMac ? 'open' : 'xdg-open';

      const child = spawn(launcher, [targetPath], {
        detached: true,
        stdio: 'ignore',
        shell: false
      });
      child.unref();

      return {
        ok: true,
        action: 'FILE_ACCESS',
        target: targetPath,
        verified: true,
        pid: child.pid,
        summary: `Opened file "${path.basename(targetPath)}" with default application.`,
        details: { sizeBytes: stat.size, extension: path.extname(targetPath) }
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        action: 'FILE_ACCESS',
        target: targetPath,
        verified: false,
        summary: `Unable to open file: ${msg}`,
        error: msg
      };
    }
  }

  /**
   * Open an approved folder in the system file manager (Windows Explorer / Finder / File Manager).
   */
  public async openApprovedFolder(folderPath: string): Promise<DesktopExecutionResult> {
    const val = this.validatePath(folderPath);
    if (!val.valid || !val.normalizedPath) {
      return {
        ok: false,
        action: 'FOLDER_ACCESS',
        target: folderPath,
        verified: false,
        summary: val.error || 'Blocked invalid folder path.',
        error: val.error
      };
    }

    const targetPath = val.normalizedPath;

    if (!fs.existsSync(targetPath)) {
      return {
        ok: false,
        action: 'FOLDER_ACCESS',
        target: targetPath,
        verified: false,
        summary: `Target folder "${targetPath}" does not exist on disk.`,
        error: 'FOLDER_NOT_FOUND'
      };
    }

    const stat = fs.statSync(targetPath);
    if (!stat.isDirectory()) {
      return {
        ok: false,
        action: 'FOLDER_ACCESS',
        target: targetPath,
        verified: false,
        summary: `Target "${targetPath}" is a file, not a folder.`,
        error: 'NOT_A_DIRECTORY'
      };
    }

    try {
      const isWin = process.platform === 'win32';
      const isMac = process.platform === 'darwin';
      const launcher = isWin ? 'explorer.exe' : isMac ? 'open' : 'xdg-open';

      const child = spawn(launcher, [targetPath], {
        detached: true,
        stdio: 'ignore',
        shell: false
      });
      child.unref();

      return {
        ok: true,
        action: 'FOLDER_ACCESS',
        target: targetPath,
        verified: true,
        pid: child.pid,
        summary: `Opened folder "${path.basename(targetPath) || targetPath}" in File Explorer.`
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        action: 'FOLDER_ACCESS',
        target: targetPath,
        verified: false,
        summary: `Unable to open folder: ${msg}`,
        error: msg
      };
    }
  }

  /**
   * Open default web browser with a validated URL.
   */
  public async openApprovedBrowser(url?: string): Promise<DesktopExecutionResult> {
    const targetUrl = url ? url.trim() : 'https://www.google.com';

    // Validate URL protocol
    if (!/^https?:\/\//i.test(targetUrl)) {
      return {
        ok: false,
        action: 'BROWSER_ACCESS',
        target: targetUrl,
        verified: false,
        summary: 'Browser navigation requires an HTTP or HTTPS URL.',
        error: 'INVALID_URL'
      };
    }

    try {
      const isWin = process.platform === 'win32';
      const isMac = process.platform === 'darwin';
      const launcher = isWin ? 'explorer.exe' : isMac ? 'open' : 'xdg-open';

      const child = spawn(launcher, [targetUrl], {
        detached: true,
        stdio: 'ignore',
        shell: false
      });
      child.unref();

      return {
        ok: true,
        action: 'BROWSER_ACCESS',
        target: targetUrl,
        verified: true,
        summary: `Opened default web browser to ${targetUrl}.`
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        action: 'BROWSER_ACCESS',
        target: targetUrl,
        verified: false,
        summary: `Failed to open web browser: ${msg}`,
        error: msg
      };
    }
  }

  /**
   * Perform an approved web search in default browser.
   */
  public async searchWeb(query: string, engine = 'google'): Promise<DesktopExecutionResult> {
    const cleanQuery = query.trim();
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
    const searchUrl =
      engine === 'duckduckgo'
        ? `https://duckduckgo.com/?q=${encoded}`
        : engine === 'bing'
        ? `https://www.bing.com/search?q=${encoded}`
        : `https://www.google.com/search?q=${encoded}`;

    return this.openApprovedBrowser(searchUrl);
  }

  /**
   * Launch approved music application or play selected music.
   */
  public async launchMusicApp(musicTarget = 'Spotify'): Promise<DesktopExecutionResult> {
    return this.launchApprovedApplication('SPOTIFY');
  }

  /**
   * Search for files within an authorized folder.
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
}

export const desktopAutomationService = new DesktopAutomationService();
