export interface Landmark3D {
  x: number;
  y: number;
  z: number;
}

export type HandLandmarks = Landmark3D[];

export type GestureType =
  | 'NONE'
  | 'OPEN_PALM'          // Gesture A: Activate interface / reveal main 3D object
  | 'CLOSED_FIST'         // Gesture B: Pause object movement / visual standby state
  | 'PINCH'               // Gesture C: Grab holographic object / select element
  | 'MOVE_PINCHED'        // Gesture D: Move selected object in 3D space
  | 'ROTATE_WRIST'        // Gesture E: Rotate selected holographic object
  | 'SPHERE_ROTATE'       // Gesture E2: Continuous hand-driven 3D spherical rotation
  | 'TWO_HAND_ZOOM'       // Gesture F: Expand or shrink holographic object & dispersion
  | 'TWO_OPEN_PALMS'      // Gesture G: Activate large wide holographic interface
  | 'SWIPE_LEFT'          // Gesture H: Switch panels / model prev
  | 'SWIPE_RIGHT'         // Gesture H: Switch panels / model next
  | 'TWO_FINGER_POINT'    // Gesture I: Laser select / activate highlighted control
  | 'DOUBLE_PINCH'        // Gesture J: Trigger diagnostic pulse action
  | 'PUSH_FORWARD'        // Gesture K: Trigger cinematic holographic energy-wave
  | 'PULL_BACK';          // Gesture L: Return selected object to original anchor

export interface DetectedHand {
  handedness: 'Left' | 'Right';
  landmarks: HandLandmarks;
  confidence: number;
  centroid: Landmark3D;
  pinchDistance: number;
  isPinching: boolean;
  isOpenPalm: boolean;
  isFist: boolean;
  isPointing: boolean;
  wristRotation: { roll: number; pitch: number; yaw: number };
  velocity: Landmark3D;
}

export interface DispersionControlTelemetry {
  rawDistance: number;
  smoothedDistance: number;
  normalizedDistance: number;
  dispersion: number; // 0..1 continuous hysteresis-filtered dispersion
  phase: 'COMPLETE' | 'EXPANDING' | 'DISPERSED' | 'RECONSTRUCTING';
}

export type SpatialTrackingStatus =
  | 'IDLE'
  | 'TRACKING'
  | 'TEMPORARY_LOSS'
  | 'RECOVERING'
  | 'LOST';

export type SpatialInteractionAction =
  | 'IDLE'
  | 'TWO_HAND_DISPERSION'
  | 'ACTIVE_ROTATION'
  | 'PINCH_MANIPULATION'
  | 'DISCRETE_GESTURE'
  | 'NAVIGATION_SWIPE'
  | 'TRACKING_HOLD';

export type SpatialPriorityTier = 0 | 1 | 2 | 3 | 4 | 5;

export interface GestureDetectionResult {
  activeGesture: GestureType;
  confidence: number;
  description: string;
  hands: DetectedHand[];
  trackingLost?: boolean;
  twoHandDistance?: number;
  deltaScale?: number;
  deltaRotation?: { x: number; y: number; z: number };
  sphericalRotationDelta?: { x: number; y: number; z: number };
  deltaTranslation?: { x: number; y: number; z: number };
  dispersionControl?: DispersionControlTelemetry;
  angularVelocity?: number; // rad/s instantaneous rotational speed
  rotationDirection?: 'LEFT' | 'RIGHT' | 'UP' | 'DOWN' | 'ROLL' | 'NONE';
  customGestureMatch?: { profileId: string; actionId: string; name: string };
  timestamp: number;
}

export interface GestureCalibrationSettings {
  pinchThreshold: number;         // Distance below which thumb+index is considered a pinch
  openPalmThreshold: number;      // Distance average for all fingertips extended
  fistThreshold: number;          // Distance average for all fingertips curled
  smoothingFactor: number;        // Exponential smoothing alpha (0.1 - 0.9)
  pushSensitivity: number;        // Z-velocity threshold for push forward
  pullSensitivity: number;        // Z-velocity threshold for pull back
  swipeSensitivity: number;       // X-velocity threshold for quick swipe
  rotationSensitivity: number;    // Horizontal hand-movement to sphere Y-rotation gain
  verticalSensitivity: number;    // Vertical hand-movement to sphere X-tilt gain
  wristRotationSensitivity: number; // Fine wrist-roll adjustment gain
  rotationDeadZone: number;       // Normalized movement dead zone to prevent drift
  maxRotationSpeed: number;       // Max angular step (rad/frame) clamp
  rotationDamping: number;        // Exponential inertia damping rate (2.0 - 14.0)
  mirrorX: boolean;               // Mirror X for selfie front-facing webcams
  twoHandMinDist: number;         // Hand separation mapped to dispersion 0.0
  twoHandMaxDist: number;         // Hand separation mapped to dispersion 1.0
  twoHandSensitivity: number;     // Two-hand dispersion sensitivity multiplier (0.5 - 2.0)
  dispersionSmoothing: number;    // EMA factor for two-hand distance smoothing
  confidenceThreshold: number;    // Minimum MediaPipe confidence threshold (0.2 - 0.9)
}

export interface SpatialVisualFeedback {
  activeAction: SpatialInteractionAction;
  priorityTier: SpatialPriorityTier;
  trackingStatus: SpatialTrackingStatus;
  isRotating: boolean;
  rotationSpeed: number; // rad/s
  rotationDirection: 'LEFT' | 'RIGHT' | 'UP' | 'DOWN' | 'ROLL' | 'NONE';
  dispersion: number; // 0..1
  dispersionPhase: DispersionControlTelemetry['phase'];
  reconstructionProgress: number; // 0..100 when reconstructing
  badgeText: string | null;
}

