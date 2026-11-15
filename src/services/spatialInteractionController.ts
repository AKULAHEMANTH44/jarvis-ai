import {
  DispersionControlTelemetry,
  GestureCalibrationSettings,
  GestureDetectionResult,
  GestureType,
  SpatialInteractionAction,
  SpatialPriorityTier,
  SpatialTrackingStatus,
  SpatialVisualFeedback
} from '../types/gesture';

export interface SpatialInteractionCommand {
  priorityTier: SpatialPriorityTier;
  activeAction: SpatialInteractionAction;
  trackingStatus: SpatialTrackingStatus;
  shouldClearInertia: boolean;
  rotationDelta?: { x: number; y: number; z: number };
  deltaRotation?: { x: number; y: number; z: number };
  translationDelta?: { x: number; y: number; z: number };
  scaleMultiplier?: number;
  dispersionControl?: DispersionControlTelemetry;
  laserPointNdc?: { x: number; y: number };
  discreteGesture?: GestureType;
  navigationSwipe?: 'SWIPE_LEFT' | 'SWIPE_RIGHT';
  handCentroid?: { x: number; y: number; z: number };
  feedback: SpatialVisualFeedback;
}

export interface SpatialControllerOptions {
  trackingLossGraceMs?: number;
  reacquisitionStabilizeFrames?: number;
}

/**
 * Centralized Phase 2 Spatial Interaction Controller.
 *
 * Cleanly decouples MediaPipe / GestureEngine optical output from Three.js scene mutations:
 * 1. Enforces deterministic 5-tier priority arbitration:
 *    Tier 1: Two-hand distance / dispersion control (suspends all single-hand actions)
 *    Tier 2: Active hand spherical rotation & wrist roll
 *    Tier 3: Pinch selection / 3D translation / double-pinch
 *    Tier 4: Discrete poses (push, pull, fist, two-finger laser, open palm)
 *    Tier 5: Navigation swipes (prev/next module)
 * 2. Smoothly absorbs temporary tracking dropouts via a grace window (freezes motion, avoids jumping)
 *    and stabilizes hand reappearance without sudden rotation or scale spikes.
 */
export class SpatialInteractionController {
  private trackingLossGraceMs: number;
  private reacquisitionStabilizeFrames: number;

  private trackingStatus: SpatialTrackingStatus = 'IDLE';
  private wasEverTracking: boolean = false;
  private trackingLossStartMs: number | null = null;
  private stabilizeFramesRemaining: number = 0;

  private lastCommittedDispersion: number = 0;
  private lastDispersionPhase: DispersionControlTelemetry['phase'] = 'COMPLETE';
  private smoothedAngularSpeed: number = 0;

  constructor(options: SpatialControllerOptions = {}) {
    this.trackingLossGraceMs = options.trackingLossGraceMs ?? 320;
    this.reacquisitionStabilizeFrames = options.reacquisitionStabilizeFrames ?? 2;
  }

  public reset() {
    this.trackingStatus = 'IDLE';
    this.wasEverTracking = false;
    this.trackingLossStartMs = null;
    this.stabilizeFramesRemaining = 0;
    this.lastCommittedDispersion = 0;
    this.lastDispersionPhase = 'COMPLETE';
    this.smoothedAngularSpeed = 0;
  }

  public setExternalDispersion(dispersion: number, phase?: DispersionControlTelemetry['phase']) {
    const clamped = Math.max(0, Math.min(1, dispersion));
    this.lastCommittedDispersion = clamped;
    if (phase) {
      this.lastDispersionPhase = phase;
    } else if (clamped <= 0.04) {
      this.lastDispersionPhase = 'COMPLETE';
    } else if (clamped >= 0.85) {
      this.lastDispersionPhase = 'DISPERSED';
    }
  }

  public process(
    detection: GestureDetectionResult,
    calibration: GestureCalibrationSettings
  ): SpatialInteractionCommand {
    const now = detection.timestamp || performance.now();
    const hasHands = detection.hands && detection.hands.length > 0;

    // A. Tracking Loss & Smooth Recovery State Machine
    if (!hasHands) {
      this.smoothedAngularSpeed *= 0.5;
      if (this.smoothedAngularSpeed < 0.01) this.smoothedAngularSpeed = 0;

      if (this.wasEverTracking) {
        if (this.trackingLossStartMs === null) {
          this.trackingLossStartMs = now;
        }
        const elapsedLoss = now - this.trackingLossStartMs;
        if (elapsedLoss <= this.trackingLossGraceMs) {
          this.trackingStatus = 'TEMPORARY_LOSS';
          return {
            priorityTier: 0,
            activeAction: 'TRACKING_HOLD',
            trackingStatus: 'TEMPORARY_LOSS',
            shouldClearInertia: true,
            feedback: this.buildFeedback({
              activeAction: 'TRACKING_HOLD',
              priorityTier: 0,
              trackingStatus: 'TEMPORARY_LOSS',
              isRotating: false,
              rotationSpeed: 0,
              rotationDirection: 'NONE',
              badgeText: 'OPTICAL TRACKING LOST // HOLDING STATE'
            })
          };
        }
        this.trackingStatus = 'LOST';
        return {
          priorityTier: 0,
          activeAction: 'IDLE',
          trackingStatus: 'LOST',
          shouldClearInertia: true,
          feedback: this.buildFeedback({
            activeAction: 'IDLE',
            priorityTier: 0,
            trackingStatus: 'LOST',
            isRotating: false,
            rotationSpeed: 0,
            rotationDirection: 'NONE',
            badgeText: detection.trackingLost ? 'OPTICAL TRACKING LOST // STABILIZING' : null
          })
        };
      }

      this.trackingStatus = 'IDLE';
      return {
        priorityTier: 0,
        activeAction: 'IDLE',
        trackingStatus: 'IDLE',
        shouldClearInertia: false,
        feedback: this.buildFeedback({
          activeAction: 'IDLE',
          priorityTier: 0,
          trackingStatus: 'IDLE',
          isRotating: false,
          rotationSpeed: 0,
          rotationDirection: 'NONE',
          badgeText: null
        })
      };
    }

    // Hands present -> check if recovering from a tracking loss
    if (this.trackingLossStartMs !== null) {
      this.trackingLossStartMs = null;
      this.stabilizeFramesRemaining = this.reacquisitionStabilizeFrames;
    }
    this.wasEverTracking = true;

    if (this.stabilizeFramesRemaining > 0) {
      this.stabilizeFramesRemaining--;
      this.trackingStatus = 'RECOVERING';
      this.smoothedAngularSpeed = 0;
      return {
        priorityTier: 0,
        activeAction: 'TRACKING_HOLD',
        trackingStatus: 'RECOVERING',
        shouldClearInertia: true,
        handCentroid: detection.hands[0]?.centroid,
        feedback: this.buildFeedback({
          activeAction: 'TRACKING_HOLD',
          priorityTier: 0,
          trackingStatus: 'RECOVERING',
          isRotating: false,
          rotationSpeed: 0,
          rotationDirection: 'NONE',
          badgeText: 'OPTICAL HAND REACQUIRED // STABILIZING'
        })
      };
    }

    this.trackingStatus = 'TRACKING';
    const g = detection.activeGesture;
    const primaryCentroid = detection.hands[0]?.centroid;

    // B. Strict 5-Tier Deterministic Priority Arbitration
    // Tier 1: Two-hand distance / dispersion control (suspends all single-hand actions)
    if (detection.hands.length >= 2 || g === 'TWO_HAND_ZOOM' || g === 'TWO_OPEN_PALMS') {
      this.smoothedAngularSpeed = 0;
      if (detection.dispersionControl) {
        this.lastCommittedDispersion = detection.dispersionControl.dispersion;
        this.lastDispersionPhase = detection.dispersionControl.phase;
      }

      const scaleDelta =
        detection.deltaScale && Math.abs(detection.deltaScale - 1.0) > 0.002
          ? detection.deltaScale
          : undefined;
      const pct = Math.round(this.lastCommittedDispersion * 100);
      const badge =
        g === 'TWO_OPEN_PALMS'
          ? `WIDE INTERFACE // DISPERSION ${pct}%`
          : `TWO-HAND DISPERSION ${pct}% · ${this.lastDispersionPhase}`;

      return {
        priorityTier: 1,
        activeAction: 'TWO_HAND_DISPERSION',
        trackingStatus: 'TRACKING',
        shouldClearInertia: true,
        scaleMultiplier: scaleDelta,
        dispersionControl: detection.dispersionControl,
        discreteGesture: g === 'TWO_OPEN_PALMS' ? 'TWO_OPEN_PALMS' : undefined,
        handCentroid: primaryCentroid,
        feedback: this.buildFeedback({
          activeAction: 'TWO_HAND_DISPERSION',
          priorityTier: 1,
          trackingStatus: 'TRACKING',
          isRotating: false,
          rotationSpeed: 0,
          rotationDirection: 'NONE',
          badgeText: badge
        })
      };
    }

    // Tier 2: Active Hand Rotation (SPHERE_ROTATE / ROTATE_WRIST)
    if (
      (g === 'SPHERE_ROTATE' && detection.sphericalRotationDelta) ||
      (g === 'ROTATE_WRIST' && detection.deltaRotation)
    ) {
      const rotDelta =
        g === 'SPHERE_ROTATE'
          ? detection.sphericalRotationDelta!
          : detection.deltaRotation!;

      const maxStep = Math.max(0.02, calibration.maxRotationSpeed);
      const clampedRot = {
        x: Math.max(-maxStep, Math.min(maxStep, rotDelta.x)),
        y: Math.max(-maxStep, Math.min(maxStep, rotDelta.y)),
        z: Math.max(-maxStep, Math.min(maxStep, rotDelta.z))
      };

      const instantSpeed =
        detection.angularVelocity ??
        Math.hypot(clampedRot.x, clampedRot.y, clampedRot.z) * 30;
      this.smoothedAngularSpeed = this.smoothedAngularSpeed * 0.55 + instantSpeed * 0.45;
      const dir = detection.rotationDirection || (g === 'ROTATE_WRIST' ? 'ROLL' : 'RIGHT');

      return {
        priorityTier: 2,
        activeAction: 'ACTIVE_ROTATION',
        trackingStatus: 'TRACKING',
        shouldClearInertia: false,
        rotationDelta: g === 'SPHERE_ROTATE' ? clampedRot : undefined,
        deltaRotation: g === 'ROTATE_WRIST' ? clampedRot : undefined,
        handCentroid: primaryCentroid,
        feedback: this.buildFeedback({
          activeAction: 'ACTIVE_ROTATION',
          priorityTier: 2,
          trackingStatus: 'TRACKING',
          isRotating: this.smoothedAngularSpeed > 0.05,
          rotationSpeed: this.smoothedAngularSpeed,
          rotationDirection: dir,
          badgeText:
            g === 'ROTATE_WRIST'
              ? `WRIST ROTATION · ${this.smoothedAngularSpeed.toFixed(1)} rad/s`
              : `ROTATING ${dir} · ${this.smoothedAngularSpeed.toFixed(1)} rad/s`
        })
      };
    }

    // Decay angular speed telemetry when not actively rotating
    this.smoothedAngularSpeed *= 0.65;
    if (this.smoothedAngularSpeed < 0.02) this.smoothedAngularSpeed = 0;

    // Tier 3: Pinch Selection / 3D Translation / Double Pinch
    if (g === 'PINCH' || g === 'MOVE_PINCHED' || g === 'DOUBLE_PINCH') {
      return {
        priorityTier: 3,
        activeAction: 'PINCH_MANIPULATION',
        trackingStatus: 'TRACKING',
        shouldClearInertia: true,
        translationDelta: g === 'MOVE_PINCHED' ? detection.deltaTranslation : undefined,
        discreteGesture: g,
        handCentroid: primaryCentroid,
        feedback: this.buildFeedback({
          activeAction: 'PINCH_MANIPULATION',
          priorityTier: 3,
          trackingStatus: 'TRACKING',
          isRotating: false,
          rotationSpeed: 0,
          rotationDirection: 'NONE',
          badgeText:
            g === 'MOVE_PINCHED'
              ? 'PINCH TRANSLATE // 3D OBJECT'
              : g === 'DOUBLE_PINCH'
              ? 'DOUBLE PINCH // EXPLODED ASSEMBLY'
              : 'PINCH LOCK // TARGET ACQUIRED'
        })
      };
    }

    // Tier 4: Discrete Gestures (CLOSED_FIST, TWO_FINGER_POINT, PUSH_FORWARD, PULL_BACK, OPEN_PALM)
    if (
      g === 'CLOSED_FIST' ||
      g === 'TWO_FINGER_POINT' ||
      g === 'PUSH_FORWARD' ||
      g === 'PULL_BACK' ||
      g === 'OPEN_PALM'
    ) {
      let laserPointNdc: { x: number; y: number } | undefined;
      if (g === 'TWO_FINGER_POINT' && detection.hands[0]?.landmarks[8]) {
        const indexTip = detection.hands[0].landmarks[8];
        laserPointNdc = {
          x: (1 - indexTip.x) * 2 - 1,
          y: -(indexTip.y * 2 - 1)
        };
      }

      const badgeMap: Record<string, string> = {
        CLOSED_FIST: 'CLOSED FIST // HOLOGRAM FROZEN',
        TWO_FINGER_POINT: 'PRECISION LASER RETICLE',
        PUSH_FORWARD: 'ENERGY DISPLACEMENT SHOCKWAVE',
        PULL_BACK: 'RECONSTRUCT & RETRIEVE ANCHOR',
        OPEN_PALM: 'OPEN PALM // STATIONARY NEUTRAL HOLD'
      };

      return {
        priorityTier: 4,
        activeAction: 'DISCRETE_GESTURE',
        trackingStatus: 'TRACKING',
        shouldClearInertia: g === 'CLOSED_FIST' || g === 'PUSH_FORWARD' || g === 'PULL_BACK',
        laserPointNdc,
        discreteGesture: g,
        handCentroid: primaryCentroid,
        feedback: this.buildFeedback({
          activeAction: 'DISCRETE_GESTURE',
          priorityTier: 4,
          trackingStatus: 'TRACKING',
          isRotating: false,
          rotationSpeed: 0,
          rotationDirection: 'NONE',
          badgeText: badgeMap[g] || null
        })
      };
    }

    // Tier 5: Navigation Swipes
    if (g === 'SWIPE_LEFT' || g === 'SWIPE_RIGHT') {
      return {
        priorityTier: 5,
        activeAction: 'NAVIGATION_SWIPE',
        trackingStatus: 'TRACKING',
        shouldClearInertia: true,
        navigationSwipe: g,
        discreteGesture: g,
        handCentroid: primaryCentroid,
        feedback: this.buildFeedback({
          activeAction: 'NAVIGATION_SWIPE',
          priorityTier: 5,
          trackingStatus: 'TRACKING',
          isRotating: false,
          rotationSpeed: 0,
          rotationDirection: 'NONE',
          badgeText: g === 'SWIPE_RIGHT' ? 'SWIPE // NEXT MODULE' : 'SWIPE // PREV MODULE'
        })
      };
    }

    // Stationary hand with no active gesture -> zero drift
    return {
      priorityTier: 0,
      activeAction: 'IDLE',
      trackingStatus: 'TRACKING',
      shouldClearInertia: false,
      handCentroid: primaryCentroid,
      feedback: this.buildFeedback({
        activeAction: 'IDLE',
        priorityTier: 0,
        trackingStatus: 'TRACKING',
        isRotating: false,
        rotationSpeed: 0,
        rotationDirection: 'NONE',
        badgeText: null
      })
    };
  }

  private buildFeedback(partial: {
    activeAction: SpatialInteractionAction;
    priorityTier: SpatialPriorityTier;
    trackingStatus: SpatialTrackingStatus;
    isRotating: boolean;
    rotationSpeed: number;
    rotationDirection: 'LEFT' | 'RIGHT' | 'UP' | 'DOWN' | 'ROLL' | 'NONE';
    badgeText: string | null;
  }): SpatialVisualFeedback {
    const reconProgress =
      this.lastDispersionPhase === 'RECONSTRUCTING'
        ? Math.round((1 - this.lastCommittedDispersion) * 100)
        : this.lastDispersionPhase === 'COMPLETE'
        ? 100
        : 0;

    return {
      ...partial,
      dispersion: this.lastCommittedDispersion,
      dispersionPhase: this.lastDispersionPhase,
      reconstructionProgress: reconProgress
    };
  }
}

export const spatialInteractionController = new SpatialInteractionController();
