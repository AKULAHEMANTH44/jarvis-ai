import { HandLandmarkerResult } from '@mediapipe/tasks-vision';
import {
  DetectedHand,
  GestureCalibrationSettings,
  GestureDetectionResult,
  GestureType,
  Landmark3D
} from '../types/gesture';

export const DEFAULT_CALIBRATION: GestureCalibrationSettings = {
  pinchThreshold: 0.055,
  openPalmThreshold: 0.22,
  fistThreshold: 0.13,
  smoothingFactor: 0.65,
  pushSensitivity: -0.035, // Negative delta Z = moving toward camera
  pullSensitivity: 0.035,  // Positive delta Z = moving away from camera
  swipeSensitivity: 0.06
};

// Euclidean distance between two 3D landmarks
function distance3D(p1: Landmark3D, p2: Landmark3D): number {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  const dz = (p1.z || 0) - (p2.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export class GestureEngine {
  private calibration: GestureCalibrationSettings = { ...DEFAULT_CALIBRATION };
  private prevCentroids: Landmark3D[] = [];
  private prevPinchState: boolean = false;
  private lastPinchTimestamp: number = 0;
  private prevGesture: GestureType = 'NONE';
  private gestureHoldFrames: number = 0;
  private prevTwoHandDistance: number | null = null;
  private initialObjectGrabPosition: Landmark3D | null = null;

  public updateCalibration(settings: Partial<GestureCalibrationSettings>) {
    this.calibration = { ...this.calibration, ...settings };
  }

  public getCalibration(): GestureCalibrationSettings {
    return { ...this.calibration };
  }

  public processResults(
    rawResult: HandLandmarkerResult,
    timestamp: number = performance.now()
  ): GestureDetectionResult {
    const rawHands = rawResult.landmarks;
    const rawHandedness = rawResult.handednesses;

    if (!rawHands || rawHands.length === 0) {
      this.prevCentroids = [];
      this.prevTwoHandDistance = null;
      this.initialObjectGrabPosition = null;
      return {
        activeGesture: 'NONE',
        confidence: 0,
        description: 'Awaiting hand presence in sensor field',
        hands: [],
        timestamp
      };
    }

    const detectedHands: DetectedHand[] = [];

    // Analyze each detected hand
    for (let i = 0; i < rawHands.length; i++) {
      const landmarks = rawHands[i];
      const handedness = rawHandedness && rawHandedness[i] && rawHandedness[i][0]
        ? (rawHandedness[i][0].displayName as 'Left' | 'Right')
        : (i === 0 ? 'Right' : 'Left');
      const confidence = rawHandedness && rawHandedness[i] && rawHandedness[i][0]
        ? rawHandedness[i][0].score
        : 0.85;

      // Key landmark indices:
      // 0: Wrist
      // 4: Thumb Tip, 3: Thumb IP, 2: Thumb MCP
      // 8: Index Tip, 6: Index PIP, 5: Index MCP
      // 12: Middle Tip, 10: Middle PIP, 9: Middle MCP
      // 16: Ring Tip, 14: Ring PIP, 13: Ring MCP
      // 20: Pinky Tip, 18: Pinky PIP, 17: Pinky MCP

      const wrist = landmarks[0];
      const thumbTip = landmarks[4];
      const indexTip = landmarks[8];
      const middleTip = landmarks[12];
      const ringTip = landmarks[16];
      const pinkyTip = landmarks[20];

      // Centroid (average of wrist, index MCP, middle MCP, pinky MCP)
      const centroid: Landmark3D = {
        x: (wrist.x + landmarks[5].x + landmarks[9].x + landmarks[17].x) / 4,
        y: (wrist.y + landmarks[5].y + landmarks[9].y + landmarks[17].y) / 4,
        z: (wrist.z + landmarks[5].z + landmarks[9].z + landmarks[17].z) / 4
      };

      // Velocity calculation
      let velocity: Landmark3D = { x: 0, y: 0, z: 0 };
      if (this.prevCentroids[i]) {
        const rawVel = {
          x: centroid.x - this.prevCentroids[i].x,
          y: centroid.y - this.prevCentroids[i].y,
          z: centroid.z - this.prevCentroids[i].z
        };
        // Exponential smoothing
        const alpha = this.calibration.smoothingFactor;
        velocity = {
          x: rawVel.x * alpha,
          y: rawVel.y * alpha,
          z: rawVel.z * alpha
        };
      }
      this.prevCentroids[i] = centroid;

      // Distances from wrist to fingertips
      const dThumb = distance3D(wrist, thumbTip);
      const dIndex = distance3D(wrist, indexTip);
      const dMiddle = distance3D(wrist, middleTip);
      const dRing = distance3D(wrist, ringTip);
      const dPinky = distance3D(wrist, pinkyTip);
      const avgFingertipDist = (dIndex + dMiddle + dRing + dPinky) / 4;

      // Fist check: all fingertips close to wrist
      const isFist =
        dIndex < this.calibration.fistThreshold &&
        dMiddle < this.calibration.fistThreshold &&
        dRing < this.calibration.fistThreshold &&
        dPinky < this.calibration.fistThreshold;

      // Pinch distance: thumb tip to index tip (only when not in a fist)
      const pinchDist = distance3D(thumbTip, indexTip);
      const isPinching = !isFist && pinchDist < this.calibration.pinchThreshold;

      // Open palm check: all fingertips extended away from wrist
      const isOpenPalm =
        avgFingertipDist > this.calibration.openPalmThreshold &&
        dIndex > this.calibration.openPalmThreshold * 0.9 &&
        dMiddle > this.calibration.openPalmThreshold * 0.9 &&
        !isFist &&
        !isPinching;

      // Two-finger point check: index & middle extended, ring & pinky curled
      const isPointing =
        dIndex > this.calibration.openPalmThreshold * 0.85 &&
        dMiddle > this.calibration.openPalmThreshold * 0.85 &&
        dRing < this.calibration.fistThreshold * 1.3 &&
        dPinky < this.calibration.fistThreshold * 1.3;

      // Wrist rotation estimate (roll, pitch, yaw)
      const roll = Math.atan2(landmarks[9].y - wrist.y, landmarks[9].x - wrist.x);
      const pitch = Math.atan2(landmarks[9].z - wrist.z, landmarks[9].y - wrist.y);
      const yaw = Math.atan2(landmarks[5].x - landmarks[17].x, landmarks[5].z - landmarks[17].z);

      detectedHands.push({
        handedness,
        landmarks,
        confidence,
        centroid,
        pinchDistance: pinchDist,
        isPinching,
        isOpenPalm,
        isFist,
        isPointing,
        wristRotation: { roll, pitch, yaw },
        velocity
      });
    }

    // MULTI-HAND AND COMPOSITE GESTURE EVALUATION
    let activeGesture: GestureType = 'NONE';
    let description = 'Hand active';
    let deltaScale: number | undefined = undefined;
    let deltaRotation: { x: number; y: number; z: number } | undefined = undefined;
    let deltaTranslation: { x: number; y: number; z: number } | undefined = undefined;
    let currentTwoHandDistance: number | undefined = undefined;

    const primaryHand = detectedHands[0];

    // Check G: TWO OPEN PALMS
    if (detectedHands.length >= 2 && detectedHands[0].isOpenPalm && detectedHands[1].isOpenPalm) {
      activeGesture = 'TWO_OPEN_PALMS';
      description = 'Two open palms: Wide Holographic Interface Engaged';
    }
    // Check F: TWO-HAND MOVEMENT (ZOOM / SCALE)
    else if (detectedHands.length >= 2) {
      currentTwoHandDistance = distance3D(detectedHands[0].centroid, detectedHands[1].centroid);
      if (this.prevTwoHandDistance !== null) {
        const delta = currentTwoHandDistance - this.prevTwoHandDistance;
        if (Math.abs(delta) > 0.005) {
          activeGesture = 'TWO_HAND_ZOOM';
          deltaScale = 1 + delta * 2.5;
          description = `Two-hand Zoom: Scale factor ${(deltaScale).toFixed(2)}x`;
        }
      }
      this.prevTwoHandDistance = currentTwoHandDistance;
    }

    // If no multi-hand gesture matched, evaluate single primary hand
    if (activeGesture === 'NONE' && primaryHand) {
      const vel = primaryHand.velocity;

      // Check K: HAND PUSH FORWARD (Rapid movement toward camera - negative Z velocity)
      if (vel.z < this.calibration.pushSensitivity && primaryHand.isOpenPalm) {
        activeGesture = 'PUSH_FORWARD';
        description = 'Push Forward: Cinematic Energy Wave Triggered';
      }
      // Check L: HAND PULL BACK (Rapid movement away from camera - positive Z velocity)
      else if (vel.z > this.calibration.pullSensitivity) {
        activeGesture = 'PULL_BACK';
        description = 'Pull Back: Reset Object to Anchor';
      }
      // Check H: QUICK HAND SWIPE (High X velocity)
      else if (vel.x > this.calibration.swipeSensitivity) {
        activeGesture = 'SWIPE_RIGHT';
        description = 'Quick Swipe Right: Next Holographic Module';
      } else if (vel.x < -this.calibration.swipeSensitivity) {
        activeGesture = 'SWIPE_LEFT';
        description = 'Quick Swipe Left: Previous Holographic Module';
      }
      // Check B: CLOSED FIST
      else if (primaryHand.isFist) {
        activeGesture = 'CLOSED_FIST';
        description = 'Closed Fist: Movement Paused / Visual Standby';
      }
      // Check A: OPEN PALM
      else if (primaryHand.isOpenPalm) {
        activeGesture = 'OPEN_PALM';
        description = 'Open Palm: Holographic System Active';
      }
      // Check I: TWO-FINGER POINT
      else if (primaryHand.isPointing) {
        activeGesture = 'TWO_FINGER_POINT';
        description = 'Two-Finger Point: Precision Laser Control';
      }
      // Check J: DOUBLE PINCH
      else if (primaryHand.isPinching && !this.prevPinchState) {
        const timeSinceLastPinch = this.lastPinchTimestamp > 0 ? timestamp - this.lastPinchTimestamp : 99999;
        if (timeSinceLastPinch > 80 && timeSinceLastPinch < 450) {
          activeGesture = 'DOUBLE_PINCH';
          description = 'Double Pinch: Diagnostic Pulse Activated';
          this.lastPinchTimestamp = 0;
        } else {
          this.lastPinchTimestamp = timestamp;
          activeGesture = 'PINCH';
          description = 'Pinch: Object Acquired / Interacting';
        }
      }
      // Check C & D: PINCH and MOVE PINCHED HAND
      else if (primaryHand.isPinching) {
        if (!this.initialObjectGrabPosition) {
          this.initialObjectGrabPosition = { ...primaryHand.centroid };
          activeGesture = 'PINCH';
          description = 'Pinch Grab: Holographic Object Selected';
        } else {
          // If pinching and translating
          activeGesture = 'MOVE_PINCHED';
          deltaTranslation = {
            x: (primaryHand.centroid.x - this.initialObjectGrabPosition.x) * 4.0,
            y: -(primaryHand.centroid.y - this.initialObjectGrabPosition.y) * 4.0,
            z: (primaryHand.centroid.z - this.initialObjectGrabPosition.z) * 4.0
          };
          description = `Move Pinched: Translating 3D Object (ΔX:${deltaTranslation.x.toFixed(2)}, ΔY:${deltaTranslation.y.toFixed(2)})`;
        }
      }
      // Check E: ROTATE WRIST (When hand is tilted significantly and not in rest state)
      else if (Math.abs(primaryHand.wristRotation.roll) > 0.6 || Math.abs(primaryHand.wristRotation.pitch) > 0.6) {
        activeGesture = 'ROTATE_WRIST';
        deltaRotation = {
          x: primaryHand.wristRotation.pitch * 0.08,
          y: primaryHand.wristRotation.roll * 0.08,
          z: primaryHand.wristRotation.yaw * 0.08
        };
        description = `Wrist Rotate: Rolling ${primaryHand.wristRotation.roll.toFixed(2)} rad`;
      }
    }

    if (primaryHand && !primaryHand.isPinching) {
      this.initialObjectGrabPosition = null;
    }
    this.prevPinchState = primaryHand ? primaryHand.isPinching : false;

    // Hysteresis debouncing
    if (activeGesture === this.prevGesture) {
      this.gestureHoldFrames++;
    } else {
      this.gestureHoldFrames = 1;
      this.prevGesture = activeGesture;
    }

    return {
      activeGesture,
      confidence: primaryHand ? primaryHand.confidence : 0,
      description,
      hands: detectedHands,
      twoHandDistance: currentTwoHandDistance,
      deltaScale,
      deltaRotation,
      deltaTranslation,
      timestamp
    };
  }
}

export const gestureEngine = new GestureEngine();
