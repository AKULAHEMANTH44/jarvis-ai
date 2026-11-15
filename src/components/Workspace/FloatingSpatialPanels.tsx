import React, { useState, useEffect, useRef } from 'react';
import { HolographicPanel } from '../Common/HolographicPanel';
import {
  SpatialObjectState,
  LayoutFormation,
  HologramModelId,
  HologramVisualSettings,
  HologramRenderMode,
  ReconstructionPresetId,
  SliceAxis
} from '../../types/hologram';
import { AutomationTask } from '../../types/assistant';
import { automationEngine } from '../../services/automationEngine';
import { desktopBridge } from '../../services/desktopBridge';
import { audioService } from '../../services/soundFx';
import {
  Layers,
  Copy,
  Trash2,
  Clock,
  Save,
  FolderOpen,
  ClipboardCheck,
  CheckCircle,
  AlertTriangle,
  Minimize2,
  Maximize2,
  Workflow,
  Sparkles,
  ScanLine,
  Upload,
  Camera,
  Lock,
  Unlock,
  Scissors,
  RotateCcw,
  RotateCw,
  Link2,
  ImagePlus
} from 'lucide-react';

interface FloatingSpatialPanelsProps {
  spatialObjects: SpatialObjectState[];
  selectedObjectId: string | null;
  visualSettings: HologramVisualSettings;
  isCameraActive: boolean;
  onUpdateVisualSettings: (settings: Partial<HologramVisualSettings>) => void;
  onSelectObject: (id: string) => void;
  onAddObject: (modelId: HologramModelId) => void;
  onDuplicateObject: (id: string) => void;
  onDeleteObject: (id: string) => void;
  onToggleLockObject: (id: string) => void;
  onTransformObject: (
    id: string,
    transform: {
      position?: Partial<{ x: number; y: number; z: number }>;
      scale?: number;
    }
  ) => void;
  onResetSelectedTransform: () => void;
  onGroupAll: () => void;
  onUngroupObject: (id: string) => void;
  onApplyFormation: (formation: LayoutFormation) => void;
  onSynthesizePreset: (presetId: ReconstructionPresetId) => void;
  onImportMeshFile: (file: File) => void;
  onReconstructImages: (files: File[]) => void;
  onCaptureWebcamScan: () => void;
  onTriggerRescan: () => void;
  onRotate360: () => void;
  onDisintegrate: () => void;
  onReconstruct: () => void;
  notes: string;
  onUpdateNotes: (notes: string) => void;
  requestedTab?: { tab: 'OBJECTS' | 'LAB' | 'AUTOMATION' | 'NOTES' | 'TIMER'; nonce: number } | null;
  hideTabBar?: boolean;
  visibleTabs?: ('OBJECTS' | 'LAB' | 'AUTOMATION' | 'NOTES' | 'TIMER')[];
}

export const FloatingSpatialPanels: React.FC<FloatingSpatialPanelsProps> = ({
  spatialObjects,
  selectedObjectId,
  visualSettings,
  isCameraActive,
  onUpdateVisualSettings,
  onSelectObject,
  onAddObject,
  onDuplicateObject,
  onDeleteObject,
  onToggleLockObject,
  onTransformObject,
  onResetSelectedTransform,
  onGroupAll,
  onUngroupObject,
  onApplyFormation,
  onSynthesizePreset,
  onImportMeshFile,
  onReconstructImages,
  onCaptureWebcamScan,
  onTriggerRescan,
  onRotate360,
  onDisintegrate,
  onReconstruct,
  notes,
  onUpdateNotes,
  requestedTab,
  hideTabBar = false,
  visibleTabs
}) => {
  const [tasks, setTasks] = useState<AutomationTask[]>([]);
  const [timerSeconds, setTimerSeconds] = useState<number>(0);
  const [timerActive, setTimerActive] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'OBJECTS' | 'LAB' | 'AUTOMATION' | 'NOTES' | 'TIMER'>(
    visibleTabs?.[0] || 'OBJECTS'
  );
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [copiedNote, setCopiedNote] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const selectedObj = spatialObjects.find((o) => o.id === selectedObjectId) || spatialObjects[0] || null;
  const displayedTabs = visibleTabs ?? (['OBJECTS', 'LAB', 'AUTOMATION', 'NOTES', 'TIMER'] as const);

  useEffect(() => {
    if (requestedTab) {
      setActiveTab(requestedTab.tab);
      setIsMinimized(false);
    }
  }, [requestedTab]);

  useEffect(() => {
    return automationEngine.subscribe((updated) => {
      setTasks(updated);
    });
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (timerActive) {
      interval = setInterval(() => {
        setTimerSeconds((s) => s + 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [timerActive]);

  const handleSaveNotesFile = async () => {
    audioService.playChirp(1200);
    const approved = await desktopBridge.requestAuthorization(
      'FILE_WRITE',
      'stark_lab_notes.txt',
      'Export mission telemetry notes to authorized local file system.'
    );
    if (approved) {
      await desktopBridge.saveAuthorizedFile('stark_lab_notes.txt', notes);
    }
  };

  const handleOpenFile = async () => {
    audioService.playChirp(1200);
    const file = await desktopBridge.readAuthorizedFile();
    if (file) {
      onUpdateNotes(`${notes}\n\n[IMPORTED: ${file.name}]\n${file.content}`);
    }
  };

  const handleCopyNotes = async () => {
    const ok = await desktopBridge.copyToClipboard(notes);
    if (ok) {
      setCopiedNote(true);
      setTimeout(() => setCopiedNote(false), 2000);
    }
  };

  const handleMeshFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onImportMeshFile(file);
    }
    e.target.value = '';
  };

  const handleImageFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length > 0) {
      onReconstructImages(files);
    }
    e.target.value = '';
  };

  const runQuickAutomation = (type: 'DIAGNOSTIC' | 'ORBIT_SWEEP' | 'OVERCLOCK') => {
    audioService.playChirp(1400);
    if (type === 'DIAGNOSTIC') {
      automationEngine.createTask(
        'Autonomous Sensor & Optical Calibration Sweep',
        'Verify camera frames, landmark smoothing, and containment flux.',
        [
          { description: 'Testing optical sensor stream fidelity', action: () => audioService.playChirp(1200) },
          { description: 'Synchronizing 21 3D hand landmarks', action: () => audioService.playChirp(1400) },
          { description: 'Evaluating magnetic containment coherence', action: () => audioService.playActivationWhoosh() }
        ]
      );
    } else if (type === 'ORBIT_SWEEP') {
      automationEngine.createTask(
        'Spatial Orbital Matrix Reconfiguration',
        'Reorganize active models into satellite orbital geometry.',
        [
          {
            description: 'Duplicating selected primary module',
            action: () => {
              if (selectedObjectId) onDuplicateObject(selectedObjectId);
            }
          },
          { description: 'Calculating equidistant orbital trajectories', action: () => audioService.playChirp(1500) },
          { description: 'Applying 3D orbital formation vectors', action: () => onApplyFormation('ORBIT') }
        ]
      );
    } else if (type === 'OVERCLOCK') {
      automationEngine.createTask(
        'Reactor Overclock & High-Yield Pulse Protocol',
        'Overclock containment output and discharge radial shockwave wave.',
        [
          { description: 'Diverting secondary plasma channels to primary core', action: () => audioService.playChirp(1600) },
          { description: 'Discharging radial energy shockwave wave', action: () => audioService.playShockwave() },
          { description: 'Engaging exploded component telemetry view', action: () => audioService.playActivationWhoosh() }
        ],
        ['HIGH_ENERGY_DISCHARGE']
      );
    }
  };

  const renderModes: { id: HologramRenderMode; label: string }[] = [
    { id: 'HYBRID', label: 'HYBRID' },
    { id: 'WIREFRAME', label: 'WIRE' },
    { id: 'POINT_CLOUD', label: 'POINTS' },
    { id: 'SOLID_HOLO', label: 'SOLID' }
  ];

  const sliceAxes: SliceAxis[] = ['x', 'y', 'z'];

  return (
    <div className="w-full flex flex-col space-y-2 pointer-events-auto text-xs select-none">
      {/* Workspace Navigation Tabs + Minimize */}
      {!hideTabBar && (
        <div className="flex items-center bg-black/75 border border-cyan-500/40 rounded-lg p-1 space-x-1">
          {displayedTabs.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => {
                audioService.playChirp(1200);
                setActiveTab(tab);
                setIsMinimized(false);
              }}
              className={`flex-1 py-1 rounded font-orbitron text-[10px] tracking-wider transition-all ${
                activeTab === tab && !isMinimized
                  ? 'bg-cyan-500/30 text-white border border-cyan-400 font-bold'
                  : 'text-cyan-400/70 hover:text-cyan-200'
              }`}
            >
              {tab === 'OBJECTS' ? 'SPATIAL' : tab === 'LAB' ? 'LAB' : tab === 'AUTOMATION' ? 'TASKS' : tab === 'NOTES' ? 'MEMO' : 'CLOCK'}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              audioService.playChirp(1100);
              setIsMinimized(!isMinimized);
            }}
            title={isMinimized ? 'Expand Workspace Panel' : 'Minimize Workspace Panel'}
            aria-label={isMinimized ? 'Expand Workspace Panel' : 'Minimize Workspace Panel'}
            className="p-1 rounded border border-cyan-500/30 text-cyan-400 hover:text-white hover:bg-cyan-500/20"
          >
            {isMinimized ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      )}

      {!isMinimized && (
        <>
          {/* TAB 1: Multi-Object Spatial Hierarchy & Layout */}
          {activeTab === 'OBJECTS' && (
            <HolographicPanel
              title="SPATIAL OBJECT MATRIX"
              subtitle={`${spatialObjects.length} ACTIVE 3D ENTITIES`}
              icon={<Layers className="w-4 h-4 text-cyan-400" />}
              headerRight={
                spatialObjects.length > 1 ? (
                  <button
                    onClick={() => { audioService.playChirp(1300); onGroupAll(); }}
                    title="Group all active objects for synchronized translation"
                    className="flex items-center space-x-1 px-1.5 py-0.5 rounded border border-cyan-500/40 bg-cyan-950/40 text-[9px] text-cyan-300 hover:text-white"
                  >
                    <Link2 className="w-3 h-3" />
                    <span>GROUP</span>
                  </button>
                ) : undefined
              }
            >
              <div className="space-y-3">
                {/* Object Instances List */}
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {spatialObjects.map((obj) => (
                    <div
                      key={obj.id}
                      onClick={() => { audioService.playChirp(1400); onSelectObject(obj.id); }}
                      className={`p-2 rounded border flex items-center justify-between cursor-pointer transition-all ${
                        obj.id === selectedObjectId
                          ? 'border-cyan-400 bg-cyan-500/25 shadow-[0_0_12px_rgba(0,240,255,0.4)] text-white'
                          : 'border-cyan-500/20 bg-black/40 hover:bg-cyan-950/40 text-cyan-300'
                      }`}
                    >
                      <div className="flex flex-col min-w-0 pr-2">
                        <div className="flex items-center space-x-1.5">
                          <span className="font-orbitron font-bold text-[11px] truncate">{obj.name}</span>
                          {obj.isLocked && (
                            <span className="text-[8px] px-1 rounded bg-amber-950/60 border border-amber-400/50 text-amber-300">
                              LOCKED
                            </span>
                          )}
                        </div>
                        <span className="font-mono text-[9px] text-cyan-400/70">
                          SCALE: {obj.scale.toFixed(2)}x
                          {obj.vertexCount ? ` • ${obj.vertexCount} VTX` : ''}
                          {obj.groupId ? ' • GROUPED' : ''}
                        </span>
                      </div>
                      <div className="flex items-center space-x-1 shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            audioService.playChirp(1200);
                            onToggleLockObject(obj.id);
                          }}
                          title={obj.isLocked ? 'Unlock Transform' : 'Lock Transform'}
                          className={`p-1 rounded border ${
                            obj.isLocked
                              ? 'border-amber-400/60 bg-amber-950/40 text-amber-300'
                              : 'border-cyan-500/30 bg-cyan-950/40 text-cyan-300 hover:text-white'
                          }`}
                        >
                          {obj.isLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                        </button>
                        {obj.groupId && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              audioService.playChirp(1000);
                              onUngroupObject(obj.id);
                            }}
                            title="Ungroup Object"
                            className="p-1 hover:text-white rounded border border-cyan-500/30 bg-cyan-950/40 text-[9px]"
                          >
                            UNLINK
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); onDuplicateObject(obj.id); }}
                          title="Duplicate Object"
                          className="p-1 hover:text-white rounded border border-cyan-500/30 bg-cyan-950/40"
                        >
                          <Copy className="w-3 h-3 text-cyan-300" />
                        </button>
                        {spatialObjects.length > 1 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onDeleteObject(obj.id); }}
                            title="Delete Object"
                            className="p-1 hover:text-red-300 rounded border border-red-500/30 bg-red-950/40"
                          >
                            <Trash2 className="w-3 h-3 text-red-400" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Spawn Real-World & Stark Spatial Object */}
                <div className="pt-2 border-t border-cyan-500/20">
                  <span className="text-[10px] font-mono text-cyan-400/70 block mb-1">
                    SPAWN REAL-WORLD & STARK ENTITIES:
                  </span>
                  <div className="grid grid-cols-3 gap-1 font-mono text-[9px] max-h-24 overflow-y-auto pr-0.5">
                    <button onClick={() => onAddObject('vision_sphere')} className="p-1 rounded bg-cyan-500/20 hover:bg-cyan-500/35 border border-cyan-400/60 text-white text-left truncate">+ Vision 1.2 Core</button>
                    <button onClick={() => onAddObject('sports_car')} className="p-1 rounded bg-cyan-950/40 hover:bg-cyan-500/20 border border-cyan-500/30 text-left truncate">+ Hypercar</button>
                    <button onClick={() => onAddObject('cyber_motorcycle')} className="p-1 rounded bg-cyan-950/40 hover:bg-cyan-500/20 border border-cyan-500/30 text-left truncate">+ Superbike</button>
                    <button onClick={() => onAddObject('jet_turbine_engine')} className="p-1 rounded bg-cyan-950/40 hover:bg-cyan-500/20 border border-cyan-500/30 text-left truncate">+ Jet Engine</button>
                    <button onClick={() => onAddObject('holo_smartphone')} className="p-1 rounded bg-cyan-950/40 hover:bg-cyan-500/20 border border-cyan-500/30 text-left truncate">+ Smartphone</button>
                    <button onClick={() => onAddObject('quantum_workstation')} className="p-1 rounded bg-cyan-950/40 hover:bg-cyan-500/20 border border-cyan-500/30 text-left truncate">+ Workstation</button>
                    <button onClick={() => onAddObject('stark_skyscraper')} className="p-1 rounded bg-cyan-950/40 hover:bg-cyan-500/20 border border-cyan-500/30 text-left truncate">+ Skyscraper</button>
                    <button onClick={() => onAddObject('industrial_robot_arm')} className="p-1 rounded bg-cyan-950/40 hover:bg-cyan-500/20 border border-cyan-500/30 text-left truncate">+ Robot Arm</button>
                    <button onClick={() => onAddObject('planetary_gearbox')} className="p-1 rounded bg-cyan-950/40 hover:bg-cyan-500/20 border border-cyan-500/30 text-left truncate">+ Gearbox</button>
                    <button onClick={() => onAddObject('atom_orbital_model')} className="p-1 rounded bg-cyan-950/40 hover:bg-cyan-500/20 border border-cyan-500/30 text-left truncate">+ Atom Model</button>
                    <button onClick={() => onAddObject('arc_reactor')} className="p-1 rounded bg-cyan-950/40 hover:bg-cyan-500/20 border border-cyan-500/30 text-left truncate">+ Arc Reactor</button>
                    <button onClick={() => onAddObject('quantum_tesseract')} className="p-1 rounded bg-cyan-950/40 hover:bg-cyan-500/20 border border-cyan-500/30 text-left truncate">+ Tesseract</button>
                    <button onClick={() => onAddObject('carbon_buckyball')} className="p-1 rounded bg-cyan-950/40 hover:bg-cyan-500/20 border border-cyan-500/30 text-left truncate">+ Fullerene</button>
                  </div>
                </div>

                {/* Spatial Layout Formations */}
                <div className="pt-2 border-t border-cyan-500/20">
                  <span className="text-[10px] font-mono text-cyan-400/70 block mb-1">
                    SPATIAL FORMATIONS:
                  </span>
                  <div className="flex space-x-1.5">
                    <button
                      onClick={() => { audioService.playActivationWhoosh(); onApplyFormation('ORBIT'); }}
                      className="flex-1 py-1 rounded bg-cyan-950/50 hover:bg-cyan-500/30 border border-cyan-500/40 font-orbitron text-[9px] text-white"
                    >
                      ORBIT
                    </button>
                    <button
                      onClick={() => { audioService.playActivationWhoosh(); onApplyFormation('GRID'); }}
                      className="flex-1 py-1 rounded bg-cyan-950/50 hover:bg-cyan-500/30 border border-cyan-500/40 font-orbitron text-[9px] text-white"
                    >
                      GRID
                    </button>
                    <button
                      onClick={() => { audioService.playActivationWhoosh(); onApplyFormation('LINE'); }}
                      className="flex-1 py-1 rounded bg-cyan-950/50 hover:bg-cyan-500/30 border border-cyan-500/40 font-orbitron text-[9px] text-white"
                    >
                      LINEUP
                    </button>
                    <button
                      onClick={() => { audioService.playActivationWhoosh(); onApplyFormation('SINGLE'); }}
                      className="flex-1 py-1 rounded bg-cyan-950/50 hover:bg-cyan-500/30 border border-cyan-500/40 font-orbitron text-[9px] text-white"
                    >
                      CENTER
                    </button>
                  </div>
                </div>
              </div>
            </HolographicPanel>
          )}

          {/* TAB 2: Holographic Object Reconstruction & Manipulation Lab */}
          {activeTab === 'LAB' && (
            <HolographicPanel
              title="RECONSTRUCTION & MANIPULATION LAB"
              subtitle="SCANNER // SLICER // PRECISION RIG"
              icon={<ScanLine className="w-4 h-4 text-cyan-400" />}
              headerRight={
                <button
                  onClick={() => { audioService.playActivationWhoosh(); onTriggerRescan(); }}
                  className="px-2 py-0.5 rounded border border-cyan-400 bg-cyan-500/20 hover:bg-cyan-500/40 text-white font-orbitron text-[9px]"
                >
                  RESCAN
                </button>
              }
            >
              <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                {/* 0. Cinematic Object Animation Sequence Controls */}
                <div>
                  <span className="text-[10px] font-mono text-cyan-400/70 block mb-1">
                    CINEMATIC OBJECT ANIMATIONS:
                  </span>
                  <div className="grid grid-cols-4 gap-1 font-orbitron text-[9px]">
                    <button
                      onClick={() => { audioService.playChirp(1450); onRotate360(); }}
                      className="py-1.5 px-1 rounded border border-cyan-400/50 bg-cyan-500/20 hover:bg-cyan-500/35 text-white flex items-center justify-center space-x-1"
                    >
                      <RotateCw className="w-2.5 h-2.5" />
                      <span>360°</span>
                    </button>
                    <button
                      onClick={() => {
                        audioService.playChirp(1300);
                        const next = !visualSettings.explodedView;
                        onUpdateVisualSettings({ explodedView: next, explosionAmount: next ? 1.0 : 0.0 });
                      }}
                      className={`py-1.5 px-1 rounded border ${
                        visualSettings.explodedView
                          ? 'border-amber-400 bg-amber-500/30 text-amber-200 font-bold'
                          : 'border-cyan-400/50 bg-cyan-950/40 hover:bg-cyan-500/20 text-cyan-200'
                      }`}
                    >
                      EXPLODE
                    </button>
                    <button
                      onClick={() => { audioService.playShockwave(); onDisintegrate(); }}
                      className={`py-1.5 px-1 rounded border ${
                        selectedObj?.isDisintegrated
                          ? 'border-red-400 bg-red-500/30 text-red-200 font-bold'
                          : 'border-red-500/50 bg-red-950/30 hover:bg-red-500/25 text-red-300'
                      }`}
                    >
                      DISINT
                    </button>
                    <button
                      onClick={() => { audioService.playActivationWhoosh(); onReconstruct(); }}
                      className="py-1.5 px-1 rounded border border-emerald-400/60 bg-emerald-500/20 hover:bg-emerald-500/35 text-emerald-200 font-bold"
                    >
                      RECONST
                    </button>
                  </div>
                </div>

                {/* 1. Reconstruction Synthesis, Mesh & Multi-View Image Upload */}
                <div className="pt-2 border-t border-cyan-500/20">
                  <span className="text-[10px] font-mono text-cyan-400/70 block mb-1">
                    RECONSTRUCT 3D SPECIMEN:
                  </span>
                  <div className="grid grid-cols-2 gap-1 font-mono text-[10px] mb-1.5">
                    <button
                      onClick={() => onSynthesizePreset('palladium_core')}
                      className="p-1.5 rounded bg-cyan-950/40 hover:bg-cyan-500/20 border border-cyan-500/30 text-left"
                    >
                      ◈ Palladium Core
                    </button>
                    <button
                      onClick={() => onSynthesizePreset('mark7_gauntlet')}
                      className="p-1.5 rounded bg-cyan-950/40 hover:bg-cyan-500/20 border border-cyan-500/30 text-left"
                    >
                      ◈ MK-VII Gauntlet
                    </button>
                    <button
                      onClick={() => onSynthesizePreset('repulsor_turbine')}
                      className="p-1.5 rounded bg-cyan-950/40 hover:bg-cyan-500/20 border border-cyan-500/30 text-left"
                    >
                      ◈ Repulsor Stator
                    </button>
                    <button
                      onClick={() => onSynthesizePreset('crystal_lattice')}
                      className="p-1.5 rounded bg-cyan-950/40 hover:bg-cyan-500/20 border border-cyan-500/30 text-left"
                    >
                      ◈ Crystal Lattice
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-1">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".glb,.gltf,.obj,.stl"
                      onChange={handleMeshFileChange}
                      className="hidden"
                    />
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handleImageFilesChange}
                      className="hidden"
                    />
                    <button
                      onClick={() => { audioService.playChirp(1300); fileInputRef.current?.click(); }}
                      title="Import .GLB, .GLTF, .OBJ or .STL 3D model"
                      className="py-1.5 px-1.5 rounded border border-cyan-400/60 bg-cyan-500/20 hover:bg-cyan-500/35 text-white font-orbitron text-[8.5px] flex items-center justify-center space-x-1"
                    >
                      <Upload className="w-3 h-3 shrink-0" />
                      <span>GLB/OBJ</span>
                    </button>
                    <button
                      onClick={() => { audioService.playChirp(1350); imageInputRef.current?.click(); }}
                      title="Upload 1 photo (2.5D depth relief) or 2-4 orthogonal photos (silhouette hull approximation)"
                      className="py-1.5 px-1.5 rounded border border-cyan-400/60 bg-cyan-950/60 hover:bg-cyan-500/30 text-cyan-200 font-orbitron text-[8.5px] flex items-center justify-center space-x-1"
                    >
                      <ImagePlus className="w-3 h-3 shrink-0" />
                      <span>IMAGES</span>
                    </button>
                    <button
                      onClick={() => { audioService.playChirp(1400); onCaptureWebcamScan(); }}
                      title={isCameraActive ? 'Capture illustrative 2.5D depth relief from camera' : 'Enable camera first to capture live 2.5D relief'}
                      className={`py-1.5 px-1.5 rounded border font-orbitron text-[8.5px] flex items-center justify-center space-x-1 ${
                        isCameraActive
                          ? 'border-emerald-400 bg-emerald-500/20 hover:bg-emerald-500/35 text-emerald-200'
                          : 'border-cyan-500/30 bg-black/40 text-cyan-400/60 hover:text-cyan-200'
                      }`}
                    >
                      <Camera className="w-3 h-3 shrink-0" />
                      <span>CAM SCAN</span>
                    </button>
                  </div>
                  <p className="mt-1 text-[8.5px] font-mono text-amber-300/75 leading-tight">
                    Image upload builds an illustrative 2.5D depth relief (1 photo) or silhouette hull approximation (multi-view) unless an external photogrammetry service is configured.
                  </p>
                </div>

                {/* 2. Render Topology Mode */}
                <div className="pt-2 border-t border-cyan-500/20">
                  <span className="text-[10px] font-mono text-cyan-400/70 block mb-1">
                    HOLOGRAM TOPOLOGY MODE:
                  </span>
                  <div className="grid grid-cols-4 gap-1">
                    {renderModes.map((rm) => (
                      <button
                        key={rm.id}
                        onClick={() => {
                          audioService.playChirp(1350);
                          onUpdateVisualSettings({
                            renderMode: rm.id,
                            wireframe: rm.id !== 'SOLID_HOLO'
                          });
                        }}
                        className={`py-1 rounded font-orbitron text-[9px] border ${
                          visualSettings.renderMode === rm.id
                            ? 'border-cyan-400 bg-cyan-500/30 text-white font-bold'
                            : 'border-cyan-500/25 bg-black/40 text-cyan-400/80 hover:text-white'
                        }`}
                      >
                        {rm.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 3. Cross-Section Tomography Slicer */}
                <div className="pt-2 border-t border-cyan-500/20 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center space-x-1 text-[10px] font-mono text-cyan-300">
                      <Scissors className="w-3 h-3 text-cyan-400" />
                      <span>TOMOGRAPHY SLICE PLANE</span>
                    </span>
                    <button
                      onClick={() => {
                        audioService.playChirp(1250);
                        onUpdateVisualSettings({ sliceEnabled: !visualSettings.sliceEnabled });
                      }}
                      className={`px-2 py-0.5 rounded font-mono text-[9px] border ${
                        visualSettings.sliceEnabled
                          ? 'border-amber-400 bg-amber-950/50 text-amber-300 font-bold'
                          : 'border-cyan-500/30 text-cyan-400'
                      }`}
                    >
                      {visualSettings.sliceEnabled ? 'SLICE ON' : 'SLICE OFF'}
                    </button>
                  </div>

                  {visualSettings.sliceEnabled && (
                    <div className="space-y-1.5 bg-black/40 p-2 rounded border border-cyan-500/20">
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-mono text-cyan-400/80">AXIS:</span>
                        <div className="flex space-x-1">
                          {sliceAxes.map((axis) => (
                            <button
                              key={axis}
                              onClick={() => onUpdateVisualSettings({ sliceAxis: axis })}
                              className={`px-2 py-0.5 rounded font-orbitron text-[9px] uppercase border ${
                                visualSettings.sliceAxis === axis
                                  ? 'border-cyan-400 bg-cyan-500/30 text-white'
                                  : 'border-cyan-500/30 text-cyan-400/70'
                              }`}
                            >
                              {axis}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-[9px] font-mono">
                          <span>PLANE OFFSET</span>
                          <span>{visualSettings.sliceOffset.toFixed(2)}</span>
                        </div>
                        <input
                          type="range"
                          min="-2.0"
                          max="2.0"
                          step="0.05"
                          value={visualSettings.sliceOffset}
                          onChange={(e) => onUpdateVisualSettings({ sliceOffset: parseFloat(e.target.value) })}
                          className="w-full accent-amber-400 h-1 bg-cyan-950 rounded cursor-pointer"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* 4. Precision Manipulation Rig */}
                {selectedObj && (
                  <div className="pt-2 border-t border-cyan-500/20 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono text-cyan-400/80 truncate max-w-[180px]">
                        RIG // {selectedObj.name}
                      </span>
                      <div className="flex space-x-1">
                        <button
                          onClick={() => {
                            audioService.playChirp(1200);
                            onToggleLockObject(selectedObj.id);
                          }}
                          className={`px-1.5 py-0.5 rounded border text-[9px] flex items-center space-x-1 ${
                            selectedObj.isLocked
                              ? 'border-amber-400 bg-amber-950/50 text-amber-300'
                              : 'border-cyan-500/30 text-cyan-300'
                          }`}
                        >
                          {selectedObj.isLocked ? <Lock className="w-2.5 h-2.5" /> : <Unlock className="w-2.5 h-2.5" />}
                          <span>{selectedObj.isLocked ? 'LOCKED' : 'UNLOCKED'}</span>
                        </button>
                        <button
                          onClick={() => { audioService.playChirp(1000); onResetSelectedTransform(); }}
                          title="Reset Selected Object"
                          className="p-0.5 rounded border border-cyan-500/30 text-cyan-300 hover:text-white"
                        >
                          <RotateCcw className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 font-mono text-[9px]">
                      <div>
                        <div className="flex justify-between">
                          <span>POS X</span>
                          <span>{selectedObj.position.x.toFixed(2)}</span>
                        </div>
                        <input
                          type="range"
                          min="-4.0"
                          max="4.0"
                          step="0.1"
                          disabled={selectedObj.isLocked}
                          value={selectedObj.position.x}
                          onChange={(e) => onTransformObject(selectedObj.id, { position: { x: parseFloat(e.target.value) } })}
                          className="w-full accent-cyan-400 h-1 bg-cyan-950 rounded cursor-pointer disabled:opacity-40"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between">
                          <span>POS Y</span>
                          <span>{selectedObj.position.y.toFixed(2)}</span>
                        </div>
                        <input
                          type="range"
                          min="-2.5"
                          max="2.5"
                          step="0.1"
                          disabled={selectedObj.isLocked}
                          value={selectedObj.position.y}
                          onChange={(e) => onTransformObject(selectedObj.id, { position: { y: parseFloat(e.target.value) } })}
                          className="w-full accent-cyan-400 h-1 bg-cyan-950 rounded cursor-pointer disabled:opacity-40"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between">
                          <span>SCALE</span>
                          <span>{selectedObj.scale.toFixed(2)}x</span>
                        </div>
                        <input
                          type="range"
                          min="0.3"
                          max="2.8"
                          step="0.05"
                          disabled={selectedObj.isLocked}
                          value={selectedObj.scale}
                          onChange={(e) => onTransformObject(selectedObj.id, { scale: parseFloat(e.target.value) })}
                          className="w-full accent-cyan-400 h-1 bg-cyan-950 rounded cursor-pointer disabled:opacity-40"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between">
                          <span>EXPLODE</span>
                          <span>{Math.round(visualSettings.explosionAmount * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={visualSettings.explosionAmount}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            onUpdateVisualSettings({
                              explosionAmount: val,
                              explodedView: val > 0.05
                            });
                          }}
                          className="w-full accent-cyan-400 h-1 bg-cyan-950 rounded cursor-pointer"
                        />
                      </div>
                    </div>
                    <div className="pt-1.5 border-t border-cyan-500/15 font-mono text-[9px] space-y-1">
                      <div className="flex justify-between items-center">
                        <span>PARTICLE DISPERSION</span>
                        <span className="text-white font-bold">
                          {Math.round(visualSettings.dispersionAmount * 100)}% • {selectedObj.dispersionPhase || 'COMPLETE'}
                        </span>
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
                  </div>
                )}
              </div>
            </HolographicPanel>
          )}

          {/* TAB 3: Autonomous Task Execution Pipeline */}
          {activeTab === 'AUTOMATION' && (
            <HolographicPanel
              title="AUTONOMOUS TASK ENGINE"
              subtitle="MULTI-STEP PIPELINE"
              icon={<Workflow className="w-4 h-4 text-cyan-400" />}
              headerRight={
                <button
                  onClick={() => automationEngine.clearCompleted()}
                  className="text-[9px] font-mono text-cyan-400/70 hover:text-white"
                >
                  CLEAR DONE
                </button>
              }
            >
              <div className="space-y-3">
                <div>
                  <span className="text-[10px] font-mono text-cyan-400/70 block mb-1">
                    EXECUTE STARK PROTOCOL:
                  </span>
                  <div className="flex flex-col space-y-1">
                    <button
                      onClick={() => runQuickAutomation('DIAGNOSTIC')}
                      className="p-1.5 rounded bg-cyan-950/40 hover:bg-cyan-500/20 border border-cyan-500/30 text-left font-mono text-[10px] text-cyan-200 flex items-center justify-between"
                    >
                      <span>▶ Diagnostic Sensor Sweep</span>
                      <Sparkles className="w-3 h-3 text-cyan-400" />
                    </button>
                    <button
                      onClick={() => runQuickAutomation('ORBIT_SWEEP')}
                      className="p-1.5 rounded bg-cyan-950/40 hover:bg-cyan-500/20 border border-cyan-500/30 text-left font-mono text-[10px] text-cyan-200 flex items-center justify-between"
                    >
                      <span>▶ Reconfigure Orbital Array</span>
                      <Sparkles className="w-3 h-3 text-cyan-400" />
                    </button>
                    <button
                      onClick={() => runQuickAutomation('OVERCLOCK')}
                      className="p-1.5 rounded bg-amber-950/30 hover:bg-amber-900/40 border border-amber-500/40 text-left font-mono text-[10px] text-amber-200 flex items-center justify-between"
                    >
                      <span>▶ High-Yield Overclock Pulse</span>
                      <AlertTriangle className="w-3 h-3 text-amber-400" />
                    </button>
                  </div>
                </div>

                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {tasks.length === 0 ? (
                    <div className="text-[11px] font-mono text-cyan-400/60 p-3 bg-black/40 rounded border border-cyan-500/20 text-center">
                      Task execution queue idle. Speak or trigger a protocol to execute.
                    </div>
                  ) : (
                    tasks.map((task) => (
                      <div
                        key={task.id}
                        className="p-2 rounded bg-black/60 border border-cyan-500/30 space-y-1.5 text-xs font-mono"
                      >
                        <div className="flex justify-between items-center">
                          <span className="font-orbitron font-bold text-white text-[11px]">
                            {task.title}
                          </span>
                          <span
                            className={`text-[9px] px-1.5 py-0.5 rounded border ${
                              task.status === 'COMPLETED'
                                ? 'border-emerald-500 text-emerald-300 bg-emerald-950/40'
                                : task.status === 'RUNNING'
                                ? 'border-cyan-400 text-cyan-300 bg-cyan-950/40'
                                : task.status === 'WAITING_CONFIRMATION'
                                ? 'border-amber-400 text-amber-300 bg-amber-950/40'
                                : 'border-red-500 text-red-300 bg-red-950/40'
                            }`}
                          >
                            {task.status}
                          </span>
                        </div>

                        <div className="w-full h-1 bg-black rounded-full overflow-hidden border border-cyan-500/30">
                          <div
                            className="h-full bg-cyan-400 transition-all duration-300"
                            style={{ width: `${task.progressPercent}%` }}
                          />
                        </div>

                        <div className="space-y-0.5 pt-1 text-[10px]">
                          {task.steps.map((st, idx) => (
                            <div key={st.id} className="flex items-center space-x-1.5 text-cyan-300/80">
                              {st.status === 'DONE' ? (
                                <CheckCircle className="w-3 h-3 text-emerald-400" />
                              ) : st.status === 'EXECUTING' ? (
                                <span className="w-2 h-2 rounded-full bg-cyan-400" />
                              ) : (
                                <span className="w-2 h-2 rounded-full bg-cyan-800" />
                              )}
                              <span>
                                {idx + 1}. {st.description}
                              </span>
                            </div>
                          ))}
                        </div>

                        {task.status === 'WAITING_CONFIRMATION' && (
                          <div className="flex space-x-1 pt-1">
                            <button
                              onClick={() => automationEngine.confirmTask(task.id)}
                              className="flex-1 py-1 rounded bg-emerald-500/30 hover:bg-emerald-500/50 text-white font-bold text-[10px] border border-emerald-400"
                            >
                              CONFIRM & EXECUTE
                            </button>
                            <button
                              onClick={() => automationEngine.cancelTask(task.id)}
                              className="py-1 px-2 rounded bg-red-950/40 text-red-300 text-[10px] border border-red-500/40"
                            >
                              CANCEL
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </HolographicPanel>
          )}

          {/* TAB 4: Mission Notes & File Integration */}
          {activeTab === 'NOTES' && (
            <HolographicPanel
              title="MISSION MEMORANDUM // NOTES"
              subtitle="LOCAL-FIRST PERSISTENT SCRATCHPAD"
              icon={<Save className="w-4 h-4 text-cyan-400" />}
              headerRight={
                <div className="flex space-x-1">
                  <button
                    onClick={handleCopyNotes}
                    title="Copy to Clipboard"
                    className="p-1 text-cyan-400 hover:text-white rounded border border-cyan-500/30"
                  >
                    {copiedNote ? <ClipboardCheck className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={handleOpenFile}
                    title="Open Local File"
                    className="p-1 text-cyan-400 hover:text-white rounded border border-cyan-500/30"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={handleSaveNotesFile}
                    title="Save Notes to Local File"
                    className="p-1 text-cyan-400 hover:text-white rounded border border-cyan-500/30"
                  >
                    <Save className="w-3.5 h-3.5" />
                  </button>
                </div>
              }
            >
              <div className="space-y-2">
                <textarea
                  value={notes}
                  onChange={(e) => onUpdateNotes(e.target.value)}
                  rows={7}
                  placeholder="Record Stark Industries mission logs, code snippets, or diagnostics..."
                  className="w-full bg-black/70 border border-cyan-500/40 rounded p-2 font-mono text-[11px] text-cyan-100 placeholder-cyan-500/40 focus:outline-none focus:border-cyan-400 resize-none"
                />
                <div className="flex justify-between items-center text-[10px] font-mono text-cyan-400/70">
                  <span>{notes.length} characters</span>
                  <span>DESKTOP BRIDGE: SECURE LOCAL ACCESS</span>
                </div>
              </div>
            </HolographicPanel>
          )}

          {/* TAB 5: Chronometer & Overclock Timer */}
          {activeTab === 'TIMER' && (
            <HolographicPanel
              title="OVERCLOCK CHRONOMETER"
              subtitle="REACTOR RUNTIME TRACKER"
              icon={<Clock className="w-4 h-4 text-cyan-400" />}
            >
              <div className="space-y-4 py-2 text-center">
                <div className="font-mono text-4xl font-extrabold text-white tracking-widest drop-shadow-[0_0_15px_rgba(0,240,255,0.6)]">
                  {Math.floor(timerSeconds / 60).toString().padStart(2, '0')}:{(timerSeconds % 60).toString().padStart(2, '0')}
                </div>

                <div className="flex justify-center space-x-2">
                  <button
                    onClick={() => {
                      audioService.playChirp(timerActive ? 900 : 1600);
                      setTimerActive(!timerActive);
                    }}
                    className={`py-1.5 px-4 rounded font-orbitron font-bold text-xs border transition-all ${
                      timerActive
                        ? 'border-red-500 bg-red-950/40 text-red-300'
                        : 'border-cyan-400 bg-cyan-500/30 text-white'
                    }`}
                  >
                    {timerActive ? 'PAUSE TIMER' : 'START TIMER'}
                  </button>
                  <button
                    onClick={() => {
                      audioService.playChirp(1000);
                      setTimerActive(false);
                      setTimerSeconds(0);
                    }}
                    className="py-1.5 px-3 rounded font-orbitron text-xs border border-cyan-500/40 bg-cyan-950/30 text-cyan-300 hover:bg-cyan-500/20"
                  >
                    RESET
                  </button>
                </div>

                <div className="flex justify-center space-x-2 pt-2 border-t border-cyan-500/20">
                  <button
                    onClick={() => { audioService.playChirp(1200); setTimerSeconds(300); }}
                    className="px-2 py-0.5 rounded bg-cyan-950/40 border border-cyan-500/30 text-[10px] font-mono text-cyan-300"
                  >
                    +5 MIN
                  </button>
                  <button
                    onClick={() => { audioService.playChirp(1200); setTimerSeconds(900); }}
                    className="px-2 py-0.5 rounded bg-cyan-950/40 border border-cyan-500/30 text-[10px] font-mono text-cyan-300"
                  >
                    +15 MIN
                  </button>
                  <button
                    onClick={() => { audioService.playChirp(1200); setTimerSeconds(1800); }}
                    className="px-2 py-0.5 rounded bg-cyan-950/40 border border-cyan-500/30 text-[10px] font-mono text-cyan-300"
                  >
                    +30 MIN
                  </button>
                </div>
              </div>
            </HolographicPanel>
          )}
        </>
      )}
    </div>
  );
};
