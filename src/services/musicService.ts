import {
  MusicPlaybackState,
  MusicSourceType,
  PermissionRequest
} from '../types/assistant';
import { PermissionManager, permissionManager as defaultPermissionManager } from './permissionManager';
import { validateNavigationUrl } from './browserActionService';

export interface MusicSourceChoice {
  id: MusicSourceType;
  label: string;
  description: string;
}

export const MUSIC_SOURCE_CHOICES: MusicSourceChoice[] = [
  {
    id: 'LOCAL_AUDIO',
    label: 'Local Audio File',
    description: 'Select an audio file from your device for direct in-app playback.'
  },
  {
    id: 'SPOTIFY',
    label: 'Spotify Web',
    description: 'Open an official Spotify search page in a new approved browser tab.'
  },
  {
    id: 'YOUTUBE_MUSIC',
    label: 'YouTube Music',
    description: 'Open an official YouTube Music search page in a new approved tab.'
  },
  {
    id: 'SOUNDCLOUD',
    label: 'SoundCloud',
    description: 'Open SoundCloud search results in a new approved tab.'
  }
];

export function buildMusicServiceUrl(sourceType: MusicSourceType, query: string): string | null {
  const q = encodeURIComponent(query.trim());
  switch (sourceType) {
    case 'SPOTIFY':
      return q ? `https://open.spotify.com/search/${q}` : 'https://open.spotify.com/';
    case 'YOUTUBE_MUSIC':
      return q ? `https://music.youtube.com/search?q=${q}` : 'https://music.youtube.com/';
    case 'SOUNDCLOUD':
      return q ? `https://soundcloud.com/search?q=${q}` : 'https://soundcloud.com/';
    case 'YOUTUBE':
      return q ? `https://www.youtube.com/results?search_query=${q}` : 'https://www.youtube.com/';
    default:
      return null;
  }
}

export class MusicService {
  private permissionMgr: PermissionManager;
  private audioEl: HTMLAudioElement | null = null;
  private activeObjectUrl: string | null = null;
  private listeners: Set<(state: MusicPlaybackState) => void> = new Set();
  private state: MusicPlaybackState = {
    status: 'IDLE',
    sourceType: null,
    trackTitle: null,
    volume: 0.75,
    currentTimeSec: 0,
    durationSec: 0,
    isActualAudioPlaying: false,
    statusMessage: 'Music controller ready.'
  };

  constructor(permissionMgr: PermissionManager = defaultPermissionManager) {
    this.permissionMgr = permissionMgr;
  }

  public subscribe(listener: (state: MusicPlaybackState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  public getState(): MusicPlaybackState {
    return { ...this.state };
  }

  private updateState(patch: Partial<MusicPlaybackState>) {
    this.state = { ...this.state, ...patch };
    const snap = this.getState();
    this.listeners.forEach((fn) => fn(snap));
  }

  private disposeAudioElement() {
    if (this.audioEl) {
      try {
        this.audioEl.pause();
        this.audioEl.src = '';
      } catch {
        // ignore
      }
      this.audioEl = null;
    }
    if (this.activeObjectUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      try {
        URL.revokeObjectURL(this.activeObjectUrl);
      } catch {
        // ignore
      }
      this.activeObjectUrl = null;
    }
  }

  public requestMusicPermission(params: {
    sourceType: MusicSourceType;
    targetLabel: string;
    reason?: string;
    metadata?: Record<string, unknown>;
  }): PermissionRequest {
    const isExternalLink =
      params.sourceType === 'SPOTIFY' ||
      params.sourceType === 'YOUTUBE_MUSIC' ||
      params.sourceType === 'SOUNDCLOUD' ||
      params.sourceType === 'YOUTUBE';

    const url = isExternalLink ? buildMusicServiceUrl(params.sourceType, params.targetLabel) : null;
    const requestedAction = isExternalLink
      ? `Open ${params.sourceType.replace('_', ' ')} for "${params.targetLabel}"`
      : `Play local audio "${params.targetLabel}"`;

    this.updateState({
      status: 'AWAITING_APPROVAL',
      sourceType: params.sourceType,
      trackTitle: params.targetLabel,
      sourceUrl: url || undefined,
      statusMessage: `Waiting for your permission to ${requestedAction.toLowerCase()}.`,
      error: undefined
    });

    return this.permissionMgr.createRequest({
      category: 'MUSIC_PLAYBACK',
      requestedAction,
      target: url || params.targetLabel,
      reason: params.reason || `User requested music via ${params.sourceType}`,
      riskLevel: isExternalLink ? 'MEDIUM' : 'LOW',
      requestedScope: isExternalLink
        ? `Open official ${params.sourceType.replace('_', ' ')} link in a new browser tab`
        : `Play user-selected local audio "${params.targetLabel}" in browser`,
      metadata: {
        sourceType: params.sourceType,
        trackTitle: params.targetLabel,
        url,
        ...(params.metadata || {})
      }
    });
  }

  public async playApprovedLocalAudio(file: File, permissionId: string): Promise<MusicPlaybackState> {
    const auth = this.permissionMgr.beginAuthorizedExecution(permissionId, 'MUSIC_PLAYBACK', file.name);
    if (!auth.authorized) {
      this.updateState({
        status: 'ERROR',
        isActualAudioPlaying: false,
        error: auth.error,
        statusMessage: auth.error || 'Music playback requires explicit permission.'
      });
      return this.getState();
    }

    this.disposeAudioElement();

    if (typeof Audio === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      const msg = 'HTML5 Audio playback API is unavailable in this environment.';
      this.permissionMgr.completeExecution(permissionId, false, msg, msg);
      this.updateState({
        status: 'UNAVAILABLE',
        sourceType: 'LOCAL_AUDIO',
        trackTitle: file.name,
        isActualAudioPlaying: false,
        error: msg,
        statusMessage: msg
      });
      return this.getState();
    }

    try {
      const objectUrl = URL.createObjectURL(file);
      this.activeObjectUrl = objectUrl;
      const audio = new Audio(objectUrl);
      audio.volume = this.state.volume;
      this.audioEl = audio;

      audio.ontimeupdate = () => {
        if (this.audioEl === audio) {
          this.updateState({
            currentTimeSec: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
            durationSec: Number.isFinite(audio.duration) ? audio.duration : 0
          });
        }
      };

      audio.onended = () => {
        if (this.audioEl === audio) {
          this.updateState({
            status: 'STOPPED',
            isActualAudioPlaying: false,
            currentTimeSec: 0,
            statusMessage: `Finished playing "${file.name}".`
          });
        }
      };

      audio.onerror = () => {
        if (this.audioEl === audio) {
          this.updateState({
            status: 'UNAVAILABLE',
            isActualAudioPlaying: false,
            error: 'Audio codec or file stream unavailable.',
            statusMessage: `Unable to decode audio track "${file.name}".`
          });
        }
      };

      await audio.play();
      const msg = `Music playback started: "${file.name}".`;
      this.permissionMgr.completeExecution(permissionId, true, msg);
      this.updateState({
        status: 'PLAYING',
        sourceType: 'LOCAL_AUDIO',
        trackTitle: file.name,
        sourceUrl: undefined,
        currentTimeSec: 0,
        durationSec: Number.isFinite(audio.duration) ? audio.duration : 0,
        isActualAudioPlaying: true,
        autoplayBlocked: false,
        popupBlocked: false,
        error: undefined,
        statusMessage: msg
      });
      return this.getState();
    } catch (err) {
      const isAutoplayBlocked =
        err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'AbortError');
      if (isAutoplayBlocked) {
        const msg = `Track "${file.name}" is loaded, but browser autoplay policy requires clicking Play/Resume directly.`;
        this.permissionMgr.completeExecution(permissionId, true, msg);
        this.updateState({
          status: 'PAUSED',
          sourceType: 'LOCAL_AUDIO',
          trackTitle: file.name,
          isActualAudioPlaying: false,
          autoplayBlocked: true,
          error: undefined,
          statusMessage: msg
        });
        return this.getState();
      }

      const msg = err instanceof Error ? err.message : 'Unable to start audio playback.';
      this.disposeAudioElement();
      this.permissionMgr.completeExecution(permissionId, false, msg, msg);
      this.updateState({
        status: 'ERROR',
        sourceType: 'LOCAL_AUDIO',
        trackTitle: file.name,
        isActualAudioPlaying: false,
        error: msg,
        statusMessage: msg
      });
      return this.getState();
    }
  }

  public openApprovedMusicServiceLink(
    sourceType: Exclude<MusicSourceType, 'LOCAL_AUDIO' | 'DIRECT_STREAM'>,
    query: string,
    permissionId: string
  ): MusicPlaybackState {
    const targetUrl = buildMusicServiceUrl(sourceType, query);
    if (!targetUrl) {
      const msg = `Unsupported external music service "${sourceType}".`;
      this.updateState({
        status: 'ERROR',
        isActualAudioPlaying: false,
        error: msg,
        statusMessage: msg
      });
      return this.getState();
    }

    const preview = validateNavigationUrl(targetUrl);
    if (!preview.valid || !preview.normalizedUrl) {
      const msg = preview.error || 'Invalid music service URL.';
      this.permissionMgr.completeExecution(permissionId, false, msg, msg);
      this.updateState({
        status: 'ERROR',
        isActualAudioPlaying: false,
        error: msg,
        statusMessage: msg
      });
      return this.getState();
    }

    const auth = this.permissionMgr.beginAuthorizedExecution(
      permissionId,
      'MUSIC_PLAYBACK',
      preview.normalizedUrl
    );
    if (!auth.authorized) {
      this.updateState({
        status: 'ERROR',
        isActualAudioPlaying: false,
        error: auth.error,
        statusMessage: auth.error || 'Music service navigation denied.'
      });
      return this.getState();
    }

    if (typeof window === 'undefined' || typeof window.open !== 'function') {
      const msg = 'Browser window.open API is unavailable in this environment.';
      this.permissionMgr.completeExecution(permissionId, false, msg, msg);
      this.updateState({
        status: 'UNAVAILABLE',
        sourceType,
        trackTitle: query || sourceType,
        sourceUrl: preview.normalizedUrl,
        isActualAudioPlaying: false,
        error: msg,
        statusMessage: msg
      });
      return this.getState();
    }

    const win = window.open(preview.normalizedUrl, '_blank', 'noopener,noreferrer');
    if (!win) {
      const msg = `Popup blocker prevented opening ${sourceType.replace('_', ' ')} automatically. Click the verified link to open it manually.`;
      this.permissionMgr.completeExecution(permissionId, false, msg, 'POPUP_BLOCKED');
      this.updateState({
        status: 'ERROR',
        sourceType,
        trackTitle: query || sourceType,
        sourceUrl: preview.normalizedUrl,
        isActualAudioPlaying: false,
        popupBlocked: true,
        error: 'POPUP_BLOCKED',
        statusMessage: msg
      });
      return this.getState();
    }

    // Explicitly do NOT report PLAYING when only an external service/search page opened
    const msg = `Opened ${sourceType.replace('_', ' ')} link for "${query || 'home'}" in a new browser tab. Playback occurs inside that external service, not inside JARVIS local audio.`;
    this.permissionMgr.completeExecution(permissionId, true, msg);
    this.updateState({
      status: 'OPENED_EXTERNAL_LINK',
      sourceType,
      trackTitle: query || sourceType,
      sourceUrl: preview.normalizedUrl,
      isActualAudioPlaying: false,
      popupBlocked: false,
      error: undefined,
      statusMessage: msg
    });
    return this.getState();
  }

  public pause(): boolean {
    if (!this.audioEl) {
      if (this.state.status === 'PLAYING') {
        this.updateState({
          status: 'PAUSED',
          isActualAudioPlaying: false,
          statusMessage: 'Music playback paused.'
        });
        return true;
      }
      return false;
    }
    this.audioEl.pause();
    this.updateState({
      status: 'PAUSED',
      isActualAudioPlaying: false,
      statusMessage: `Paused "${this.state.trackTitle || 'track'}".`
    });
    return true;
  }

  public async resume(): Promise<boolean> {
    if (!this.audioEl) return false;
    try {
      await this.audioEl.play();
      this.updateState({
        status: 'PLAYING',
        isActualAudioPlaying: true,
        autoplayBlocked: false,
        error: undefined,
        statusMessage: `Resumed "${this.state.trackTitle || 'track'}".`
      });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to resume audio playback.';
      this.updateState({
        status: 'PAUSED',
        isActualAudioPlaying: false,
        error: msg,
        statusMessage: msg
      });
      return false;
    }
  }

  public stop(): boolean {
    const hadMedia = Boolean(this.audioEl || this.state.trackTitle);
    this.disposeAudioElement();
    this.updateState({
      status: 'STOPPED',
      isActualAudioPlaying: false,
      currentTimeSec: 0,
      statusMessage: hadMedia ? 'Music playback stopped.' : 'No active music playback.'
    });
    return hadMedia;
  }

  public setVolume(volume: number): number {
    const clamped = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0.75));
    if (this.audioEl) {
      this.audioEl.volume = clamped;
    }
    this.updateState({
      volume: clamped,
      statusMessage: `Music volume set to ${Math.round(clamped * 100)}%.`
    });
    return clamped;
  }

  public reset() {
    this.disposeAudioElement();
    this.updateState({
      status: 'IDLE',
      sourceType: null,
      trackTitle: null,
      sourceUrl: undefined,
      currentTimeSec: 0,
      durationSec: 0,
      isActualAudioPlaying: false,
      autoplayBlocked: false,
      popupBlocked: false,
      error: undefined,
      statusMessage: 'Music controller ready.'
    });
  }
}

export const musicService = new MusicService();
