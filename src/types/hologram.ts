export type HologramModelId =
  | 'vision_sphere'
  | 'arc_reactor'
  | 'quantum_tesseract'
  | 'ironman_armor'
  | 'planetary_defense'
  | 'molecular_dna'
  | 'carbon_buckyball'
  | 'hologram_datachart'
  | 'sports_car'
  | 'cyber_motorcycle'
  | 'holo_smartphone'
  | 'quantum_workstation'
  | 'jet_turbine_engine'
  | 'stark_skyscraper'
  | 'industrial_robot_arm'
  | 'planetary_gearbox'
  | 'atom_orbital_model'
  | 'reconstructed_object';

export type DispersionPhase = 'COMPLETE' | 'EXPANDING' | 'DISPERSED' | 'RECONSTRUCTING';

export type HologramRenderMode = 'HYBRID' | 'WIREFRAME' | 'POINT_CLOUD' | 'SOLID_HOLO';

export type SliceAxis = 'x' | 'y' | 'z';

export type ReconstructionPresetId =
  | 'palladium_core'
  | 'mark7_gauntlet'
  | 'repulsor_turbine'
  | 'crystal_lattice';

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

export interface ComponentLabel2D {
  id: string;
  name: string;
  x: number; // viewport px or normalized 0..100%
  y: number;
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
  isFrozen?: boolean;
  isDisintegrated?: boolean;
  disintegrationProgress?: number;
  dispersionPhase?: DispersionPhase;
  isReconstructed?: boolean;
  reconstructionMethodLabel?: string;
  vertexCount?: number;
  faceCount?: number;
  reconstructionProgress?: number;
  renderMode?: HologramRenderMode;
  componentCount?: number;
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
  renderMode: HologramRenderMode;
  glowIntensity: number;     // 0.5 to 3.0
  rotationSpeed: number;     // 0 to 2.0
  particleCount: number;     // 500 to 5000
  colorTheme: 'cyan' | 'orange' | 'matrix_green' | 'red_alert';
  hologramColor: string;
  explodedView: boolean;
  explosionAmount: number;   // 0.0 to 1.0
  dispersionAmount: number;  // 0.0 to 1.0 (two-hand / continuous particle dispersion)
  particleIntensity: number; // 0.3 to 2.0
  orbitalSpeed: number;      // 0.0 to 2.5
  coreBrightness: number;    // 0.3 to 2.0
  scanSpeed: number;         // 0.2 to 2.5
  reducedEffects: boolean;   // Adaptive low-power mode
  showComponentLabels: boolean;
  pulseEnabled: boolean;
  showBoundingBoxes: boolean;
  spatialFormation: LayoutFormation;
  sliceEnabled: boolean;
  sliceAxis: SliceAxis;
  sliceOffset: number;       // -2.0 to 2.0
}

export interface LaserTargetInfo {
  objectId: string;
  objectName: string;
  point: { x: number; y: number; z: number };
}

export interface FloatingPanelState {
  id: string;
  title: string;
  type: 'TELEMETRY' | 'TASKS' | 'NOTES' | 'TIMER' | 'AUTOMATION' | 'DATA_VIZ';
  position: { x: number; y: number; z: number };
  isMinimized: boolean;
  isPinned: boolean;
}
