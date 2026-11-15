import React, { useState, useEffect, useRef, useCallback } from 'react';
import { HologramCanvas } from './components/HologramCanvas';
import { TopStatusBar } from './components/HUD/TopStatusBar';
import { LeftVisionHUD } from './components/HUD/LeftVisionHUD';
import { RightDiagnosticsHUD } from './components/HUD/RightDiagnosticsHUD';
import { BottomControlHUD } from './components/HUD/BottomControlHUD';
import { VoiceConsoleHUD } from './components/HUD/VoiceConsoleHUD';
import { StandbyHUD } from './components/HUD/StandbyHUD';
import { BootSequenceOverlay } from './components/HUD/BootSequenceOverlay';
import { FloatingSpatialPanels } from './components/Workspace/FloatingSpatialPanels';
import { PermissionConfirmationModal } from './components/Workspace/PermissionConfirmationModal';
import { AIConfigModal } from './components/HUD/AIConfigModal';
import { HologramSceneManager } from './three/HologramScene';
import {
  ComponentLabel2D,
  HologramModelId,
  HologramVisualSettings,
  InteractionMode,
  LaserTargetInfo,
  LayoutFormation,
  ReconstructionPresetId,
  SpatialObjectState
} from './types/hologram';
import {
  GestureCalibrationSettings,
  GestureDetectionResult,
  GestureType
} from './types/gesture';
import { AssistantMessage, VoiceCommand, DesktopPermissionRequest } from './types/assistant';
import { handTrackingService } from './services/handTracking';
import { gestureEngine, DEFAULT_CALIBRATION } from './services/gestureEngine';
import { audioService } from './services/soundFx';
import { speechService } from './services/speechService';
import { desktopBridge } from './services/desktopBridge';
import { automationEngine } from './services/automationEngine';
import { contextualAI } from './services/contextualAI';

export const App: React.FC = () => {
  const autostart =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('autostart') === '1';

  // Modes & Models State
  const [showBootOverlay, setShowBootOverlay] = useState<boolean>(() => !autostart);
  const [mode, setMode] = useState<InteractionMode>('WORKSPACE');
  const [currentModelId, setCurrentModelId] = useState<HologramModelId>('vision_sphere');
  const [spatialObjects, setSpatialObjects] = useState<SpatialObjectState[]>([]);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [laserTarget, setLaserTarget] = useState<LaserTargetInfo | null>(null);
  const [componentLabels, setComponentLabels] = useState<ComponentLabel2D[]>([]);
  const [activeGestureFeedback, setActiveGestureFeedback] = useState<string | null>(null);
  const [isProcessingCommand, setIsProcessingCommand] = useState<boolean>(false);

  // Discreet Collapsible Edge Drawers (default closed so Vision X core dominates the viewport)
  const [leftDrawerOpen, setLeftDrawerOpen] = useState<boolean>(false);
  const [rightDrawerMode, setRightDrawerMode] = useState<'CLOSED' | 'LAB' | 'DIAGNOSTICS'>('CLOSED');
  const [voiceDrawerOpen, setVoiceDrawerOpen] = useState<boolean>(false);

  const [requestedWorkspaceTab, setRequestedWorkspaceTab] = useState<{
    tab: 'OBJECTS' | 'LAB' | 'AUTOMATION' | 'NOTES' | 'TIMER';
    nonce: number;
  } | null>(null);
  const [requestedDiagnosticsTab, setRequestedDiagnosticsTab] = useState<{
    tab: 'MODELS' | 'DIAGNOSTICS' | 'SETTINGS';
    nonce: number;
  } | null>(null);

  // Modals & Panels State
  const [permissionRequest, setPermissionRequest] = useState<DesktopPermissionRequest | null>(null);
  const [isAIConfigOpen, setIsAIConfigOpen] = useState<boolean>(false);
  const [notes, setNotes] = useState<string>(
    'STARK INDUSTRIES // MARK VII MEMORANDUM\n• VISION 1.2 spatial sphere core calibrated\n• Fusion harmonic stabilized at 142.8 GHz\n• Multi-object spatial collision matrix active\n• Local-first autonomous intelligence engaged'
  );

  // Visual & Calibration Settings
  const [visualSettings, setVisualSettings] = useState<HologramVisualSettings>({
    wireframe: true,
    renderMode: 'HYBRID',
    glowIntensity: 1.5,
    rotationSpeed: 1.0,
    particleCount: 2500,
    colorTheme: 'cyan',
    hologramColor: '#00f0ff',
    explodedView: false,
    explosionAmount: 0,
    dispersionAmount: 0,
    particleIntensity: 1.2,
    orbitalSpeed: 1.0,
    coreBrightness: 1.3,
    scanSpeed: 1.0,
    reducedEffects: false,
    showComponentLabels: true,
    pulseEnabled: true,
    showBoundingBoxes: true,
    spatialFormation: 'FREE',
    sliceEnabled: false,
    sliceAxis: 'y',
    sliceOffset: 0
  });

  const [calibration, setCalibration] = useState<GestureCalibrationSettings>(() => {
    const hasSaved =
      typeof window !== 'undefined' &&
      window.localStorage &&
      Boolean(window.localStorage.getItem('jarvis_gesture_calibration'));
    if (!hasSaved) {
      gestureEngine.updateCalibration({ mirrorX: true });
      return { ...gestureEngine.getCalibration(), mirrorX: true };
    }
    return gestureEngine.getCalibration();
  });

  // Camera & Tracking State
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [gestureResult, setGestureResult] = useState<GestureDetectionResult | null>(null);
  const [fps, setFps] = useState<number>(60);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Voice Assistant State
  const [isVoiceActive, setIsVoiceActive] = useState<boolean>(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([
    {
      id: 'init-1',
      sender: 'JARVIS',
      text: 'Good evening, sir. Mark VII spatial workspace and Reconstruction Lab online. Optical tracking, voice synthesis, and autonomous engines await your command.',
      timestamp: new Date().toLocaleTimeString(),
      type: 'RESPONSE'
    }
  ]);

  // Three.js Scene Reference
  const sceneManagerRef = useRef<HologramSceneManager | null>(null);
  const lastGestureRef = useRef<GestureType>('NONE');
  const lastDispatchedGestureRef = useRef<GestureDetectionResult | null>(null);

  const appendMessage = useCallback(
    (sender: AssistantMessage['sender'], text: string, type: AssistantMessage['type'] = 'INFO') => {
      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(36).substring(7),
          sender,
          text,
          timestamp: new Date().toLocaleTimeString(),
          type
        }
      ]);
    },
    []
  );

  // Sync spatial objects from Three.js scene
  const syncSpatialStates = useCallback(() => {
    if (sceneManagerRef.current) {
      const states = sceneManagerRef.current.getSpatialStates();
      setSpatialObjects(states);
      setSelectedObjectId(sceneManagerRef.current.spatialManager.getSelectedId());
    }
  }, []);

  // Wire up desktop bridge confirmation modal & speech status watcher
  useEffect(() => {
    desktopBridge.setPromptCallback((req) => {
      setPermissionRequest(req);
    });
    speechService.setStatusChangeCallback((active, err) => {
      setIsVoiceActive(active);
      setVoiceError(err || null);
    });
    return () => {
      handTrackingService.stop();
      speechService.stopListening();
    };
  }, []);

  // Update states initially
  useEffect(() => {
    const timer = setTimeout(syncSpatialStates, 500);
    return () => clearTimeout(timer);
  }, [syncSpatialStates]);

  // Trigger Shockwave Action
  const handleTriggerShockwave = useCallback(() => {
    audioService.playShockwave();
    if (sceneManagerRef.current) {
      sceneManagerRef.current.triggerShockwave();
    }
    appendMessage('JARVIS', 'Radial holographic energy shockwave discharged.', 'ALERT');
  }, [appendMessage]);

  // Reset 3D Object Transform
  const handleResetTransform = useCallback(() => {
    audioService.playChirp(1100);
    if (sceneManagerRef.current) {
      sceneManagerRef.current.resetTransform();
      syncSpatialStates();
    }
    appendMessage('JARVIS', 'Holographic anchor position re-centered.', 'INFO');
  }, [appendMessage, syncSpatialStates]);

  // Multi-Object Operations
  const handleAddSpatialObject = useCallback((modelId: HologramModelId) => {
    if (sceneManagerRef.current) {
      audioService.playActivationWhoosh();
      const inst = sceneManagerRef.current.addSpatialObject(modelId);
      setCurrentModelId(modelId);
      syncSpatialStates();
      appendMessage('JARVIS', `Spawned new ${inst.name} in spatial workspace.`, 'INFO');
    }
  }, [appendMessage, syncSpatialStates]);

  const handleDuplicateObject = useCallback((id: string): boolean => {
    if (!sceneManagerRef.current) return false;
    audioService.playChirp(1500);
    const dup = sceneManagerRef.current.spatialManager.duplicate(id);
    syncSpatialStates();
    if (dup) {
      appendMessage('JARVIS', `Cloned ${dup.name}. Both instances ready for independent spatial manipulation.`, 'INFO');
      return true;
    }
    return false;
  }, [appendMessage, syncSpatialStates]);

  const handleDeleteObject = useCallback(async (id: string): Promise<boolean> => {
    const target = spatialObjects.find((o) => o.id === id);
    const targetName = target ? target.name : 'Selected Hologram';

    const approved = await desktopBridge.requestAuthorization(
      'DELETE_OBJECT',
      targetName,
      `De-materialize spatial 3D instance from active scene.`
    );

    if (approved && sceneManagerRef.current) {
      audioService.playChirp(800);
      const deleted = sceneManagerRef.current.spatialManager.delete(id);
      syncSpatialStates();
      if (deleted) {
        appendMessage('JARVIS', `${targetName} de-materialized from workspace.`, 'INFO');
      }
      return deleted;
    }
    return false;
  }, [appendMessage, spatialObjects, syncSpatialStates]);

  const handleSelectObject = useCallback((id: string) => {
    if (sceneManagerRef.current) {
      sceneManagerRef.current.selectObject(id);
      syncSpatialStates();
    }
  }, [syncSpatialStates]);

  const handleToggleLockObject = useCallback((id: string) => {
    if (sceneManagerRef.current) {
      const locked = sceneManagerRef.current.toggleObjectLock(id);
      syncSpatialStates();
      appendMessage('JARVIS', locked ? 'Object spatial transform locked.' : 'Object spatial transform unlocked.', 'INFO');
    }
  }, [appendMessage, syncSpatialStates]);

  const handleTransformObject = useCallback(
    (
      id: string,
      transform: {
        position?: Partial<{ x: number; y: number; z: number }>;
        scale?: number;
      }
    ) => {
      if (sceneManagerRef.current) {
        sceneManagerRef.current.setObjectTransform(id, transform);
        syncSpatialStates();
      }
    },
    [syncSpatialStates]
  );

  const handleGroupAll = useCallback(() => {
    if (sceneManagerRef.current) {
      const ids = sceneManagerRef.current.spatialManager.getAll().map((i) => i.id);
      if (ids.length > 1) {
        sceneManagerRef.current.spatialManager.groupObjects(ids);
        syncSpatialStates();
        appendMessage('JARVIS', `Linked ${ids.length} spatial entities into a synchronized transform group.`, 'INFO');
      }
    }
  }, [appendMessage, syncSpatialStates]);

  const handleUngroupObject = useCallback((id: string) => {
    if (sceneManagerRef.current) {
      sceneManagerRef.current.spatialManager.ungroupObject(id);
      syncSpatialStates();
    }
  }, [syncSpatialStates]);

  const handleApplyFormation = useCallback((formation: LayoutFormation) => {
    if (sceneManagerRef.current) {
      audioService.playActivationWhoosh();
      sceneManagerRef.current.applyFormation(formation);
      syncSpatialStates();
      appendMessage('JARVIS', `Applied ${formation} spatial layout formation.`, 'INFO');
    }
  }, [appendMessage, syncSpatialStates]);

  // Reconstruction Lab Operations
  const handleSynthesizePreset = useCallback((presetId: ReconstructionPresetId) => {
    if (sceneManagerRef.current) {
      audioService.playActivationWhoosh();
      const inst = sceneManagerRef.current.synthesizePreset(presetId);
      setCurrentModelId('reconstructed_object');
      syncSpatialStates();
      appendMessage(
        'JARVIS',
        `Reconstructed ${inst.name} (${inst.vertexCount} vertices, ${inst.faceCount} faces).`,
        'RESPONSE'
      );
    }
  }, [appendMessage, syncSpatialStates]);

  const handleImportMeshFile = useCallback(async (file: File) => {
    if (!sceneManagerRef.current) return;
    try {
      const inst = await sceneManagerRef.current.importMeshFromFile(file);
      audioService.playActivationWhoosh();
      setCurrentModelId('reconstructed_object');
      syncSpatialStates();
      appendMessage(
        'JARVIS',
        `Imported and reconstructed ${inst.name} (${inst.vertexCount} vertices, ${inst.faceCount} faces).`,
        'RESPONSE'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to parse 3D mesh file.';
      appendMessage('JARVIS', msg, 'ALERT');
    }
  }, [appendMessage, syncSpatialStates]);

  const handleCaptureWebcamScan = useCallback((): boolean => {
    if (!isCameraActive || !videoRef.current || !sceneManagerRef.current) {
      appendMessage(
        'JARVIS',
        'Optical sensor is offline. Enable the camera in the Optical drawer first to capture a 3D depth-relief scan.',
        'ALERT'
      );
      return false;
    }
    const inst = sceneManagerRef.current.reconstructFromVideo(videoRef.current);
    if (inst) {
      audioService.playActivationWhoosh();
      setCurrentModelId('reconstructed_object');
      syncSpatialStates();
      appendMessage(
        'JARVIS',
        `Captured optical frame and reconstructed 3D depth-relief hologram (${inst.vertexCount} vertices).`,
        'RESPONSE'
      );
      return true;
    }
    appendMessage('JARVIS', 'Camera video stream is still warming up. Retry in a moment.', 'ALERT');
    return false;
  }, [appendMessage, isCameraActive, syncSpatialStates]);

  const handleTriggerRescan = useCallback(() => {
    if (sceneManagerRef.current) {
      audioService.playActivationWhoosh();
      sceneManagerRef.current.triggerReconstructionScan(selectedObjectId || undefined);
      appendMessage('JARVIS', 'Executing volumetric laser reconstruction pass.', 'INFO');
    }
  }, [appendMessage, selectedObjectId]);

  const handleRotate360 = useCallback((): boolean => {
    if (!sceneManagerRef.current) return false;
    audioService.playChirp(1450);
    const ok = sceneManagerRef.current.rotate360(selectedObjectId || undefined);
    syncSpatialStates();
    return ok;
  }, [selectedObjectId, syncSpatialStates]);

  const handleDisintegrate = useCallback((): boolean => {
    if (!sceneManagerRef.current) return false;
    audioService.playShockwave();
    const ok = sceneManagerRef.current.disintegrateObject(selectedObjectId || undefined);
    if (ok) {
      setVisualSettings((v) => ({ ...v, dispersionAmount: 1.0 }));
      syncSpatialStates();
      appendMessage('JARVIS', 'Particle disintegration initiated. Original spatial state preserved.', 'ALERT');
    }
    return ok;
  }, [appendMessage, selectedObjectId, syncSpatialStates]);

  const handleReconstruct = useCallback((): boolean => {
    if (!sceneManagerRef.current) return false;
    audioService.playActivationWhoosh();
    const ok = sceneManagerRef.current.reconstructObject(selectedObjectId || undefined);
    if (ok) {
      setVisualSettings((v) => ({ ...v, explodedView: false, explosionAmount: 0, dispersionAmount: 0 }));
      syncSpatialStates();
      appendMessage('JARVIS', 'Reassembling holographic structure to original state.', 'RESPONSE');
    }
    return ok;
  }, [appendMessage, selectedObjectId, syncSpatialStates]);

  const handleReconstructImages = useCallback(async (files: File[]) => {
    if (!sceneManagerRef.current) return;
    try {
      const inst = await sceneManagerRef.current.reconstructFromImages(files);
      audioService.playActivationWhoosh();
      setCurrentModelId('reconstructed_object');
      syncSpatialStates();
      appendMessage(
        'JARVIS',
        `Synthesized ${inst.name} via ${inst.reconstructionMethodLabel || 'illustrative visual reconstruction'}.`,
        'RESPONSE'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to process image files.';
      appendMessage('JARVIS', msg, 'ALERT');
    }
  }, [appendMessage, syncSpatialStates]);

  // Model switching
  const handleSelectModel = useCallback((modelId: HologramModelId) => {
    if (sceneManagerRef.current) {
      audioService.playActivationWhoosh();
      sceneManagerRef.current.setModel(modelId);
      setCurrentModelId(modelId);
      syncSpatialStates();
    }
  }, [syncSpatialStates]);

  // Next / Prev 3D Model
  const handleNextModel = useCallback(() => {
    if (sceneManagerRef.current) {
      const nextId = sceneManagerRef.current.nextModel();
      setCurrentModelId(nextId);
      audioService.playSwipeSound();
      syncSpatialStates();
      appendMessage('JARVIS', `Switched holographic module to ${nextId.toUpperCase().replace('_', ' ')}.`, 'INFO');
    }
  }, [appendMessage, syncSpatialStates]);

  const handlePrevModel = useCallback(() => {
    if (sceneManagerRef.current) {
      const prevId = sceneManagerRef.current.prevModel();
      setCurrentModelId(prevId);
      audioService.playSwipeSound();
      syncSpatialStates();
      appendMessage('JARVIS', `Switched holographic module to ${prevId.toUpperCase().replace('_', ' ')}.`, 'INFO');
    }
  }, [appendMessage, syncSpatialStates]);

  // Register Contextual Voice Commands with SpeechService
  useEffect(() => {
    const commands: VoiceCommand[] = [
      {
        patterns: ['hello jarvis', 'hey jarvis', 'jarvis', 'good morning', 'good evening'],
        description: 'Wake greetings',
        category: 'SYSTEM',
        action: () => {},
        feedbackText: 'Good evening, sir. All holographic systems are online and awaiting your command.'
      },
      {
        patterns: [
          'jarvis activate vision',
          'activate vision',
          'activate vision interface',
          'load vision sphere',
          'vision core'
        ],
        description: 'Activate VISION 1.2 Holographic Core',
        category: 'NAVIGATION',
        action: () => {
          setMode('WORKSPACE');
          handleSelectModel('vision_sphere');
        },
        feedbackText: 'VISION 1.2 spatial intelligence sphere online.'
      },
      {
        patterns: [
          'open holographic workspace',
          'initialize holographic interface',
          'initialize hologram',
          'open interface',
          'workspace mode'
        ],
        description: 'Initialize main workspace',
        category: 'NAVIGATION',
        action: () => {
          setMode('WORKSPACE');
          audioService.playActivationWhoosh();
        },
        feedbackText: 'Opening holographic workspace. Mark VII core engaged.'
      },
      {
        patterns: ['show me the vehicle', 'show vehicle', 'show car', 'load car', 'sports car'],
        description: 'Load Hypercar vehicle blueprint',
        category: 'NAVIGATION',
        action: () => handleSelectModel('sports_car'),
        feedbackText: 'Projecting aero hypercar holographic chassis.'
      },
      {
        patterns: ['show bike', 'show motorcycle', 'load bike'],
        description: 'Load Superbike hologram',
        category: 'NAVIGATION',
        action: () => handleSelectModel('cyber_motorcycle'),
        feedbackText: 'Projecting autonomous superbike blueprint.'
      },
      {
        patterns: ['show phone', 'show smartphone', 'load smartphone'],
        description: 'Load Smartphone hologram',
        category: 'NAVIGATION',
        action: () => handleSelectModel('holo_smartphone'),
        feedbackText: 'Projecting holographic smartphone hardware stack.'
      },
      {
        patterns: ['show computer', 'show workstation', 'load computer'],
        description: 'Load Quantum Workstation',
        category: 'NAVIGATION',
        action: () => handleSelectModel('quantum_workstation'),
        feedbackText: 'Projecting quantum compute workstation tower.'
      },
      {
        patterns: ['show engine', 'show jet engine', 'show turbine', 'load engine'],
        description: 'Load Jet Turbine Engine',
        category: 'NAVIGATION',
        action: () => handleSelectModel('jet_turbine_engine'),
        feedbackText: 'Projecting turbofan jet propulsion engine.'
      },
      {
        patterns: ['show building', 'show skyscraper', 'load building'],
        description: 'Load Stark Spire Architecture',
        category: 'NAVIGATION',
        action: () => handleSelectModel('stark_skyscraper'),
        feedbackText: 'Projecting architectural spire blueprint.'
      },
      {
        patterns: ['show machine', 'show robot arm', 'show robot'],
        description: 'Load Industrial Robot Arm',
        category: 'NAVIGATION',
        action: () => handleSelectModel('industrial_robot_arm'),
        feedbackText: 'Projecting 6-DOF industrial robotic manipulator.'
      },
      {
        patterns: ['show gearbox', 'show mechanical component', 'load gearbox'],
        description: 'Load Planetary Gearbox',
        category: 'NAVIGATION',
        action: () => handleSelectModel('planetary_gearbox'),
        feedbackText: 'Projecting planetary mechanical reduction gearbox.'
      },
      {
        patterns: ['show atom', 'show scientific object', 'load atom'],
        description: 'Load Atom Orbital Model',
        category: 'NAVIGATION',
        action: () => handleSelectModel('atom_orbital_model'),
        feedbackText: 'Projecting quantum atomic orbital lattice.'
      },
      {
        patterns: ['switch to arc reactor', 'load arc reactor'],
        description: 'Load Arc Reactor MK-VII',
        category: 'NAVIGATION',
        action: () => handleSelectModel('arc_reactor'),
        feedbackText: 'Projecting Arc Reactor Mark VII clean energy core.'
      },
      {
        patterns: ['switch to tesseract', 'load tesseract', 'quantum tesseract'],
        description: 'Load Quantum Tesseract',
        category: 'NAVIGATION',
        action: () => handleSelectModel('quantum_tesseract'),
        feedbackText: 'Projecting Quantum Tesseract 4D hypercube.'
      },
      {
        patterns: ['switch to mark suit', 'switch to iron man', 'load mark seven', 'armor blueprint'],
        description: 'Load Iron Man Mark VII schematic',
        category: 'NAVIGATION',
        action: () => handleSelectModel('ironman_armor'),
        feedbackText: 'Loading Iron Man Mark VII tactical armor schematics.'
      },
      {
        patterns: ['switch to planetary defense', 'switch to defense grid', 'load globe'],
        description: 'Load Stark Defense Grid',
        category: 'NAVIGATION',
        action: () => handleSelectModel('planetary_defense'),
        feedbackText: 'Projecting Stark Planetary Defense orbital grid.'
      },
      {
        patterns: ['switch to dna', 'switch to helix', 'molecular dna'],
        description: 'Load Nanotech DNA Helix',
        category: 'NAVIGATION',
        action: () => handleSelectModel('molecular_dna'),
        feedbackText: 'Synthesizing nanotech molecular double helix.'
      },
      {
        patterns: ['switch to buckyball', 'switch to fullerene'],
        description: 'Load Fullerene C60',
        category: 'NAVIGATION',
        action: () => handleSelectModel('carbon_buckyball'),
        feedbackText: 'Projecting Fullerene C60 carbon lattice.'
      },
      {
        patterns: ['switch to telemetry chart', 'switch to data chart'],
        description: 'Load Telemetry Spectrum',
        category: 'NAVIGATION',
        action: () => handleSelectModel('hologram_datachart'),
        feedbackText: 'Projecting 3D volumetric telemetry spectrum.'
      },
      {
        patterns: ['rotate it 360 degrees', 'rotate 360 degrees', 'rotate 360', '360 rotation'],
        description: 'Full 360-degree rotation',
        category: 'MANIPULATION',
        action: () => handleRotate360(),
        feedbackText: 'Executing full 360-degree holographic inspection rotation.',
        failureText: 'Rotation blocked — unlock the selected holographic object first.'
      },
      {
        patterns: ['rotate hologram', 'rotate the hologram', 'rotate the interface', 'rotate interface', 'rotate the object', 'rotate object', 'spin object', 'rotate it'],
        description: 'Rotate holographic interface or object',
        category: 'MANIPULATION',
        action: () => {
          if (!sceneManagerRef.current) return false;
          sceneManagerRef.current.applySphericalRotation(0, 0.9, 0);
          return true;
        },
        feedbackText: 'Rotating the holographic structure.'
      },
      {
        patterns: ['turn right', 'rotate right'],
        description: 'Rotate sphere right',
        category: 'MANIPULATION',
        action: () => {
          if (sceneManagerRef.current) {
            sceneManagerRef.current.applySphericalRotation(0, 0.75, 0);
          }
        },
        feedbackText: 'Rotating holographic sphere right.'
      },
      {
        patterns: ['turn left', 'rotate left'],
        description: 'Rotate sphere left',
        category: 'MANIPULATION',
        action: () => {
          if (sceneManagerRef.current) {
            sceneManagerRef.current.applySphericalRotation(0, -0.75, 0);
          }
        },
        feedbackText: 'Rotating holographic sphere left.'
      },
      {
        patterns: ['explode the model', 'show internal components', 'exploded view', 'disassemble', 'breakdown view'],
        description: 'Explode model into labeled layers',
        category: 'MANIPULATION',
        action: () => {
          setVisualSettings((v) => ({
            ...v,
            explodedView: true,
            explosionAmount: 1.0,
            showComponentLabels: true
          }));
        },
        feedbackText: 'Expanding assembly layers and surfacing component callouts.'
      },
      {
        patterns: ['increase dispersion', 'more dispersion'],
        description: 'Increase particle dispersion level',
        category: 'CINEMATIC',
        action: () => {
          setVisualSettings((v) => {
            const next = Math.min(1.0, v.dispersionAmount + 0.35);
            sceneManagerRef.current?.setDispersion(next, next >= 0.85 ? 'DISPERSED' : 'EXPANDING');
            return { ...v, dispersionAmount: next };
          });
          syncSpatialStates();
        },
        feedbackText: 'Increasing holographic particle dispersion.'
      },
      {
        patterns: ['disperse the sphere', 'disperse sphere', 'disperse the interface', 'disperse interface', 'disintegrate', 'particle disintegration'],
        description: 'Disperse sphere or object into particles',
        category: 'CINEMATIC',
        action: () => {
          setVisualSettings((v) => ({ ...v, dispersionAmount: 1.0 }));
          sceneManagerRef.current?.setDispersion(1.0, 'DISPERSED');
          return handleDisintegrate();
        },
        feedbackText: 'Dispersing holographic structure into controlled energy particles.'
      },
      {
        patterns: ['reconstruct the interface', 'reconstruct interface', 'reconstruct the object', 'reconstruct object', 'assembled view', 'assemble', 'reconstruct'],
        description: 'Reconstruct dispersed particles back into original structure',
        category: 'MANIPULATION',
        action: () => handleReconstruct(),
        feedbackText: 'Reconstructing particles back into exact original geometry.'
      },
      {
        patterns: ['return to normal view', 'return to normal', 'normal view'],
        description: 'Return to normal assembled view',
        category: 'NAVIGATION',
        action: () => {
          setMode('WORKSPACE');
          setLeftDrawerOpen(false);
          setRightDrawerMode('CLOSED');
          setVoiceDrawerOpen(false);
          handleReconstruct();
          handleResetTransform();
        },
        feedbackText: 'Restoring clean spatial focus and assembled holographic core.'
      },
      {
        patterns: ['open the object laboratory', 'open object laboratory', 'open laboratory', 'object laboratory'],
        description: 'Open Reconstruction & Manipulation Lab panel',
        category: 'NAVIGATION',
        action: () => {
          setMode('WORKSPACE');
          setRightDrawerMode('LAB');
          setRequestedWorkspaceTab({ tab: 'LAB', nonce: Date.now() });
          audioService.playActivationWhoosh();
        },
        feedbackText: 'Opening the holographic Object Reconstruction Laboratory.'
      },
      {
        patterns: ['show diagnostics', 'open diagnostics'],
        description: 'Show reactor diagnostics & telemetry panel',
        category: 'NAVIGATION',
        action: () => {
          setMode('WORKSPACE');
          setRightDrawerMode('DIAGNOSTICS');
          setRequestedDiagnosticsTab({ tab: 'DIAGNOSTICS', nonce: Date.now() });
          audioService.playChirp(1400);
        },
        feedbackText: 'Displaying live holographic diagnostics telemetry.'
      },
      {
        patterns: ['activate diagnostics', 'run diagnostic sweep', 'diagnostic protocol', 'system sweep'],
        description: 'Activate diagnostics and run system sweep',
        category: 'AUTOMATION',
        action: () => {
          setMode('WORKSPACE');
          setRightDrawerMode('DIAGNOSTICS');
          setRequestedDiagnosticsTab({ tab: 'DIAGNOSTICS', nonce: Date.now() });
          automationEngine.createTask(
            'Autonomous Optical & Containment Sweep',
            'Verify camera frames, landmark smoothing, and containment flux.',
            [
              { description: 'Testing optical sensor stream fidelity', action: () => audioService.playChirp(1200) },
              { description: 'Synchronizing 21 3D hand landmarks', action: () => audioService.playChirp(1400) },
              { description: 'Evaluating magnetic containment coherence', action: () => audioService.playActivationWhoosh() }
            ]
          );
        },
        feedbackText: 'Activating diagnostics and initiating sensor containment sweep.'
      },
      {
        patterns: ['laser scan', 'rescan', 'run holographic scan'],
        description: 'Trigger holographic laser reconstruction scan',
        category: 'MANIPULATION',
        action: () => handleTriggerRescan(),
        feedbackText: 'Executing volumetric laser reconstruction pass.'
      },
      {
        patterns: ['wireframe mode', 'wireframe'],
        description: 'Switch to wireframe topology',
        category: 'MANIPULATION',
        action: () => setVisualSettings((v) => ({ ...v, renderMode: 'WIREFRAME', wireframe: true })),
        feedbackText: 'Switching hologram topology to wireframe mesh.'
      },
      {
        patterns: ['point cloud mode', 'point cloud'],
        description: 'Switch to point cloud topology',
        category: 'MANIPULATION',
        action: () => setVisualSettings((v) => ({ ...v, renderMode: 'POINT_CLOUD', wireframe: true })),
        feedbackText: 'Rendering volumetric point-cloud vertex lattice.'
      },
      {
        patterns: ['solid hologram', 'solid mode'],
        description: 'Switch to solid hologram surface',
        category: 'MANIPULATION',
        action: () => setVisualSettings((v) => ({ ...v, renderMode: 'SOLID_HOLO', wireframe: false })),
        feedbackText: 'Engaging translucent solid hologram surface.'
      },
      {
        patterns: ['hybrid mode', 'hybrid view'],
        description: 'Switch to hybrid hologram mode',
        category: 'MANIPULATION',
        action: () => setVisualSettings((v) => ({ ...v, renderMode: 'HYBRID', wireframe: true })),
        feedbackText: 'Engaging hybrid multi-layer holographic rendering.'
      },
      {
        patterns: ['slice view', 'cross section', 'enable slice'],
        description: 'Enable cross-section tomography slice plane',
        category: 'MANIPULATION',
        action: () => setVisualSettings((v) => ({ ...v, sliceEnabled: true })),
        feedbackText: 'Activating tomography cross-section slicing plane.'
      },
      {
        patterns: ['disable slice', 'turn off slice', 'full mesh'],
        description: 'Disable cross-section slice',
        category: 'MANIPULATION',
        action: () => setVisualSettings((v) => ({ ...v, sliceEnabled: false })),
        feedbackText: 'Disengaging tomography slicing plane.'
      },
      {
        patterns: ['lock object', 'freeze object'],
        description: 'Lock selected object transform',
        category: 'SPATIAL',
        action: () => {
          if (selectedObjectId && sceneManagerRef.current) {
            sceneManagerRef.current.spatialManager.setLocked(selectedObjectId, true);
            syncSpatialStates();
            return true;
          }
          return false;
        },
        feedbackText: 'Spatial transform locked for active hologram.',
        failureText: 'No active hologram selected to lock.'
      },
      {
        patterns: ['unlock object', 'unfreeze object'],
        description: 'Unlock selected object transform',
        category: 'SPATIAL',
        action: () => {
          if (selectedObjectId && sceneManagerRef.current) {
            sceneManagerRef.current.spatialManager.setLocked(selectedObjectId, false);
            sceneManagerRef.current.spatialManager.setFrozen(selectedObjectId, false);
            syncSpatialStates();
            return true;
          }
          return false;
        },
        feedbackText: 'Spatial transform unlocked.',
        failureText: 'No active hologram selected to unlock.'
      },
      {
        patterns: ['expand it', 'expand', 'zoom in', 'enlarge'],
        description: 'Expand hologram',
        category: 'MANIPULATION',
        action: () => {
          if (sceneManagerRef.current) {
            sceneManagerRef.current.applyScaleMultiplier(1.35);
            syncSpatialStates();
            return true;
          }
          return false;
        },
        feedbackText: 'Expanding the holographic structure.'
      },
      {
        patterns: ['shrink it', 'shrink', 'zoom out', 'contract'],
        description: 'Contract hologram',
        category: 'MANIPULATION',
        action: () => {
          if (sceneManagerRef.current) {
            sceneManagerRef.current.applyScaleMultiplier(0.75);
            syncSpatialStates();
            return true;
          }
          return false;
        },
        feedbackText: 'Contracting holographic dimensions.'
      },
      {
        patterns: ['reset environment', 'reset hologram', 'reset object', 'reset', 'center object', 'recenter'],
        description: 'Reset environment, dispersion, and hologram anchor',
        category: 'MANIPULATION',
        action: () => {
          setVisualSettings((v) => ({
            ...v,
            explodedView: false,
            explosionAmount: 0,
            dispersionAmount: 0,
            sliceEnabled: false
          }));
          handleReconstruct();
          handleResetTransform();
          return true;
        },
        feedbackText: 'Resetting Vision X environment and returning anchor to origin.'
      },
      {
        patterns: ['duplicate it', 'duplicate object', 'clone object', 'make a copy'],
        description: 'Duplicate selected object',
        category: 'SPATIAL',
        action: () => {
          if (!selectedObjectId) return false;
          return handleDuplicateObject(selectedObjectId);
        },
        feedbackText: 'Duplicating selected holographic entity.',
        failureText: 'No holographic object selected to duplicate.'
      },
      {
        patterns: ['delete it', 'delete object', 'remove object', 'dematerialize'],
        description: 'Delete selected object',
        category: 'SPATIAL',
        action: async () => {
          if (!selectedObjectId) return false;
          return handleDeleteObject(selectedObjectId);
        },
        feedbackText: 'Selected holographic object de-materialized.',
        failureText: 'Deletion cancelled or no object selected.',
        requiresConfirmation: true
      },
      {
        patterns: ['orbit formation', 'orbit layout', 'orbit'],
        description: 'Orbit layout',
        category: 'SPATIAL',
        action: () => handleApplyFormation('ORBIT'),
        feedbackText: 'Applying orbital satellite formation to all active modules.'
      },
      {
        patterns: ['grid formation', 'grid layout', 'matrix layout'],
        description: 'Grid layout',
        category: 'SPATIAL',
        action: () => handleApplyFormation('GRID'),
        feedbackText: 'Arranging all active modules in planar matrix grid.'
      },
      {
        patterns: ['lineup formation', 'line formation', 'linear array'],
        description: 'Line layout',
        category: 'SPATIAL',
        action: () => handleApplyFormation('LINE'),
        feedbackText: 'Aligning holographic models in linear telemetry array.'
      },
      {
        patterns: ['trigger shockwave', 'cinematic pulse', 'repulsor blast', 'shockwave'],
        description: 'Discharge energy wave',
        category: 'CINEMATIC',
        action: () => handleTriggerShockwave(),
        feedbackText: 'Discharging radial energy pulse.'
      },
      {
        patterns: ['run overclock protocol', 'overclock pulse'],
        description: 'Autonomous overclock workflow',
        category: 'AUTOMATION',
        action: () => {
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
        },
        feedbackText: 'Starting high-yield overclock workflow. Security verification required.'
      },
      {
        patterns: ['open ai settings', 'configure ai', 'ai settings'],
        description: 'Open AI provider modal',
        category: 'SYSTEM',
        action: () => setIsAIConfigOpen(true),
        feedbackText: 'Opening AI intelligence provider configuration panel.'
      },
      {
        patterns: ['save notes', 'export notes', 'save file'],
        description: 'Save notes to file',
        category: 'SYSTEM',
        action: async () => {
          const approved = await desktopBridge.requestAuthorization(
            'FILE_WRITE',
            'stark_lab_notes.txt',
            'Export mission memorandum notes to authorized local file system.'
          );
          if (approved) {
            await desktopBridge.saveAuthorizedFile('stark_lab_notes.txt', notes);
          }
        },
        feedbackText: 'Requesting permission to export mission memo to local storage.'
      },
      {
        patterns: ['enter standby mode', 'standby', 'sleep mode'],
        description: 'Activate standby',
        category: 'SYSTEM',
        action: () => setMode('STANDBY'),
        feedbackText: 'Entering standby mode. Power conservation engaged.'
      },
      {
        patterns: ['wake up', 'wake', 'activate systems'],
        description: 'Wake from standby',
        category: 'SYSTEM',
        action: () => setMode('WORKSPACE'),
        feedbackText: 'Systems restored to active status.'
      },
      {
        patterns: ['status report', 'diagnostics', 'system status'],
        description: 'Status report',
        category: 'SYSTEM',
        action: () => {},
        feedbackText: 'Core output 3.2 Gigajoules. Magnetic containment stable at 99.8%. All optical sensors operational.'
      },
      {
        patterns: ['what time is it', 'time and date', 'current time'],
        description: 'Current time',
        category: 'AI',
        action: () => {},
        feedbackText: `The current time is ${new Date().toLocaleTimeString()}.`
      }
    ];

    speechService.registerCommands(commands);
    speechService.setMessageCallback((msg) => {
      setMessages((prev) => [...prev, msg]);
    });
  }, [
    handleApplyFormation,
    handleDeleteObject,
    handleDisintegrate,
    handleDuplicateObject,
    handleReconstruct,
    handleResetTransform,
    handleRotate360,
    handleSelectModel,
    handleTriggerRescan,
    handleTriggerShockwave,
    notes,
    selectedObjectId,
    syncSpatialStates
  ]);

  // Voice Assistant toggle with explicit microphone permission flow
  const handleToggleVoice = useCallback(async () => {
    if (isVoiceActive) {
      speechService.stopListening();
      setIsVoiceActive(false);
      setVoiceError(null);
      appendMessage('JARVIS', 'Audio sensor deactivated. Hardware microphone tracks closed.', 'INFO');
    } else {
      setVoiceError(null);
      const res = await speechService.startListeningWithPermission();
      setIsVoiceActive(res.started);
      if (res.started) {
        audioService.playActivationWhoosh();
        appendMessage('JARVIS', 'Audio sensor online. Speak your command, sir.', 'INFO');
      } else if (res.error) {
        setVoiceError(res.error);
        appendMessage('JARVIS', res.error, 'ALERT');
      }
    }
  }, [appendMessage, isVoiceActive]);

  // Handle direct command string from console input with Contextual AI
  const handleSendConsoleCommand = useCallback(async (text: string) => {
    contextualAI.addHistory('user', text);

    if (contextualAI.getConfig().provider !== 'LOCAL' && contextualAI.hasApiKey()) {
      setIsProcessingCommand(true);
      try {
        const extReply = await contextualAI.queryExternalAI(text);
        if (extReply) {
          appendMessage('USER', text, 'COMMAND');
          appendMessage('JARVIS', extReply, 'RESPONSE');
          speechService.speak(extReply);
          return;
        }
      } finally {
        setIsProcessingCommand(false);
      }
    }

    speechService.handleTranscript(text);
  }, [appendMessage]);

  // Camera & Tracking toggle with clear permission feedback
  const handleToggleCamera = useCallback(async () => {
    if (isCameraActive) {
      handTrackingService.stop();
      gestureEngine.recalibrateNeutral();
      lastGestureRef.current = 'NONE';
      lastDispatchedGestureRef.current = null;
      setIsCameraActive(false);
      setCameraError(null);
      setGestureResult(null);
      setActiveGestureFeedback(null);
      setLaserTarget(null);
      if (sceneManagerRef.current) {
        sceneManagerRef.current.clearRotationInertia();
        sceneManagerRef.current.setHandCentroid(undefined);
        sceneManagerRef.current.updateLaserPointer(0, 0, false);
      }
      appendMessage('JARVIS', 'Optical sensor deactivated. Camera hardware disconnected.', 'INFO');
    } else {
      if (!videoRef.current) return;
      setCameraError(null);
      const started = await handTrackingService.startCamera(
        videoRef.current,
        (result, currentFps) => {
          setFps(currentFps);
          const detection = gestureEngine.processResults(result);
          setGestureResult(detection);
          if (sceneManagerRef.current) {
            sceneManagerRef.current.setHandCentroid(detection.hands[0]?.centroid);
          }
        }
      );
      setIsCameraActive(started);
      if (started) {
        audioService.playActivationWhoosh();
        appendMessage('JARVIS', 'Optical sensor online. MediaPipe 21-landmark hand tracking active.', 'INFO');
      } else {
        const errMsg = handTrackingService.getLastError() || 'Unable to activate optical camera sensor.';
        setCameraError(errMsg);
        appendMessage('JARVIS', errMsg, 'ALERT');
      }
    }
  }, [appendMessage, isCameraActive]);

  // GESTURE DISPATCH ENGINE
  useEffect(() => {
    if (!gestureResult || lastDispatchedGestureRef.current === gestureResult) return;
    lastDispatchedGestureRef.current = gestureResult;

    const g = gestureResult.activeGesture;
    const scene = sceneManagerRef.current;

    if (lastGestureRef.current === 'PINCH' && g !== 'PINCH' && g !== 'MOVE_PINCHED') {
      audioService.playPinchRelease();
    }

    // Update or clear 3D Laser Targeting Reticle
    if (g !== 'TWO_FINGER_POINT' && scene) {
      scene.updateLaserPointer(0, 0, false);
      setLaserTarget((prev) => (prev ? null : prev));
    }

    if (gestureResult.trackingLost) {
      setActiveGestureFeedback('OPTICAL TRACKING LOST // STABILIZING');
    }

    if (g === 'NONE') {
      lastGestureRef.current = 'NONE';
      if (!gestureResult.trackingLost) {
        setActiveGestureFeedback((prev) => (prev ? null : prev));
      }
      return;
    }

    // Apply continuous two-hand particle dispersion when present
    if (gestureResult.dispersionControl && scene) {
      const disp = gestureResult.dispersionControl;
      scene.setDispersion(disp.dispersion, disp.phase);
      setVisualSettings((v) =>
        Math.abs(v.dispersionAmount - disp.dispersion) >= 0.015
          ? { ...v, dispersionAmount: disp.dispersion }
          : v
      );
    }

    // A. OPEN PALM (Activate interaction / unfreeze)
    if (g === 'OPEN_PALM') {
      setActiveGestureFeedback('GESTURE // OPEN PALM · INTERACTION ACTIVE');
      if (scene && selectedObjectId) {
        scene.spatialManager.setFrozen(selectedObjectId, false);
      }
      setMode((prev) => {
        if (prev === 'STANDBY') {
          audioService.playActivationWhoosh();
          return 'WORKSPACE';
        }
        return prev;
      });
    }
    // B. CLOSED FIST (Hold / Freeze active object)
    else if (g === 'CLOSED_FIST') {
      setActiveGestureFeedback('GESTURE // CLOSED FIST · OBJECT FROZEN');
      if (scene) scene.clearRotationInertia();
      if (lastGestureRef.current !== 'CLOSED_FIST') {
        audioService.playChirp(820);
        if (scene && selectedObjectId) {
          scene.spatialManager.setFrozen(selectedObjectId, true);
          syncSpatialStates();
        }
      }
    }
    // C. PINCH
    else if (g === 'PINCH') {
      setActiveGestureFeedback('GESTURE // PINCH · TARGET GRABBED');
      if (scene) scene.clearRotationInertia();
      if (lastGestureRef.current !== 'PINCH' && lastGestureRef.current !== 'MOVE_PINCHED') {
        audioService.playPinchGrab();
      }
    }
    // D. MOVE PINCHED HAND
    else if (g === 'MOVE_PINCHED' && gestureResult.deltaTranslation && scene) {
      setActiveGestureFeedback('GESTURE // TRANSLATE OBJECT');
      scene.applyDeltaTranslation(
        gestureResult.deltaTranslation.x,
        gestureResult.deltaTranslation.y,
        gestureResult.deltaTranslation.z
      );
    }
    // E. ROTATE WRIST
    else if (g === 'ROTATE_WRIST' && gestureResult.deltaRotation && scene) {
      setActiveGestureFeedback('GESTURE // WRIST ROTATION');
      scene.applyDeltaRotation(
        gestureResult.deltaRotation.x,
        gestureResult.deltaRotation.y,
        gestureResult.deltaRotation.z
      );
    }
    // E2. CONTINUOUS HAND SPHERE ROTATION
    else if (g === 'SPHERE_ROTATE' && gestureResult.sphericalRotationDelta && scene) {
      const { x, y, z } = gestureResult.sphericalRotationDelta;
      setActiveGestureFeedback('GESTURE // SPHERICAL ROTATION');
      scene.applySphericalRotation(x, y, z);
    }
    // F. TWO-HAND MOVEMENT (ZOOM / DISPERSION)
    else if (g === 'TWO_HAND_ZOOM' && scene) {
      scene.clearRotationInertia();
      if (gestureResult.dispersionControl) {
        setActiveGestureFeedback(
          `GESTURE // DISPERSION ${Math.round(gestureResult.dispersionControl.dispersion * 100)}% (${gestureResult.dispersionControl.phase})`
        );
      } else {
        setActiveGestureFeedback('GESTURE // TWO-HAND SCALE');
      }
      if (gestureResult.deltaScale && Math.abs(gestureResult.deltaScale - 1.0) > 0.002) {
        scene.applyScaleMultiplier(gestureResult.deltaScale);
      }
    }
    // G. TWO OPEN PALMS
    else if (g === 'TWO_OPEN_PALMS') {
      if (scene) scene.clearRotationInertia();
      if (gestureResult.dispersionControl) {
        setActiveGestureFeedback(
          `GESTURE // WIDE INTERFACE · DISPERSION ${Math.round(gestureResult.dispersionControl.dispersion * 100)}%`
        );
      } else {
        setActiveGestureFeedback('GESTURE // CINEMATIC MODE');
      }
      if (lastGestureRef.current !== 'TWO_OPEN_PALMS') {
        audioService.playActivationWhoosh();
        setMode('CINEMATIC');
      }
    }
    // H. QUICK SWIPES
    else if (g === 'SWIPE_RIGHT' && lastGestureRef.current !== 'SWIPE_RIGHT') {
      setActiveGestureFeedback('GESTURE // SWIPE NEXT MODULE');
      handleNextModel();
    } else if (g === 'SWIPE_LEFT' && lastGestureRef.current !== 'SWIPE_LEFT') {
      setActiveGestureFeedback('GESTURE // SWIPE PREV MODULE');
      handlePrevModel();
    }
    // I. TWO-FINGER POINT (Precision 3D Laser Targeting Reticle)
    else if (g === 'TWO_FINGER_POINT' && scene && gestureResult.hands[0]) {
      setActiveGestureFeedback('GESTURE // PRECISION LASER RETICLE');
      const indexTip = gestureResult.hands[0].landmarks[8];
      if (indexTip) {
        const ndcX = (1 - indexTip.x) * 2 - 1;
        const ndcY = -(indexTip.y * 2 - 1);
        const hit = scene.updateLaserPointer(ndcX, ndcY, true);
        setLaserTarget(hit);
      }
    }
    // J. DOUBLE PINCH (Toggle Exploded View)
    else if (g === 'DOUBLE_PINCH' && lastGestureRef.current !== 'DOUBLE_PINCH') {
      setActiveGestureFeedback('GESTURE // EXPLODED ASSEMBLY TOGGLE');
      audioService.playChirp(1500);
      setVisualSettings((v) => {
        const next = !v.explodedView;
        return { ...v, explodedView: next, explosionAmount: next ? 1.0 : 0.0 };
      });
    }
    // K. HAND PUSH FORWARD (Virtual Energy Displacement Shockwave)
    else if (g === 'PUSH_FORWARD' && lastGestureRef.current !== 'PUSH_FORWARD') {
      setActiveGestureFeedback('GESTURE // PUSH ENERGY DISPLACEMENT');
      handleTriggerShockwave();
    }
    // L. HAND PULL BACK (Reconstruct / Retrieve Object)
    else if (g === 'PULL_BACK' && lastGestureRef.current !== 'PULL_BACK') {
      setActiveGestureFeedback('GESTURE // PULL RECONSTRUCT & RETRIEVE');
      handleReconstruct();
      handleResetTransform();
    }

    lastGestureRef.current = g;
  }, [
    gestureResult,
    handleNextModel,
    handlePrevModel,
    handleReconstruct,
    handleResetTransform,
    handleTriggerShockwave,
    selectedObjectId,
    syncSpatialStates
  ]);

  // Audio Speech state watcher & Reactive Core Synchronization
  useEffect(() => {
    const timer = setInterval(() => {
      setIsSpeaking(speechService.isCurrentlySpeaking());
    }, 100);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (sceneManagerRef.current) {
      sceneManagerRef.current.setCoreActivity({
        isListening: isVoiceActive,
        isSpeaking,
        isProcessing: isProcessingCommand
      });
    }
  }, [isVoiceActive, isSpeaking, isProcessingCommand]);

  // Project 2D component callout labels smoothly when Exploded View or VISION 1.2 CORE is active
  useEffect(() => {
    const shouldShowLabels =
      visualSettings.showComponentLabels &&
      (visualSettings.explosionAmount > 0.15 ||
        (currentModelId === 'vision_sphere' &&
          !visualSettings.reducedEffects &&
          visualSettings.dispersionAmount < 0.85));

    if (!shouldShowLabels) {
      if (componentLabels.length > 0) setComponentLabels([]);
      return;
    }

    const interval = setInterval(() => {
      if (sceneManagerRef.current) {
        setComponentLabels(sceneManagerRef.current.getProjectedComponentLabels());
      }
    }, 80);

    return () => clearInterval(interval);
  }, [
    visualSettings.showComponentLabels,
    visualSettings.explosionAmount,
    visualSettings.reducedEffects,
    visualSettings.dispersionAmount,
    currentModelId,
    componentLabels.length
  ]);

  const selectedSpatialObj = spatialObjects.find((o) => o.id === selectedObjectId) || spatialObjects[0] || null;
  const isTrackingLost = Boolean(isCameraActive && gestureResult?.trackingLost);

  const coreActivityLabel = isTrackingLost
    ? 'TRACKING LOST'
    : selectedSpatialObj?.dispersionPhase && selectedSpatialObj.dispersionPhase !== 'COMPLETE'
    ? `DISPERSION: ${selectedSpatialObj.dispersionPhase}`
    : selectedSpatialObj?.isDisintegrated
    ? 'DISINTEGRATED'
    : selectedSpatialObj?.isFrozen
    ? 'OBJECT FROZEN'
    : isSpeaking
    ? 'SPEAKING'
    : isVoiceActive
    ? 'LISTENING'
    : 'ACTIVE';

  const isDispersed = visualSettings.dispersionAmount >= 0.45 || Boolean(selectedSpatialObj?.isDisintegrated);
  const hasOpenDrawers = leftDrawerOpen || rightDrawerMode !== 'CLOSED' || voiceDrawerOpen;

  const handleToggleDispersion = useCallback(() => {
    if (isDispersed) {
      handleReconstruct();
    } else {
      setVisualSettings((v) => ({ ...v, dispersionAmount: 1.0 }));
      sceneManagerRef.current?.setDispersion(1.0, 'DISPERSED');
      handleDisintegrate();
    }
  }, [handleDisintegrate, handleReconstruct, isDispersed]);

  const handleToggleCollapseAll = useCallback(() => {
    if (hasOpenDrawers) {
      setLeftDrawerOpen(false);
      setRightDrawerMode('CLOSED');
      setVoiceDrawerOpen(false);
    } else {
      setRightDrawerMode('LAB');
    }
  }, [hasOpenDrawers]);

  const handleBootProgress = useCallback((p: number) => {
    sceneManagerRef.current?.setInitializationProgress(p);
  }, []);

  const handleBootComplete = useCallback(() => {
    sceneManagerRef.current?.skipInitialization();
    setShowBootOverlay(false);
  }, []);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#02060c] font-mono text-cyan-400 select-none flex flex-col">
      {/* 0. Skippable Live-3D Initialization Telemetry */}
      {showBootOverlay && (
        <BootSequenceOverlay
          onProgress={handleBootProgress}
          onComplete={handleBootComplete}
        />
      )}

      {/* 1. Central Full-Viewport 3D Holographic Canvas */}
      <HologramCanvas
        currentModelId={currentModelId}
        visualSettings={visualSettings}
        sceneManagerRef={sceneManagerRef}
        onModelChange={handleSelectModel}
        onSelectObject={(id) => {
          setSelectedObjectId(id);
          syncSpatialStates();
        }}
        onTransformChange={syncSpatialStates}
        laserTarget={laserTarget}
        componentLabels={componentLabels}
        activeGestureFeedback={activeGestureFeedback}
        isTrackingLost={isTrackingLost}
        startAtInitZero={!autostart}
      />

      {/* 2. Slim Top Telemetry Bar */}
      {mode !== 'STANDBY' && (
        <TopStatusBar
          mode={mode}
          fps={fps}
          coreState={coreActivityLabel}
          onModeChange={(nextMode) => {
            setMode(nextMode);
            if (nextMode === 'CINEMATIC') {
              setLeftDrawerOpen(false);
              setRightDrawerMode('CLOSED');
              setVoiceDrawerOpen(false);
            }
          }}
          hasOpenDrawers={hasOpenDrawers}
          onToggleCollapseAll={handleToggleCollapseAll}
        />
      )}

      {/* 3. Unobstructed Center Spatial Area with Collapsible Edge Drawers */}
      {mode !== 'STANDBY' && (
        <div className="relative z-20 flex-1 pointer-events-none flex justify-between items-stretch p-3 overflow-hidden">
          {/* Left Edge Column: Collapsible Optical Sensor & Vocal Stream */}
          <div className="flex flex-col justify-between items-start space-y-2 max-h-full">
            {leftDrawerOpen && (
              <div className="pointer-events-auto overflow-y-auto max-h-full pr-1 animate-fade-in">
                <LeftVisionHUD
                  isCameraActive={isCameraActive}
                  cameraError={cameraError}
                  onToggleCamera={handleToggleCamera}
                  gestureResult={gestureResult}
                  calibration={calibration}
                  onUpdateCalibration={(cal) => {
                    setCalibration((prev) => ({ ...prev, ...cal }));
                    gestureEngine.updateCalibration(cal);
                  }}
                  onResetCalibration={() => {
                    const defaults = gestureEngine.resetCalibrationToDefaults();
                    gestureEngine.updateCalibration({ mirrorX: true });
                    setCalibration({ ...defaults, mirrorX: true });
                  }}
                  onRecalibrateNeutral={() => {
                    gestureEngine.recalibrateNeutral();
                    appendMessage('JARVIS', 'Neutral optical hand anchor recalibrated.', 'INFO');
                  }}
                  videoRef={videoRef}
                />
              </div>
            )}

            {voiceDrawerOpen && (
              <div className="pointer-events-auto mt-auto animate-fade-in">
                <VoiceConsoleHUD
                  messages={messages}
                  onSendCommand={handleSendConsoleCommand}
                  isListening={isVoiceActive}
                  isSpeaking={isSpeaking}
                  isProcessing={isProcessingCommand}
                  onClearHistory={() => setMessages((prev) => prev.slice(0, 1))}
                />
              </div>
            )}
          </div>

          {/* Center remains 100% open & unobstructed for the Vision X Hologram */}
          <div className="flex-1 pointer-events-none" />

          {/* Right Edge Column: Collapsible Object Lab OR Diagnostics & Model Catalog */}
          <div className="flex flex-col justify-start items-end max-h-full">
            {rightDrawerMode === 'LAB' && (
              <div className="pointer-events-auto overflow-y-auto max-h-full pl-1 animate-fade-in">
                <FloatingSpatialPanels
                  spatialObjects={spatialObjects}
                  selectedObjectId={selectedObjectId}
                  visualSettings={visualSettings}
                  isCameraActive={isCameraActive}
                  onUpdateVisualSettings={(settings) =>
                    setVisualSettings((v) => ({ ...v, ...settings }))
                  }
                  onSelectObject={handleSelectObject}
                  onAddObject={handleAddSpatialObject}
                  onDuplicateObject={handleDuplicateObject}
                  onDeleteObject={handleDeleteObject}
                  onToggleLockObject={handleToggleLockObject}
                  onTransformObject={handleTransformObject}
                  onResetSelectedTransform={handleResetTransform}
                  onGroupAll={handleGroupAll}
                  onUngroupObject={handleUngroupObject}
                  onApplyFormation={handleApplyFormation}
                  onSynthesizePreset={handleSynthesizePreset}
                  onImportMeshFile={handleImportMeshFile}
                  onReconstructImages={handleReconstructImages}
                  onCaptureWebcamScan={handleCaptureWebcamScan}
                  onTriggerRescan={handleTriggerRescan}
                  onRotate360={handleRotate360}
                  onDisintegrate={handleDisintegrate}
                  onReconstruct={handleReconstruct}
                  notes={notes}
                  onUpdateNotes={setNotes}
                  requestedTab={requestedWorkspaceTab}
                />
              </div>
            )}

            {rightDrawerMode === 'DIAGNOSTICS' && (
              <div className="pointer-events-auto overflow-y-auto max-h-full pl-1 animate-fade-in">
                <RightDiagnosticsHUD
                  currentModelId={currentModelId}
                  selectedObject={selectedSpatialObj}
                  onSelectModel={handleSelectModel}
                  visualSettings={visualSettings}
                  onUpdateVisualSettings={(settings) =>
                    setVisualSettings((v) => ({ ...v, ...settings }))
                  }
                  onOpenAIConfig={() => setIsAIConfigOpen(true)}
                  requestedTab={requestedDiagnosticsTab}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Hidden video element preserved when Optical drawer is collapsed so camera tracking keeps running */}
      {!leftDrawerOpen && (
        <video ref={videoRef} className="hidden" playsInline muted />
      )}

      {/* 4. Unified Slim Bottom Command Dock */}
      {mode !== 'STANDBY' && (
        <BottomControlHUD
          currentMode={mode}
          onSelectMode={(nextMode) => {
            setMode(nextMode);
            if (nextMode === 'CINEMATIC') {
              setLeftDrawerOpen(false);
              setRightDrawerMode('CLOSED');
              setVoiceDrawerOpen(false);
            }
          }}
          isVoiceActive={isVoiceActive}
          voiceError={voiceError}
          onToggleVoice={handleToggleVoice}
          onSendCommand={handleSendConsoleCommand}
          onTriggerShockwave={handleTriggerShockwave}
          onResetTransform={handleResetTransform}
          isCameraActive={isCameraActive}
          onToggleCamera={handleToggleCamera}
          isDispersed={isDispersed}
          onToggleDispersion={handleToggleDispersion}
          leftDrawerOpen={leftDrawerOpen}
          onToggleLeftDrawer={() => setLeftDrawerOpen((prev) => !prev)}
          rightDrawerMode={rightDrawerMode}
          onToggleRightDrawer={(target) =>
            setRightDrawerMode((prev) => (prev === target ? 'CLOSED' : target))
          }
          voiceDrawerOpen={voiceDrawerOpen}
          onToggleVoiceDrawer={() => setVoiceDrawerOpen((prev) => !prev)}
        />
      )}

      {/* 5. Minimalist Translucent Standby HUD Overlay (sphere remains visible behind) */}
      {mode === 'STANDBY' && <StandbyHUD onWake={() => setMode('WORKSPACE')} />}

      {/* 6. Security Confirmation Modal for Consequential Actions */}
      <PermissionConfirmationModal
        request={permissionRequest}
        onConfirm={() => {
          if (permissionRequest) {
            desktopBridge.resolvePermission(permissionRequest.id, true);
            setPermissionRequest(null);
          }
        }}
        onReject={() => {
          if (permissionRequest) {
            desktopBridge.resolvePermission(permissionRequest.id, false);
            setPermissionRequest(null);
          }
        }}
      />

      {/* 7. AI Provider Config Modal */}
      <AIConfigModal
        isOpen={isAIConfigOpen}
        onClose={() => setIsAIConfigOpen(false)}
      />
    </div>
  );
};

export default App;
