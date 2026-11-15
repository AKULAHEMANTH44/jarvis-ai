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

  public async initialize(): Promise<boolean> {
    if (this.handLandmarker) return true;
    if (this.isInitializing) return false;

    this.isInitializing = true;
    try {
      // First try local wasm in /wasm, fallback to CDN
      let vision = null;
      try {
        vision = await FilesetResolver.forVisionTasks('/wasm');
      } catch {
        console.warn('Local wasm failed, falling back to Google CDN...');
        vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
      }

      // Try local model first, then fallback to storage URL
      const modelAssetPath = '/models/hand_landmarker.task';
      try {
        this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: modelAssetPath,
            delegate: 'GPU'
          },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5
        });
      } catch (gpuError) {
        console.warn('GPU delegate failed or local model issue, attempting CPU / fallback URL:', gpuError);
        try {
          this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
              delegate: 'CPU'
            },
            runningMode: 'VIDEO',
            numHands: 2,
            minHandDetectionConfidence: 0.5,
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.5
          });
        } catch (cpuError) {
          console.error('HandLandmarker initialization failed completely:', cpuError);
          this.isInitializing = false;
          return false;
        }
      }

      this.isInitializing = false;
      return true;
    } catch (err) {
      console.error('Failed to initialize FilesetResolver:', err);
      this.isInitializing = false;
      return false;
    }
  }

  public async startCamera(videoEl: HTMLVideoElement, onResults: (result: HandLandmarkerResult, fps: number) => void): Promise<boolean> {
    this.videoElement = videoEl;
    this.onResultsCallback = onResults;

    const initialized = await this.initialize();
    if (!initialized || !this.handLandmarker) {
      console.error('Cannot start tracking: HandLandmarker not initialized.');
      return false;
    }

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

      this.videoElement.srcObject = this.stream;
      await new Promise<void>((resolve) => {
        if (!this.videoElement) return resolve();
        this.videoElement.onloadeddata = () => resolve();
      });

      await this.videoElement.play();
      this.isRunning = true;
      this.lastTimestampMs = 0;
      this.processVideo();
      return true;
    } catch (err) {
      console.error('Camera permission or start failed:', err);
      this.stop();
      return false;
    }
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
      this.stream.getTracks().forEach((track) => track.stop());
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
