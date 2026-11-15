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
  offsetY?: number;
  rollAngle?: number; // angle in radians from vertical
}) {
  const {
    isPinching = false,
    isOpenPalm = false,
    isFist = false,
    isPointing = false,
    offsetZ = 0,
    offsetX = 0,
    offsetY = 0,
    rollAngle = 0
  } = options;

  // 21 landmarks
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5 + offsetX, y: 0.5 + offsetY, z: offsetZ }));

  // Wrist at (0.5, 0.8)
  landmarks[0] = { x: 0.5 + offsetX, y: 0.8 + offsetY, z: offsetZ };

  // Middle MCP (9) positioned relative to wrist according to rollAngle
  const mcpDist = 0.35;
  const rad = -Math.PI / 2 + rollAngle;
  landmarks[9] = {
    x: landmarks[0].x + Math.cos(rad) * mcpDist,
    y: landmarks[0].y + Math.sin(rad) * mcpDist,
    z: offsetZ
  };
  landmarks[5] = { x: landmarks[9].x - 0.08, y: landmarks[9].y, z: offsetZ };
  landmarks[17] = { x: landmarks[9].x + 0.08, y: landmarks[9].y, z: offsetZ };

  // Default relaxed natural pose (separated fingers, no accidental pinch)
  landmarks[4] = { x: landmarks[9].x - 0.15, y: landmarks[9].y - 0.1, z: offsetZ }; // Thumb
  landmarks[8] = { x: landmarks[9].x - 0.04, y: landmarks[9].y - 0.18, z: offsetZ }; // Index
  landmarks[12] = { x: landmarks[9].x, y: landmarks[9].y - 0.19, z: offsetZ }; // Middle
  landmarks[16] = { x: landmarks[9].x + 0.05, y: landmarks[9].y - 0.17, z: offsetZ }; // Ring
  landmarks[20] = { x: landmarks[9].x + 0.12, y: landmarks[9].y - 0.14, z: offsetZ }; // Pinky

  if (isOpenPalm) {
    // Fingertips extended far from wrist
    landmarks[4] = { x: landmarks[9].x - 0.2, y: landmarks[9].y - 0.15, z: offsetZ }; // Thumb
    landmarks[8] = { x: landmarks[9].x - 0.06, y: landmarks[9].y - 0.3, z: offsetZ }; // Index
    landmarks[12] = { x: landmarks[9].x, y: landmarks[9].y - 0.32, z: offsetZ }; // Middle
    landmarks[16] = { x: landmarks[9].x + 0.06, y: landmarks[9].y - 0.28, z: offsetZ }; // Ring
    landmarks[20] = { x: landmarks[9].x + 0.15, y: landmarks[9].y - 0.22, z: offsetZ }; // Pinky
  } else if (isFist) {
    // Fingertips curled right at wrist
    landmarks[4] = { x: landmarks[0].x - 0.02, y: landmarks[0].y - 0.05, z: offsetZ };
    landmarks[8] = { x: landmarks[0].x - 0.01, y: landmarks[0].y - 0.06, z: offsetZ };
    landmarks[12] = { x: landmarks[0].x, y: landmarks[0].y - 0.06, z: offsetZ };
    landmarks[16] = { x: landmarks[0].x + 0.01, y: landmarks[0].y - 0.05, z: offsetZ };
    landmarks[20] = { x: landmarks[0].x + 0.02, y: landmarks[0].y - 0.04, z: offsetZ };
  } else if (isPointing) {
    // Index and middle extended, ring and pinky curled
    landmarks[4] = { x: landmarks[0].x - 0.05, y: landmarks[0].y - 0.1, z: offsetZ };
    landmarks[8] = { x: landmarks[9].x - 0.05, y: landmarks[9].y - 0.28, z: offsetZ };
    landmarks[12] = { x: landmarks[9].x, y: landmarks[9].y - 0.29, z: offsetZ };
    landmarks[16] = { x: landmarks[0].x + 0.02, y: landmarks[0].y - 0.05, z: offsetZ };
    landmarks[20] = { x: landmarks[0].x + 0.03, y: landmarks[0].y - 0.04, z: offsetZ };
  } else if (isPinching) {
    // Thumb tip and Index tip touching
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

describe('GestureEngine Phase 2 Technical Validation', () => {
  let engine: GestureEngine;

  beforeEach(() => {
    engine = new GestureEngine();
    engine.resetCalibrationToDefaults();
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

  it('detects PINCH and produces valid frame-by-frame delta translations for MOVE_PINCHED', () => {
    // Frame 1: Initial pinch grab
    const h1 = createMockLandmarks({ isPinching: true, offsetX: 0 });
    const r1 = engine.processResults(createMockResult([h1]), 100);
    expect(r1.activeGesture).toBe('PINCH');
    expect(r1.hands[0].isPinching).toBe(true);

    // Frame 2: Move pinched hand slightly to right (X + 0.05)
    const h2 = createMockLandmarks({ isPinching: true, offsetX: 0.05 });
    const r2 = engine.processResults(createMockResult([h2]), 133);
    expect(r2.activeGesture).toBe('MOVE_PINCHED');
    expect(r2.deltaTranslation).toBeDefined();
    expect(r2.deltaTranslation!.x).toBeGreaterThan(0);

    // Frame 3: Move pinched hand slightly further (X + 0.07)
    const h3 = createMockLandmarks({ isPinching: true, offsetX: 0.07 });
    const r3 = engine.processResults(createMockResult([h3]), 166);
    expect(r3.activeGesture).toBe('MOVE_PINCHED');
    // Frame delta should be ~ (0.07 - 0.05) * 6 = 0.12, NOT cumulative runaway
    expect(r3.deltaTranslation!.x).toBeCloseTo(0.12, 1);
  });

  it('accurately normalizes wrist roll: upright hand is 0, tilted is non-zero', () => {
    // Upright hand
    const uprightHand = createMockLandmarks({ rollAngle: 0 });
    const rUpright = engine.processResults(createMockResult([uprightHand]), 100);
    expect(rUpright.hands[0].wristRotation.roll).toBeCloseTo(0, 1);

    // Hand tilted 45 degrees (+0.785 rad) on fresh engine
    const tiltedEngine = new GestureEngine();
    const tiltedHand = createMockLandmarks({ rollAngle: 0.785 });
    const rTilted = tiltedEngine.processResults(createMockResult([tiltedHand]), 100);
    expect(rTilted.hands[0].wristRotation.roll).toBeCloseTo(0.785, 1);
    expect(rTilted.activeGesture).toBe('ROTATE_WRIST');
  });

  it('detects TWO_FINGER_POINT when index and middle are extended and others curled', () => {
    const pointHand = createMockLandmarks({ isPointing: true });
    const result = engine.processResults(createMockResult([pointHand]), 100);
    expect(result.activeGesture).toBe('TWO_FINGER_POINT');
    expect(result.hands[0].isPointing).toBe(true);
  });

  it('detects TWO_OPEN_PALMS when both hands are open', () => {
    const hand1 = createMockLandmarks({ isOpenPalm: true, offsetX: -0.2 });
    const hand2 = createMockLandmarks({ isOpenPalm: true, offsetX: 0.2 });
    const result = engine.processResults(createMockResult([hand1, hand2]), 100);
    expect(result.activeGesture).toBe('TWO_OPEN_PALMS');
    expect(result.hands.length).toBe(2);
  });

  it('detects TWO_HAND_ZOOM when distance between hands changes smoothly', () => {
    const h1 = createMockLandmarks({ isOpenPalm: false, offsetX: -0.2 });
    const h2 = createMockLandmarks({ isOpenPalm: false, offsetX: 0.2 });
    engine.processResults(createMockResult([h1, h2]), 100);

    const h1Expanded = createMockLandmarks({ isOpenPalm: false, offsetX: -0.3 });
    const h2Expanded = createMockLandmarks({ isOpenPalm: false, offsetX: 0.3 });
    const result2 = engine.processResults(createMockResult([h1Expanded, h2Expanded]), 200);

    expect(result2.activeGesture).toBe('TWO_HAND_ZOOM');
    expect(result2.deltaScale).toBeGreaterThan(1.0);
  });

  it('enforces gesture cooldown on transient actions like PUSH_FORWARD and SWIPE', () => {
    // Frame 1: Hand push forward
    const h1 = createMockLandmarks({ isOpenPalm: true, offsetZ: 0.5 });
    engine.processResults(createMockResult([h1]), 100);

    // Frame 2 at z = 0.1 -> triggers PUSH_FORWARD
    const h2 = createMockLandmarks({ isOpenPalm: true, offsetZ: 0.1 });
    const r2 = engine.processResults(createMockResult([h2]), 133);
    expect(r2.activeGesture).toBe('PUSH_FORWARD');

    // Frame 3 only 50ms later -> cooldown should prevent duplicate shockwave trigger
    const h3 = createMockLandmarks({ isOpenPalm: true, offsetZ: 0.05 });
    const r3 = engine.processResults(createMockResult([h3]), 183);
    expect(r3.activeGesture).not.toBe('PUSH_FORWARD');
  });

  it('detects PULL_BACK on rapid positive Z movement away from camera', () => {
    const h1 = createMockLandmarks({ isOpenPalm: false, offsetZ: 0.1 });
    engine.processResults(createMockResult([h1]), 1000);

    const h2 = createMockLandmarks({ isOpenPalm: false, offsetZ: 0.5 });
    const r2 = engine.processResults(createMockResult([h2]), 1033);
    expect(r2.activeGesture).toBe('PULL_BACK');
  });

  it('handles hand-loss recovery cleanly when hand leaves sensor frame', () => {
    const hand = createMockLandmarks({ isPinching: true });
    engine.processResults(createMockResult([hand]), 100);

    // Hand leaves camera frame completely
    const emptyResult = engine.processResults(createMockResult([]), 133);
    expect(emptyResult.activeGesture).toBe('NONE');
    expect(emptyResult.hands.length).toBe(0);
    expect(emptyResult.description).toContain('Awaiting');
  });

  it('persists and restores calibration parameters', () => {
    engine.saveCalibration({ pinchThreshold: 0.095, pushSensitivity: -0.05 });
    expect(engine.getCalibration().pinchThreshold).toBe(0.095);
    expect(engine.getCalibration().pushSensitivity).toBe(-0.05);

    const restored = engine.resetCalibrationToDefaults();
    expect(restored.pinchThreshold).toBe(DEFAULT_CALIBRATION.pinchThreshold);
  });

  it('rotates sphere continuously right/left/up/down and flips horizontally when mirrorX is enabled', () => {
    engine.updateCalibration({ smoothingFactor: 1.0, mirrorX: false });
    engine.processResults(createMockResult([createMockLandmarks({ offsetX: 0, offsetY: 0 })]), 100);

    // Move right (+X) -> positive Y rotation
    const rightRes = engine.processResults(createMockResult([createMockLandmarks({ offsetX: 0.025 })]), 133);
    expect(rightRes.activeGesture).toBe('SPHERE_ROTATE');
    expect(rightRes.sphericalRotationDelta!.y).toBeGreaterThan(0);

    // Move left (-X) -> reverse direction
    const leftRes = engine.processResults(createMockResult([createMockLandmarks({ offsetX: -0.015 })]), 166);
    expect(leftRes.activeGesture).toBe('SPHERE_ROTATE');
    expect(leftRes.sphericalRotationDelta!.y).toBeLessThan(0);

    // Move up (-Y) -> negative X tilt
    const upRes = engine.processResults(createMockResult([createMockLandmarks({ offsetX: -0.015, offsetY: -0.025 })]), 200);
    expect(upRes.activeGesture).toBe('SPHERE_ROTATE');
    expect(upRes.sphericalRotationDelta!.x).toBeLessThan(0);

    // Move down (+Y) -> positive X tilt
    const downRes = engine.processResults(createMockResult([createMockLandmarks({ offsetX: -0.015, offsetY: 0.015 })]), 233);
    expect(downRes.activeGesture).toBe('SPHERE_ROTATE');
    expect(downRes.sphericalRotationDelta!.x).toBeGreaterThan(0);

    // Mirror webcam mode: raw +X movement rotates sphere left (-Y) so physical right rotates right
    const mirrored = new GestureEngine();
    mirrored.updateCalibration({ smoothingFactor: 1.0, mirrorX: true });
    mirrored.processResults(createMockResult([createMockLandmarks({ offsetX: 0 })]), 100);
    const mirRes = mirrored.processResults(createMockResult([createMockLandmarks({ offsetX: -0.025 })]), 133);
    expect(mirRes.activeGesture).toBe('SPHERE_ROTATE');
    expect(mirRes.sphericalRotationDelta!.y).toBeGreaterThan(0);
  });

  it('prevents drift inside dead zone and clamps extreme velocities via EMA smoothing', () => {
    engine.updateCalibration({ smoothingFactor: 1.0, rotationDeadZone: 0.005, maxRotationSpeed: 0.15 });
    engine.processResults(createMockResult([createMockLandmarks({ offsetX: 0, isOpenPalm: true })]), 100);

    // Jitter smaller than dead zone -> zero rotation drift
    const jitter = engine.processResults(createMockResult([createMockLandmarks({ offsetX: 0.002, isOpenPalm: true })]), 133);
    expect(jitter.activeGesture).toBe('OPEN_PALM');
    expect(jitter.sphericalRotationDelta).toBeUndefined();

    // Large spike clamps safely below maxRotationSpeed
    const spike = engine.processResults(createMockResult([createMockLandmarks({ offsetX: 0.35 })]), 166);
    expect(Math.abs(spike.sphericalRotationDelta?.y || 0)).toBeLessThanOrEqual(0.15);
  });

  it('supports neutral anchor calibration and jump-free recovery after tracking loss', () => {
    engine.updateCalibration({ smoothingFactor: 1.0 });
    engine.processResults(createMockResult([createMockLandmarks({ offsetX: 0.1 })]), 100);
    expect(engine.getNeutralAnchor()).not.toBeNull();

    engine.recalibrateNeutral();
    expect(engine.getNeutralAnchor()).toBeNull();

    // Active frame then hand disappears -> trackingLost = true
    engine.processResults(createMockResult([createMockLandmarks({ offsetX: 0.1 })]), 133);
    const lost = engine.processResults(createMockResult([]), 166);
    expect(lost.trackingLost).toBe(true);
    expect(lost.activeGesture).toBe('NONE');

    // Hand re-appears at different coordinates -> no sudden rotation jump on re-entry frame
    const reacquired = engine.processResults(createMockResult([createMockLandmarks({ offsetX: -0.2 })]), 200);
    expect(reacquired.trackingLost).toBe(false);
    expect(reacquired.sphericalRotationDelta).toBeUndefined();
  });

  it('normalizes two-hand separation for continuous dispersion with hysteresis and two-hand priority', () => {
    engine.updateCalibration({
      smoothingFactor: 1.0,
      dispersionSmoothing: 1.0,
      twoHandMinDist: 0.15,
      twoHandMaxDist: 0.65
    });

    // Hands close together -> dispersion near 0 (COMPLETE)
    const close1 = createMockLandmarks({ isPinching: true, offsetX: -0.075 });
    const close2 = createMockLandmarks({ offsetX: 0.075 });
    const resClose = engine.processResults(createMockResult([close1, close2]), 100);
    expect(resClose.activeGesture).toBe('TWO_HAND_ZOOM'); // priority over single-hand PINCH
    expect(resClose.dispersionControl?.dispersion).toBeCloseTo(0, 2);
    expect(resClose.dispersionControl?.phase).toBe('COMPLETE');

    // Mid-range separation (~0.40 -> normalized 0.50); allow EMA to settle
    const midStart1 = createMockLandmarks({ offsetX: -0.20 });
    const midStart2 = createMockLandmarks({ offsetX: 0.20 });
    engine.processResults(createMockResult([midStart1, midStart2]), 130);
    engine.processResults(createMockResult([midStart1, midStart2]), 140);
    const resMidStart = engine.processResults(createMockResult([midStart1, midStart2]), 150);
    expect(resMidStart.dispersionControl?.dispersion).toBeCloseTo(0.5, 1);

    // Minor hand tremor (~0.004 distance -> 0.508) stays inside hysteresis band without flickering dispersion
    const tremor1 = createMockLandmarks({ offsetX: -0.202 });
    const tremor2 = createMockLandmarks({ offsetX: 0.202 });
    const resTremor = engine.processResults(createMockResult([tremor1, tremor2]), 165);
    expect(resTremor.dispersionControl?.dispersion).toBe(resMidStart.dispersionControl?.dispersion);

    // Spread hands wide -> dispersion increases smoothly toward 1.0 (DISPERSED)
    const wide1 = createMockLandmarks({ offsetX: -0.35 });
    const wide2 = createMockLandmarks({ offsetX: 0.35 });
    const resWide = engine.processResults(createMockResult([wide1, wide2]), 180);
    expect(resWide.dispersionControl?.dispersion).toBeGreaterThanOrEqual(0.95);
    expect(resWide.dispersionControl?.phase).toBe('DISPERSED');

    // Bring hands halfway back together -> RECONSTRUCTING
    const mid1 = createMockLandmarks({ offsetX: -0.18 });
    const mid2 = createMockLandmarks({ offsetX: 0.18 });
    const resMid = engine.processResults(createMockResult([mid1, mid2]), 220);
    expect(resMid.dispersionControl?.dispersion).toBeGreaterThan(0.2);
    expect(resMid.dispersionControl?.dispersion).toBeLessThan(0.8);
    expect(resMid.dispersionControl?.phase).toBe('RECONSTRUCTING');
  });

  it('prevents rotation spikes, swipe misfires, and cross-hand blending across SPHERE_ROTATE <-> TWO_HAND_ZOOM transitions', () => {
    engine.updateCalibration({ smoothingFactor: 0.65, mirrorX: false });

    // 1. Single hand rotating sphere strongly to the right -> builds up smoothedRotVel
    const r0 = createMockLandmarks({ offsetX: 0.20 });
    const r1 = createMockLandmarks({ offsetX: 0.24 });
    engine.processResults(createMockResult([r0]), 100);
    const spin = engine.processResults(createMockResult([r1]), 133);
    expect(spin.activeGesture).toBe('SPHERE_ROTATE');
    expect(spin.sphericalRotationDelta!.y).toBeGreaterThan(0);

    // 2. Second hand (Left at -0.25) enters at slot 0, pushing Right (+0.24) to slot 1, then spreads apart -> TWO_HAND_ZOOM
    const leftHand1 = createMockLandmarks({ offsetX: -0.25 });
    const rightHand1 = createMockLandmarks({ offsetX: 0.24 });
    engine.processResults(
      {
        landmarks: [leftHand1, rightHand1],
        worldLandmarks: [leftHand1, rightHand1],
        handednesses: [
          [{ index: 0, score: 0.98, categoryName: 'Left', displayName: 'Left' }],
          [{ index: 1, score: 0.98, categoryName: 'Right', displayName: 'Right' }]
        ]
      },
      166
    );
    const leftHand2 = createMockLandmarks({ offsetX: -0.35 });
    const rightHand2 = createMockLandmarks({ offsetX: 0.24 });
    const zoom2 = engine.processResults(
      {
        landmarks: [leftHand2, rightHand2],
        worldLandmarks: [leftHand2, rightHand2],
        handednesses: [
          [{ index: 0, score: 0.98, categoryName: 'Left', displayName: 'Left' }],
          [{ index: 1, score: 0.98, categoryName: 'Right', displayName: 'Right' }]
        ]
      },
      200
    );
    expect(zoom2.activeGesture).toBe('TWO_HAND_ZOOM');
    expect(zoom2.sphericalRotationDelta).toBeUndefined();
    // Slot matching preserves exact centroids without cross-hand Left/Right blending
    expect(zoom2.hands[0].centroid.x).toBeCloseTo(0.18, 1);
    expect(zoom2.hands[1].centroid.x).toBeCloseTo(0.74, 1);

    // 3. Left hand leaves camera frame -> Right hand swaps back into rawHands[0]
    const rightOnlyResult: HandLandmarkerResult = {
      landmarks: [createMockLandmarks({ offsetX: 0.24 })],
      worldLandmarks: [createMockLandmarks({ offsetX: 0.24 })],
      handednesses: [[{ index: 0, score: 0.98, categoryName: 'Right', displayName: 'Right' }]]
    };
    const exitFrame1 = engine.processResults(rightOnlyResult, 200);
    // Must stay matched to Right hand (~0.74), NOT interpolated from Left (~0.25)
    expect(exitFrame1.hands[0].centroid.x).toBeCloseTo(0.74, 1);
    expect(exitFrame1.sphericalRotationDelta).toBeUndefined();
    expect(exitFrame1.activeGesture).not.toBe('SWIPE_RIGHT');
    expect(exitFrame1.activeGesture).not.toBe('SPHERE_ROTATE');

    // Second stabilization frame absorbs transition tremor without rotation spike
    const exitFrame2 = engine.processResults(rightOnlyResult, 233);
    expect(exitFrame2.sphericalRotationDelta).toBeUndefined();

    // 4. Subsequent stationary hand does NOT replay stale rotational velocity from before TWO_HAND_ZOOM
    const stationary = engine.processResults(rightOnlyResult, 266);
    expect(stationary.sphericalRotationDelta).toBeUndefined();

    // 5. Moving LEFT (-X) rotates smoothly negatively (zero stale +Y spike from step 1)
    const moveLeftResult: HandLandmarkerResult = {
      landmarks: [createMockLandmarks({ offsetX: 0.21 })],
      worldLandmarks: [createMockLandmarks({ offsetX: 0.21 })],
      handednesses: [[{ index: 0, score: 0.98, categoryName: 'Right', displayName: 'Right' }]]
    };
    const resumed = engine.processResults(moveLeftResult, 300);
    expect(resumed.activeGesture).toBe('SPHERE_ROTATE');
    expect(resumed.sphericalRotationDelta!.y).toBeLessThan(0);
  });
});
