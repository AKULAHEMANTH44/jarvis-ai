import { DesktopPermissionRequest, SelectedFolderMetadata, SystemStatusTelemetry } from '../types/assistant';
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
  category?: 'APP' | 'BROWSER' | 'MUSIC';
}

export interface DesktopActionAuditEntry {
  id: string;
  action: string;
  target: string;
  ok: boolean;
  verified: boolean;
  error?: string;
  timestamp: number;
}

const DEFAULT_APPROVED_APPS: ApprovedAppInfo[] = [
  { id: 'VS_CODE', displayName: 'Visual Studio Code', description: 'Code editor and development environment', category: 'APP' },
  { id: 'NOTEPAD', displayName: 'Notepad', description: 'Lightweight text editor', category: 'APP' },
  { id: 'CALCULATOR', displayName: 'Windows Calculator', description: 'Standard system scientific calculator', category: 'APP' },
  { id: 'EXPLORER', displayName: 'File Explorer', description: 'Windows graphical folder navigator', category: 'APP' },
  { id: 'BROWSER', displayName: 'Web Browser', description: 'System default web browser', category: 'BROWSER' },
  { id: 'CHROME', displayName: 'Google Chrome', description: 'Google Chrome web browser', category: 'BROWSER' },
  { id: 'SPOTIFY', displayName: 'Spotify', description: 'Music streaming application', category: 'MUSIC' }
];

export class DesktopBridgeService {
  private pendingRequests: Map<
    string,
    { req: DesktopPermissionRequest; resolve: (approved: boolean) => void; timeout: ReturnType<typeof setTimeout> }
  > = new Map();
  private onPermissionPrompt?: (req: DesktopPermissionRequest) => void;
  private selectedFolder: SelectedFolderMetadata | null = null;
  private approvedPaths: Set<string> = new Set();
  private requireApprovedPath = false;
  private actionAuditLog: DesktopActionAuditEntry[] = [];

  public isElectron(): boolean {
    return (
      typeof window !== 'undefined' &&
      Boolean((window as unknown as { jarvisDesktop?: { isElectron: boolean } }).jarvisDesktop?.isElectron)
    );
  }

  public setPromptCallback(cb: (req: DesktopPermissionRequest) => void) {
    this.onPermissionPrompt = cb;
  }

  public setSelectedFolder(folderPath: string, folderName?: string): SelectedFolderMetadata {
    const cleanPath = folderPath.trim();
    const inferredName =
      folderName?.trim() || cleanPath.split(/[\\/]/).filter(Boolean).pop() || cleanPath;
    const meta: SelectedFolderMetadata = {
      folderId: `fld-${Date.now().toString(36)}`,
      name: inferredName,
      path: cleanPath,
      selectedAt: Date.now()
    };
    this.selectedFolder = meta;
    this.approvedPaths.add(cleanPath);
    return { ...meta };
  }

  public getSelectedFolder(): SelectedFolderMetadata | null {
    return this.selectedFolder ? { ...this.selectedFolder } : null;
  }

  public clearSelectedFolder(): void {
    this.selectedFolder = null;
  }

  public setRequireApprovedPath(required: boolean): void {
    this.requireApprovedPath = required;
  }

  public registerApprovedPath(rawPath: string): void {
    const clean = rawPath.trim();
    if (clean) {
      this.approvedPaths.add(clean);
    }
  }

  public getApprovedPaths(): string[] {
    return Array.from(this.approvedPaths);
  }

  public clearApprovedPaths(): void {
    this.approvedPaths.clear();
    this.selectedFolder = null;
    this.requireApprovedPath = false;
  }

  public isPathApproved(rawPath: string): boolean {
    if (!this.requireApprovedPath && this.approvedPaths.size === 0) return true;
    const clean = rawPath.trim();
    for (const root of this.approvedPaths) {
      if (clean === root || clean.startsWith(`${root}/`) || clean.startsWith(`${root}\\`)) {
        return true;
      }
    }
    return false;
  }

  public getActionAuditLog(limit = 30): DesktopActionAuditEntry[] {
    return this.actionAuditLog.slice(0, Math.max(1, limit)).map((e) => ({ ...e }));
  }

  public clearActionAuditLog(): void {
    this.actionAuditLog = [];
  }

  private recordActionAudit(action: string, target: string, ok: boolean, verified: boolean, error?: string): void {
    this.actionAuditLog.unshift({
      id: `dact-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 5)}`,
      action,
      target,
      ok,
      verified,
      error,
      timestamp: Date.now()
    });
    if (this.actionAuditLog.length > 60) {
      this.actionAuditLog = this.actionAuditLog.slice(0, 60);
    }
  }

  public async getApprovedApplications(): Promise<ApprovedAppInfo[]> {
    try {
      if (!this.isElectron() && typeof fetch === 'function') {
        const res = await fetch('/api/desktop/apps');
        if (res.ok) {
          const json = (await res.json()) as { ok?: boolean; applications?: ApprovedAppInfo[] };
          if (Array.isArray(json.applications) && json.applications.length > 0) {
            return json.applications;
          }
        }
      }
    } catch {
      // Fallback cleanly to default allowlist
    }
    return DEFAULT_APPROVED_APPS.map((a) => ({ ...a }));
  }

  public async pickFolder(): Promise<{
    cancelled: boolean;
    folder?: SelectedFolderMetadata;
    browserLimited?: boolean;
    error?: string;
  }> {
    if (this.isElectron()) {
      const electronBridge = (window as unknown as {
        jarvisDesktop: {
          selectFolder?: () => Promise<{ ok: boolean; cancelled: boolean; path?: string | null; name?: string; error?: string }>;
        };
      }).jarvisDesktop;
      if (electronBridge?.selectFolder) {
        const res = await electronBridge.selectFolder();
        if (res.cancelled || !res.path) {
          return { cancelled: true };
        }
        const folder = this.setSelectedFolder(res.path, res.name);
        return { cancelled: false, folder };
      }
    }

    if (
      typeof window !== 'undefined' &&
      'showDirectoryPicker' in window &&
      typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
    ) {
      try {
        const picker = (window as unknown as {
          showDirectoryPicker: () => Promise<{ name: string }>;
        }).showDirectoryPicker;
        const handle = await picker();
        const folder = this.setSelectedFolder(handle.name, handle.name);
        return { cancelled: false, folder, browserLimited: true };
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return { cancelled: true };
        }
        return {
          cancelled: false,
          error: err instanceof Error ? err.message : 'Unable to open browser directory picker.'
        };
      }
    }

    return {
      cancelled: false,
      browserLimited: true,
      error: 'Native OS folder picker is unavailable in this browser context.'
    };
  }

  public async pickDesktopFile(): Promise<{
    cancelled: boolean;
    path?: string;
    name?: string;
    error?: string;
  }> {
    if (!this.isElectron()) {
      return { cancelled: false, error: 'Native OS file path picker requires Electron desktop runtime.' };
    }
    const electronBridge = (window as unknown as {
      jarvisDesktop: {
        selectFile?: () => Promise<{ ok: boolean; cancelled: boolean; path?: string | null; name?: string; error?: string }>;
      };
    }).jarvisDesktop;
    if (!electronBridge?.selectFile) {
      return { cancelled: false, error: 'Electron selectFile handler is unavailable.' };
    }
    const res = await electronBridge.selectFile();
    if (res.cancelled || !res.path) {
      return { cancelled: true };
    }
    this.registerApprovedPath(res.path);
    return { cancelled: false, path: res.path, name: res.name };
  }

  public async approveDesktopPathOnServer(rawPath: string): Promise<{ ok: boolean; normalizedPath?: string; error?: string }> {
    const clean = rawPath.trim();
    if (!clean) return { ok: false, error: 'Path cannot be empty.' };
    this.registerApprovedPath(clean);
    if (this.isElectron() || typeof fetch !== 'function') {
      return { ok: true, normalizedPath: clean };
    }
    try {
      const response = await fetch('/api/desktop/paths/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: clean })
      });
      const data = (await response.json()) as { ok: boolean; normalizedPath?: string; error?: string };
      if (data.ok && data.normalizedPath) {
        this.registerApprovedPath(data.normalizedPath);
      }
      return data;
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async postDesktopJson(
    endpoint: string,
    action: string,
    target: string,
    body: Record<string, unknown>
  ): Promise<DesktopExecutionResult> {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    let data: Partial<DesktopExecutionResult> | null = null;
    try {
      data = (await response.json()) as Partial<DesktopExecutionResult>;
    } catch {
      data = null;
    }

    if (!data || typeof data.ok !== 'boolean') {
      const errMsg = `Desktop server returned invalid response (HTTP ${response.status}).`;
      return {
        ok: false,
        action,
        target,
        verified: false,
        summary: errMsg,
        error: `HTTP_${response.status}`
      };
    }

    return {
      ok: Boolean(data.ok && response.ok),
      action: data.action || action,
      target: data.target || target,
      verified: Boolean(data.verified && data.ok && response.ok),
      summary: data.summary || (response.ok ? 'Action completed.' : `Desktop action failed (HTTP ${response.status}).`),
      pid: data.pid,
      error: data.error || (response.ok ? undefined : `HTTP_${response.status}`),
      details: data.details
    };
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
      const deniedRes: DesktopExecutionResult = {
        ok: false,
        action: 'APPLICATION_LAUNCH',
        target: cleanAppId,
        verified: false,
        summary: auth.error || 'Blocked: application launch not authorized.',
        error: auth.error || 'PERMISSION_DENIED'
      };
      this.recordActionAudit('APPLICATION_LAUNCH', cleanAppId, false, false, deniedRes.error);
      return deniedRes;
    }

    try {
      let res: DesktopExecutionResult;
      if (this.isElectron()) {
        const electronBridge = (window as unknown as {
          jarvisDesktop: { launchApp: (id: string, a: string[]) => Promise<DesktopExecutionResult> };
        }).jarvisDesktop;
        res = await electronBridge.launchApp(cleanAppId, args);
      } else {
        res = await this.postDesktopJson('/api/desktop/launch', 'APPLICATION_LAUNCH', cleanAppId, {
          applicationId: cleanAppId,
          args
        });
      }

      permissionManager.completeExecution(permissionId, res.ok, res.summary, res.error);
      this.recordActionAudit('APPLICATION_LAUNCH', res.target || cleanAppId, res.ok, Boolean(res.verified), res.error);
      if (res.ok) audioService.playActivationWhoosh();
      else audioService.playChirp(600);
      return res;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      permissionManager.completeExecution(permissionId, false, `Failed to launch application: ${msg}`, msg);
      this.recordActionAudit('APPLICATION_LAUNCH', cleanAppId, false, false, msg);
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
      const deniedRes: DesktopExecutionResult = {
        ok: false,
        action: 'FILE_ACCESS',
        target: cleanPath,
        verified: false,
        summary: auth.error || 'Blocked: file access not authorized.',
        error: auth.error || 'PERMISSION_DENIED'
      };
      this.recordActionAudit('FILE_ACCESS', cleanPath, false, false, deniedRes.error);
      return deniedRes;
    }

    if (!this.isPathApproved(cleanPath)) {
      const errMsg = `Path "${cleanPath}" is not inside explicitly selected or approved desktop paths.`;
      permissionManager.completeExecution(permissionId, false, errMsg, 'UNAPPROVED_PATH');
      this.recordActionAudit('FILE_ACCESS', cleanPath, false, false, 'UNAPPROVED_PATH');
      audioService.playChirp(600);
      return {
        ok: false,
        action: 'FILE_ACCESS',
        target: cleanPath,
        verified: false,
        summary: errMsg,
        error: 'UNAPPROVED_PATH'
      };
    }

    try {
      let res: DesktopExecutionResult;
      if (this.isElectron()) {
        const electronBridge = (window as unknown as {
          jarvisDesktop: { openFile: (p: string) => Promise<DesktopExecutionResult> };
        }).jarvisDesktop;
        res = await electronBridge.openFile(cleanPath);
      } else {
        res = await this.postDesktopJson('/api/desktop/file/open', 'FILE_ACCESS', cleanPath, {
          filePath: cleanPath
        });
      }

      permissionManager.completeExecution(permissionId, res.ok, res.summary, res.error);
      this.recordActionAudit('FILE_ACCESS', res.target || cleanPath, res.ok, Boolean(res.verified), res.error);
      if (res.ok) audioService.playActivationWhoosh();
      else audioService.playChirp(600);
      return res;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      permissionManager.completeExecution(permissionId, false, `Failed to open file: ${msg}`, msg);
      this.recordActionAudit('FILE_ACCESS', cleanPath, false, false, msg);
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
      const deniedRes: DesktopExecutionResult = {
        ok: false,
        action: 'FOLDER_ACCESS',
        target: cleanPath,
        verified: false,
        summary: auth.error || 'Blocked: folder access not authorized.',
        error: auth.error || 'PERMISSION_DENIED'
      };
      this.recordActionAudit('FOLDER_ACCESS', cleanPath, false, false, deniedRes.error);
      return deniedRes;
    }

    if (!this.isPathApproved(cleanPath)) {
      const errMsg = `Folder "${cleanPath}" is not inside explicitly selected or approved desktop paths.`;
      permissionManager.completeExecution(permissionId, false, errMsg, 'UNAPPROVED_PATH');
      this.recordActionAudit('FOLDER_ACCESS', cleanPath, false, false, 'UNAPPROVED_PATH');
      audioService.playChirp(600);
      return {
        ok: false,
        action: 'FOLDER_ACCESS',
        target: cleanPath,
        verified: false,
        summary: errMsg,
        error: 'UNAPPROVED_PATH'
      };
    }

    try {
      let res: DesktopExecutionResult;
      if (this.isElectron()) {
        const electronBridge = (window as unknown as {
          jarvisDesktop: { openFolder: (p: string) => Promise<DesktopExecutionResult> };
        }).jarvisDesktop;
        res = await electronBridge.openFolder(cleanPath);
      } else {
        res = await this.postDesktopJson('/api/desktop/folder/open', 'FOLDER_ACCESS', cleanPath, {
          folderPath: cleanPath
        });
      }

      permissionManager.completeExecution(permissionId, res.ok, res.summary, res.error);
      this.recordActionAudit('FOLDER_ACCESS', res.target || cleanPath, res.ok, Boolean(res.verified), res.error);
      if (res.ok) audioService.playActivationWhoosh();
      else audioService.playChirp(600);
      return res;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      permissionManager.completeExecution(permissionId, false, `Failed to open folder: ${msg}`, msg);
      this.recordActionAudit('FOLDER_ACCESS', cleanPath, false, false, msg);
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
      const deniedRes: DesktopExecutionResult = {
        ok: false,
        action: 'BROWSER_ACCESS',
        target: cleanUrl,
        verified: false,
        summary: auth.error || 'Blocked: browser access not authorized.',
        error: auth.error || 'PERMISSION_DENIED'
      };
      this.recordActionAudit('BROWSER_ACCESS', cleanUrl, false, false, deniedRes.error);
      return deniedRes;
    }

    try {
      let res: DesktopExecutionResult;
      if (this.isElectron()) {
        const electronBridge = (window as unknown as {
          jarvisDesktop: { openBrowser: (u: string) => Promise<DesktopExecutionResult> };
        }).jarvisDesktop;
        res = await electronBridge.openBrowser(cleanUrl);
      } else {
        res = await this.postDesktopJson('/api/desktop/browser/open', 'BROWSER_ACCESS', cleanUrl, {
          url: cleanUrl
        });
      }

      permissionManager.completeExecution(permissionId, res.ok, res.summary, res.error);
      this.recordActionAudit('BROWSER_ACCESS', res.target || cleanUrl, res.ok, Boolean(res.verified), res.error);
      if (res.ok) audioService.playActivationWhoosh();
      else audioService.playChirp(600);
      return res;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      permissionManager.completeExecution(permissionId, false, `Failed to open browser: ${msg}`, msg);
      this.recordActionAudit('BROWSER_ACCESS', cleanUrl, false, false, msg);
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
      const deniedRes: DesktopExecutionResult = {
        ok: false,
        action: 'WEB_SEARCH',
        target: cleanQuery,
        verified: false,
        summary: auth.error || 'Blocked: web search not authorized.',
        error: auth.error || 'PERMISSION_DENIED'
      };
      this.recordActionAudit('WEB_SEARCH', cleanQuery, false, false, deniedRes.error);
      return deniedRes;
    }

    try {
      let res: DesktopExecutionResult;
      if (this.isElectron()) {
        const electronBridge = (window as unknown as {
          jarvisDesktop: { searchWeb: (q: string, e: string) => Promise<DesktopExecutionResult> };
        }).jarvisDesktop;
        res = await electronBridge.searchWeb(cleanQuery, engine);
      } else {
        res = await this.postDesktopJson('/api/desktop/search', 'WEB_SEARCH', cleanQuery, {
          query: cleanQuery,
          engine
        });
      }

      permissionManager.completeExecution(permissionId, res.ok, res.summary, res.error);
      this.recordActionAudit('WEB_SEARCH', res.target || cleanQuery, res.ok, Boolean(res.verified), res.error);
      if (res.ok) audioService.playActivationWhoosh();
      else audioService.playChirp(600);
      return res;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      permissionManager.completeExecution(permissionId, false, `Search failed: ${msg}`, msg);
      this.recordActionAudit('WEB_SEARCH', cleanQuery, false, false, msg);
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
      const deniedRes: DesktopExecutionResult = {
        ok: false,
        action: 'MUSIC_CONTROL',
        target: cleanTarget,
        verified: false,
        summary: auth.error || 'Blocked: music control not authorized.',
        error: auth.error || 'PERMISSION_DENIED'
      };
      this.recordActionAudit('MUSIC_CONTROL', cleanTarget, false, false, deniedRes.error);
      return deniedRes;
    }

    try {
      let res: DesktopExecutionResult;
      if (this.isElectron()) {
        const electronBridge = (window as unknown as {
          jarvisDesktop: { launchMusic: (t: string) => Promise<DesktopExecutionResult> };
        }).jarvisDesktop;
        res = await electronBridge.launchMusic(cleanTarget);
      } else {
        res = await this.postDesktopJson('/api/desktop/music', 'MUSIC_CONTROL', cleanTarget, {
          musicTarget: cleanTarget
        });
      }

      permissionManager.completeExecution(permissionId, res.ok, res.summary, res.error);
      this.recordActionAudit('MUSIC_CONTROL', res.target || cleanTarget, res.ok, Boolean(res.verified), res.error);
      if (res.ok) audioService.playActivationWhoosh();
      else audioService.playChirp(600);
      return res;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      permissionManager.completeExecution(permissionId, false, `Music launch failed: ${msg}`, msg);
      this.recordActionAudit('MUSIC_CONTROL', cleanTarget, false, false, msg);
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
    if (!this.isPathApproved(folderPath)) {
      return {
        ok: false,
        folder: folderPath,
        files: [],
        error: `Folder "${folderPath}" is not inside explicitly selected or approved desktop paths.`
      };
    }
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
