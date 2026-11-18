import { HandLandmarkerResult } from '@mediapipe/tasks-vision';
import {
  DetectedHand,
  DispersionControlTelemetry,
  GestureCalibrationSettings,
  GestureDetectionResult,
  GestureType,
  Landmark3D
} from '../types/gesture';
import { customGestureService } from './customGestureService';

export const DEFAULT_CALIBRATION: GestureCalibrationSettings = {
  pinchThreshold: 0.055,
  openPalmThreshold: 0.22,
  fistThreshold: 0.13,
  smoothingFactor: 0.65,
  pushSensitivity: -0.035, // Negative delta Z = moving toward camera
  pullSensitivity: 0.035,  // Positive delta Z = moving away from camera
  swipeSensitivity: 0.055,
  rotationSensitivity: 4.8,
  verticalSensitivity: 4.2,
  wristRotationSensitivity: 1.0,
  rotationDeadZone: 0.0035,
  maxRotationSpeed: 0.18,
  rotationDamping: 6.5,
  mirrorX: false,
  twoHandMinDist: 0.14,
  twoHandMaxDist: 0.62,
  twoHandSensitivity: 1.0,
  dispersionSmoothing: 0.28,
  confidenceThreshold: 0.5
};

const STORAGE_KEY = 'jarvis_gesture_calibration';
const DISPERSION_HYSTERESIS = 0.018;

// Euclidean distance between two 3D landmarks
export function distance3D(p1: Landmark3D, p2: Landmark3D): number {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  const dz = (p1.z || 0) - (p2.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

interface TrackedHandState {
  id: number;
  handedness: 'Left' | 'Right';
  centroid: Landmark3D;
  landmarks: Landmark3D[];
}

export class GestureEngine {
  private calibration: GestureCalibrationSettings;
  private trackedHands: TrackedHandState[] = [];
  private nextHandTrackId: number = 1;
  private neutralAnchor: Landmark3D | null = null;
  private prevTimestamp: number = 0;
  private smoothedRotVel: { x: number; y: number } = { x: 0, y: 0 };
  private prevPinchState: boolean = false;
  private lastPinchTimestamp: number = 0;
  private lastPinchCentroid: Landmark3D | null = null;
  private prevGesture: GestureType = 'NONE';
  private gestureHoldFrames: number = 0;
  private prevTwoHandDistance: number | null = null;
  private smoothedTwoHandDistance: number | null = null;
  private committedDispersion: number = 0;
  private lastDispersionPhase: DispersionControlTelemetry['phase'] = 'COMPLETE';
  private hadHandsPreviously: boolean = false;
  private twoHandExitStabilizeFrames: number = 0;

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
    this.recalibrateNeutral();
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
    }
    return { ...this.calibration };
  }

  public recalibrateNeutral() {
    this.neutralAnchor = null;
    this.trackedHands = [];
    this.smoothedRotVel = { x: 0, y: 0 };
    this.twoHandExitStabilizeFrames = 0;
  }

  public getNeutralAnchor(): Landmark3D | null {
    return this.neutralAnchor ? { ...this.neutralAnchor } : null;
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
    if (lastTime === undefined || timestamp - lastTime >= cooldown) {
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

    const dt =
      this.prevTimestamp > 0
        ? clamp((timestamp - this.prevTimestamp) / 1000, 0.008, 0.1)
        : 0.033;
    this.prevTimestamp = timestamp;

    // Build raw metadata and filter out hands below configured tracking confidence threshold
    const minConfidence = clamp(this.calibration.confidenceThreshold ?? 0.5, 0.2, 0.95);
    const rawMetaAll = (rawHands || []).map((currentRaw, i) => {
      const handedness: 'Left' | 'Right' =
        rawHandedness && rawHandedness[i] && rawHandedness[i][0]
          ? (rawHandedness[i][0].displayName as 'Left' | 'Right')
          : i === 0
          ? 'Right'
          : 'Left';
      const confidence =
        rawHandedness && rawHandedness[i] && rawHandedness[i][0]
          ? rawHandedness[i][0].score
          : 0.85;
      const rawCentroid: Landmark3D = {
        x: (currentRaw[0].x + currentRaw[5].x + currentRaw[9].x + currentRaw[17].x) / 4,
        y: (currentRaw[0].y + currentRaw[5].y + currentRaw[9].y + currentRaw[17].y) / 4,
        z:
          ((currentRaw[0].z || 0) +
            (currentRaw[5].z || 0) +
            (currentRaw[9].z || 0) +
            (currentRaw[17].z || 0)) /
          4
      };
      return { currentRaw, handedness, confidence, rawCentroid };
    });

    const rawMeta = rawMetaAll.filter((m) => m.confidence >= minConfidence);

    // Hand-loss recovery: cleanly clear transient tracking states when no qualifying hands detected
    if (rawMeta.length === 0) {
      const wasTracking = this.hadHandsPreviously;
      this.hadHandsPreviously = false;
      this.trackedHands = [];
      this.neutralAnchor = null;
      this.prevTwoHandDistance = null;
      this.smoothedTwoHandDistance = null;
      this.lastPinchCentroid = null;
      this.prevPinchState = false;
      this.smoothedRotVel = { x: 0, y: 0 };
      this.twoHandExitStabilizeFrames = 0;
      this.prevGesture = 'NONE';
      return {
        activeGesture: 'NONE',
        confidence: 0,
        description: 'Awaiting hand presence in optical field',
        hands: [],
        trackingLost: wasTracking,
        angularVelocity: 0,
        rotationDirection: 'NONE',
        timestamp
      };
    }

    this.hadHandsPreviously = true;
    const detectedHands: DetectedHand[] = [];
    const alpha = this.calibration.smoothingFactor;
    const prevTracked = this.trackedHands;

    const candidatePairs: Array<{ rawIdx: number; prevIdx: number; score: number }> = [];
    for (let r = 0; r < rawMeta.length; r++) {
      for (let p = 0; p < prevTracked.length; p++) {
        const dx = rawMeta[r].rawCentroid.x - prevTracked[p].centroid.x;
        const dy = rawMeta[r].rawCentroid.y - prevTracked[p].centroid.y;
        const dist2d = Math.hypot(dx, dy);
        if (dist2d <= 0.45) {
          const handednessPenalty = rawMeta[r].handedness === prevTracked[p].handedness ? 0 : 0.05;
          candidatePairs.push({ rawIdx: r, prevIdx: p, score: dist2d + handednessPenalty });
        }
      }
    }
    candidatePairs.sort((a, b) => a.score - b.score);

    const matchedPrevForRaw: Array<TrackedHandState | null> = new Array(rawMeta.length).fill(null);
    const usedRaw = new Set<number>();
    const usedPrev = new Set<number>();
    for (const pair of candidatePairs) {
      if (usedRaw.has(pair.rawIdx) || usedPrev.has(pair.prevIdx)) continue;
      usedRaw.add(pair.rawIdx);
      usedPrev.add(pair.prevIdx);
      matchedPrevForRaw[pair.rawIdx] = prevTracked[pair.prevIdx];
    }

    const nextTrackedHands: TrackedHandState[] = [];
    const prevCentroidsByRawIndex: Array<Landmark3D | null> = [];

    // Process each detected hand using its persistent match
    for (let i = 0; i < rawMeta.length; i++) {
      const { currentRaw, handedness, confidence } = rawMeta[i];
      const matchedPrev = matchedPrevForRaw[i];
      const trackId = matchedPrev ? matchedPrev.id : this.nextHandTrackId++;

      // Temporal landmark smoothing (never interpolate across different hands)
      let landmarks: Landmark3D[];
      if (!matchedPrev || matchedPrev.landmarks.length !== currentRaw.length) {
        landmarks = currentRaw.map((p) => ({ x: p.x, y: p.y, z: p.z || 0 }));
      } else {
        landmarks = matchedPrev.landmarks.map((prevPt, j) => ({
          x: prevPt.x * (1 - alpha) + currentRaw[j].x * alpha,
          y: prevPt.y * (1 - alpha) + currentRaw[j].y * alpha,
          z: prevPt.z * (1 - alpha) + (currentRaw[j].z || 0) * alpha
        }));
      }

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

      // Frame-rate normalized velocity against THIS hand's previous centroid
      let velocity: Landmark3D = { x: 0, y: 0, z: 0 };
      if (matchedPrev) {
        const timeFactor = 0.033 / dt;
        velocity = {
          x: (centroid.x - matchedPrev.centroid.x) * timeFactor,
          y: (centroid.y - matchedPrev.centroid.y) * timeFactor,
          z: (centroid.z - matchedPrev.centroid.z) * timeFactor
        };
      }
      prevCentroidsByRawIndex[i] = matchedPrev ? { ...matchedPrev.centroid } : null;
      nextTrackedHands.push({
        id: trackId,
        handedness,
        centroid,
        landmarks
      });

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
      let roll = rawAngle - -Math.PI / 2;
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

    this.trackedHands = nextTrackedHands;

    let activeGesture: GestureType = 'NONE';
    let description = 'Hand active';
    let deltaScale: number | undefined = undefined;
    let deltaRotation: { x: number; y: number; z: number } | undefined = undefined;
    let sphericalRotationDelta: { x: number; y: number; z: number } | undefined = undefined;
    let deltaTranslation: { x: number; y: number; z: number } | undefined = undefined;
    let currentTwoHandDistance: number | undefined = undefined;
    let dispersionControl: DispersionControlTelemetry | undefined = undefined;
    let customGestureMatch: { profileId: string; actionId: string; name: string } | undefined = undefined;

    const primaryHand = detectedHands[0];

    // Establish stable neutral anchor on first hand appearance
    if (primaryHand && !this.neutralAnchor) {
      this.neutralAnchor = { ...primaryHand.centroid };
    }

    // Priority 1 (Part 3 & Part 6): TWO-HAND SPATIAL ZOOM & PROGRESSIVE PARTICLE DISPERSION
    if (detectedHands.length >= 2) {
      // Zero single-hand rotation inertia & arm exit stabilization whenever 2 hands are active
      this.smoothedRotVel = { x: 0, y: 0 };
      this.twoHandExitStabilizeFrames = 2;

      currentTwoHandDistance = distance3D(detectedHands[0].centroid, detectedHands[1].centroid);
      const dispAlpha = clamp(this.calibration.dispersionSmoothing, 0.08, 0.9);
      if (this.smoothedTwoHandDistance === null) {
        this.smoothedTwoHandDistance = currentTwoHandDistance;
      } else {
        this.smoothedTwoHandDistance =
          this.smoothedTwoHandDistance * (1 - dispAlpha) + currentTwoHandDistance * dispAlpha;
      }

      const span = Math.max(0.05, this.calibration.twoHandMaxDist - this.calibration.twoHandMinDist);
      const twoHandSens = clamp(this.calibration.twoHandSensitivity ?? 1.0, 0.4, 2.5);
      const normalizedDistance = clamp(
        ((this.smoothedTwoHandDistance - this.calibration.twoHandMinDist) / span) * twoHandSens,
        0,
        1
      );

      // Hysteresis prevents flickering when hands hover near any threshold
      const prevCommitted = this.committedDispersion;
      if (
        normalizedDistance <= 0.015 ||
        normalizedDistance >= 0.985 ||
        Math.abs(normalizedDistance - prevCommitted) >= DISPERSION_HYSTERESIS
      ) {
        this.committedDispersion = normalizedDistance;
      }

      let phase: DispersionControlTelemetry['phase'] = this.lastDispersionPhase;
      if (this.committedDispersion <= 0.05) {
        phase = 'COMPLETE';
      } else if (this.committedDispersion >= 0.85) {
        phase = 'DISPERSED';
      } else if (this.committedDispersion < prevCommitted - 0.004) {
        phase = 'RECONSTRUCTING';
      } else if (this.committedDispersion > prevCommitted + 0.004) {
        phase = 'EXPANDING';
      } else if (phase === 'COMPLETE' || phase === 'DISPERSED') {
        phase = this.committedDispersion > 0.5 ? 'EXPANDING' : 'RECONSTRUCTING';
      }
      this.lastDispersionPhase = phase;

      dispersionControl = {
        rawDistance: currentTwoHandDistance,
        smoothedDistance: this.smoothedTwoHandDistance,
        normalizedDistance,
        dispersion: this.committedDispersion,
        phase
      };

      const delta =
        this.prevTwoHandDistance !== null ? this.smoothedTwoHandDistance - this.prevTwoHandDistance : 0;
      this.prevTwoHandDistance = this.smoothedTwoHandDistance;

      if (Math.abs(delta) > 0.004) {
        activeGesture = 'TWO_HAND_ZOOM';
        deltaScale = 1 + delta * 3.0;
        description = `Two-hand Dispersion: ${Math.round(this.committedDispersion * 100)}% (${phase})`;
      } else if (detectedHands[0].isOpenPalm && detectedHands[1].isOpenPalm) {
        activeGesture = 'TWO_OPEN_PALMS';
        description = `Two Open Palms: Wide Interface (${Math.round(this.committedDispersion * 100)}% dispersed)`;
      } else {
        activeGesture = 'TWO_HAND_ZOOM';
        deltaScale = 1.0;
        description = `Two-hand Hold: ${Math.round(this.committedDispersion * 100)}% (${phase})`;
      }
    } else {
      // Clear two-hand distance delta tracking when returning to <=1 hand
      this.prevTwoHandDistance = null;
      this.smoothedTwoHandDistance = null;
    }

    // Priority 1.5: Custom Gesture Evaluation
    if (activeGesture === 'NONE' && primaryHand) {
      const customMatch = customGestureService.matchCustomGesture(primaryHand.landmarks);
      if (customMatch && this.checkCooldown(`CUSTOM_${customMatch.profile.id}`, timestamp)) {
        activeGesture = 'OPEN_PALM';
        description = `Custom Gesture: ${customMatch.profile.name} (${customMatch.profile.actionId})`;
        customGestureMatch = {
          profileId: customMatch.profile.id,
          actionId: customMatch.profile.actionId,
          name: customMatch.profile.name
        };
      }
    }

    // Priority 2: Single-hand gesture evaluation
    if (activeGesture === 'NONE' && primaryHand) {
      const isTransitionStabilizing = this.twoHandExitStabilizeFrames > 0;
      if (isTransitionStabilizing) {
        this.twoHandExitStabilizeFrames--;
        this.smoothedRotVel = { x: 0, y: 0 };
      }

      const vel = primaryHand.velocity;

      // Compute calibrated relative movement rotation (Right/Left + Up/Down)
      const prevC = prevCentroidsByRawIndex[0];
      let effDx = 0;
      let effDy = 0;
      if (prevC && !isTransitionStabilizing) {
        const rawDx = primaryHand.centroid.x - prevC.x;
        const signedDx = this.calibration.mirrorX ? -rawDx : rawDx;
        const rawDy = primaryHand.centroid.y - prevC.y;
        const dzDead = this.calibration.rotationDeadZone;

        if (Math.abs(signedDx) > dzDead) {
          effDx = signedDx - Math.sign(signedDx) * dzDead;
        }
        if (Math.abs(rawDy) > dzDead) {
          effDy = rawDy - Math.sign(rawDy) * dzDead;
        }

        const rotAlpha = 0.45;
        const maxSpeed = this.calibration.maxRotationSpeed;
        const gainX = this.calibration.rotationSensitivity;
        const gainY = this.calibration.verticalSensitivity ?? this.calibration.rotationSensitivity;
        const targetRy = clamp(effDx * gainX, -maxSpeed, maxSpeed);
        const targetRx = clamp(effDy * gainY, -maxSpeed, maxSpeed);
        this.smoothedRotVel.x = this.smoothedRotVel.x * (1 - rotAlpha) + targetRx * rotAlpha;
        this.smoothedRotVel.y = this.smoothedRotVel.y * (1 - rotAlpha) + targetRy * rotAlpha;
        if (effDx === 0 && Math.abs(this.smoothedRotVel.y) < 1e-4) this.smoothedRotVel.y = 0;
        if (effDy === 0 && Math.abs(this.smoothedRotVel.x) < 1e-4) this.smoothedRotVel.x = 0;
      } else if (!prevC) {
        this.smoothedRotVel = { x: 0, y: 0 };
      }

      // Check K: HAND PUSH FORWARD (Rapid movement toward camera)
      if (vel.z < this.calibration.pushSensitivity && primaryHand.isOpenPalm) {
        if (this.checkCooldown('PUSH_FORWARD', timestamp)) {
          activeGesture = 'PUSH_FORWARD';
          this.smoothedRotVel = { x: 0, y: 0 };
          description = 'Push Forward: Cinematic Energy Wave Triggered';
        }
      }
      // Check L: HAND PULL BACK (Rapid movement away from camera)
      else if (vel.z > this.calibration.pullSensitivity) {
        if (this.checkCooldown('PULL_BACK', timestamp)) {
          activeGesture = 'PULL_BACK';
          this.smoothedRotVel = { x: 0, y: 0 };
          description = 'Pull Back: Reconstruct & Anchor Object';
        }
      }
      // Check H: QUICK HAND SWIPES (Horizontal speed threshold; suppressed during 2->1 hand stabilization)
      else if (!isTransitionStabilizing && vel.x > this.calibration.swipeSensitivity && !primaryHand.isPinching) {
        if (this.checkCooldown('SWIPE_RIGHT', timestamp)) {
          activeGesture = 'SWIPE_RIGHT';
          this.smoothedRotVel = { x: 0, y: 0 };
          description = 'Quick Swipe Right: Next Holographic Module';
        }
      } else if (!isTransitionStabilizing && vel.x < -this.calibration.swipeSensitivity && !primaryHand.isPinching) {
        if (this.checkCooldown('SWIPE_LEFT', timestamp)) {
          activeGesture = 'SWIPE_LEFT';
          this.smoothedRotVel = { x: 0, y: 0 };
          description = 'Quick Swipe Left: Previous Holographic Module';
        }
      }
      // Check B: CLOSED FIST (Freeze interaction — clears residual velocity)
      else if (primaryHand.isFist) {
        activeGesture = 'CLOSED_FIST';
        this.smoothedRotVel = { x: 0, y: 0 };
        description = 'Closed Fist: Interaction Frozen / Hold Position';
      }
      // Check I: TWO-FINGER POINT
      else if (primaryHand.isPointing) {
        activeGesture = 'TWO_FINGER_POINT';
        this.smoothedRotVel = { x: 0, y: 0 };
        description = 'Two-Finger Point: Precision Laser Control';
      }
      // Check E: ROTATE WRIST (When wrist tilt exceeds 0.38 rad from upright vertical)
      else if (Math.abs(primaryHand.wristRotation.roll) > 0.38) {
        activeGesture = 'ROTATE_WRIST';
        this.smoothedRotVel = { x: 0, y: 0 };
        const wristGain = clamp(this.calibration.wristRotationSensitivity ?? 1.0, 0.2, 2.5);
        deltaRotation = {
          x: primaryHand.wristRotation.pitch * 0.08 * wristGain,
          y: primaryHand.wristRotation.roll * 0.1 * wristGain,
          z: primaryHand.wristRotation.yaw * 0.08 * wristGain
        };
        sphericalRotationDelta = { ...deltaRotation };
        description = `Wrist Rotate: Rolling ${primaryHand.wristRotation.roll.toFixed(2)} rad`;
      }
      // Check J: DOUBLE PINCH
      else if (primaryHand.isPinching && !this.prevPinchState) {
        this.smoothedRotVel = { x: 0, y: 0 };
        const timeSinceLastPinch =
          this.lastPinchTimestamp > 0 ? timestamp - this.lastPinchTimestamp : 99999;
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
        this.smoothedRotVel = { x: 0, y: 0 };
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
      // Check E2: CONTINUOUS HAND MOVEMENT -> SPHERE ROTATION (with dead zone & fine wrist adjustment)
      else if (!isTransitionStabilizing && (Math.abs(effDx) > 0 || Math.abs(effDy) > 0)) {
        activeGesture = 'SPHERE_ROTATE';
        const wristGain = clamp(this.calibration.wristRotationSensitivity ?? 1.0, 0.2, 2.5);
        const fineWristZ =
          Math.abs(primaryHand.wristRotation.roll) > 0.08
            ? primaryHand.wristRotation.roll * 0.025 * wristGain
            : 0;
        sphericalRotationDelta = {
          x: this.smoothedRotVel.x,
          y: this.smoothedRotVel.y,
          z: fineWristZ
        };
        const dirLabel =
          Math.abs(effDx) >= Math.abs(effDy)
            ? effDx > 0
              ? 'RIGHT'
              : 'LEFT'
            : effDy < 0
            ? 'UP'
            : 'DOWN';
        description = `Spatial Sphere Rotation: Turning ${dirLabel}`;
      }
      // Check A: OPEN PALM (Stationary upright vertical palm)
      else if (primaryHand.isOpenPalm) {
        activeGesture = 'OPEN_PALM';
        description = 'Open Palm: Holographic System Active (Neutral Hold)';
      } else if (isTransitionStabilizing) {
        description = 'Optical Hand Transition Stabilizing';
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

    let angularVelocity = 0;
    let rotationDirection: GestureDetectionResult['rotationDirection'] = 'NONE';
    if (sphericalRotationDelta && (activeGesture === 'SPHERE_ROTATE' || activeGesture === 'ROTATE_WRIST')) {
      const mag = Math.hypot(
        sphericalRotationDelta.x,
        sphericalRotationDelta.y,
        sphericalRotationDelta.z
      );
      angularVelocity = mag / dt;
      if (activeGesture === 'ROTATE_WRIST') {
        rotationDirection = 'ROLL';
      } else if (Math.abs(sphericalRotationDelta.y) >= Math.abs(sphericalRotationDelta.x)) {
        rotationDirection = sphericalRotationDelta.y >= 0 ? 'RIGHT' : 'LEFT';
      } else {
        rotationDirection = sphericalRotationDelta.x < 0 ? 'UP' : 'DOWN';
      }
    }

    return {
      activeGesture,
      confidence: primaryHand ? primaryHand.confidence : 0,
      description,
      hands: detectedHands,
      trackingLost: false,
      twoHandDistance: currentTwoHandDistance,
      deltaScale,
      deltaRotation,
      sphericalRotationDelta,
      deltaTranslation,
      dispersionControl,
      angularVelocity,
      rotationDirection,
      customGestureMatch,
      timestamp
    };
  }
}

export const gestureEngine = new GestureEngine();

