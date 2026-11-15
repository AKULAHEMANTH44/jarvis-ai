import { describe, it, expect, vi, afterEach } from 'vitest';
import { HandTrackingService } from '../src/services/handTracking';

describe('HandTrackingService Camera Permission Handling', () => {
  const originalNavigator = globalThis.navigator;
  const originalDocument = globalThis.document;

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
  });

  it('handles NotAllowedError Permission denied gracefully without console.error', async () => {
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
    const fakeVideo = {} as HTMLVideoElement;
    const started = await service.startCamera(fakeVideo, () => {});

    expect(started).toBe(false);
    expect(service.getLastError()).toMatch(/permission denied/i);
    expect(errSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('handles unavailable MediaDevices cleanly', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      configurable: true
    });

    const service = new HandTrackingService();
    const fakeVideo = {} as HTMLVideoElement;
    const started = await service.startCamera(fakeVideo, () => {});

    expect(started).toBe(false);
    expect(service.getLastError()).toMatch(/MediaDevices API unavailable/i);
  });
});
