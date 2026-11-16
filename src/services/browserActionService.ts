import {
  BrowserNavigationPreview,
  BrowserNavigationResult,
  PermissionRequest
} from '../types/assistant';
import { PermissionManager, permissionManager as defaultPermissionManager } from './permissionManager';

const KNOWN_WEBSITE_MAP: Record<string, string> = {
  youtube: 'https://www.youtube.com',
  github: 'https://github.com',
  google: 'https://www.google.com',
  wikipedia: 'https://www.wikipedia.org',
  mdn: 'https://developer.mozilla.org',
  'react docs': 'https://react.dev',
  react: 'https://react.dev',
  'three.js': 'https://threejs.org/docs/',
  threejs: 'https://threejs.org/docs/',
  stackoverflow: 'https://stackoverflow.com',
  'stack overflow': 'https://stackoverflow.com',
  npm: 'https://www.npmjs.com',
  duckduckgo: 'https://duckduckgo.com',
  spotify: 'https://open.spotify.com',
  'youtube music': 'https://music.youtube.com',
  soundcloud: 'https://soundcloud.com'
};

const BLOCKED_SCHEMES = ['javascript:', 'data:', 'vbscript:', 'file:', 'blob:', 'about:', 'chrome:', 'edge:'];

export function validateNavigationUrl(rawInput: string): BrowserNavigationPreview {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { valid: false, rawInput, error: 'Destination URL or website name cannot be empty.' };
  }

  if (/\s/.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    const knownBySpace = KNOWN_WEBSITE_MAP[trimmed.toLowerCase()];
    if (!knownBySpace) {
      return {
        valid: false,
        rawInput,
        error: `"${trimmed}" contains spaces and is not a valid URL.`
      };
    }
  }

  const lower = trimmed.toLowerCase();
  for (const scheme of BLOCKED_SCHEMES) {
    if (lower.startsWith(scheme)) {
      return {
        valid: false,
        rawInput,
        error: `Blocked unsafe URI scheme (${scheme}). Only HTTPS/HTTP web destinations are permitted.`
      };
    }
  }

  let candidate = KNOWN_WEBSITE_MAP[lower] || trimmed;

  // Reject explicit non-http(s) schemes like ftp:, mailto:, intent:, tel:
  const explicitSchemeMatch = candidate.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (explicitSchemeMatch) {
    const scheme = explicitSchemeMatch[1].toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') {
      return {
        valid: false,
        rawInput,
        error: `Unsupported URL protocol "${scheme}:". Only https:// (or loopback http://) is allowed.`
      };
    }
  } else {
    // Allow explicit domain format like example.com or docs.python.org/3/
    if (!/^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+([/:?#].*)?$/.test(candidate)) {
      return {
        valid: false,
        rawInput,
        error: `"${trimmed}" is not a recognized website shortcut or valid domain URL.`
      };
    }
    candidate = `https://${candidate}`;
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.username || parsed.password) {
      return {
        valid: false,
        rawInput,
        error: 'Blocked URL containing embedded authentication credentials.'
      };
    }

    const isLoopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol === 'http:' && !isLoopback) {
      return {
        valid: false,
        rawInput,
        error: 'Insecure http:// external navigation is blocked; use https:// instead.'
      };
    }

    if (parsed.protocol !== 'https:' && !isLoopback) {
      return {
        valid: false,
        rawInput,
        error: `Protocol "${parsed.protocol}" is not permitted.`
      };
    }

    return {
      valid: true,
      rawInput,
      normalizedUrl: parsed.toString(),
      hostname: parsed.hostname,
      protocol: parsed.protocol
    };
  } catch {
    return {
      valid: false,
      rawInput,
      error: `Malformed URL "${trimmed}".`
    };
  }
}

export class BrowserActionService {
  private permissionMgr: PermissionManager;

  constructor(permissionMgr: PermissionManager = defaultPermissionManager) {
    this.permissionMgr = permissionMgr;
  }

  public getKnownWebsites(): { name: string; url: string }[] {
    return Object.entries(KNOWN_WEBSITE_MAP).map(([name, url]) => ({ name, url }));
  }

  public resolveDestinationPreview(rawDestination: string): BrowserNavigationPreview {
    return validateNavigationUrl(rawDestination);
  }

  public requestOpenWebsitePermission(
    rawDestination: string,
    reason = 'User requested opening external website in a new tab.'
  ): { preview: BrowserNavigationPreview; permissionRequest?: PermissionRequest } {
    const preview = this.resolveDestinationPreview(rawDestination);
    if (!preview.valid || !preview.normalizedUrl) {
      return { preview };
    }

    const permissionRequest = this.permissionMgr.createRequest({
      category: 'BROWSER_ACCESS',
      requestedAction: 'Open website in new browser tab',
      target: preview.normalizedUrl,
      reason,
      riskLevel: 'MEDIUM',
      requestedScope: 'Open one browser tab via user-approved action',
      metadata: {
        hostname: preview.hostname,
        rawInput: rawDestination
      }
    });

    return { preview, permissionRequest };
  }

  public openApprovedUrl(
    targetUrl: string,
    permissionId: string,
    expectedCategory: 'BROWSER_ACCESS' | 'EXTERNAL_NAVIGATION' | 'WEB_SEARCH' | 'MUSIC_PLAYBACK' = 'BROWSER_ACCESS'
  ): BrowserNavigationResult {
    const preview = validateNavigationUrl(targetUrl);
    if (!preview.valid || !preview.normalizedUrl) {
      this.permissionMgr.completeExecution(
        permissionId,
        false,
        preview.error || 'Blocked invalid URL.',
        preview.error
      );
      return {
        ok: false,
        openedInNewTab: false,
        summary: preview.error || 'Blocked invalid URL.',
        error: preview.error
      };
    }

    const auth = this.permissionMgr.beginAuthorizedExecution(
      permissionId,
      expectedCategory,
      preview.normalizedUrl
    );

    if (!auth.authorized) {
      return {
        ok: false,
        url: preview.normalizedUrl,
        hostname: preview.hostname,
        openedInNewTab: false,
        summary: auth.error || 'Navigation blocked without valid approval.',
        error: auth.error
      };
    }

    if (typeof window === 'undefined' || typeof window.open !== 'function') {
      const msg = 'Browser window.open API is unavailable in the current runtime.';
      this.permissionMgr.completeExecution(permissionId, false, msg, msg);
      return {
        ok: false,
        url: preview.normalizedUrl,
        hostname: preview.hostname,
        openedInNewTab: false,
        summary: msg,
        error: msg
      };
    }

    try {
      const openedWin = window.open(preview.normalizedUrl, '_blank', 'noopener,noreferrer');
      if (!openedWin) {
        const msg = `Browser popup blocker prevented opening ${preview.hostname || preview.normalizedUrl} automatically. Allow popups or click the direct verified link in the HUD.`;
        this.permissionMgr.completeExecution(permissionId, false, msg, 'POPUP_BLOCKED');
        return {
          ok: false,
          url: preview.normalizedUrl,
          hostname: preview.hostname,
          openedInNewTab: false,
          popupBlocked: true,
          summary: msg,
          error: 'POPUP_BLOCKED'
        };
      }

      const summary = `Website opened successfully in a new browser tab: ${preview.normalizedUrl}.`;
      this.permissionMgr.completeExecution(permissionId, true, summary);
      return {
        ok: true,
        url: preview.normalizedUrl,
        hostname: preview.hostname,
        openedInNewTab: true,
        popupBlocked: false,
        summary
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to open browser tab.';
      this.permissionMgr.completeExecution(permissionId, false, msg, msg);
      return {
        ok: false,
        url: preview.normalizedUrl,
        hostname: preview.hostname,
        openedInNewTab: false,
        summary: msg,
        error: msg
      };
    }
  }
}

export const browserActionService = new BrowserActionService();
