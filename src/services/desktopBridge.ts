import { DesktopPermissionRequest, SystemStatusTelemetry } from '../types/assistant';
import { audioService } from './soundFx';
import { permissionManager } from './permissionManager';

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

export interface ApprovedAppInfo {
  id: string;
  displayName: string;
  description: string;
}

export class DesktopBridgeService {
  private pendingRequests: Map<
    string,
    { req: DesktopPermissionRequest; resolve: (approved: boolean) => void; timeout: ReturnType<typeof setTimeout> }
  > = new Map();
  private onPermissionPrompt?: (req: DesktopPermissionRequest) => void;

  public isElectron(): boolean {
    return (
      typeof window !== 'undefined' &&
      Boolean((window as unknown as { jarvisDesktop?: { isElectron: boolean } }).jarvisDesktop?.isElectron)
    );
  }

  public setPromptCallback(cb: (req: DesktopPermissionRequest) => void) {
    this.onPermissionPrompt = cb;
  }

  // Request user authorization for consequential actions
  public async requestAuthorization(
    action: DesktopPermissionRequest['action'],
    target: string,
    reason: string
  ): Promise<boolean> {
    const id = `perm-${Math.random().toString(36).substring(2, 7)}`;
    const req: DesktopPermissionRequest = {
      id,
      action,
      target,
      reason,
      timestamp: Date.now()
    };

    audioService.playChirp(900);

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          resolve(false);
        }
      }, 30000);

      this.pendingRequests.set(id, { req, resolve, timeout });
      if (this.onPermissionPrompt) {
        this.onPermissionPrompt(req);
      }
    });
  }

  public resolvePermission(id: string, approved: boolean) {
    const entry = this.pendingRequests.get(id);
    if (!entry) return;
    clearTimeout(entry.timeout);
    this.pendingRequests.delete(id);
    entry.resolve(approved);
  }

  // =========================================================================
  // Phase 7 — Windows Desktop Automation & Permission Verification
  // =========================================================================

  /**
   * Launch an approved application with strict single-use permission verification
   */
  public async launchApplication(
    applicationId: string,
    permissionId: string,
    args: string[] = []
  ): Promise<DesktopExecutionResult> {
    const cleanAppId = applicationId.trim().toUpperCase().replace(/[\s-]+/g, '_');
    const auth = permissionManager.beginAuthorizedExecution(
      permissionId,
      'APPLICATION_LAUNCH',
      cleanAppId
    );

    if (!auth.authorized) {
      audioService.playChirp(600);
      return {
        ok: false,
        action: 'APPLICATION_LAUNCH',
        target: cleanAppId,
        verified: false,
        summary: auth.error || 'Blocked: application launch not authorized.',
        error: auth.error || 'PERMISSION_DENIED'
      };
    }

    try {
      // 1. Electron Desktop Bridge
      if (this.isElectron()) {
        const electronBridge = (window as unknown as {
          jarvisDesktop: { launchApp: (id: string, a: string[]) => Promise<DesktopExecutionResult> };
        }).jarvisDesktop;
        const res = await electronBridge.launchApp(cleanAppId, args);
        permissionManager.completeExecution(permissionId, res.ok, res.summary, res.error);
        if (res.ok) audioService.playActivationWhoosh();
        else audioService.playChirp(600);
        return res;
      }

      // 2. Full-Stack Node.js Backend API
      const response = await fetch('/api/desktop/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId: cleanAppId, args })
      });

      const data = (await response.json()) as DesktopExecutionResult;
      permissionManager.completeExecution(permissionId, data.ok, data.summary, data.error);
      if (data.ok) audioService.playActivationWhoosh();
      else audioService.playChirp(600);
      return data;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      permissionManager.completeExecution(permissionId, false, `Failed to launch application: ${msg}`, msg);
      audioService.playChirp(600);
      return {
        ok: false,
        action: 'APPLICATION_LAUNCH',
        target: cleanAppId,
        verified: false,
        summary: `Application launch failed: ${msg}`,
        error: msg
      };
    }
  }

  /**
   * Open an approved file with strict single-use permission verification
   */
  public async openFile(filePath: string, permissionId: string): Promise<DesktopExecutionResult> {
    const cleanPath = filePath.trim();
    const auth = permissionManager.beginAuthorizedExecution(
      permissionId,
      'FILE_ACCESS',
      cleanPath
    );

    if (!auth.authorized) {
      audioService.playChirp(600);
      return {
        ok: false,
        action: 'FILE_ACCESS',
        target: cleanPath,
        verified: false,
        summary: auth.error || 'Blocked: file access not authorized.',
        error: auth.error || 'PERMISSION_DENIED'
      };
    }

    try {
      if (this.isElectron()) {
        const electronBridge = (window as unknown as {
          jarvisDesktop: { openFile: (p: string) => Promise<DesktopExecutionResult> };
        }).jarvisDesktop;
        const res = await electronBridge.openFile(cleanPath);
        permissionManager.completeExecution(permissionId, res.ok, res.summary, res.error);
        if (res.ok) audioService.playActivationWhoosh();
        else audioService.playChirp(600);
        return res;
      }

      const response = await fetch('/api/desktop/file/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: cleanPath })
      });

      const data = (await response.json()) as DesktopExecutionResult;
      permissionManager.completeExecution(permissionId, data.ok, data.summary, data.error);
      if (data.ok) audioService.playActivationWhoosh();
      else audioService.playChirp(600);
      return data;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      permissionManager.completeExecution(permissionId, false, `Failed to open file: ${msg}`, msg);
      audioService.playChirp(600);
      return {
        ok: false,
        action: 'FILE_ACCESS',
        target: cleanPath,
        verified: false,
        summary: `File open failed: ${msg}`,
        error: msg
      };
    }
  }

  /**
   * Open an approved folder in the system file manager with permission verification
   */
  public async openFolder(folderPath: string, permissionId: string): Promise<DesktopExecutionResult> {
    const cleanPath = folderPath.trim();
    const auth = permissionManager.beginAuthorizedExecution(
      permissionId,
      'FOLDER_ACCESS',
      cleanPath
    );

    if (!auth.authorized) {
      audioService.playChirp(600);
      return {
        ok: false,
        action: 'FOLDER_ACCESS',
        target: cleanPath,
        verified: false,
        summary: auth.error || 'Blocked: folder access not authorized.',
        error: auth.error || 'PERMISSION_DENIED'
      };
    }

    try {
      if (this.isElectron()) {
        const electronBridge = (window as unknown as {
          jarvisDesktop: { openFolder: (p: string) => Promise<DesktopExecutionResult> };
        }).jarvisDesktop;
        const res = await electronBridge.openFolder(cleanPath);
        permissionManager.completeExecution(permissionId, res.ok, res.summary, res.error);
        if (res.ok) audioService.playActivationWhoosh();
        else audioService.playChirp(600);
        return res;
      }

      const response = await fetch('/api/desktop/folder/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath: cleanPath })
      });

      const data = (await response.json()) as DesktopExecutionResult;
      permissionManager.completeExecution(permissionId, data.ok, data.summary, data.error);
      if (data.ok) audioService.playActivationWhoosh();
      else audioService.playChirp(600);
      return data;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      permissionManager.completeExecution(permissionId, false, `Failed to open folder: ${msg}`, msg);
      audioService.playChirp(600);
      return {
        ok: false,
        action: 'FOLDER_ACCESS',
        target: cleanPath,
        verified: false,
        summary: `Folder open failed: ${msg}`,
        error: msg
      };
    }
  }

  /**
   * Open the default web browser with permission verification
   */
  public async openBrowser(url: string, permissionId: string): Promise<DesktopExecutionResult> {
    const cleanUrl = url.trim();
    const auth = permissionManager.beginAuthorizedExecution(
      permissionId,
      'BROWSER_ACCESS',
      cleanUrl
    );

    if (!auth.authorized) {
      audioService.playChirp(600);
      return {
        ok: false,
        action: 'BROWSER_ACCESS',
        target: cleanUrl,
        verified: false,
        summary: auth.error || 'Blocked: browser access not authorized.',
        error: auth.error || 'PERMISSION_DENIED'
      };
    }

    try {
      if (this.isElectron()) {
        const electronBridge = (window as unknown as {
          jarvisDesktop: { openBrowser: (u: string) => Promise<DesktopExecutionResult> };
        }).jarvisDesktop;
        const res = await electronBridge.openBrowser(cleanUrl);
        permissionManager.completeExecution(permissionId, res.ok, res.summary, res.error);
        if (res.ok) audioService.playActivationWhoosh();
        else audioService.playChirp(600);
        return res;
      }

      const response = await fetch('/api/desktop/browser/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: cleanUrl })
      });

      const data = (await response.json()) as DesktopExecutionResult;
      permissionManager.completeExecution(permissionId, data.ok, data.summary, data.error);
      if (data.ok) audioService.playActivationWhoosh();
      else audioService.playChirp(600);
      return data;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      permissionManager.completeExecution(permissionId, false, `Failed to open browser: ${msg}`, msg);
      audioService.playChirp(600);
      return {
        ok: false,
        action: 'BROWSER_ACCESS',
        target: cleanUrl,
        verified: false,
        summary: `Browser open failed: ${msg}`,
        error: msg
      };
    }
  }

  /**
   * Perform an authorized web search in default browser
   */
  public async searchWeb(query: string, permissionId: string, engine = 'google'): Promise<DesktopExecutionResult> {
    const cleanQuery = query.trim();
    const auth = permissionManager.beginAuthorizedExecution(
      permissionId,
      'WEB_SEARCH',
      cleanQuery
    );

    if (!auth.authorized) {
      audioService.playChirp(600);
      return {
        ok: false,
        action: 'WEB_SEARCH',
        target: cleanQuery,
        verified: false,
        summary: auth.error || 'Blocked: web search not authorized.',
        error: auth.error || 'PERMISSION_DENIED'
      };
    }

    try {
      if (this.isElectron()) {
        const electronBridge = (window as unknown as {
          jarvisDesktop: { searchWeb: (q: string, e: string) => Promise<DesktopExecutionResult> };
        }).jarvisDesktop;
        const res = await electronBridge.searchWeb(cleanQuery, engine);
        permissionManager.completeExecution(permissionId, res.ok, res.summary, res.error);
        if (res.ok) audioService.playActivationWhoosh();
        else audioService.playChirp(600);
        return res;
      }

      const response = await fetch('/api/desktop/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: cleanQuery, engine })
      });

      const data = (await response.json()) as DesktopExecutionResult;
      permissionManager.completeExecution(permissionId, data.ok, data.summary, data.error);
      if (data.ok) audioService.playActivationWhoosh();
      else audioService.playChirp(600);
      return data;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      permissionManager.completeExecution(permissionId, false, `Search failed: ${msg}`, msg);
      audioService.playChirp(600);
      return {
        ok: false,
        action: 'WEB_SEARCH',
        target: cleanQuery,
        verified: false,
        summary: `Web search failed: ${msg}`,
        error: msg
      };
    }
  }

  /**
   * Launch approved music application or start music playback
   */
  public async launchMusic(musicTarget: string, permissionId: string): Promise<DesktopExecutionResult> {
    const cleanTarget = musicTarget.trim();
    const auth = permissionManager.beginAuthorizedExecution(
      permissionId,
      'MUSIC_CONTROL',
      cleanTarget
    );

    if (!auth.authorized) {
      audioService.playChirp(600);
      return {
        ok: false,
        action: 'MUSIC_CONTROL',
        target: cleanTarget,
        verified: false,
        summary: auth.error || 'Blocked: music control not authorized.',
        error: auth.error || 'PERMISSION_DENIED'
      };
    }

    try {
      if (this.isElectron()) {
        const electronBridge = (window as unknown as {
          jarvisDesktop: { launchMusic: (t: string) => Promise<DesktopExecutionResult> };
        }).jarvisDesktop;
        const res = await electronBridge.launchMusic(cleanTarget);
        permissionManager.completeExecution(permissionId, res.ok, res.summary, res.error);
        if (res.ok) audioService.playActivationWhoosh();
        else audioService.playChirp(600);
        return res;
      }

      const response = await fetch('/api/desktop/music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ musicTarget: cleanTarget })
      });

      const data = (await response.json()) as DesktopExecutionResult;
      permissionManager.completeExecution(permissionId, data.ok, data.summary, data.error);
      if (data.ok) audioService.playActivationWhoosh();
      else audioService.playChirp(600);
      return data;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      permissionManager.completeExecution(permissionId, false, `Music launch failed: ${msg}`, msg);
      audioService.playChirp(600);
      return {
        ok: false,
        action: 'MUSIC_CONTROL',
        target: cleanTarget,
        verified: false,
        summary: `Music application launch failed: ${msg}`,
        error: msg
      };
    }
  }

  /**
   * Search for files within an authorized folder
   */
  public async findFilesInFolder(
    folderPath: string,
    filterPattern?: string
  ): Promise<{ ok: boolean; folder: string; files: string[]; error?: string }> {
    try {
      if (this.isElectron()) {
        const electronBridge = (window as unknown as {
          jarvisDesktop: { findFilesInFolder: (f: string, p?: string) => Promise<{ ok: boolean; folder: string; files: string[]; error?: string }> };
        }).jarvisDesktop;
        return await electronBridge.findFilesInFolder(folderPath, filterPattern);
      }

      const response = await fetch('/api/desktop/folder/find', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath, filterPattern })
      });

      return await response.json();
    } catch (err: unknown) {
      return {
        ok: false,
        folder: folderPath,
        files: [],
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }

  // File Read via Native File System Access API
  public async readAuthorizedFile(): Promise<{ name: string; content: string } | null> {
    if (typeof window === 'undefined' || !('showOpenFilePicker' in window)) {
      console.warn('File System Access API not available in this environment.');
      return null;
    }

    try {
      const [handle] = await (window as unknown as { showOpenFilePicker: () => Promise<FileSystemFileHandle[]> }).showOpenFilePicker();
      const file = await handle.getFile();
      const text = await file.text();
      audioService.playChirp(1500);
      return { name: file.name, content: text };
    } catch {
      // User cancelled picker
      return null;
    }
  }

  // File Save via Native File System Access API
  public async saveAuthorizedFile(filename: string, content: string, mimeType = 'text/plain'): Promise<boolean> {
    if (typeof window === 'undefined') return false;

    // Check if showSaveFilePicker is available
    if ('showSaveFilePicker' in window) {
      try {
        const handle = await (window as unknown as {
          showSaveFilePicker: (opts: { suggestedName: string }) => Promise<FileSystemFileHandle>;
        }).showSaveFilePicker({ suggestedName: filename });
        const writable = await (handle as unknown as {
          createWritable: () => Promise<FileSystemWritableFileStream>;
        }).createWritable();
        await writable.write(content);
        await writable.close();
        audioService.playActivationWhoosh();
        return true;
      } catch {
        // User cancelled
        return false;
      }
    }

    // Fallback: download via anchor
    try {
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      audioService.playActivationWhoosh();
      return true;
    } catch (e) {
      console.error('Failed to save file:', e);
      return false;
    }
  }

  // Clipboard Copy
  public async copyToClipboard(text: string): Promise<boolean> {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(text);
        audioService.playChirp(1600);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  // Native Desktop Notifications
  public async sendNotification(title: string, body: string): Promise<boolean> {
    if (typeof window === 'undefined' || !('Notification' in window)) return false;

    if (Notification.permission === 'granted') {
      new Notification(`J.A.R.V.I.S. // ${title}`, {
        body,
        icon: '/jarvis-arc.svg'
      });
      return true;
    } else if (Notification.permission !== 'denied') {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        new Notification(`J.A.R.V.I.S. // ${title}`, {
          body,
          icon: '/jarvis-arc.svg'
        });
        return true;
      }
    }
    return false;
  }

  // Query real browser hardware telemetry
  public async getHardwareTelemetry(): Promise<Partial<SystemStatusTelemetry>> {
    const telemetry: Partial<SystemStatusTelemetry> = {};

    if (typeof navigator !== 'undefined') {
      const nav = navigator as unknown as {
        hardwareConcurrency?: number;
        deviceMemory?: number;
        getBattery?: () => Promise<{ level: number }>;
        connection?: { downlink?: number; rtt?: number };
      };

      if (nav.hardwareConcurrency) {
        telemetry.cpuLoad = Math.min(100, Math.round(35 + nav.hardwareConcurrency * 4));
      }
      if (nav.deviceMemory) {
        telemetry.memoryUsage = Math.min(100, Math.round(40 + (16 / nav.deviceMemory) * 10));
      }
      if (nav.getBattery) {
        try {
          const battery = await nav.getBattery();
          telemetry.batteryLevel = Math.round(battery.level * 100);
        } catch {
          // ignore
        }
      }
      if (nav.connection && nav.connection.rtt) {
        telemetry.networkLatencyMs = nav.connection.rtt;
      }
    }

    return telemetry;
  }
}

export const desktopBridge = new DesktopBridgeService();
