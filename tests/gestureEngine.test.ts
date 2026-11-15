import { describe, it, expect, beforeEach } from 'vitest';
import { GestureEngine, DEFAULT_CALIBRATION } from '../src/services/gestureEngine';
import { HandLandmarkerResult } from '@mediapipe/tasks-vision';

// Helper to generate normalized hand landmarks
function createMockLandmarks(options: {
  isPinching?: boolean;
  isOpenPalm?: boolean;
  isFist?: boolean;
  isPointing?: boolean;
  offsetZ?: number;
  offsetX?: number;
}) {
  const {
    isPinching = false,
    isOpenPalm = false,
    isFist = false,
    offsetZ = 0,
    offsetX = 0
  } = options;

  // 21 landmarks
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5 + offsetX, y: 0.5, z: offsetZ }));

  // Wrist at (0.5, 0.8)
  landmarks[0] = { x: 0.5 + offsetX, y: 0.8, z: offsetZ };

  if (isOpenPalm) {
    // Fingertips extended far from wrist
    landmarks[4] = { x: 0.3 + offsetX, y: 0.4, z: offsetZ }; // Thumb
    landmarks[8] = { x: 0.45 + offsetX, y: 0.2, z: offsetZ }; // Index
    landmarks[12] = { x: 0.5 + offsetX, y: 0.18, z: offsetZ }; // Middle
    landmarks[16] = { x: 0.55 + offsetX, y: 0.22, z: offsetZ }; // Ring
    landmarks[20] = { x: 0.65 + offsetX, y: 0.25, z: offsetZ }; // Pinky
  } else if (isFist) {
    // Fingertips curled right at palm/wrist
    landmarks[4] = { x: 0.48 + offsetX, y: 0.75, z: offsetZ };
    landmarks[8] = { x: 0.49 + offsetX, y: 0.74, z: offsetZ };
    landmarks[12] = { x: 0.5 + offsetX, y: 0.74, z: offsetZ };
    landmarks[16] = { x: 0.51 + offsetX, y: 0.75, z: offsetZ };
    landmarks[20] = { x: 0.52 + offsetX, y: 0.76, z: offsetZ };
  } else if (isPinching) {
    // Thumb tip and Index tip touching (distance < 0.03)
    landmarks[4] = { x: 0.45 + offsetX, y: 0.5, z: offsetZ };
    landmarks[8] = { x: 0.455 + offsetX, y: 0.505, z: offsetZ };
  }

  return landmarks;
}

function createMockResult(hands: ReturnType<typeof createMockLandmarks>[]): HandLandmarkerResult {
  return {
    landmarks: hands,
    worldLandmarks: hands,
    handednesses: hands.map((_, i) => [{
      index: i,
      score: 0.98,
      categoryName: i === 0 ? 'Right' : 'Left',
      displayName: i === 0 ? 'Right' : 'Left'
    }])
  };
}

describe('GestureEngine', () => {
  let engine: GestureEngine;

  beforeEach(() => {
    engine = new GestureEngine();
  });

  it('detects OPEN_PALM when all fingers are extended', () => {
    const hand = createMockLandmarks({ isOpenPalm: true });
    const result = engine.processResults(createMockResult([hand]), 100);
    expect(result.activeGesture).toBe('OPEN_PALM');
    expect(result.hands[0].isOpenPalm).toBe(true);
  });

  it('detects CLOSED_FIST when fingertips are curled into palm', () => {
    const hand = createMockLandmarks({ isFist: true });
    const result = engine.processResults(createMockResult([hand]), 100);
    expect(result.activeGesture).toBe('CLOSED_FIST');
    expect(result.hands[0].isFist).toBe(true);
  });

  it('detects PINCH when thumb and index tips are close', () => {
    const hand = createMockLandmarks({ isPinching: true });
    const result = engine.processResults(createMockResult([hand]), 100);
    expect(result.activeGesture).toBe('PINCH');
    expect(result.hands[0].isPinching).toBe(true);
  });

  it('detects TWO_OPEN_PALMS when both hands are open', () => {
    const hand1 = createMockLandmarks({ isOpenPalm: true, offsetX: -0.2 });
    const hand2 = createMockLandmarks({ isOpenPalm: true, offsetX: 0.2 });
    const result = engine.processResults(createMockResult([hand1, hand2]), 100);
    expect(result.activeGesture).toBe('TWO_OPEN_PALMS');
    expect(result.hands.length).toBe(2);
  });

  it('detects TWO_HAND_ZOOM when distance between hands changes', () => {
    // Frame 1: distance = 0.4
    const h1 = createMockLandmarks({ isOpenPalm: false, offsetX: -0.2 });
    const h2 = createMockLandmarks({ isOpenPalm: false, offsetX: 0.2 });
    engine.processResults(createMockResult([h1, h2]), 100);

    // Frame 2: distance expands to 0.6
    const h1Expanded = createMockLandmarks({ isOpenPalm: false, offsetX: -0.3 });
    const h2Expanded = createMockLandmarks({ isOpenPalm: false, offsetX: 0.3 });
    const result2 = engine.processResults(createMockResult([h1Expanded, h2Expanded]), 200);

    expect(result2.activeGesture).toBe('TWO_HAND_ZOOM');
    expect(result2.deltaScale).toBeGreaterThan(1.0);
  });

  it('detects PUSH_FORWARD on rapid negative Z velocity with open palm', () => {
    // Frame 1 at z = 0.5
    const h1 = createMockLandmarks({ isOpenPalm: true, offsetZ: 0.5 });
    engine.processResults(createMockResult([h1]), 100);

    // Frame 2 at z = 0.1 (moved rapidly toward camera)
    const h2 = createMockLandmarks({ isOpenPalm: true, offsetZ: 0.1 });
    const result2 = engine.processResults(createMockResult([h2]), 200);

    expect(result2.activeGesture).toBe('PUSH_FORWARD');
  });

  it('detects PULL_BACK on rapid positive Z velocity', () => {
    // Frame 1 at z = 0.1
    const h1 = createMockLandmarks({ isOpenPalm: false, offsetZ: 0.1 });
    engine.processResults(createMockResult([h1]), 100);

    // Frame 2 at z = 0.5 (pulled away from camera)
    const h2 = createMockLandmarks({ isOpenPalm: false, offsetZ: 0.5 });
    const result2 = engine.processResults(createMockResult([h2]), 200);

    expect(result2.activeGesture).toBe('PULL_BACK');
  });

  it('updates calibration settings dynamically', () => {
    engine.updateCalibration({ pinchThreshold: 0.08 });
    expect(engine.getCalibration().pinchThreshold).toBe(0.08);
  });
});
