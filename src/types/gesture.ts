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
  | 'TWO_HAND_ZOOM'       // Gesture F: Expand or shrink holographic object / scale
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

export interface GestureDetectionResult {
  activeGesture: GestureType;
  confidence: number;
  description: string;
  hands: DetectedHand[];
  twoHandDistance?: number;
  deltaScale?: number;
  deltaRotation?: { x: number; y: number; z: number };
  deltaTranslation?: { x: number; y: number; z: number };
  timestamp: number;
}

export interface GestureCalibrationSettings {
  pinchThreshold: number;      // Distance below which thumb+index is considered a pinch (default: 0.05)
  openPalmThreshold: number;   // Distance average for all fingertips extended (default: 0.18)
  fistThreshold: number;       // Distance average for all fingertips curled (default: 0.12)
  smoothingFactor: number;     // Exponential smoothing alpha (0.1 - 0.9, default: 0.5)
  pushSensitivity: number;     // Z-velocity threshold for push forward (default: -0.04)
  pullSensitivity: number;     // Z-velocity threshold for pull back (default: 0.04)
  swipeSensitivity: number;    // X-velocity threshold for quick swipe (default: 0.05)
}
