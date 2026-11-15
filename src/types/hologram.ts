export type HologramModelId =
  | 'arc_reactor'
  | 'quantum_tesseract'
  | 'ironman_armor'
  | 'planetary_defense'
  | 'molecular_dna';

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

export interface HologramTransform {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: number;
}

export type InteractionMode =
  | 'GESTURE'       // Mode 1: Control using hands
  | 'VOICE'         // Mode 2: Spoken commands
  | 'COMBINED'      // Mode 3: Voice + Hand simultaneously
  | 'HOLOGRAM'      // Mode 4: 3D manipulation focus
  | 'CINEMATIC'     // Mode 5: Advanced visual animations
  | 'STANDBY'       // Mode 6: Minimal futuristic interface
  | 'DESKTOP';      // Mode 7: Desktop assistant productivity mode

export interface HologramVisualSettings {
  wireframe: boolean;
  glowIntensity: number;     // 0.5 to 3.0
  rotationSpeed: number;     // 0 to 2.0
  particleCount: number;     // 500 to 5000
  colorTheme: 'cyan' | 'orange' | 'matrix_green' | 'red_alert';
  hologramColor: string;
  explodedView: boolean;
  pulseEnabled: boolean;
}
