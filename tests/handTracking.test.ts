import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { CameraPermissionStatus, HandTrackingService } from '../src/services/handTracking';

function createMockVideoElement(overrides: Partial<HTMLVideoElement> = {}): HTMLVideoElement {
  return {
    readyState: 2,
    currentTime: 0.1,
    srcObject: null,
    muted: false,
    playsInline: false,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    ...overrides
  } as unknown as HTMLVideoElement;
}

function createMockStream() {
  const endedListeners: Array<() => void> = [];
  const mockTrack = {
    kind: 'video',
    stop: vi.fn(),
    addEventListener: vi.fn((evt: string, fn: () => void) => {
      if (evt === 'ended') endedListeners.push(fn);
    }),
    removeEventListener: vi.fn((evt: string, fn: () => void) => {
      if (evt === 'ended') {
        const idx = endedListeners.indexOf(fn);
        if (idx >= 0) endedListeners.splice(idx, 1);
      }
    })
  } as unknown as MediaStreamTrack;

  const mockStream = {
    getTracks: vi.fn(() => [mockTrack]),
    getVideoTracks: vi.fn(() => [mockTrack])
  } as unknown as MediaStream;

  return {
    mockStream,
    mockTrack,
    triggerEnded: () => {
      [...endedListeners].forEach((fn) => fn());
    }
  };
}

describe('HandTrackingService Camera & MediaPipe Gesture Initialization (Mocked Runtime)', () => {
  const originalNavigator = globalThis.navigator;
  const originalDocument = globalThis.document;
  const originalRaf = globalThis.requestAnimationFrame;
  const originalCancelRaf = globalThis.cancelAnimationFrame;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true
    });
    Object.defineProperty(globalThis, 'document', {
      value: originalDocument,
      configurable: true
    });
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancelRaf;
  });

  it('handles NotAllowedError Permission denied gracefully and sets denied status', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: {
          getUserMedia: vi.fn().mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'))
        }
      },
      configurable: true
    });
    Object.defineProperty(globalThis, 'document', {
      value: {},
      configurable: true
    });

    const service = new HandTrackingService();
    const statuses: CameraPermissionStatus[] = [];
    service.setPermissionChangeCallback((s) => statuses.push(s));

    const fakeVideo = {} as HTMLVideoElement;
    const started = await service.startCamera(fakeVideo, () => {});

    expect(started).toBe(false);
    expect(service.getLastError()).toMatch(/permission denied/i);
    expect(service.getPermissionStatus()).toBe('denied');
    expect(statuses).toContain('checking');
    expect(statuses).toContain('denied');
    expect(errSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('handles unavailable MediaDevices cleanly with unavailable status', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      configurable: true
    });

    const service = new HandTrackingService();
    const fakeVideo = {} as HTMLVideoElement;
    const started = await service.startCamera(fakeVideo, () => {});

    expect(started).toBe(false);
    expect(service.getLastError()).toMatch(/MediaDevices API unavailable/i);
    expect(service.getPermissionStatus()).toBe('unavailable');
  });

  it('handles NotFoundError and NotReadableError hardware errors cleanly', async () => {
    Object.defineProperty(globalThis, 'document', { value: {}, configurable: true });

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: {
          getUserMedia: vi.fn().mockRejectedValue(new DOMException('No device', 'NotFoundError'))
        }
      },
      configurable: true
    });

    const service = new HandTrackingService();
    expect(await service.startCamera(createMockVideoElement(), () => {})).toBe(false);
    expect(service.getPermissionStatus()).toBe('unavailable');
    expect(service.getLastError()).toMatch(/no camera hardware/i);

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: {
          getUserMedia: vi.fn().mockRejectedValue(new DOMException('Busy', 'NotReadableError'))
        }
      },
      configurable: true
    });

    expect(await service.startCamera(createMockVideoElement(), () => {})).toBe(false);
    expect(service.getPermissionStatus()).toBe('error');
    expect(service.getLastError()).toMatch(/in use by another application/i);
  });

  it('queries browser camera permission state cleanly', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: { getUserMedia: vi.fn() },
        permissions: {
          query: vi.fn().mockResolvedValue({ state: 'granted', onchange: null })
        }
      },
      configurable: true
    });

    const service = new HandTrackingService();
    const state = await service.getCameraPermissionState();
    expect(state).toBe('granted');
    expect(service.getPermissionStatus()).toBe('granted');
  });

  it('initializes MediaPipe HandLandmarker with CPU fallback and caches instance without duplicate init', async () => {
    const forVisionTasks = vi.spyOn(FilesetResolver, 'forVisionTasks').mockResolvedValue({} as never);
    const fakeLandmarker = {
      detectForVideo: vi.fn(() => ({ landmarks: [], worldLandmarks: [], handednesses: [], handedness: [] })),
      setOptions: vi.fn().mockResolvedValue(undefined)
    };
    const createFromOptions = vi
      .spyOn(HandLandmarker, 'createFromOptions')
      .mockRejectedValueOnce(new Error('GPU delegate unavailable'))
      .mockResolvedValueOnce(fakeLandmarker as unknown as HandLandmarker);

    const service = new HandTrackingService();
    const [ok1, ok2] = await Promise.all([service.initialize(), service.initialize()]);

    expect(ok1).toBe(true);
    expect(ok2).toBe(true);
    expect(forVisionTasks).toHaveBeenCalledWith('/wasm');
    // 1 failed GPU call + 1 successful CPU call; concurrent second call did not re-init
    expect(createFromOptions).toHaveBeenCalledTimes(2);
    expect(createFromOptions.mock.calls[1][1]?.baseOptions?.delegate).toBe('CPU');
  });

  it('starts webcam stream, runs detection loop, rebinds video elements, and stops tracks cleanly', async () => {
    const { mockStream, mockTrack } = createMockStream();
    const getUserMedia = vi.fn().mockResolvedValue(mockStream);

    Object.defineProperty(globalThis, 'navigator', {
      value: { mediaDevices: { getUserMedia } },
      configurable: true
    });
    Object.defineProperty(globalThis, 'document', { value: {}, configurable: true });

    let nextRafId = 100;
    const queuedFrames: Array<{ id: number; cb: FrameRequestCallback }> = [];
    globalThis.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
      const id = ++nextRafId;
      queuedFrames.push({ id, cb });
      return id;
    });
    const cancelRafSpy = vi.fn();
    globalThis.cancelAnimationFrame = cancelRafSpy;

    vi.spyOn(FilesetResolver, 'forVisionTasks').mockResolvedValue({} as never);
    const detectForVideo = vi.fn(() => ({
      landmarks: [[{ x: 0.5, y: 0.5, z: 0 }]],
      worldLandmarks: [],
      handednesses: [[{ score: 0.96, index: 0, categoryName: 'Right', displayName: 'Right' }]],
      handedness: [[{ score: 0.96, index: 0, categoryName: 'Right', displayName: 'Right' }]]
    }));
    vi.spyOn(HandLandmarker, 'createFromOptions').mockResolvedValue({
      detectForVideo,
      setOptions: vi.fn().mockResolvedValue(undefined)
    } as unknown as HandLandmarker);

    const videoEl = createMockVideoElement({ currentTime: 0.25 });
    const onResults = vi.fn();
    const service = new HandTrackingService();

    const started = await service.startCamera(videoEl, onResults);
    expect(started).toBe(true);
    expect(service.isTracking()).toBe(true);
    expect(service.getPermissionStatus()).toBe('active');
    expect(videoEl.srcObject).toBe(mockStream);
    expect(videoEl.play).toHaveBeenCalledTimes(1);
    expect(detectForVideo).toHaveBeenCalledTimes(1);
    expect(onResults).toHaveBeenCalledTimes(1);

    // Rebind active stream onto another newly mounted video element cleanly
    const secondaryVideo = createMockVideoElement({ currentTime: 0.5 });
    const rebound = await service.attachVideoElement(secondaryVideo);
    expect(rebound).toBe(true);
    expect(secondaryVideo.srcObject).toBe(mockStream);
    expect(secondaryVideo.play).toHaveBeenCalledTimes(1);

    // Stop camera and confirm track + RAF + srcObject cleanup
    service.stop();
    expect(service.isTracking()).toBe(false);
    expect(mockTrack.stop).toHaveBeenCalledTimes(1);
    expect(secondaryVideo.srcObject).toBeNull();
    expect(cancelRafSpy).toHaveBeenCalled();
    expect(service.getPermissionStatus()).toBe('granted');
  });

  it('recovers cleanly when active camera track is interrupted mid-session', async () => {
    const { mockStream, triggerEnded } = createMockStream();
    Object.defineProperty(globalThis, 'navigator', {
      value: { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(mockStream) } },
      configurable: true
    });
    Object.defineProperty(globalThis, 'document', { value: {}, configurable: true });
    globalThis.requestAnimationFrame = vi.fn(() => 42);
    globalThis.cancelAnimationFrame = vi.fn();

    vi.spyOn(FilesetResolver, 'forVisionTasks').mockResolvedValue({} as never);
    vi.spyOn(HandLandmarker, 'createFromOptions').mockResolvedValue({
      detectForVideo: vi.fn(() => ({ landmarks: [], worldLandmarks: [], handednesses: [], handedness: [] })),
      setOptions: vi.fn().mockResolvedValue(undefined)
    } as unknown as HandLandmarker);

    const service = new HandTrackingService();
    const interruptedSpy = vi.fn();
    service.setInterruptionCallback(interruptedSpy);

    const ok = await service.startCamera(createMockVideoElement(), () => {});
    expect(ok).toBe(true);

    triggerEnded();

    expect(service.isTracking()).toBe(false);
    expect(service.getPermissionStatus()).toBe('error');
    expect(interruptedSpy).toHaveBeenCalledWith(expect.stringMatching(/interrupted/i));
  });
});
