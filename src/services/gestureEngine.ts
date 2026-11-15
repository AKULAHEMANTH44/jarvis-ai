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
  swipeSensitivity: 0.055
};

const STORAGE_KEY = 'jarvis_gesture_calibration';

// Euclidean distance between two 3D landmarks
export function distance3D(p1: Landmark3D, p2: Landmark3D): number {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  const dz = (p1.z || 0) - (p2.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export class GestureEngine {
  private calibration: GestureCalibrationSettings;
  private prevCentroids: Landmark3D[] = [];
  private prevTimestamp: number = 0;
  private smoothedLandmarks: Landmark3D[][] = [];
  private prevPinchState: boolean = false;
  private lastPinchTimestamp: number = 0;
  private lastPinchCentroid: Landmark3D | null = null;
  private prevGesture: GestureType = 'NONE';
  private gestureHoldFrames: number = 0;
  private prevTwoHandDistance: number | null = null;
  private smoothedTwoHandDistance: number | null = null;

  // Gesture cooldown map to prevent rapid transient re-triggers
  private gestureCooldowns: Record<string, number> = {
    SWIPE_RIGHT: 500,
    SWIPE_LEFT: 500,
    PUSH_FORWARD: 850,
    PULL_BACK: 650,
    DOUBLE_PINCH: 450
  };
  private lastGestureTriggerTime: Record<string, number> = {};

  constructor() {
    this.calibration = this.loadCalibration();
  }

  private loadCalibration(): GestureCalibrationSettings {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          return { ...DEFAULT_CALIBRATION, ...parsed };
        }
      } catch (e) {
        console.warn('Failed to load gesture calibration from storage:', e);
      }
    }
    return { ...DEFAULT_CALIBRATION };
  }

  public saveCalibration(settings: Partial<GestureCalibrationSettings>) {
    this.calibration = { ...this.calibration, ...settings };
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.calibration));
      } catch (e) {
        console.warn('Failed to save calibration to storage:', e);
      }
    }
  }

  public resetCalibrationToDefaults(): GestureCalibrationSettings {
    this.calibration = { ...DEFAULT_CALIBRATION };
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
    }
    return { ...this.calibration };
  }

  public updateCalibration(settings: Partial<GestureCalibrationSettings>) {
    this.saveCalibration(settings);
  }

  public getCalibration(): GestureCalibrationSettings {
    return { ...this.calibration };
  }

  private checkCooldown(gesture: string, timestamp: number): boolean {
    const cooldown = this.gestureCooldowns[gesture];
    if (!cooldown) return true;
    const lastTime = this.lastGestureTriggerTime[gesture];
    if (lastTime === undefined || (timestamp - lastTime) >= cooldown) {
      this.lastGestureTriggerTime[gesture] = timestamp;
      return true;
    }
    return false;
  }

  public processResults(
    rawResult: HandLandmarkerResult,
    timestamp: number = performance.now()
  ): GestureDetectionResult {
    const rawHands = rawResult.landmarks;
    const rawHandedness = rawResult.handednesses;

    const dt = this.prevTimestamp > 0 ? Math.max(0.008, Math.min(0.1, (timestamp - this.prevTimestamp) / 1000)) : 0.033;
    this.prevTimestamp = timestamp;

    // Hand-loss recovery: cleanly clear transient tracking states when no hands detected
    if (!rawHands || rawHands.length === 0) {
      this.prevCentroids = [];
      this.prevTwoHandDistance = null;
      this.smoothedTwoHandDistance = null;
      this.lastPinchCentroid = null;
      this.prevPinchState = false;
      this.smoothedLandmarks = [];
      this.prevGesture = 'NONE';
      return {
        activeGesture: 'NONE',
        confidence: 0,
        description: 'Awaiting hand presence in optical field',
        hands: [],
        timestamp
      };
    }

    const detectedHands: DetectedHand[] = [];
    const alpha = this.calibration.smoothingFactor;

    // Process each detected hand
    for (let i = 0; i < rawHands.length; i++) {
      const currentRaw = rawHands[i];
      const handedness = rawHandedness && rawHandedness[i] && rawHandedness[i][0]
        ? (rawHandedness[i][0].displayName as 'Left' | 'Right')
        : (i === 0 ? 'Right' : 'Left');
      const confidence = rawHandedness && rawHandedness[i] && rawHandedness[i][0]
        ? rawHandedness[i][0].score
        : 0.85;

      // Temporal landmark smoothing
      if (!this.smoothedLandmarks[i]) {
        this.smoothedLandmarks[i] = currentRaw.map(p => ({ x: p.x, y: p.y, z: p.z || 0 }));
      } else {
        for (let j = 0; j < currentRaw.length; j++) {
          this.smoothedLandmarks[i][j].x = this.smoothedLandmarks[i][j].x * (1 - alpha) + currentRaw[j].x * alpha;
          this.smoothedLandmarks[i][j].y = this.smoothedLandmarks[i][j].y * (1 - alpha) + currentRaw[j].y * alpha;
          this.smoothedLandmarks[i][j].z = this.smoothedLandmarks[i][j].z * (1 - alpha) + (currentRaw[j].z || 0) * alpha;
        }
      }
      const landmarks = this.smoothedLandmarks[i];

      const wrist = landmarks[0];
      const thumbTip = landmarks[4];
      const indexTip = landmarks[8];
      const middleTip = landmarks[12];
      const ringTip = landmarks[16];
      const pinkyTip = landmarks[20];

      // Hand centroid
      const centroid: Landmark3D = {
        x: (wrist.x + landmarks[5].x + landmarks[9].x + landmarks[17].x) / 4,
        y: (wrist.y + landmarks[5].y + landmarks[9].y + landmarks[17].y) / 4,
        z: (wrist.z + landmarks[5].z + landmarks[9].z + landmarks[17].z) / 4
      };

      // Frame-rate normalized velocity
      let velocity: Landmark3D = { x: 0, y: 0, z: 0 };
      if (this.prevCentroids[i]) {
        const timeFactor = 0.033 / dt;
        velocity = {
          x: (centroid.x - this.prevCentroids[i].x) * timeFactor,
          y: (centroid.y - this.prevCentroids[i].y) * timeFactor,
          z: (centroid.z - this.prevCentroids[i].z) * timeFactor
        };
      }
      this.prevCentroids[i] = centroid;

      // Distances from wrist to fingertips
      const dIndex = distance3D(wrist, indexTip);
      const dMiddle = distance3D(wrist, middleTip);
      const dRing = distance3D(wrist, ringTip);
      const dPinky = distance3D(wrist, pinkyTip);
      const avgFingertipDist = (dIndex + dMiddle + dRing + dPinky) / 4;

      // Fist check
      const isFist =
        dIndex < this.calibration.fistThreshold &&
        dMiddle < this.calibration.fistThreshold &&
        dRing < this.calibration.fistThreshold &&
        dPinky < this.calibration.fistThreshold;

      // Pinch distance
      const pinchDist = distance3D(thumbTip, indexTip);
      const isPinching = !isFist && pinchDist < this.calibration.pinchThreshold;

      // Open palm check: ALL 4 fingers extended away from wrist
      const isOpenPalm =
        avgFingertipDist > this.calibration.openPalmThreshold &&
        dIndex > this.calibration.openPalmThreshold * 0.85 &&
        dMiddle > this.calibration.openPalmThreshold * 0.85 &&
        dRing > this.calibration.openPalmThreshold * 0.75 &&
        dPinky > this.calibration.openPalmThreshold * 0.75 &&
        !isFist &&
        !isPinching;

      // Two-finger point check: index & middle extended, ring & pinky curled
      const isPointing =
        dIndex > this.calibration.openPalmThreshold * 0.85 &&
        dMiddle > this.calibration.openPalmThreshold * 0.85 &&
        dRing < this.calibration.fistThreshold * 1.4 &&
        dPinky < this.calibration.fistThreshold * 1.4 &&
        !isOpenPalm &&
        !isPinching;

      // Accurate Wrist Orientation
      const rawAngle = Math.atan2(landmarks[9].y - wrist.y, landmarks[9].x - wrist.x);
      let roll = rawAngle - (-Math.PI / 2);
      while (roll > Math.PI) roll -= 2 * Math.PI;
      while (roll < -Math.PI) roll += 2 * Math.PI;

      const pitch = landmarks[9].z - wrist.z;
      const yaw = Math.atan2(landmarks[5].z - landmarks[17].z, landmarks[5].x - landmarks[17].x);

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

    let activeGesture: GestureType = 'NONE';
    let description = 'Hand active';
    let deltaScale: number | undefined = undefined;
    let deltaRotation: { x: number; y: number; z: number } | undefined = undefined;
    let deltaTranslation: { x: number; y: number; z: number } | undefined = undefined;
    let currentTwoHandDistance: number | undefined = undefined;

    const primaryHand = detectedHands[0];

    // Check F & G: TWO HANDS (ZOOM vs WIDE INTERFACE)
    if (detectedHands.length >= 2) {
      currentTwoHandDistance = distance3D(detectedHands[0].centroid, detectedHands[1].centroid);
      if (this.smoothedTwoHandDistance === null) {
        this.smoothedTwoHandDistance = currentTwoHandDistance;
      } else {
        this.smoothedTwoHandDistance = this.smoothedTwoHandDistance * 0.7 + currentTwoHandDistance * 0.3;
      }

      const delta = this.prevTwoHandDistance !== null ? (this.smoothedTwoHandDistance - this.prevTwoHandDistance) : 0;
      this.prevTwoHandDistance = this.smoothedTwoHandDistance;

      if (Math.abs(delta) > 0.004) {
        activeGesture = 'TWO_HAND_ZOOM';
        deltaScale = 1 + delta * 3.0;
        description = `Two-hand Zoom: Scale factor ${(deltaScale).toFixed(2)}x`;
      } else if (detectedHands[0].isOpenPalm && detectedHands[1].isOpenPalm) {
        activeGesture = 'TWO_OPEN_PALMS';
        description = 'Two open palms: Wide Holographic Interface Engaged';
      }
    }

    // Single hand gesture evaluation
    if (activeGesture === 'NONE' && primaryHand) {
      const vel = primaryHand.velocity;

      // Check K: HAND PUSH FORWARD (Rapid movement toward camera)
      if (vel.z < this.calibration.pushSensitivity && primaryHand.isOpenPalm) {
        if (this.checkCooldown('PUSH_FORWARD', timestamp)) {
          activeGesture = 'PUSH_FORWARD';
          description = 'Push Forward: Cinematic Energy Wave Triggered';
        }
      }
      // Check L: HAND PULL BACK (Rapid movement away from camera)
      else if (vel.z > this.calibration.pullSensitivity) {
        if (this.checkCooldown('PULL_BACK', timestamp)) {
          activeGesture = 'PULL_BACK';
          description = 'Pull Back: Reset Object to Anchor';
        }
      }
      // Check H: QUICK HAND SWIPES (Horizontal speed threshold)
      else if (vel.x > this.calibration.swipeSensitivity && !primaryHand.isPinching) {
        if (this.checkCooldown('SWIPE_RIGHT', timestamp)) {
          activeGesture = 'SWIPE_RIGHT';
          description = 'Quick Swipe Right: Next Holographic Module';
        }
      } else if (vel.x < -this.calibration.swipeSensitivity && !primaryHand.isPinching) {
        if (this.checkCooldown('SWIPE_LEFT', timestamp)) {
          activeGesture = 'SWIPE_LEFT';
          description = 'Quick Swipe Left: Previous Holographic Module';
        }
      }
      // Check B: CLOSED FIST
      else if (primaryHand.isFist) {
        activeGesture = 'CLOSED_FIST';
        description = 'Closed Fist: Movement Paused / Visual Standby';
      }
      // Check I: TWO-FINGER POINT
      else if (primaryHand.isPointing) {
        activeGesture = 'TWO_FINGER_POINT';
        description = 'Two-Finger Point: Precision Laser Control';
      }
      // Check E: ROTATE WRIST (When wrist tilt exceeds 0.38 rad from upright vertical)
      else if (Math.abs(primaryHand.wristRotation.roll) > 0.38) {
        activeGesture = 'ROTATE_WRIST';
        deltaRotation = {
          x: primaryHand.wristRotation.pitch * 0.08,
          y: primaryHand.wristRotation.roll * 0.1,
          z: primaryHand.wristRotation.yaw * 0.08
        };
        description = `Wrist Rotate: Rolling ${primaryHand.wristRotation.roll.toFixed(2)} rad`;
      }
      // Check A: OPEN PALM (Upright vertical palm)
      else if (primaryHand.isOpenPalm) {
        activeGesture = 'OPEN_PALM';
        description = 'Open Palm: Holographic System Active';
      }
      // Check J: DOUBLE PINCH
      else if (primaryHand.isPinching && !this.prevPinchState) {
        const timeSinceLastPinch = this.lastPinchTimestamp > 0 ? timestamp - this.lastPinchTimestamp : 99999;
        this.lastPinchCentroid = { ...primaryHand.centroid };
        if (timeSinceLastPinch > 80 && timeSinceLastPinch < 450) {
          if (this.checkCooldown('DOUBLE_PINCH', timestamp)) {
            activeGesture = 'DOUBLE_PINCH';
            description = 'Double Pinch: Disassembly Blueprint Toggle';
            this.lastPinchTimestamp = 0;
          }
        } else {
          this.lastPinchTimestamp = timestamp;
          activeGesture = 'PINCH';
          description = 'Pinch: Object Acquired / Interacting';
        }
      }
      // Check C & D: PINCH and MOVE PINCHED HAND (True delta calculation)
      else if (primaryHand.isPinching) {
        if (!this.lastPinchCentroid) {
          this.lastPinchCentroid = { ...primaryHand.centroid };
          activeGesture = 'PINCH';
          description = 'Pinch Grab: Holographic Object Selected';
        } else {
          const moveDist = distance3D(primaryHand.centroid, this.lastPinchCentroid);
          if (moveDist > 0.003) {
            activeGesture = 'MOVE_PINCHED';
            deltaTranslation = {
              x: (primaryHand.centroid.x - this.lastPinchCentroid.x) * 6.0,
              y: -(primaryHand.centroid.y - this.lastPinchCentroid.y) * 6.0,
              z: (primaryHand.centroid.z - this.lastPinchCentroid.z) * 6.0
            };
            this.lastPinchCentroid = { ...primaryHand.centroid };
            description = `Move Pinched: Translating 3D Object (ΔX:${deltaTranslation.x.toFixed(3)}, ΔY:${deltaTranslation.y.toFixed(3)})`;
          } else {
            activeGesture = 'PINCH';
            description = 'Pinch Grab: Holographic Object Held';
          }
        }
      }
    }

    if (primaryHand && !primaryHand.isPinching) {
      this.lastPinchCentroid = null;
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
