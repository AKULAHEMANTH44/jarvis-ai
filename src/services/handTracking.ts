import { FilesetResolver, HandLandmarker, HandLandmarkerResult } from '@mediapipe/tasks-vision';

export class HandTrackingService {
  private handLandmarker: HandLandmarker | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private isRunning: boolean = false;
  private stream: MediaStream | null = null;
  private animationFrameId: number | null = null;
  private lastVideoTime: number = -1;
  private lastTimestampMs: number = 0;
  private fps: number = 0;
  private frameCount: number = 0;
  private lastFpsUpdate: number = performance.now();
  private onResultsCallback: ((result: HandLandmarkerResult, fps: number) => void) | null = null;
  private isInitializing: boolean = false;
  private lastError: string | null = null;

  public getLastError(): string | null {
    return this.lastError;
  }

  public async getCameraPermissionState(): Promise<PermissionState | 'unsupported'> {
    if (typeof navigator === 'undefined' || !navigator.permissions) return 'unsupported';
    try {
      const status = await navigator.permissions.query({ name: 'camera' as PermissionName });
      return status.state;
    } catch {
      return 'unsupported';
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

      // 1. Try local model with GPU
      try {
        this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: localModel, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5
        });
      } catch {
        // 2. Try local model with CPU (important for environments without WebGL GPU delegate)
        try {
          this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: localModel, delegate: 'CPU' },
            runningMode: 'VIDEO',
            numHands: 2,
            minHandDetectionConfidence: 0.5,
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.5
          });
        } catch {
          // 3. Fallback to remote model with CPU
          try {
            this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
              baseOptions: { modelAssetPath: remoteModel, delegate: 'CPU' },
              runningMode: 'VIDEO',
              numHands: 2,
              minHandDetectionConfidence: 0.5,
              minHandPresenceConfidence: 0.5,
              minTrackingConfidence: 0.5
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

  public async startCamera(
    videoEl: HTMLVideoElement,
    onResults: (result: HandLandmarkerResult, fps: number) => void
  ): Promise<boolean> {
    this.videoElement = videoEl;
    this.onResultsCallback = onResults;
    this.lastError = null;

    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.lastError = 'MediaDevices API unavailable. Ensure HTTPS or localhost context.';
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
          this.lastError = this.formatMediaError(fallbackErr);
          this.stop();
          return false;
        }
      } else {
        console.warn('Camera permission or start unavailable:', err instanceof Error ? err.message : err);
        this.lastError = this.formatMediaError(err);
        this.stop();
        return false;
      }
    }

    try {
      this.videoElement.srcObject = this.stream;
      this.videoElement.muted = true;
      this.videoElement.playsInline = true;

      if (this.videoElement.readyState < 2) {
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

      await this.videoElement.play();
    } catch (playErr) {
      console.warn('Video element playback failed:', playErr);
      this.lastError = 'Camera stream acquired but video playback failed.';
      this.stop();
      return false;
    }

    const initialized = await this.initialize();
    if (!initialized || !this.handLandmarker) {
      console.warn('Cannot start tracking: HandLandmarker not initialized.');
      this.stop();
      return false;
    }

    this.isRunning = true;
    this.lastTimestampMs = 0;
    this.lastVideoTime = -1;
    this.processVideo();
    return true;
  }

  private processVideo = () => {
    if (!this.isRunning || !this.videoElement || !this.handLandmarker) return;

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

    if (this.videoElement.currentTime !== this.lastVideoTime && this.videoElement.readyState >= 2) {
      this.lastVideoTime = this.videoElement.currentTime;
      try {
        const results = this.handLandmarker.detectForVideo(this.videoElement, now);
        if (this.onResultsCallback) {
          this.onResultsCallback(results, this.fps);
        }
      } catch (detectionErr) {
        console.warn('Hand detection frame error:', detectionErr);
      }
    }

    this.animationFrameId = requestAnimationFrame(this.processVideo);
  };

  public stop() {
    this.isRunning = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.videoElement) {
      try {
        this.videoElement.pause();
      } catch {
        // ignore
      }
      this.videoElement.srcObject = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      this.stream = null;
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
