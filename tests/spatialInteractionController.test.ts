import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { GestureEngine, DEFAULT_CALIBRATION } from '../src/services/gestureEngine';
import { SpatialInteractionController } from '../src/services/spatialInteractionController';
import { RingGimbalsEffect } from '../src/three/effects/RingGimbals';
import { HandLandmarkerResult } from '@mediapipe/tasks-vision';
import { GestureDetectionResult } from '../src/types/gesture';

function makeHandLandmarks(opts: {
  offsetX?: number;
  offsetY?: number;
  offsetZ?: number;
  rollAngle?: number;
  isOpenPalm?: boolean;
  isPinching?: boolean;
  isFist?: boolean;
}) {
  const {
    offsetX = 0,
    offsetY = 0,
    offsetZ = 0,
    rollAngle = 0,
    isOpenPalm = false,
    isPinching = false,
    isFist = false
  } = opts;
  const lm = Array.from({ length: 21 }, () => ({ x: 0.5 + offsetX, y: 0.5 + offsetY, z: offsetZ }));
  lm[0] = { x: 0.5 + offsetX, y: 0.8 + offsetY, z: offsetZ };
  const mcpDist = 0.35;
  const rad = -Math.PI / 2 + rollAngle;
  lm[9] = {
    x: lm[0].x + Math.cos(rad) * mcpDist,
    y: lm[0].y + Math.sin(rad) * mcpDist,
    z: offsetZ
  };
  lm[5] = { x: lm[9].x - 0.08, y: lm[9].y, z: offsetZ };
  lm[17] = { x: lm[9].x + 0.08, y: lm[9].y, z: offsetZ };

  lm[4] = { x: lm[9].x - 0.15, y: lm[9].y - 0.1, z: offsetZ };
  lm[8] = { x: lm[9].x - 0.04, y: lm[9].y - 0.18, z: offsetZ };
  lm[12] = { x: lm[9].x, y: lm[9].y - 0.19, z: offsetZ };
  lm[16] = { x: lm[9].x + 0.05, y: lm[9].y - 0.17, z: offsetZ };
  lm[20] = { x: lm[9].x + 0.12, y: lm[9].y - 0.14, z: offsetZ };

  if (isOpenPalm) {
    lm[4] = { x: lm[9].x - 0.2, y: lm[9].y - 0.15, z: offsetZ };
    lm[8] = { x: lm[9].x - 0.06, y: lm[9].y - 0.3, z: offsetZ };
    lm[12] = { x: lm[9].x, y: lm[9].y - 0.32, z: offsetZ };
    lm[16] = { x: lm[9].x + 0.06, y: lm[9].y - 0.28, z: offsetZ };
    lm[20] = { x: lm[9].x + 0.15, y: lm[9].y - 0.22, z: offsetZ };
  } else if (isFist) {
    lm[4] = { x: lm[0].x - 0.02, y: lm[0].y - 0.05, z: offsetZ };
    lm[8] = { x: lm[0].x - 0.01, y: lm[0].y - 0.06, z: offsetZ };
    lm[12] = { x: lm[0].x, y: lm[0].y - 0.06, z: offsetZ };
    lm[16] = { x: lm[0].x + 0.01, y: lm[0].y - 0.05, z: offsetZ };
    lm[20] = { x: lm[0].x + 0.02, y: lm[0].y - 0.04, z: offsetZ };
  } else if (isPinching) {
    lm[4] = { x: 0.45 + offsetX, y: 0.5 + offsetY, z: offsetZ };
    lm[8] = { x: 0.455 + offsetX, y: 0.505 + offsetY, z: offsetZ };
  }
  return lm;
}

function makeMediaPipeResult(
  hands: ReturnType<typeof makeHandLandmarks>[],
  scores?: number[]
): HandLandmarkerResult {
  return {
    landmarks: hands,
    worldLandmarks: hands,
    handednesses: hands.map((_, i) => [
      {
        index: i,
        score: scores?.[i] ?? 0.96,
        categoryName: i === 0 ? 'Right' : 'Left',
        displayName: i === 0 ? 'Right' : 'Left'
      }
    ])
  };
}

describe('Phase 2 SpatialInteractionController & End-to-End Pipeline', () => {
  let engine: GestureEngine;
  let controller: SpatialInteractionController;

  beforeEach(() => {
    engine = new GestureEngine();
    engine.resetCalibrationToDefaults();
    controller = new SpatialInteractionController({
      trackingLossGraceMs: 320,
      reacquisitionStabilizeFrames: 2
    });
  });

  it('supports independent horizontal and vertical sensitivity plus fine wrist roll adjustment', () => {
    engine.updateCalibration({
      smoothingFactor: 1.0,
      mirrorX: false,
      rotationSensitivity: 6.0,
      verticalSensitivity: 2.0,
      wristRotationSensitivity: 1.5
    });

    engine.processResults(makeMediaPipeResult([makeHandLandmarks({ offsetX: 0, offsetY: 0, rollAngle: 0.16 })]), 100);
    const moved = engine.processResults(
      makeMediaPipeResult([makeHandLandmarks({ offsetX: 0.02, offsetY: 0.02, rollAngle: 0.16 })]),
      133
    );

    expect(moved.activeGesture).toBe('SPHERE_ROTATE');
    expect(Math.abs(moved.sphericalRotationDelta!.y)).toBeGreaterThan(
      Math.abs(moved.sphericalRotationDelta!.x) * 2
    );
    expect(moved.sphericalRotationDelta!.z).not.toBe(0);
    expect(moved.angularVelocity).toBeGreaterThan(0);

    const cmd = controller.process(moved, engine.getCalibration());
    expect(cmd.priorityTier).toBe(2);
    expect(cmd.activeAction).toBe('ACTIVE_ROTATION');
    expect(cmd.feedback.isRotating).toBe(true);
    expect(cmd.feedback.rotationDirection).toBe('RIGHT');
  });

  it('produces zero drift when hand remains stationary after active rotation', () => {
    engine.updateCalibration({ smoothingFactor: 1.0, rotationDeadZone: 0.005 });
    const h0 = makeHandLandmarks({ offsetX: 0, offsetY: 0, isOpenPalm: true });
    const h1 = makeHandLandmarks({ offsetX: 0.03, offsetY: 0, isOpenPalm: true });

    controller.process(engine.processResults(makeMediaPipeResult([h0]), 100), engine.getCalibration());
    const rotCmd = controller.process(
      engine.processResults(makeMediaPipeResult([h1]), 133),
      engine.getCalibration()
    );
    expect(rotCmd.activeAction).toBe('ACTIVE_ROTATION');

    // Hold completely still on subsequent frames
    const hold1 = controller.process(
      engine.processResults(makeMediaPipeResult([h1]), 166),
      engine.getCalibration()
    );
    expect(hold1.rotationDelta).toBeUndefined();
    expect(hold1.feedback.isRotating).toBe(false);
    expect(hold1.activeAction).not.toBe('ACTIVE_ROTATION');
  });

  it('filters low-confidence hand detections below confidenceThreshold', () => {
    engine.updateCalibration({ confidenceThreshold: 0.75 });
    const hand = makeHandLandmarks({ isOpenPalm: true });
    const lowConf = engine.processResults(makeMediaPipeResult([hand], [0.42]), 100);
    expect(lowConf.hands.length).toBe(0);
    expect(lowConf.activeGesture).toBe('NONE');

    const highConf = engine.processResults(makeMediaPipeResult([hand], [0.89]), 133);
    expect(highConf.hands.length).toBe(1);
    expect(highConf.activeGesture).toBe('OPEN_PALM');
  });

  it('absorbs temporary tracking loss via grace window and recovers without jumps on hand reappearance', () => {
    engine.updateCalibration({ smoothingFactor: 1.0, mirrorX: false });
    const h0 = makeHandLandmarks({ offsetX: 0 });
    const h1 = makeHandLandmarks({ offsetX: 0.03 });

    controller.process(engine.processResults(makeMediaPipeResult([h0]), 100), engine.getCalibration());
    const active = controller.process(
      engine.processResults(makeMediaPipeResult([h1]), 133),
      engine.getCalibration()
    );
    expect(active.activeAction).toBe('ACTIVE_ROTATION');

    // Simulate two-hand dispersion recorded before momentary dropout
    controller.setExternalDispersion(0.6, 'EXPANDING');

    // Brief 120ms tracking dropout -> enters TEMPORARY_LOSS grace window, freezes motion & preserves dispersion
    const lostRes = engine.processResults(makeMediaPipeResult([]), 250);
    const holdCmd = controller.process(lostRes, engine.getCalibration());
    expect(holdCmd.trackingStatus).toBe('TEMPORARY_LOSS');
    expect(holdCmd.activeAction).toBe('TRACKING_HOLD');
    expect(holdCmd.shouldClearInertia).toBe(true);
    expect(holdCmd.rotationDelta).toBeUndefined();
    expect(holdCmd.feedback.dispersion).toBeCloseTo(0.6, 2);

    // Beyond 320ms grace window -> LOST
    const expiredCmd = controller.process(
      engine.processResults(makeMediaPipeResult([]), 650),
      engine.getCalibration()
    );
    expect(expiredCmd.trackingStatus).toBe('LOST');

    // Hand reappears far away -> RECOVERING stabilization frames suppress jump spikes
    const reenter1 = controller.process(
      engine.processResults(makeMediaPipeResult([makeHandLandmarks({ offsetX: -0.25 })]), 683),
      engine.getCalibration()
    );
    expect(reenter1.trackingStatus).toBe('RECOVERING');
    expect(reenter1.rotationDelta).toBeUndefined();

    const reenter2 = controller.process(
      engine.processResults(makeMediaPipeResult([makeHandLandmarks({ offsetX: -0.22 })]), 716),
      engine.getCalibration()
    );
    expect(reenter2.trackingStatus).toBe('RECOVERING');
    expect(reenter2.rotationDelta).toBeUndefined();

    // Third frame after stabilization -> normal tracking resumes smoothly
    const resumed = controller.process(
      engine.processResults(makeMediaPipeResult([makeHandLandmarks({ offsetX: -0.19 })]), 750),
      engine.getCalibration()
    );
    expect(resumed.trackingStatus).toBe('TRACKING');
    expect(resumed.activeAction).toBe('ACTIVE_ROTATION');
  });

  it('enforces strict 5-tier priority hierarchy across concurrent signals', () => {
    const cal = { ...DEFAULT_CALIBRATION };

    // Tier 1: Two-hand dispersion overrides any single-hand rotation or pinch flags
    const tier1Mock: GestureDetectionResult = {
      activeGesture: 'TWO_HAND_ZOOM',
      confidence: 0.95,
      description: 'Two-hand dispersion',
      hands: [
        {
          handedness: 'Right',
          landmarks: makeHandLandmarks({ offsetX: 0.2 }),
          confidence: 0.95,
          centroid: { x: 0.7, y: 0.5, z: 0 },
          pinchDistance: 0.02,
          isPinching: true,
          isOpenPalm: false,
          isFist: false,
          isPointing: false,
          wristRotation: { roll: 0, pitch: 0, yaw: 0 },
          velocity: { x: 0.1, y: 0, z: 0 }
        },
        {
          handedness: 'Left',
          landmarks: makeHandLandmarks({ offsetX: -0.2 }),
          confidence: 0.95,
          centroid: { x: 0.3, y: 0.5, z: 0 },
          pinchDistance: 0.15,
          isPinching: false,
          isOpenPalm: false,
          isFist: false,
          isPointing: false,
          wristRotation: { roll: 0, pitch: 0, yaw: 0 },
          velocity: { x: 0, y: 0, z: 0 }
        }
      ],
      sphericalRotationDelta: { x: 0.05, y: 0.05, z: 0 },
      dispersionControl: {
        rawDistance: 0.4,
        smoothedDistance: 0.4,
        normalizedDistance: 0.54,
        dispersion: 0.54,
        phase: 'EXPANDING'
      },
      timestamp: 100
    };
    const c1 = controller.process(tier1Mock, cal);
    expect(c1.priorityTier).toBe(1);
    expect(c1.activeAction).toBe('TWO_HAND_DISPERSION');
    expect(c1.rotationDelta).toBeUndefined();

    // Tier 2: Active rotation
    const c2 = controller.process(
      {
        ...tier1Mock,
        activeGesture: 'SPHERE_ROTATE',
        hands: [tier1Mock.hands[0]],
        dispersionControl: undefined,
        angularVelocity: 2.1,
        rotationDirection: 'RIGHT',
        timestamp: 133
      },
      cal
    );
    expect(c2.priorityTier).toBe(2);
    expect(c2.activeAction).toBe('ACTIVE_ROTATION');

    // Tier 3: Pinch manipulation
    const c3 = controller.process(
      {
        ...tier1Mock,
        activeGesture: 'MOVE_PINCHED',
        hands: [tier1Mock.hands[0]],
        deltaTranslation: { x: 0.1, y: 0.05, z: 0 },
        sphericalRotationDelta: undefined,
        timestamp: 166
      },
      cal
    );
    expect(c3.priorityTier).toBe(3);
    expect(c3.activeAction).toBe('PINCH_MANIPULATION');

    // Tier 4: Discrete gesture
    const c4 = controller.process(
      {
        ...tier1Mock,
        activeGesture: 'CLOSED_FIST',
        hands: [tier1Mock.hands[0]],
        sphericalRotationDelta: undefined,
        timestamp: 200
      },
      cal
    );
    expect(c4.priorityTier).toBe(4);
    expect(c4.activeAction).toBe('DISCRETE_GESTURE');

    // Tier 5: Navigation swipe
    const c5 = controller.process(
      {
        ...tier1Mock,
        activeGesture: 'SWIPE_RIGHT',
        hands: [tier1Mock.hands[0]],
        sphericalRotationDelta: undefined,
        timestamp: 233
      },
      cal
    );
    expect(c5.priorityTier).toBe(5);
    expect(c5.activeAction).toBe('NAVIGATION_SWIPE');
  });

  it('scales two-hand dispersion with twoHandSensitivity calibration', () => {
    engine.updateCalibration({
      dispersionSmoothing: 1.0,
      twoHandMinDist: 0.15,
      twoHandMaxDist: 0.65,
      twoHandSensitivity: 1.5
    });

    const h1 = makeHandLandmarks({ offsetX: -0.15 });
    const h2 = makeHandLandmarks({ offsetX: 0.15 });
    const res = engine.processResults(makeMediaPipeResult([h1, h2]), 100);
    // Distance is 0.30 -> base norm (0.30 - 0.15)/0.50 = 0.30 -> * 1.5 = 0.45
    expect(res.dispersionControl?.dispersion).toBeCloseTo(0.45, 2);
  });

  it('updates RingGimbalsEffect visual feedback cleanly across rotation, dispersion, reconstruction, and tracking loss', () => {
    const gimbals = new RingGimbalsEffect(0x00f0ff);
    gimbals.setVisionSphereActive(true);

    gimbals.setInteractionFeedback({
      rotationSpeed: 3.0,
      dispersion: 0.75,
      isReconstructing: false,
      isTrackingLost: false
    });
    gimbals.update(1.0, 1.0);

    gimbals.setInteractionFeedback({
      rotationSpeed: 0,
      dispersion: 0.4,
      isReconstructing: true,
      isTrackingLost: true
    });
    gimbals.update(1.2, 1.0);

    expect(gimbals.group.children.length).toBeGreaterThan(4);
    gimbals.dispose();
  });
});
