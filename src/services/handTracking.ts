import { FilesetResolver, HandLandmarker, HandLandmarkerResult } from '@mediapipe/tasks-vision';

export type CameraPermissionStatus =
  | 'unknown'
  | 'checking'
  | 'prompt'
  | 'granted'
  | 'denied'
  | 'unavailable'
  | 'active'
  | 'error';

export class HandTrackingService {
  private handLandmarker: HandLandmarker | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private isRunning: boolean = false;
  private isStarting: boolean = false;
  private stream: MediaStream | null = null;
  private animationFrameId: number | null = null;
  private lastVideoTime: number = -1;
  private lastTimestampMs: number = 0;
  private fps: number = 0;
  private frameCount: number = 0;
  private lastFpsUpdate: number = performance.now();
  private onResultsCallback: ((result: HandLandmarkerResult, fps: number) => void) | null = null;
  private onPermissionChangeCallback: ((status: CameraPermissionStatus) => void) | null = null;
  private onInterruptionCallback: ((reason: string) => void) | null = null;
  private trackEndedCleanup: (() => void) | null = null;
  private isInitializing: boolean = false;
  private lastError: string | null = null;
  private minConfidence: number = 0.5;
  private permissionStatus: CameraPermissionStatus = 'unknown';
  private lastResult: HandLandmarkerResult | null = null;

  public getLastResult(): HandLandmarkerResult | null {
    return this.lastResult;
  }

  public getLastError(): string | null {
    return this.lastError;
  }

  public getPermissionStatus(): CameraPermissionStatus {
    return this.permissionStatus;
  }

  public setPermissionChangeCallback(cb: ((status: CameraPermissionStatus) => void) | null) {
    this.onPermissionChangeCallback = cb;
  }

  public setInterruptionCallback(cb: ((reason: string) => void) | null) {
    this.onInterruptionCallback = cb;
  }

  private setPermissionStatus(status: CameraPermissionStatus) {
    if (this.permissionStatus !== status) {
      this.permissionStatus = status;
      this.onPermissionChangeCallback?.(status);
    }
  }

  public getStream(): MediaStream | null {
    return this.stream;
  }

  public getConfidenceThreshold(): number {
    return this.minConfidence;
  }

  public setConfidenceThreshold(threshold: number) {
    this.minConfidence = Math.max(0.2, Math.min(0.95, threshold));
    if (this.handLandmarker && typeof this.handLandmarker.setOptions === 'function') {
      void this.handLandmarker
        .setOptions({
          minHandDetectionConfidence: this.minConfidence,
          minHandPresenceConfidence: this.minConfidence,
          minTrackingConfidence: this.minConfidence
        })
        .catch(() => {
          // Safe ignore if runtime rejects live option update; software confidence filter remains active
        });
    }
  }

  public async getCameraPermissionState(): Promise<PermissionState | 'unsupported'> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (!this.isRunning) {
        this.setPermissionStatus('unavailable');
      }
      return 'unsupported';
    }
    if (!navigator.permissions || typeof navigator.permissions.query !== 'function') {
      if (!this.isRunning && this.permissionStatus === 'unknown') {
        this.setPermissionStatus('prompt');
      }
      return 'unsupported';
    }
    try {
      const status = await navigator.permissions.query({ name: 'camera' as PermissionName });
      if (!this.isRunning) {
        this.setPermissionStatus(status.state);
      }
      if ('onchange' in status) {
        status.onchange = () => {
          if (!this.isRunning) {
            this.setPermissionStatus(status.state);
          }
        };
      }
      return status.state;
    } catch {
      if (!this.isRunning && this.permissionStatus === 'unknown') {
        this.setPermissionStatus('prompt');
      }
      return 'unsupported';
    }
  }

  public async attachVideoElement(videoEl: HTMLVideoElement | null): Promise<boolean> {
    if (!videoEl) return false;
    this.videoElement = videoEl;
    if (!this.stream) return false;

    try {
      if (videoEl.srcObject !== this.stream) {
        videoEl.srcObject = this.stream;
      }
      videoEl.muted = true;
      videoEl.playsInline = true;
      this.lastVideoTime = -1;
      if (typeof videoEl.play === 'function') {
        await videoEl.play();
      }
      return true;
    } catch {
      return false;
    }
  }

  public async initialize(): Promise<boolean> {
    if (this.handLandmarker) return true;
    if (this.isInitializing) {
      // Wait briefly for in-flight initialization
      let waited = 0;
      while (this.isInitializing && waited < 10000) {
        await new Promise((r) => setTimeout(r, 100));
        waited += 100;
      }
      return Boolean(this.handLandmarker);
    }

    this.isInitializing = true;
    this.lastError = null;
    try {
      // First try local wasm in /wasm, fallback to CDN
      let vision = null;
      try {
        vision = await FilesetResolver.forVisionTasks('/wasm');
      } catch {
        console.warn('Local wasm failed, falling back to CDN...');
        vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
      }

      const localModel = '/models/hand_landmarker.task';
      const remoteModel = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
      const conf = this.minConfidence;

      // 1. Try local model with GPU
      try {
        this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: localModel, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: conf,
          minHandPresenceConfidence: conf,
          minTrackingConfidence: conf
        });
      } catch {
        // 2. Try local model with CPU (important for environments without WebGL GPU delegate)
        try {
          this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: localModel, delegate: 'CPU' },
            runningMode: 'VIDEO',
            numHands: 2,
            minHandDetectionConfidence: conf,
            minHandPresenceConfidence: conf,
            minTrackingConfidence: conf
          });
        } catch {
          // 3. Fallback to remote model with CPU
          try {
            this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
              baseOptions: { modelAssetPath: remoteModel, delegate: 'CPU' },
              runningMode: 'VIDEO',
              numHands: 2,
              minHandDetectionConfidence: conf,
              minHandPresenceConfidence: conf,
              minTrackingConfidence: conf
            });
          } catch (cpuError) {
            console.warn('HandLandmarker initialization failed:', cpuError);
            this.lastError = 'Unable to initialize MediaPipe HandLandmarker model.';
            this.isInitializing = false;
            return false;
          }
        }
      }

      this.isInitializing = false;
      return true;
    } catch (err) {
      console.warn('Failed to initialize FilesetResolver:', err);
      this.lastError = 'Failed to load MediaPipe vision runtime.';
      this.isInitializing = false;
      return false;
    }
  }

  private isEmbeddedFrame(): boolean {
    try {
      return typeof window !== 'undefined' && window.self !== window.top;
    } catch {
      return true;
    }
  }

  private classifyMediaErrorStatus(err: unknown): CameraPermissionStatus {
    const name = err instanceof Error ? err.name : '';
    const message = err instanceof Error ? err.message : String(err || '');

    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || /permission denied/i.test(message)) {
      return 'denied';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return 'unavailable';
    }
    return 'error';
  }

  private formatMediaError(err: unknown): string {
    const name = err instanceof Error ? err.name : '';
    const message = err instanceof Error ? err.message : String(err || '');

    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || /permission denied/i.test(message)) {
      return this.isEmbeddedFrame()
        ? 'Camera permission denied by browser or preview frame. Allow Camera in site permissions (or open in a new tab) and retry.'
        : 'Camera permission denied. Allow camera access in your browser site settings and retry.';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return 'No camera hardware detected. Connect a webcam or use Mouse/Lab controls.';
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return 'Camera is currently in use by another application or browser tab.';
    }
    if (name === 'SecurityError') {
      return 'Camera access requires a secure HTTPS or localhost origin.';
    }
    if (err instanceof DOMException) {
      return `Camera sensor error (${err.name}): ${err.message}`;
    }
    return message ? `Unable to access camera sensor: ${message}` : 'Unable to access camera sensor.';
  }

  private attachStreamInterruptionHandlers(stream: MediaStream) {
    if (this.trackEndedCleanup) {
      this.trackEndedCleanup();
      this.trackEndedCleanup = null;
    }

    const videoTracks = typeof stream.getVideoTracks === 'function' ? stream.getVideoTracks() : [];
    const handlers: Array<{ track: MediaStreamTrack; fn: () => void }> = [];

    videoTracks.forEach((track) => {
      if (typeof track.addEventListener === 'function') {
        const fn = () => {
          if (!this.isRunning) return;
          const reason = 'Camera stream interrupted or hardware disconnected.';
          this.stop();
          this.lastError = reason;
          this.setPermissionStatus('error');
          this.onInterruptionCallback?.(reason);
        };
        track.addEventListener('ended', fn);
        handlers.push({ track, fn });
      }
    });

    this.trackEndedCleanup = () => {
      handlers.forEach(({ track, fn }) => {
        if (typeof track.removeEventListener === 'function') {
          track.removeEventListener('ended', fn);
        }
      });
    };
  }

  public async startCamera(
    videoEl: HTMLVideoElement,
    onResults: (result: HandLandmarkerResult, fps: number) => void
  ): Promise<boolean> {
    if (this.isStarting) {
      return false;
    }

    if (this.isRunning || this.stream || this.animationFrameId !== null) {
      this.stop();
    }

    this.isStarting = true;
    this.videoElement = videoEl;
    this.onResultsCallback = onResults;
    this.lastError = null;
    this.setPermissionStatus('checking');

    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        this.lastError = 'MediaDevices API unavailable. Ensure HTTPS or localhost context.';
        this.setPermissionStatus('unavailable');
        return false;
      }

      // Check iframe permissions policy if exposed by browser
      try {
        const docAny = document as unknown as {
          featurePolicy?: { allowsFeature?: (feature: string) => boolean };
          permissionsPolicy?: { allowsFeature?: (feature: string) => boolean };
        };
        const policy = docAny.permissionsPolicy || docAny.featurePolicy;
        if (policy?.allowsFeature && !policy.allowsFeature('camera')) {
          this.lastError = 'Camera access is blocked by the embedded frame permissions policy. Open the app in a new tab to enable optical tracking.';
          this.setPermissionStatus('denied');
          return false;
        }
      } catch {
        // ignore unsupported featurePolicy inspection
      }

      // Request camera permission immediately within user gesture first so browser prompt fires reliably
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: 'user',
            frameRate: { ideal: 30, max: 60 }
          },
          audio: false
        });
      } catch (err) {
        const errName = err instanceof Error ? err.name : '';
        if (errName === 'OverconstrainedError' || errName === 'ConstraintNotSatisfiedError') {
          try {
            this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          } catch (fallbackErr) {
            console.warn('Camera fallback unavailable:', fallbackErr);
            this.stop();
            this.lastError = this.formatMediaError(fallbackErr);
            this.setPermissionStatus(this.classifyMediaErrorStatus(fallbackErr));
            return false;
          }
        } else {
          console.warn('Camera permission or start unavailable:', err instanceof Error ? err.message : err);
          this.stop();
          this.lastError = this.formatMediaError(err);
          this.setPermissionStatus(this.classifyMediaErrorStatus(err));
          return false;
        }
      }

      this.attachStreamInterruptionHandlers(this.stream);

      try {
        this.videoElement.srcObject = this.stream;
        this.videoElement.muted = true;
        this.videoElement.playsInline = true;

        if ((this.videoElement.readyState ?? 0) < 2 && typeof this.videoElement.addEventListener === 'function') {
          await new Promise<void>((resolve) => {
            const el = this.videoElement;
            if (!el) return resolve();

            let settled = false;
            const finish = () => {
              if (settled) return;
              settled = true;
              el.removeEventListener('loadeddata', finish);
              el.removeEventListener('canplay', finish);
              el.removeEventListener('error', finish);
              resolve();
            };

            el.addEventListener('loadeddata', finish);
            el.addEventListener('canplay', finish);
            el.addEventListener('error', finish);
            setTimeout(finish, 3000);
          });
        }

        if (typeof this.videoElement.play === 'function') {
          await this.videoElement.play();
        }
      } catch (playErr) {
        console.warn('Video element playback failed:', playErr);
        this.stop();
        this.lastError = 'Camera stream acquired but video playback failed.';
        this.setPermissionStatus('error');
        return false;
      }

      const initialized = await this.initialize();
      if (!initialized || !this.handLandmarker) {
        console.warn('Cannot start tracking: HandLandmarker not initialized.');
        const initErr = this.lastError || 'Unable to initialize MediaPipe HandLandmarker model.';
        this.stop();
        this.lastError = initErr;
        this.setPermissionStatus('error');
        return false;
      }

      if (this.animationFrameId !== null) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
      }

      this.isRunning = true;
      this.lastTimestampMs = 0;
      this.lastVideoTime = -1;
      this.frameCount = 0;
      this.lastFpsUpdate = performance.now();
      this.setPermissionStatus('active');
      this.processVideo();
      return true;
    } finally {
      this.isStarting = false;
    }
  }

  private processVideo = () => {
    if (!this.isRunning || !this.videoElement || !this.handLandmarker) {
      this.animationFrameId = null;
      return;
    }

    let now = performance.now();
    // Guarantee strictly monotonically increasing timestamp for MediaPipe VIDEO mode
    if (now <= this.lastTimestampMs) {
      now = this.lastTimestampMs + 1;
    }
    this.lastTimestampMs = now;

    this.frameCount++;
    if (now - this.lastFpsUpdate >= 1000) {
      this.fps = Math.round((this.frameCount * 1000) / (now - this.lastFpsUpdate));
      this.frameCount = 0;
      this.lastFpsUpdate = now;
    }

    if (this.videoElement.currentTime !== this.lastVideoTime && (this.videoElement.readyState ?? 0) >= 2) {
      this.lastVideoTime = this.videoElement.currentTime;
      try {
        const results = this.handLandmarker.detectForVideo(this.videoElement, now);
        this.lastResult = results;
        if (this.isRunning && this.onResultsCallback) {
          this.onResultsCallback(results, this.fps);
        }
      } catch (detectionErr) {
        console.warn('Hand detection frame error:', detectionErr);
      }
    }

    if (this.isRunning) {
      this.animationFrameId = requestAnimationFrame(this.processVideo);
    } else {
      this.animationFrameId = null;
    }
  };

  public stop() {
    this.isRunning = false;
    this.onResultsCallback = null;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.trackEndedCleanup) {
      this.trackEndedCleanup();
      this.trackEndedCleanup = null;
    }
    if (this.videoElement) {
      try {
        if (typeof this.videoElement.pause === 'function') {
          this.videoElement.pause();
        }
      } catch {
        // ignore
      }
      this.videoElement.srcObject = null;
    }
    if (this.stream) {
      const tracks = typeof this.stream.getTracks === 'function' ? this.stream.getTracks() : [];
      tracks.forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      this.stream = null;
    }
    this.fps = 0;
    this.frameCount = 0;
    this.lastVideoTime = -1;
    this.lastTimestampMs = 0;
    if (this.permissionStatus === 'active') {
      this.setPermissionStatus('granted');
    }
  }

  public getFps(): number {
    return this.fps;
  }

  public isTracking(): boolean {
    return this.isRunning;
  }
}

export const handTrackingService = new HandTrackingService();
