export type HologramModelId =
  | 'arc_reactor'
  | 'quantum_tesseract'
  | 'ironman_armor'
  | 'planetary_defense'
  | 'molecular_dna'
  | 'carbon_buckyball'
  | 'hologram_datachart';

export interface HologramModelInfo {
  id: HologramModelId;
  name: string;
  codename: string;
  category: string;
  description: string;
  specs: {
    energyOutput: string;
    containmentField: string;
    structuralIntegrity: string;
    temperature: string;
  };
}

export interface SpatialObjectState {
  id: string;
  modelId: HologramModelId;
  name: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: number;
  isSelected: boolean;
  groupId?: string;
  isLocked: boolean;
}

export type LayoutFormation = 'FREE' | 'GRID' | 'ORBIT' | 'LINE' | 'SINGLE';

export type InteractionMode =
  | 'GESTURE'       // Mode 1: Control using hands
  | 'VOICE'         // Mode 2: Spoken commands
  | 'COMBINED'      // Mode 3: Voice + Hand simultaneously
  | 'HOLOGRAM'      // Mode 4: 3D manipulation focus
  | 'CINEMATIC'     // Mode 5: Advanced visual animations
  | 'STANDBY'       // Mode 6: Minimal futuristic interface
  | 'DESKTOP'       // Mode 7: Desktop assistant productivity mode
  | 'WORKSPACE';    // Mode 8: Multi-object spatial workspace

export interface HologramVisualSettings {
  wireframe: boolean;
  glowIntensity: number;     // 0.5 to 3.0
  rotationSpeed: number;     // 0 to 2.0
  particleCount: number;     // 500 to 5000
  colorTheme: 'cyan' | 'orange' | 'matrix_green' | 'red_alert';
  hologramColor: string;
  explodedView: boolean;
  pulseEnabled: boolean;
  showBoundingBoxes: boolean;
  spatialFormation: LayoutFormation;
}

export interface FloatingPanelState {
  id: string;
  title: string;
  type: 'TELEMETRY' | 'TASKS' | 'NOTES' | 'TIMER' | 'AUTOMATION' | 'DATA_VIZ';
  position: { x: number; y: number; z: number };
  isMinimized: boolean;
  isPinned: boolean;
}
