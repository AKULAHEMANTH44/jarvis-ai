import React, { useState } from 'react';
import { HolographicPanel } from '../Common/HolographicPanel';
import { CircularGauge } from '../Common/CircularGauge';
import { HologramModelId, HologramModelInfo, HologramVisualSettings } from '../../types/hologram';
import { Layers, Cpu, Wrench, Clock, FileText, KeyRound, Sparkles } from 'lucide-react';
import { audioService } from '../../services/soundFx';

interface RightDiagnosticsHUDProps {
  currentModelId: HologramModelId;
  onSelectModel: (id: HologramModelId) => void;
  visualSettings: HologramVisualSettings;
  onUpdateVisualSettings: (settings: Partial<HologramVisualSettings>) => void;
  onOpenAIConfig?: () => void;
}

const MODEL_CATALOG: HologramModelInfo[] = [
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
  }
];

export const RightDiagnosticsHUD: React.FC<RightDiagnosticsHUDProps> = ({
  currentModelId,
  onSelectModel,
  visualSettings,
  onUpdateVisualSettings,
  onOpenAIConfig
}) => {
  const [activeTab, setActiveTab] = useState<'MODELS' | 'DIAGNOSTICS' | 'SETTINGS'>('MODELS');

  const activeModel = MODEL_CATALOG.find((m) => m.id === currentModelId) || MODEL_CATALOG[0];

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
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {MODEL_CATALOG.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleSelectModel(item.id)}
                  className={`w-full text-left p-2 rounded border transition-all flex items-center justify-between ${
                    currentModelId === item.id
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
                  {currentModelId === item.id && (
                    <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                  )}
                </button>
              ))}
            </div>
          </HolographicPanel>

          {/* Model Specifications & Controls */}
          <HolographicPanel
            title="SPECIFICATIONS & RENDERING"
            subtitle={activeModel.name}
            icon={<Wrench className="w-4 h-4 text-cyan-400" />}
          >
            <div className="space-y-2.5">
              <p className="text-[10px] font-mono text-cyan-300/80 leading-relaxed">
                {activeModel.description}
              </p>

              <div className="grid grid-cols-2 gap-1.5 font-mono text-[10px]">
                <div className="bg-cyan-950/30 p-1.5 rounded border border-cyan-500/20">
                  <span className="text-cyan-400/70 block">ENERGY OUTPUT</span>
                  <span className="text-white font-bold">{activeModel.specs.energyOutput}</span>
                </div>
                <div className="bg-cyan-950/30 p-1.5 rounded border border-cyan-500/20">
                  <span className="text-cyan-400/70 block">CONTAINMENT</span>
                  <span className="text-white font-bold">{activeModel.specs.containmentField}</span>
                </div>
                <div className="bg-cyan-950/30 p-1.5 rounded border border-cyan-500/20">
                  <span className="text-cyan-400/70 block">CORE TEMP</span>
                  <span className="text-white font-bold">{activeModel.specs.temperature}</span>
                </div>
                <div className="bg-cyan-950/30 p-1.5 rounded border border-cyan-500/20">
                  <span className="text-cyan-400/70 block">INTEGRITY</span>
                  <span className="text-white font-bold">{activeModel.specs.structuralIntegrity}</span>
                </div>
              </div>

              {/* Exploded View Toggle */}
              <div className="flex items-center justify-between pt-1 border-t border-cyan-500/20">
                <span className="font-mono text-[11px] text-cyan-300">EXPLODED ASSEMBLY VIEW</span>
                <button
                  onClick={() => {
                    audioService.playChirp(1200);
                    onUpdateVisualSettings({ explodedView: !visualSettings.explodedView });
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
                <span className="text-cyan-400/70">REPULSOR CAPACITORS:</span>
                <span className="text-cyan-300 font-bold">CHARGED (100%)</span>
              </div>
            </div>
          </div>
        </HolographicPanel>
      )}

      {/* TAB 3: Configuration & AI Provider */}
      {activeTab === 'SETTINGS' && (
        <HolographicPanel
          title="SYSTEM & AI CONFIG"
          subtitle="NEURAL PROTOCOL CONTROL"
          icon={<KeyRound className="w-4 h-4 text-cyan-400" />}
        >
          <div className="space-y-3 font-mono text-xs">
            <div className="p-2.5 rounded bg-cyan-950/40 border border-cyan-500/30 space-y-2">
              <span className="font-bold text-white block">AI ASSISTANT PROVIDER</span>
              <p className="text-[10px] text-cyan-400/80 leading-relaxed">
                Connect external LLM provider or operate with local deterministic intent parser.
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

            <div className="p-2 rounded bg-black/40 border border-cyan-500/20 text-[10px] text-cyan-400/80 space-y-1">
              <span className="text-white font-bold block">ACTIVE DIRECTIVE:</span>
              <span>• Local Autonomous Speech Parser</span>
              <br />
              <span>• MediaPipe 3D Hand Tracking: ON</span>
              <br />
              <span>• Spatial Collision Physics: ACTIVE</span>
            </div>
          </div>
        </HolographicPanel>
      )}
    </div>
  );
};
