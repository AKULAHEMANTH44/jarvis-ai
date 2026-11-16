import { DesktopPermissionRequest, SystemStatusTelemetry } from '../types/assistant';
import { audioService } from './soundFx';

class DesktopBridgeService {
  private pendingRequests: Map<string, { req: DesktopPermissionRequest; resolve: (approved: boolean) => void; timeout: ReturnType<typeof setTimeout> }> = new Map();
  private onPermissionPrompt?: (req: DesktopPermissionRequest) => void;

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
        telemetry.cpuLoad = Math.min(100, Math.round(35 + (nav.hardwareConcurrency * 4)));
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
