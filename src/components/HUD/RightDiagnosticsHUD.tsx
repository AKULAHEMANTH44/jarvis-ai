import React, { useEffect, useState } from 'react';
import { HolographicPanel } from '../Common/HolographicPanel';
import { CircularGauge } from '../Common/CircularGauge';
import {
  HologramModelId,
  HologramModelInfo,
  HologramVisualSettings,
  SpatialObjectState
} from '../../types/hologram';
import { Layers, Cpu, Wrench, KeyRound } from 'lucide-react';
import { audioService } from '../../services/soundFx';

interface RightDiagnosticsHUDProps {
  currentModelId: HologramModelId;
  selectedObject?: SpatialObjectState | null;
  onSelectModel: (id: HologramModelId) => void;
  visualSettings: HologramVisualSettings;
  onUpdateVisualSettings: (settings: Partial<HologramVisualSettings>) => void;
  onOpenAIConfig?: () => void;
  requestedTab?: { tab: 'MODELS' | 'DIAGNOSTICS' | 'SETTINGS'; nonce: number } | null;
}

const MODEL_CATALOG: HologramModelInfo[] = [
  {
    id: 'vision_sphere',
    name: 'VISION 1.2 CORE',
    codename: 'SPATIAL INTELLIGENCE SPHERE',
    category: 'PRIMARY INTERFACE',
    description: '10-layer spherical holographic core with orbital gimbals, radial ticks, Fresnel plasma & reversible particle engine.',
    specs: {
      energyOutput: '4.8 GJ/s',
      containmentField: '99.9%',
      structuralIntegrity: '100%',
      temperature: '3,850 K'
    }
  },
  {
    id: 'arc_reactor',
    name: 'ARC REACTOR MK-VII',
    codename: 'CLEAN ENERGY CORE',
    category: 'POWER GENERATION',
    description: 'Vibranium-shielded palladium/nanotech fusion ring with 10 magnetic coils.',
    specs: {
      energyOutput: '3.2 GJ/s',
      containmentField: '99.8%',
      structuralIntegrity: '100%',
      temperature: '4,200 K'
    }
  },
  {
    id: 'quantum_tesseract',
    name: 'QUANTUM TESSERACT',
    codename: '4D HYPERCUBE',
    category: 'SINGULARITY MATRIX',
    description: 'Higher-dimensional spatial containment cube harnessing vacuum energy.',
    specs: {
      energyOutput: '8.4 TJ/s',
      containmentField: '97.4%',
      structuralIntegrity: '94%',
      temperature: '12 K'
    }
  },
  {
    id: 'ironman_armor',
    name: 'IRON MAN MARK VII',
    codename: 'AVENGER CHASSIS',
    category: 'TACTICAL SCHEMATIC',
    description: 'Full telemetry breakdown with rapid-deployment laser pod targeters.',
    specs: {
      energyOutput: '1.8 GJ/s',
      containmentField: '100%',
      structuralIntegrity: '98%',
      temperature: '340 K'
    }
  },
  {
    id: 'planetary_defense',
    name: 'STARK DEFENSE GRID',
    codename: 'GLOBAL SENTINEL',
    category: 'ORBITAL SURVEILLANCE',
    description: 'Synchronous low-orbit defense satellite shield with real-time vectoring.',
    specs: {
      energyOutput: '540 MW',
      containmentField: '99.9%',
      structuralIntegrity: '99%',
      temperature: '260 K'
    }
  },
  {
    id: 'molecular_dna',
    name: 'NANOTECH HELIX',
    codename: 'CELLULAR SYNTHESIS',
    category: 'BIOMEDICAL MATRIX',
    description: 'Synthesized extreme-density molecular double helix for rapid tissue healing.',
    specs: {
      energyOutput: '95 MW',
      containmentField: '100%',
      structuralIntegrity: '96%',
      temperature: '310 K'
    }
  },
  {
    id: 'carbon_buckyball',
    name: 'FULLERENE C60',
    codename: 'CARBON NANOMATRIX',
    category: 'MOLECULAR LATTICE',
    description: 'Spherical 60-vertex carbon fullerene cage with high-tensile quantum bonding.',
    specs: {
      energyOutput: '220 MW',
      containmentField: '100%',
      structuralIntegrity: '99%',
      temperature: '298 K'
    }
  },
  {
    id: 'hologram_datachart',
    name: 'TELEMETRY SPECTRUM',
    codename: '3D DATA EQUALIZER',
    category: 'ACOUSTIC ANALYZER',
    description: 'Volumetric real-time frequency distribution with orbital trajectory spline.',
    specs: {
      energyOutput: '110 MW',
      containmentField: '99.5%',
      structuralIntegrity: '95%',
      temperature: '305 K'
    }
  },
  {
    id: 'sports_car',
    name: 'HYPERCAR AERO CHASSIS',
    codename: 'VEHICLE BLUEPRINT',
    category: 'AUTOMOTIVE LAB',
    description: 'Multi-layer aero monocoque vehicle with dual-flux drivetrain, canopy & vector wheels.',
    specs: {
      energyOutput: '1.1 MW',
      containmentField: '99.9%',
      structuralIntegrity: '100%',
      temperature: '335 K'
    }
  },
  {
    id: 'cyber_motorcycle',
    name: 'AUTONOMOUS SUPERBIKE',
    codename: 'TWO-WHEEL VECTOR',
    category: 'AUTOMOTIVE LAB',
    description: 'Titanium trellis motorcycle chassis with fusion cell tank & gyro-stabilized wheels.',
    specs: {
      energyOutput: '420 kW',
      containmentField: '99.6%',
      structuralIntegrity: '99%',
      temperature: '328 K'
    }
  },
  {
    id: 'holo_smartphone',
    name: 'HOLO-GLASS SMARTPHONE',
    codename: 'MOBILE COMPUTE',
    category: 'CONSUMER HARDWARE',
    description: 'Explodable titanium smartphone stack with OLED display, neural SoC & optical array.',
    specs: {
      energyOutput: '18 W',
      containmentField: '100%',
      structuralIntegrity: '100%',
      temperature: '304 K'
    }
  },
  {
    id: 'quantum_workstation',
    name: 'QUANTUM COMPUTE TOWER',
    codename: 'WORKSTATION RIG',
    category: 'COMPUTING SYSTEMS',
    description: 'Dual tensor compute blade workstation with cryo-liquid loop & logic backplane.',
    specs: {
      energyOutput: '1.4 kW',
      containmentField: '99.9%',
      structuralIntegrity: '100%',
      temperature: '286 K'
    }
  },
  {
    id: 'jet_turbine_engine',
    name: 'TURBOFAN JET ENGINE',
    codename: 'PROPULSION CORE',
    category: 'AEROSPACE PROPULSION',
    description: 'High-bypass jet turbine assembly with titanium fan stage, HP compressor & nozzle.',
    specs: {
      energyOutput: '42 MW',
      containmentField: '99.4%',
      structuralIntegrity: '98%',
      temperature: '1,480 K'
    }
  },
  {
    id: 'stark_skyscraper',
    name: 'STARK SPIRE ARCHITECTURE',
    codename: 'STRUCTURAL TOWER',
    category: 'CIVIL ARCHITECTURE',
    description: 'Diagrid exo-core tower with seismic foundation plinth, launch deck & arc spire.',
    specs: {
      energyOutput: '1.2 GW',
      containmentField: '100%',
      structuralIntegrity: '100%',
      temperature: '295 K'
    }
  },
  {
    id: 'industrial_robot_arm',
    name: '6-DOF ASSEMBLY ROBOT',
    codename: 'PRECISION KINEMATICS',
    category: 'ROBOTICS LAB',
    description: 'Articulated harmonic turret robot arm with hydraulic boom & servo laser gripper.',
    specs: {
      energyOutput: '12 kW',
      containmentField: '100%',
      structuralIntegrity: '99%',
      temperature: '312 K'
    }
  },
  {
    id: 'planetary_gearbox',
    name: 'PLANETARY GEARBOX',
    codename: 'TORQUE TRANSMISSION',
    category: 'MECHANICAL SYSTEMS',
    description: 'Sun pinion, tri-planet carrier and internal annulus ring gear reduction unit.',
    specs: {
      energyOutput: '85 kW',
      containmentField: '100%',
      structuralIntegrity: '100%',
      temperature: '318 K'
    }
  },
  {
    id: 'atom_orbital_model',
    name: 'QUANTUM ATOMIC LATTICE',
    codename: 'ELECTRON SHELLS',
    category: 'SCIENTIFIC MODEL',
    description: 'Proton-neutron cluster nucleus with inclined valence electron orbital shells.',
    specs: {
      energyOutput: 'QUANTUM',
      containmentField: '99.9%',
      structuralIntegrity: '100%',
      temperature: '4 K'
    }
  },
  {
    id: 'reconstructed_object',
    name: 'RECONSTRUCTED SPECIMEN',
    codename: 'LAB MESH SYNTHESIS',
    category: 'RECONSTRUCTION LAB',
    description: 'Volumetric mesh from GLB/GLTF/OBJ/STL import or illustrative image depth/hull approximation.',
    specs: {
      energyOutput: '680 MW',
      containmentField: '99.7%',
      structuralIntegrity: '99%',
      temperature: '295 K'
    }
  }
];

export const RightDiagnosticsHUD: React.FC<RightDiagnosticsHUDProps> = ({
  currentModelId,
  selectedObject,
  onSelectModel,
  visualSettings,
  onUpdateVisualSettings,
  onOpenAIConfig,
  requestedTab
}) => {
  const [activeTab, setActiveTab] = useState<'MODELS' | 'DIAGNOSTICS' | 'SETTINGS'>('MODELS');

  useEffect(() => {
    if (requestedTab) {
      setActiveTab(requestedTab.tab);
    }
  }, [requestedTab]);

  const activeModel = MODEL_CATALOG.find((m) => m.id === (selectedObject?.modelId || currentModelId)) || MODEL_CATALOG[0];

  const handleTabChange = (tab: 'MODELS' | 'DIAGNOSTICS' | 'SETTINGS') => {
    audioService.playChirp(1400);
    setActiveTab(tab);
  };

  const handleSelectModel = (id: HologramModelId) => {
    audioService.playActivationWhoosh();
    onSelectModel(id);
  };

  const handleThemeChange = (theme: HologramVisualSettings['colorTheme']) => {
    audioService.playChirp(1600);
    onUpdateVisualSettings({ colorTheme: theme });
  };

  return (
    <div className="flex flex-col space-y-3 w-80 text-xs">
      {/* Tab Navigation */}
      <div className="flex rounded-lg bg-black/70 border border-cyan-500/30 p-1 space-x-1">
        <button
          onClick={() => handleTabChange('MODELS')}
          className={`flex-1 py-1 rounded font-orbitron text-[10px] tracking-wider transition-all ${
            activeTab === 'MODELS'
              ? 'bg-cyan-500/30 text-white border border-cyan-400 font-bold'
              : 'text-cyan-400/70 hover:text-cyan-300'
          }`}
        >
          MODELS
        </button>
        <button
          onClick={() => handleTabChange('DIAGNOSTICS')}
          className={`flex-1 py-1 rounded font-orbitron text-[10px] tracking-wider transition-all ${
            activeTab === 'DIAGNOSTICS'
              ? 'bg-cyan-500/30 text-white border border-cyan-400 font-bold'
              : 'text-cyan-400/70 hover:text-cyan-300'
          }`}
        >
          TELEMETRY
        </button>
        <button
          onClick={() => handleTabChange('SETTINGS')}
          className={`flex-1 py-1 rounded font-orbitron text-[10px] tracking-wider transition-all ${
            activeTab === 'SETTINGS'
              ? 'bg-cyan-500/30 text-white border border-cyan-400 font-bold'
              : 'text-cyan-400/70 hover:text-cyan-300'
          }`}
        >
          CONFIG
        </button>
      </div>

      {/* TAB 1: 3D Holographic Models Selection */}
      {activeTab === 'MODELS' && (
        <>
          <HolographicPanel
            title="HOLOGRAPHIC REPOSITORY"
            subtitle={`${MODEL_CATALOG.length} QUANTUM BLUEPRINTS`}
            icon={<Layers className="w-4 h-4 text-cyan-400" />}
          >
            <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
              {MODEL_CATALOG.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleSelectModel(item.id)}
                  className={`w-full text-left p-2 rounded border transition-all flex items-center justify-between ${
                    (selectedObject?.modelId || currentModelId) === item.id
                      ? 'border-cyan-400 bg-cyan-500/20 shadow-[0_0_12px_rgba(0,240,255,0.3)]'
                      : 'border-cyan-500/20 bg-black/40 hover:bg-cyan-950/40 hover:border-cyan-500/50'
                  }`}
                >
                  <div className="flex flex-col">
                    <span className="font-orbitron font-bold text-[11px] text-white">
                      {item.name}
                    </span>
                    <span className="font-mono text-[9px] text-cyan-400/80">
                      {item.category} // {item.codename}
                    </span>
                  </div>
                  {(selectedObject?.modelId || currentModelId) === item.id && (
                    <span className="text-[9px] font-mono text-cyan-300 border border-cyan-400/50 px-1.5 py-0.5 rounded">
                      ACTIVE
                    </span>
                  )}
                </button>
              ))}
            </div>
          </HolographicPanel>

          {/* Model Specifications & Controls */}
          <HolographicPanel
            title="SPECIFICATIONS & RENDERING"
            subtitle={selectedObject ? selectedObject.name : activeModel.name}
            icon={<Wrench className="w-4 h-4 text-cyan-400" />}
          >
            <div className="space-y-2.5">
              <p className="text-[10px] font-mono text-cyan-300/80 leading-relaxed">
                {activeModel.description}
              </p>

              {selectedObject?.reconstructionMethodLabel && (
                <div className="p-1.5 rounded border border-amber-400/50 bg-amber-950/30 font-mono text-[9px] text-amber-200 leading-snug">
                  METHOD: {selectedObject.reconstructionMethodLabel}
                </div>
              )}

              <div className="grid grid-cols-2 gap-1.5 font-mono text-[10px]">
                <div className="bg-cyan-950/30 p-1.5 rounded border border-cyan-500/20">
                  <span className="text-cyan-400/70 block">VERTICES / FACES</span>
                  <span className="text-white font-bold">
                    {selectedObject?.vertexCount ?? '--'} / {selectedObject?.faceCount ?? '--'}
                  </span>
                </div>
                <div className="bg-cyan-950/30 p-1.5 rounded border border-cyan-500/20">
                  <span className="text-cyan-400/70 block">CONTAINMENT</span>
                  <span className="text-white font-bold">{activeModel.specs.containmentField}</span>
                </div>
                <div className="bg-cyan-950/30 p-1.5 rounded border border-cyan-500/20">
                  <span className="text-cyan-400/70 block">ENERGY OUTPUT</span>
                  <span className="text-white font-bold">{activeModel.specs.energyOutput}</span>
                </div>
                <div className="bg-cyan-950/30 p-1.5 rounded border border-cyan-500/20">
                  <span className="text-cyan-400/70 block">CORE TEMP</span>
                  <span className="text-white font-bold">{activeModel.specs.temperature}</span>
                </div>
              </div>

              {/* Exploded View Toggle */}
              <div className="flex items-center justify-between pt-1 border-t border-cyan-500/20">
                <span className="font-mono text-[11px] text-cyan-300">EXPLODED ASSEMBLY VIEW</span>
                <button
                  onClick={() => {
                    audioService.playChirp(1200);
                    const next = !visualSettings.explodedView;
                    onUpdateVisualSettings({
                      explodedView: next,
                      explosionAmount: next ? 1.0 : 0.0
                    });
                  }}
                  className={`px-2.5 py-1 rounded font-mono text-[10px] font-bold border transition-all ${
                    visualSettings.explodedView
                      ? 'border-amber-400 text-amber-300 bg-amber-950/40'
                      : 'border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/20'
                  }`}
                >
                  {visualSettings.explodedView ? 'DISASSEMBLED' : 'ASSEMBLED'}
                </button>
              </div>

              {/* Color Theme Selector */}
              <div className="pt-1 border-t border-cyan-500/20">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-mono text-[10px] text-cyan-300">HOLOGRAPHIC SPECTRUM:</span>
                  <span className="font-mono text-[10px] uppercase text-white font-bold">
                    {visualSettings.colorTheme.replace('_', ' ')}
                  </span>
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={() => handleThemeChange('cyan')}
                    title="Cyan Stark Arc"
                    className={`flex-1 h-5 rounded border ${
                      visualSettings.colorTheme === 'cyan' ? 'border-white ring-1 ring-cyan-400' : 'border-cyan-500/40'
                    } bg-[#00f0ff]`}
                  />
                  <button
                    onClick={() => handleThemeChange('orange')}
                    title="Repulsor Flare"
                    className={`flex-1 h-5 rounded border ${
                      visualSettings.colorTheme === 'orange' ? 'border-white ring-1 ring-amber-400' : 'border-amber-500/40'
                    } bg-[#ff8800]`}
                  />
                  <button
                    onClick={() => handleThemeChange('matrix_green')}
                    title="Nanotech Green"
                    className={`flex-1 h-5 rounded border ${
                      visualSettings.colorTheme === 'matrix_green' ? 'border-white ring-1 ring-emerald-400' : 'border-emerald-500/40'
                    } bg-[#00ffaa]`}
                  />
                  <button
                    onClick={() => handleThemeChange('red_alert')}
                    title="Red Sentry Protocol"
                    className={`flex-1 h-5 rounded border ${
                      visualSettings.colorTheme === 'red_alert' ? 'border-white ring-1 ring-red-400' : 'border-red-500/40'
                    } bg-[#ff3344]`}
                  />
                </div>
              </div>
            </div>
          </HolographicPanel>
        </>
      )}

      {/* TAB 2: System Telemetry & Gauges */}
      {activeTab === 'DIAGNOSTICS' && (
        <HolographicPanel
          title="REACTOR TELEMETRY"
          subtitle="REAL-TIME MONITORING"
          icon={<Cpu className="w-4 h-4 text-cyan-400" />}
        >
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2 py-2">
              <CircularGauge value={98} label="CONTAIN" unit="%" color="#00f0ff" />
              <CircularGauge value={74} label="CORE LOAD" unit="%" color="#ff8800" />
              <CircularGauge value={99} label="PLASMA" unit="%" color="#00ffaa" />
            </div>

            <div className="space-y-2 font-mono text-[10px]">
              <div className="flex justify-between border-b border-cyan-500/20 pb-1">
                <span className="text-cyan-400/70">FUSION HARMONIC:</span>
                <span className="text-white font-bold">142.8 GHz</span>
              </div>
              <div className="flex justify-between border-b border-cyan-500/20 pb-1">
                <span className="text-cyan-400/70">MAGNETIC FLUX:</span>
                <span className="text-white font-bold">18.4 Tesla</span>
              </div>
              <div className="flex justify-between border-b border-cyan-500/20 pb-1">
                <span className="text-cyan-400/70">QUANTUM COHERENCE:</span>
                <span className="text-emerald-400 font-bold">OPTIMAL (0.998)</span>
              </div>
              <div className="flex justify-between border-b border-cyan-500/20 pb-1">
                <span className="text-cyan-400/70">RENDER MODE:</span>
                <span className="text-cyan-300 font-bold">{visualSettings.renderMode}</span>
              </div>
            </div>
          </div>
        </HolographicPanel>
      )}

      {/* TAB 3: Configuration, Visual Sliders & AI Provider */}
      {activeTab === 'SETTINGS' && (
        <HolographicPanel
          title="SYSTEM & RENDER CONFIG"
          subtitle="NEURAL & HOLOGRAPHIC TUNING"
          icon={<KeyRound className="w-4 h-4 text-cyan-400" />}
        >
          <div className="space-y-3 font-mono text-xs">
            {/* Live Hologram Rendering Parameters */}
            <div className="p-2.5 rounded bg-black/50 border border-cyan-500/30 space-y-2 text-[10px]">
              <div>
                <div className="flex justify-between">
                  <span>GLOW INTENSITY</span>
                  <span>{visualSettings.glowIntensity.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="3.0"
                  step="0.1"
                  value={visualSettings.glowIntensity}
                  onChange={(e) => onUpdateVisualSettings({ glowIntensity: parseFloat(e.target.value) })}
                  className="w-full accent-cyan-400 h-1 bg-cyan-950 rounded cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between">
                  <span>ROTATION VELOCITY</span>
                  <span>{visualSettings.rotationSpeed.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="2.0"
                  step="0.1"
                  value={visualSettings.rotationSpeed}
                  onChange={(e) => onUpdateVisualSettings({ rotationSpeed: parseFloat(e.target.value) })}
                  className="w-full accent-cyan-400 h-1 bg-cyan-950 rounded cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between">
                  <span>DISPERSION LEVEL</span>
                  <span>{Math.round(visualSettings.dispersionAmount * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.02"
                  value={visualSettings.dispersionAmount}
                  onChange={(e) => onUpdateVisualSettings({ dispersionAmount: parseFloat(e.target.value) })}
                  className="w-full accent-cyan-400 h-1 bg-cyan-950 rounded cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between">
                  <span>ORBITAL SPEED</span>
                  <span>{visualSettings.orbitalSpeed.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="2.5"
                  step="0.1"
                  value={visualSettings.orbitalSpeed}
                  onChange={(e) => onUpdateVisualSettings({ orbitalSpeed: parseFloat(e.target.value) })}
                  className="w-full accent-cyan-400 h-1 bg-cyan-950 rounded cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between">
                  <span>CORE BRIGHTNESS</span>
                  <span>{visualSettings.coreBrightness.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min="0.3"
                  max="2.0"
                  step="0.1"
                  value={visualSettings.coreBrightness}
                  onChange={(e) => onUpdateVisualSettings({ coreBrightness: parseFloat(e.target.value) })}
                  className="w-full accent-cyan-400 h-1 bg-cyan-950 rounded cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between">
                  <span>SCAN SPEED</span>
                  <span>{visualSettings.scanSpeed.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min="0.2"
                  max="2.5"
                  step="0.1"
                  value={visualSettings.scanSpeed}
                  onChange={(e) => onUpdateVisualSettings({ scanSpeed: parseFloat(e.target.value) })}
                  className="w-full accent-cyan-400 h-1 bg-cyan-950 rounded cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between">
                  <span>PARTICLE INTENSITY</span>
                  <span>{visualSettings.particleIntensity.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min="0.3"
                  max="2.0"
                  step="0.1"
                  value={visualSettings.particleIntensity}
                  onChange={(e) => onUpdateVisualSettings({ particleIntensity: parseFloat(e.target.value) })}
                  className="w-full accent-cyan-400 h-1 bg-cyan-950 rounded cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between">
                  <span>PARTICLE FIELD DENSITY</span>
                  <span>{visualSettings.particleCount}</span>
                </div>
                <input
                  type="range"
                  min="500"
                  max="5000"
                  step="250"
                  value={visualSettings.particleCount}
                  onChange={(e) => onUpdateVisualSettings({ particleCount: parseInt(e.target.value, 10) })}
                  className="w-full accent-cyan-400 h-1 bg-cyan-950 rounded cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-cyan-500/20">
                <span>BOUNDING BRACKETS</span>
                <button
                  onClick={() => onUpdateVisualSettings({ showBoundingBoxes: !visualSettings.showBoundingBoxes })}
                  className={`px-2 py-0.5 rounded border text-[9px] ${
                    visualSettings.showBoundingBoxes
                      ? 'border-cyan-400 bg-cyan-500/25 text-white'
                      : 'border-cyan-500/30 text-cyan-400/70'
                  }`}
                >
                  {visualSettings.showBoundingBoxes ? 'VISIBLE' : 'HIDDEN'}
                </button>
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-cyan-500/20">
                <span>COMPONENT LABELS</span>
                <button
                  onClick={() => onUpdateVisualSettings({ showComponentLabels: !visualSettings.showComponentLabels })}
                  className={`px-2 py-0.5 rounded border text-[9px] ${
                    visualSettings.showComponentLabels
                      ? 'border-cyan-400 bg-cyan-500/25 text-white'
                      : 'border-cyan-500/30 text-cyan-400/70'
                  }`}
                >
                  {visualSettings.showComponentLabels ? 'ON' : 'OFF'}
                </button>
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-cyan-500/20">
                <span>REDUCED EFFECTS MODE</span>
                <button
                  onClick={() => onUpdateVisualSettings({ reducedEffects: !visualSettings.reducedEffects })}
                  className={`px-2 py-0.5 rounded border text-[9px] ${
                    visualSettings.reducedEffects
                      ? 'border-amber-400 bg-amber-950/50 text-amber-200'
                      : 'border-cyan-500/30 text-cyan-400/70'
                  }`}
                >
                  {visualSettings.reducedEffects ? 'LOW POWER' : 'CINEMATIC'}
                </button>
              </div>
            </div>

            <div className="p-2.5 rounded bg-cyan-950/40 border border-cyan-500/30 space-y-2">
              <span className="font-bold text-white block">AI ASSISTANT PROVIDER</span>
              <p className="text-[10px] text-cyan-400/80 leading-relaxed">
                Connect external LLM provider (volatile RAM key only) or operate with local deterministic parser.
              </p>
              <button
                onClick={() => {
                  audioService.playChirp(1200);
                  if (onOpenAIConfig) onOpenAIConfig();
                }}
                className="w-full py-1.5 px-3 rounded bg-cyan-500/30 hover:bg-cyan-500/50 text-white font-orbitron font-bold text-[10px] border border-cyan-400 flex items-center justify-center space-x-1.5 shadow-[0_0_12px_rgba(0,240,255,0.3)] transition-all"
              >
                <KeyRound className="w-3.5 h-3.5 text-cyan-300" />
                <span>CONFIGURE AI PROVIDER</span>
              </button>
            </div>
          </div>
        </HolographicPanel>
      )}
    </div>
  );
};
