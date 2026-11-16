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
import { IntelligenceHUD, IntelligenceTabId } from './components/HUD/IntelligenceHUD';
import { CommandCenterDashboard } from './components/CommandCenter/CommandCenterDashboard';
import { HologramSceneManager } from './three/HologramScene';
import {
  CameraControlMode,
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
  GestureType,
  SpatialVisualFeedback
} from './types/gesture';
import {
  AssistantMessage,
  VoiceCommand,
  DesktopPermissionRequest,
  WorkspaceContextSnapshot
} from './types/assistant';
import { handTrackingService } from './services/handTracking';
import { gestureEngine } from './services/gestureEngine';
import { spatialInteractionController } from './services/spatialInteractionController';
import { audioService } from './services/soundFx';
import { speechService } from './services/speechService';
import { desktopBridge } from './services/desktopBridge';
import { automationEngine } from './services/automationEngine';
import { contextualAI } from './services/contextualAI';
import { intelligenceEngine, IntelligenceStateSnapshot } from './services/intelligenceEngine';
import { toolRegistry, WorkspaceToolHost } from './services/toolRegistry';
import { memoryManager } from './services/memoryManager';
import { suggestionEngine } from './services/suggestionEngine';
import { fileAccessService } from './services/fileAccessService';
import { musicService } from './services/musicService';
import {
  HudDrawerId,
  HudLayoutState,
  isRightDrawer,
  toggleDrawerState,
  openDrawerState,
  closeDrawerState,
  enterVisionHomeState,
  toggleFocusModeState,
  handleEscapeKeyState,
  shouldShowProjectedLabels
} from './utils/hudState';
import { SpatialHistoryManager } from './utils/spatialHistory';
import { WorkspaceSnapshot } from './three/SpatialObjectManager';
import { X, Sparkles } from 'lucide-react';

interface WorkspaceUndoState {
  spatial: WorkspaceSnapshot;
  visual: {
    renderMode: HologramVisualSettings['renderMode'];
    wireframe: boolean;
    explodedView: boolean;
    explosionAmount: number;
    dispersionAmount: number;
    spatialFormation: HologramVisualSettings['spatialFormation'];
  };
}

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
  const [spatialFeedback, setSpatialFeedback] = useState<SpatialVisualFeedback | null>(null);
  const [isProcessingCommand, setIsProcessingCommand] = useState<boolean>(false);
  const [cameraControlMode, setCameraControlMode] = useState<CameraControlMode>('OBJECT');
  const [labError, setLabError] = useState<string | null>(null);
  const [isCanvasInteracting, setIsCanvasInteracting] = useState<boolean>(false);
  const [intelligenceState, setIntelligenceState] = useState<IntelligenceStateSnapshot>(() =>
    intelligenceEngine.getSnapshot()
  );

  // Unified Hologram-First Contextual HUD & Focus Mode State
  const [hudState, setHudState] = useState<HudLayoutState>({
    activeDrawer: null,
    isFocusMode: false
  });
  const tabNonceRef = useRef<number>(1);
  const nextNonce = () => {
    tabNonceRef.current += 1;
    return tabNonceRef.current;
  };

  const [requestedWorkspaceTab, setRequestedWorkspaceTab] = useState<{
    tab: 'OBJECTS' | 'LAB' | 'AUTOMATION' | 'NOTES' | 'TIMER';
    nonce: number;
  } | null>({ tab: 'LAB', nonce: 1 });
  const [taskSubTab, setTaskSubTab] = useState<'AUTOMATION' | 'NOTES' | 'TIMER'>('AUTOMATION');
  const [requestedTaskTab, setRequestedTaskTab] = useState<{
    tab: 'AUTOMATION' | 'NOTES' | 'TIMER';
    nonce: number;
  }>({ tab: 'AUTOMATION', nonce: 1 });
  const [requestedDiagnosticsTab, setRequestedDiagnosticsTab] = useState<{
    tab: 'MODELS' | 'DIAGNOSTICS' | 'SETTINGS';
    nonce: number;
  } | null>({ tab: 'MODELS', nonce: 1 });
  const [requestedBrainTab, setRequestedBrainTab] = useState<{
    tab: IntelligenceTabId;
    nonce: number;
  } | null>({ tab: 'CHAT', nonce: 1 });

  // Modals & Panels State
  const [permissionRequest, setPermissionRequest] = useState<DesktopPermissionRequest | null>(null);
  const [isAIConfigOpen, setIsAIConfigOpen] = useState<boolean>(false);
  const [notes, setNotes] = useState<string>(
    'STARK INDUSTRIES // MARK VII MEMORANDUM\n• VISION 1.2 spatial sphere core calibrated\n• Fusion harmonic stabilized at 142.8 GHz\n• Multi-object spatial collision matrix active\n• Local-first autonomous intelligence engaged'
  );

  // Visual & Calibration Settings (persisted locally)
  const [visualSettings, setVisualSettings] = useState<HologramVisualSettings>(() => {
    const defaults: HologramVisualSettings = {
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
      particleSpeed: 1.0,
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
    };
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const saved = window.localStorage.getItem('jarvis_visual_settings_v2');
        if (saved) {
          const parsed = JSON.parse(saved);
          return {
            ...defaults,
            ...parsed,
            explodedView: false,
            explosionAmount: 0,
            dispersionAmount: 0
          };
        }
      } catch {
        // fallback to defaults
      }
    }
    return defaults;
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

  // Persist user visual settings cleanly & sync tracking confidence / rotation damping
  useEffect(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const { explodedView: _e, explosionAmount: _ea, dispersionAmount: _da, ...persistable } = visualSettings;
        window.localStorage.setItem('jarvis_visual_settings_v2', JSON.stringify(persistable));
      } catch {
        // ignore storage quota errors
      }
    }
    spatialInteractionController.setExternalDispersion(visualSettings.dispersionAmount);
  }, [visualSettings]);

  useEffect(() => {
    handTrackingService.setConfidenceThreshold(calibration.confidenceThreshold);
    sceneManagerRef.current?.setRotationDamping(calibration.rotationDamping);
  }, [calibration.confidenceThreshold, calibration.rotationDamping]);

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

  // Three.js Scene Reference & Undo/Redo History
  const sceneManagerRef = useRef<HologramSceneManager | null>(null);
  const lastGestureRef = useRef<GestureType>('NONE');
  const lastDispatchedGestureRef = useRef<GestureDetectionResult | null>(null);
  const historyRef = useRef<SpatialHistoryManager<WorkspaceUndoState>>(
    new SpatialHistoryManager<WorkspaceUndoState>(50, 600)
  );
  const pendingCanvasBeforeRef = useRef<WorkspaceUndoState | null>(null);
  const visualSettingsRef = useRef<HologramVisualSettings>(visualSettings);
  visualSettingsRef.current = visualSettings;

  const [historyStatus, setHistoryStatus] = useState<{
    canUndo: boolean;
    canRedo: boolean;
    undoLabel: string | null;
    redoLabel: string | null;
  }>({
    canUndo: false,
    canRedo: false,
    undoLabel: null,
    redoLabel: null
  });

  const refreshHistoryStatus = useCallback(() => {
    setHistoryStatus({
      canUndo: historyRef.current.canUndo(),
      canRedo: historyRef.current.canRedo(),
      undoLabel: historyRef.current.getUndoLabel(),
      redoLabel: historyRef.current.getRedoLabel()
    });
  }, []);

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

  const captureUndoState = useCallback(
    (visualOverride?: Partial<HologramVisualSettings>): WorkspaceUndoState | null => {
      if (!sceneManagerRef.current) return null;
      const merged = { ...visualSettingsRef.current, ...(visualOverride || {}) };
      return {
        spatial: sceneManagerRef.current.spatialManager.captureWorkspaceSnapshot(),
        visual: {
          renderMode: merged.renderMode,
          wireframe: merged.wireframe,
          explodedView: merged.explodedView,
          explosionAmount: merged.explosionAmount,
          dispersionAmount: merged.dispersionAmount,
          spatialFormation: merged.spatialFormation
        }
      };
    },
    []
  );

  const recordHistoryTransition = useCallback(
    (
      before: WorkspaceUndoState | null,
      label: string,
      mergeKey?: string,
      afterVisualOverride?: Partial<HologramVisualSettings>
    ) => {
      if (!before) return;
      const after = captureUndoState(afterVisualOverride);
      if (!after) return;
      if (historyRef.current.record(before, after, label, mergeKey)) {
        refreshHistoryStatus();
      }
    },
    [captureUndoState, refreshHistoryStatus]
  );

  const syncVisualDisplayToSelected = useCallback(() => {
    if (!sceneManagerRef.current) return;
    const selected = sceneManagerRef.current.spatialManager.getSelected();
    if (!selected) return;
    const nextPatch: Partial<HologramVisualSettings> = {
      explosionAmount: selected.explosionAmount,
      explodedView: selected.explosionAmount > 0.05,
      dispersionAmount: selected.visionSphereObj
        ? selected.visionSphereObj.getDispersion()
        : selected.targetDisintegration
    };
    sceneManagerRef.current.syncVisualSettingsState(nextPatch);
    setVisualSettings((v) => ({ ...v, ...nextPatch }));
  }, []);

  const handleUndo = useCallback((): boolean => {
    if (!sceneManagerRef.current) return false;
    const undone = historyRef.current.undo();
    if (!undone) return false;

    sceneManagerRef.current.spatialManager.restoreWorkspaceSnapshot(undone.state.spatial);
    sceneManagerRef.current.syncVisualSettingsState(undone.state.visual);
    setVisualSettings((v) => ({ ...v, ...undone.state.visual }));
    syncSpatialStates();
    refreshHistoryStatus();
    audioService.playChirp(1120);
    appendMessage('JARVIS', `Reverted operation: ${undone.entry.label}.`, 'INFO');
    return true;
  }, [appendMessage, refreshHistoryStatus, syncSpatialStates]);

  const handleRedo = useCallback((): boolean => {
    if (!sceneManagerRef.current) return false;
    const redone = historyRef.current.redo();
    if (!redone) return false;

    sceneManagerRef.current.spatialManager.restoreWorkspaceSnapshot(redone.state.spatial);
    sceneManagerRef.current.syncVisualSettingsState(redone.state.visual);
    setVisualSettings((v) => ({ ...v, ...redone.state.visual }));
    syncSpatialStates();
    refreshHistoryStatus();
    audioService.playChirp(1280);
    appendMessage('JARVIS', `Restored operation: ${redone.entry.label}.`, 'INFO');
    return true;
  }, [appendMessage, refreshHistoryStatus, syncSpatialStates]);

  // Wire up desktop bridge confirmation modal, speech status watcher & Phase 5 service lifecycle
  useEffect(() => {
    desktopBridge.setPromptCallback((req) => {
      setPermissionRequest(req);
    });
    speechService.setStatusChangeCallback((active, err) => {
      setIsVoiceActive(active);
      setVoiceError(err || null);
    });
    fileAccessService.setHostCallbacks({
      onImport3DModels: async (files) => {
        if (importMeshFilesRef.current) {
          await importMeshFilesRef.current(files);
        } else {
          throw new Error('3D holographic workspace is not initialized yet.');
        }
      }
    });
    return () => {
      handTrackingService.stop();
      speechService.stopListening();
      fileAccessService.setHostCallbacks({});
      fileAccessService.disposeAllPreviewUrls();
      musicService.stop();
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
      const before = captureUndoState();
      sceneManagerRef.current.resetTransform();
      syncSpatialStates();
      recordHistoryTransition(before, 'Reset Transform');
    }
    appendMessage('JARVIS', 'Holographic anchor position re-centered.', 'INFO');
  }, [appendMessage, captureUndoState, recordHistoryTransition, syncSpatialStates]);

  // Multi-Object Operations
  const handleAddSpatialObject = useCallback((modelId: HologramModelId) => {
    if (sceneManagerRef.current) {
      audioService.playActivationWhoosh();
      const inst = sceneManagerRef.current.addSpatialObject(modelId);
      setCurrentModelId(modelId);
      syncSpatialStates();
      syncVisualDisplayToSelected();
      appendMessage('JARVIS', `Spawned new ${inst.name} in spatial workspace.`, 'INFO');
    }
  }, [appendMessage, syncSpatialStates, syncVisualDisplayToSelected]);

  const handleDuplicateObject = useCallback((id: string): boolean => {
    if (!sceneManagerRef.current) return false;
    audioService.playChirp(1500);
    const dup = sceneManagerRef.current.spatialManager.duplicate(id);
    syncSpatialStates();
    syncVisualDisplayToSelected();
    if (dup) {
      appendMessage('JARVIS', `Cloned ${dup.name}. Both instances ready for independent spatial manipulation.`, 'INFO');
      return true;
    }
    return false;
  }, [appendMessage, syncSpatialStates, syncVisualDisplayToSelected]);

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
      syncVisualDisplayToSelected();
      if (deleted) {
        appendMessage('JARVIS', `${targetName} de-materialized from workspace.`, 'INFO');
      }
      return deleted;
    }
    return false;
  }, [appendMessage, spatialObjects, syncSpatialStates, syncVisualDisplayToSelected]);

  const handleSelectObject = useCallback((id: string) => {
    if (sceneManagerRef.current) {
      sceneManagerRef.current.selectObject(id);
      syncSpatialStates();
      syncVisualDisplayToSelected();
    }
  }, [syncSpatialStates, syncVisualDisplayToSelected]);

  const handleToggleLockObject = useCallback((id: string) => {
    if (sceneManagerRef.current) {
      const before = captureUndoState();
      const locked = sceneManagerRef.current.toggleObjectLock(id);
      syncSpatialStates();
      recordHistoryTransition(before, locked ? 'Lock Object' : 'Unlock Object');
      appendMessage('JARVIS', locked ? 'Object spatial transform locked.' : 'Object spatial transform unlocked.', 'INFO');
    }
  }, [appendMessage, captureUndoState, recordHistoryTransition, syncSpatialStates]);

  const handleTransformObject = useCallback(
    (
      id: string,
      transform: {
        position?: Partial<{ x: number; y: number; z: number }>;
        scale?: number;
      }
    ) => {
      if (sceneManagerRef.current) {
        const before = captureUndoState();
        sceneManagerRef.current.setObjectTransform(id, transform);
        syncSpatialStates();
        recordHistoryTransition(before, 'Transform Object', `rig-transform-${id}`);
      }
    },
    [captureUndoState, recordHistoryTransition, syncSpatialStates]
  );

  const handleGroupAll = useCallback(() => {
    if (sceneManagerRef.current) {
      const ids = sceneManagerRef.current.spatialManager.getAll().map((i) => i.id);
      if (ids.length > 1) {
        const before = captureUndoState();
        sceneManagerRef.current.spatialManager.groupObjects(ids);
        syncSpatialStates();
        recordHistoryTransition(before, 'Group Objects');
        appendMessage('JARVIS', `Linked ${ids.length} spatial entities into a synchronized transform group.`, 'INFO');
      }
    }
  }, [appendMessage, captureUndoState, recordHistoryTransition, syncSpatialStates]);

  const handleUngroupObject = useCallback((id: string) => {
    if (sceneManagerRef.current) {
      const before = captureUndoState();
      sceneManagerRef.current.spatialManager.ungroupObject(id);
      syncSpatialStates();
      recordHistoryTransition(before, 'Ungroup Object');
    }
  }, [captureUndoState, recordHistoryTransition, syncSpatialStates]);

  const handleApplyFormation = useCallback((formation: LayoutFormation) => {
    if (sceneManagerRef.current) {
      audioService.playActivationWhoosh();
      const before = captureUndoState();
      sceneManagerRef.current.applyFormation(formation);
      setVisualSettings((v) => ({ ...v, spatialFormation: formation }));
      syncSpatialStates();
      recordHistoryTransition(before, `Formation: ${formation}`, undefined, {
        spatialFormation: formation
      });
      appendMessage('JARVIS', `Applied ${formation} spatial layout formation.`, 'INFO');
    }
  }, [appendMessage, captureUndoState, recordHistoryTransition, syncSpatialStates]);

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

  const handleImportMeshFiles = useCallback(async (files: File[]) => {
    if (!sceneManagerRef.current) {
      throw new Error('3D holographic scene is not ready yet.');
    }
    setLabError(null);
    try {
      const inst = await sceneManagerRef.current.importMeshFromFiles(files);
      audioService.playActivationWhoosh();
      setCurrentModelId('reconstructed_object');
      syncSpatialStates();
      appendMessage(
        'JARVIS',
        `Imported and reconstructed ${inst.name} (${inst.vertexCount} vertices, ${inst.faceCount} faces, ${inst.componentCount} parts).`,
        'RESPONSE'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to parse 3D mesh file.';
      setLabError(msg);
      appendMessage('JARVIS', msg, 'ALERT');
      throw err;
    }
  }, [appendMessage, syncSpatialStates]);

  const importMeshFilesRef = useRef<((files: File[]) => Promise<void>) | null>(null);
  importMeshFilesRef.current = handleImportMeshFiles;

  const handleImportMeshFile = useCallback(async (file: File) => {
    try {
      await handleImportMeshFiles([file]);
    } catch {
      // handled cleanly inside handleImportMeshFiles & surfaced in labError/console
    }
  }, [handleImportMeshFiles]);

  const handleFrameSelectedObject = useCallback(() => {
    if (!sceneManagerRef.current) return;
    audioService.playChirp(1400);
    sceneManagerRef.current.frameObject(selectedObjectId || undefined);
  }, [selectedObjectId]);

  const handleResetCamera = useCallback(() => {
    if (!sceneManagerRef.current) return;
    audioService.playChirp(1100);
    setCameraControlMode('OBJECT');
    sceneManagerRef.current.resetCamera();
  }, []);

  const handleSelectComponent = useCallback((instanceId: string, componentId: string | null) => {
    if (!sceneManagerRef.current) return;
    const before = captureUndoState();
    sceneManagerRef.current.selectComponent(instanceId, componentId);
    syncSpatialStates();
    recordHistoryTransition(before, componentId ? 'Select Component' : 'Clear Component Selection');
  }, [captureUndoState, recordHistoryTransition, syncSpatialStates]);

  const handleIsolateComponent = useCallback((instanceId: string, componentId: string | null) => {
    if (!sceneManagerRef.current) return;
    const before = captureUndoState();
    sceneManagerRef.current.isolateComponent(instanceId, componentId);
    syncSpatialStates();
    recordHistoryTransition(before, componentId ? 'Isolate Component' : 'Show All Components');
  }, [captureUndoState, recordHistoryTransition, syncSpatialStates]);

  const handleHighlightComponent = useCallback((instanceId: string, componentId: string | null) => {
    if (!sceneManagerRef.current) return;
    sceneManagerRef.current.highlightComponent(instanceId, componentId);
  }, []);

  const handleUpdateVisualSettingsWithHistory = useCallback(
    (patch: Partial<HologramVisualSettings>) => {
      const before = captureUndoState();
      let label = 'Update Visual Settings';
      let mergeKey: string | undefined;

      if (patch.explosionAmount !== undefined || patch.explodedView !== undefined) {
        label = patch.explodedView === false || patch.explosionAmount === 0 ? 'Collapse Explosion' : 'Explode View';
        mergeKey = 'visual-explosion';
      } else if (patch.dispersionAmount !== undefined) {
        label = 'Particle Dispersion';
        mergeKey = 'visual-dispersion';
      } else if (patch.renderMode !== undefined) {
        label = `Render Mode: ${patch.renderMode}`;
      }

      setVisualSettings((prev) => ({ ...prev, ...patch }));

      if (
        sceneManagerRef.current &&
        (patch.explosionAmount !== undefined ||
          patch.explodedView !== undefined ||
          patch.dispersionAmount !== undefined ||
          patch.renderMode !== undefined)
      ) {
        if (patch.renderMode !== undefined) {
          sceneManagerRef.current.spatialManager.setGlobalRenderMode(patch.renderMode);
        }
        if (patch.explosionAmount !== undefined) {
          sceneManagerRef.current.spatialManager.setExplosionAmount(patch.explosionAmount);
        } else if (patch.explodedView !== undefined) {
          sceneManagerRef.current.spatialManager.setExplodedView(patch.explodedView);
        }
        if (patch.dispersionAmount !== undefined) {
          sceneManagerRef.current.setDispersion(patch.dispersionAmount);
        }
        sceneManagerRef.current.syncVisualSettingsState(patch);
        syncSpatialStates();
        recordHistoryTransition(before, label, mergeKey, patch);
      }
    },
    [captureUndoState, recordHistoryTransition, syncSpatialStates]
  );

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
    const before = captureUndoState();
    const ok = sceneManagerRef.current.rotate360(selectedObjectId || undefined);
    syncSpatialStates();
    if (ok) {
      recordHistoryTransition(before, 'Rotate 360°');
    }
    return ok;
  }, [captureUndoState, recordHistoryTransition, selectedObjectId, syncSpatialStates]);

  const handleDisintegrate = useCallback((): boolean => {
    if (!sceneManagerRef.current) return false;
    audioService.playShockwave();
    const before = captureUndoState();
    const ok = sceneManagerRef.current.disintegrateObject(selectedObjectId || undefined);
    if (ok) {
      setVisualSettings((v) => ({ ...v, dispersionAmount: 1.0 }));
      syncSpatialStates();
      recordHistoryTransition(before, 'Disintegrate', undefined, { dispersionAmount: 1.0 });
      appendMessage('JARVIS', 'Particle disintegration initiated. Original spatial state preserved.', 'ALERT');
    }
    return ok;
  }, [appendMessage, captureUndoState, recordHistoryTransition, selectedObjectId, syncSpatialStates]);

  const handleReconstruct = useCallback((): boolean => {
    if (!sceneManagerRef.current) return false;
    audioService.playActivationWhoosh();
    const before = captureUndoState();
    const ok = sceneManagerRef.current.reconstructObject(selectedObjectId || undefined);
    if (ok) {
      const visualReset = { explodedView: false, explosionAmount: 0, dispersionAmount: 0 };
      setVisualSettings((v) => ({ ...v, ...visualReset }));
      syncSpatialStates();
      recordHistoryTransition(before, 'Reconstruct', undefined, visualReset);
      appendMessage('JARVIS', 'Reassembling holographic structure to original state.', 'RESPONSE');
    }
    return ok;
  }, [appendMessage, captureUndoState, recordHistoryTransition, selectedObjectId, syncSpatialStates]);

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
        patterns: ['return to normal view', 'return to normal', 'normal view', 'vision mode', 'exit focus'],
        description: 'Return to normal assembled view',
        category: 'NAVIGATION',
        action: () => {
          setMode('WORKSPACE');
          setHudState(enterVisionHomeState());
          handleReconstruct();
          handleResetTransform();
        },
        feedbackText: 'Restoring clean spatial focus and assembled holographic core.'
      },
      {
        patterns: ['focus mode', 'enter focus', 'immersive mode'],
        description: 'Enter full immersive Focus mode',
        category: 'NAVIGATION',
        action: () => {
          setMode('WORKSPACE');
          setHudState({ activeDrawer: null, isFocusMode: true });
          audioService.playActivationWhoosh();
        },
        feedbackText: 'Engaging immersive Focus mode.'
      },
      {
        patterns: ['open the object laboratory', 'open object laboratory', 'open laboratory', 'object laboratory', 'open lab'],
        description: 'Open Reconstruction & Manipulation Lab panel',
        category: 'NAVIGATION',
        action: () => {
          setMode('WORKSPACE');
          setHudState((prev) => openDrawerState(prev, 'LAB'));
          setRequestedWorkspaceTab({ tab: 'LAB', nonce: nextNonce() });
          audioService.playActivationWhoosh();
        },
        feedbackText: 'Opening the holographic Object Reconstruction Laboratory.'
      },
      {
        patterns: ['open models', 'show models', 'model repository'],
        description: 'Open Holographic Models drawer',
        category: 'NAVIGATION',
        action: () => {
          setMode('WORKSPACE');
          setHudState((prev) => openDrawerState(prev, 'MODELS'));
          audioService.playChirp(1350);
        },
        feedbackText: 'Opening holographic repository.'
      },
      {
        patterns: ['open gesture controls', 'open camera', 'gesture controls'],
        description: 'Open Optical & Gesture drawer',
        category: 'NAVIGATION',
        action: () => {
          setMode('WORKSPACE');
          setHudState((prev) => openDrawerState(prev, 'GESTURE'));
          audioService.playChirp(1350);
        },
        feedbackText: 'Opening optical sensor and gesture controls.'
      },
      {
        patterns: ['open tasks', 'show tasks', 'task engine'],
        description: 'Open Autonomous Task Engine',
        category: 'NAVIGATION',
        action: () => {
          setMode('WORKSPACE');
          setHudState((prev) => openDrawerState(prev, 'TASKS'));
          setTaskSubTab('AUTOMATION');
          setRequestedTaskTab({ tab: 'AUTOMATION', nonce: nextNonce() });
          audioService.playChirp(1350);
        },
        feedbackText: 'Opening Autonomous Task Engine.'
      },
      {
        patterns: ['open voice console', 'show voice console'],
        description: 'Open Vocal Console',
        category: 'NAVIGATION',
        action: () => {
          setMode('WORKSPACE');
          setHudState((prev) => openDrawerState(prev, 'VOICE'));
          audioService.playChirp(1350);
        },
        feedbackText: 'Opening J.A.R.V.I.S. Vocal Console.'
      },
      {
        patterns: ['show diagnostics', 'open diagnostics', 'open telemetry'],
        description: 'Show reactor diagnostics & telemetry panel',
        category: 'NAVIGATION',
        action: () => {
          setMode('WORKSPACE');
          setHudState((prev) => openDrawerState(prev, 'TELEMETRY'));
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
          setHudState((prev) => openDrawerState(prev, 'TASKS'));
          setTaskSubTab('AUTOMATION');
          setRequestedTaskTab({ tab: 'AUTOMATION', nonce: nextNonce() });
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
        patterns: ['fit model', 'frame model', 'focus model', 'center camera'],
        description: 'Adaptively frame selected 3D model in viewport',
        category: 'MANIPULATION',
        action: () => {
          handleFrameSelectedObject();
          return true;
        },
        feedbackText: 'Framing holographic specimen to optimal viewport bounds.'
      },
      {
        patterns: ['reset camera', 'default camera', 'home camera'],
        description: 'Reset camera viewpoint to default angle',
        category: 'MANIPULATION',
        action: () => {
          handleResetCamera();
          return true;
        },
        feedbackText: 'Restoring default camera viewpoint.'
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
          setMode('WORKSPACE');
          setHudState((prev) => openDrawerState(prev, 'TASKS'));
          setTaskSubTab('AUTOMATION');
          setRequestedTaskTab({ tab: 'AUTOMATION', nonce: nextNonce() });
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
        patterns: ['open ai settings', 'configure ai', 'ai settings', 'open config'],
        description: 'Open Rendering & AI Config drawer',
        category: 'SYSTEM',
        action: () => {
          setMode('WORKSPACE');
          setHudState((prev) => openDrawerState(prev, 'CONFIG'));
        },
        feedbackText: 'Opening rendering and intelligence configuration.'
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
      },
      {
        patterns: ['undo transformation', 'undo last action', 'undo action', 'undo'],
        description: 'Undo last holographic transformation or operation',
        category: 'MANIPULATION',
        action: () => handleUndo(),
        feedbackText: 'Reverting last workspace transformation.',
        failureText: 'No earlier transformation state available to undo.'
      },
      {
        patterns: ['redo transformation', 'redo last action', 'redo action', 'redo'],
        description: 'Redo previously undone holographic transformation',
        category: 'MANIPULATION',
        action: () => handleRedo(),
        feedbackText: 'Restoring undone workspace transformation.',
        failureText: 'No undone transformation state available to redo.'
      },
      {
        patterns: ['open intelligence brain', 'open ai brain', 'open brain', 'show brain'],
        description: 'Open the AI Intelligence Brain HUD',
        category: 'AI',
        action: () => {
          setMode('WORKSPACE');
          setRequestedBrainTab({ tab: 'CHAT', nonce: nextNonce() });
          setHudState((prev) => openDrawerState(prev, 'BRAIN'));
          audioService.playChirp(1350);
          return true;
        },
        feedbackText: 'Opening J.A.R.V.I.S. AI Intelligence Brain.'
      },
      {
        patterns: ['show suggestions', 'open suggestions', 'ai suggestions'],
        description: 'Open Intelligence Brain Suggestions tab',
        category: 'AI',
        action: () => {
          setMode('WORKSPACE');
          setRequestedBrainTab({ tab: 'SUGGESTIONS', nonce: nextNonce() });
          setHudState((prev) => openDrawerState(prev, 'BRAIN'));
          audioService.playChirp(1350);
          return true;
        },
        feedbackText: 'Displaying contextual workspace suggestions.'
      },
      {
        patterns: ['show memory', 'open memory', 'memory controls'],
        description: 'Open User-Controlled Memory panel',
        category: 'AI',
        action: () => {
          setMode('WORKSPACE');
          setRequestedBrainTab({ tab: 'MEMORY', nonce: nextNonce() });
          setHudState((prev) => openDrawerState(prev, 'BRAIN'));
          audioService.playChirp(1350);
          return true;
        },
        feedbackText: 'Opening user-controlled persistent memory controls.'
      },
      {
        patterns: ['show plan', 'open plan', 'execution plan'],
        description: 'Open Multi-Step Planning panel',
        category: 'AI',
        action: () => {
          setMode('WORKSPACE');
          setRequestedBrainTab({ tab: 'PLAN', nonce: nextNonce() });
          setHudState((prev) => openDrawerState(prev, 'BRAIN'));
          audioService.playChirp(1350);
          return true;
        },
        feedbackText: 'Opening structured execution planner.'
      },
      {
        patterns: ['open permissions', 'show permissions', 'permission center', 'open permission center'],
        description: 'Open Phase 5 Permission Manager tab in Intelligence Brain',
        category: 'AI',
        action: () => {
          setMode('WORKSPACE');
          setRequestedBrainTab({ tab: 'PERMISSIONS', nonce: nextNonce() });
          setHudState((prev) => openDrawerState(prev, 'BRAIN'));
          audioService.playChirp(1350);
          return true;
        },
        feedbackText: 'Opening centralized Permission & Real-World Action Monitor.'
      },
      {
        patterns: ['cancel request', 'stop thinking', 'stop speaking'],
        description: 'Cancel active AI request and speech synthesis',
        category: 'SYSTEM',
        action: () => {
          speechService.interruptAndCancel();
          return true;
        },
        feedbackText: 'Active AI request and vocal synthesis cancelled.'
      }
    ];

    speechService.registerCommands(commands);
    speechService.setMessageCallback((msg) => {
      setMessages((prev) => [...prev, msg]);
    });
    speechService.setCommandExecutedCallback((_cmd, rawTranscript) => {
      memoryManager.recordCommandUsage(rawTranscript);
    });
    speechService.setCancelCallback(() => {
      intelligenceEngine.cancelActiveRequest();
    });
    speechService.setUnmatchedTranscriptHandler(async (transcript, source) => {
      setIsProcessingCommand(true);
      try {
        const snapshot = buildWorkspaceSnapshotRef.current();
        const res = await intelligenceEngine.processRequest({
          input: transcript,
          snapshot,
          source
        });
        if (res.pendingPermission) {
          setMode('WORKSPACE');
          setRequestedBrainTab({ tab: 'PERMISSIONS', nonce: nextNonce() });
          setHudState((prev) => openDrawerState(prev, 'BRAIN'));
        } else if (res.interactivePrompt) {
          setMode('WORKSPACE');
          setRequestedBrainTab({ tab: 'CHAT', nonce: nextNonce() });
          setHudState((prev) => openDrawerState(prev, 'BRAIN'));
        }
        return res.reply;
      } finally {
        setIsProcessingCommand(false);
      }
    });
  }, [
    handleApplyFormation,
    handleDeleteObject,
    handleDisintegrate,
    handleDuplicateObject,
    handleFrameSelectedObject,
    handleReconstruct,
    handleRedo,
    handleResetCamera,
    handleResetTransform,
    handleRotate360,
    handleSelectModel,
    handleTriggerRescan,
    handleTriggerShockwave,
    handleUndo
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

  // Local voice commands always take priority over external LLM chat responses
  const handleSendConsoleCommand = useCallback((text: string) => {
    speechService.handleTranscript(text, 'CONSOLE');
  }, []);

  // Camera & Tracking toggle with clear permission feedback
  const handleToggleCamera = useCallback(async () => {
    if (isCameraActive) {
      handTrackingService.stop();
      gestureEngine.recalibrateNeutral();
      spatialInteractionController.reset();
      lastGestureRef.current = 'NONE';
      lastDispatchedGestureRef.current = null;
      setIsCameraActive(false);
      setCameraError(null);
      setGestureResult(null);
      setActiveGestureFeedback(null);
      setSpatialFeedback(null);
      setLaserTarget(null);
      if (sceneManagerRef.current) {
        sceneManagerRef.current.clearRotationInertia();
        sceneManagerRef.current.setInteractionFeedback({ isTrackingLost: false });
        sceneManagerRef.current.setHandCentroid(undefined);
        sceneManagerRef.current.updateLaserPointer(0, 0, false);
      }
      appendMessage('JARVIS', 'Optical sensor deactivated. Camera hardware disconnected.', 'INFO');
    } else {
      if (!videoRef.current) return;
      setCameraError(null);
      handTrackingService.setConfidenceThreshold(calibration.confidenceThreshold);
      const started = await handTrackingService.startCamera(
        videoRef.current,
        (result, currentFps) => {
          setFps(currentFps);
          const detection = gestureEngine.processResults(result);
          setGestureResult(detection);
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
  }, [appendMessage, calibration.confidenceThreshold, isCameraActive]);

  // CENTRALIZED SPATIAL INTERACTION DISPATCH ENGINE
  useEffect(() => {
    if (!gestureResult || lastDispatchedGestureRef.current === gestureResult) return;
    lastDispatchedGestureRef.current = gestureResult;

    const cmd = spatialInteractionController.process(gestureResult, calibration);
    const scene = sceneManagerRef.current;
    const g = gestureResult.activeGesture;

    setSpatialFeedback(cmd.feedback);
    if (scene) {
      scene.setRotationDamping(calibration.rotationDamping);
      scene.setHandCentroid(cmd.handCentroid);
      scene.setInteractionFeedback({
        isTrackingLost:
          cmd.trackingStatus === 'TEMPORARY_LOSS' || cmd.trackingStatus === 'LOST'
      });
    }

    if (lastGestureRef.current === 'PINCH' && g !== 'PINCH' && g !== 'MOVE_PINCHED') {
      audioService.playPinchRelease();
    }

    // Update or clear 3D Laser Targeting Reticle
    if (cmd.discreteGesture !== 'TWO_FINGER_POINT' && scene) {
      scene.updateLaserPointer(0, 0, false);
      setLaserTarget((prev) => (prev ? null : prev));
    }

    if (cmd.shouldClearInertia && scene) {
      scene.clearRotationInertia();
    }

    if (cmd.trackingStatus === 'TEMPORARY_LOSS' || cmd.trackingStatus === 'RECOVERING') {
      setActiveGestureFeedback(cmd.feedback.badgeText);
      lastGestureRef.current = 'NONE';
      return;
    }

    if (g === 'NONE') {
      lastGestureRef.current = 'NONE';
      setActiveGestureFeedback(cmd.feedback.badgeText);
      return;
    }

    // Tier 1: Two-hand spatial dispersion & scale control (suspends conflicting single-hand actions)
    if (cmd.priorityTier === 1) {
      if (cmd.dispersionControl && scene) {
        const disp = cmd.dispersionControl;
        scene.setDispersion(disp.dispersion, disp.phase);
        setVisualSettings((v) =>
          Math.abs(v.dispersionAmount - disp.dispersion) >= 0.015
            ? { ...v, dispersionAmount: disp.dispersion }
            : v
        );
      }
      if (cmd.scaleMultiplier && scene) {
        scene.applyScaleMultiplier(cmd.scaleMultiplier);
      }
      if (cmd.discreteGesture === 'TWO_OPEN_PALMS' && lastGestureRef.current !== 'TWO_OPEN_PALMS') {
        audioService.playActivationWhoosh();
        setMode('CINEMATIC');
      }
      setActiveGestureFeedback(cmd.feedback.badgeText);
      lastGestureRef.current = g;
      return;
    }

    // Tier 2: Active Hand Rotation (Spherical Rotation & Wrist Roll)
    if (cmd.priorityTier === 2 && scene) {
      if (cmd.rotationDelta) {
        scene.applySphericalRotation(cmd.rotationDelta.x, cmd.rotationDelta.y, cmd.rotationDelta.z);
      } else if (cmd.deltaRotation) {
        scene.applyDeltaRotation(cmd.deltaRotation.x, cmd.deltaRotation.y, cmd.deltaRotation.z);
      }
      setActiveGestureFeedback(cmd.feedback.badgeText);
      lastGestureRef.current = g;
      return;
    }

    // Tier 3: Pinch Selection, 3D Translation, Double-Pinch Exploded View
    if (cmd.priorityTier === 3) {
      if (cmd.discreteGesture === 'PINCH') {
        if (lastGestureRef.current !== 'PINCH' && lastGestureRef.current !== 'MOVE_PINCHED') {
          audioService.playPinchGrab();
        }
      } else if (cmd.discreteGesture === 'MOVE_PINCHED' && cmd.translationDelta && scene) {
        scene.applyDeltaTranslation(
          cmd.translationDelta.x,
          cmd.translationDelta.y,
          cmd.translationDelta.z
        );
      } else if (cmd.discreteGesture === 'DOUBLE_PINCH' && lastGestureRef.current !== 'DOUBLE_PINCH') {
        audioService.playChirp(1500);
        setVisualSettings((v) => {
          const next = !v.explodedView;
          return { ...v, explodedView: next, explosionAmount: next ? 1.0 : 0.0 };
        });
      }
      setActiveGestureFeedback(cmd.feedback.badgeText);
      lastGestureRef.current = g;
      return;
    }

    // Tier 4: Discrete Poses
    if (cmd.priorityTier === 4) {
      if (cmd.discreteGesture === 'OPEN_PALM') {
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
      } else if (cmd.discreteGesture === 'CLOSED_FIST') {
        if (lastGestureRef.current !== 'CLOSED_FIST') {
          audioService.playChirp(820);
          if (scene && selectedObjectId) {
            scene.spatialManager.setFrozen(selectedObjectId, true);
            syncSpatialStates();
          }
        }
      } else if (cmd.discreteGesture === 'TWO_FINGER_POINT' && scene && cmd.laserPointNdc) {
        const hit = scene.updateLaserPointer(cmd.laserPointNdc.x, cmd.laserPointNdc.y, true);
        setLaserTarget(hit);
      } else if (cmd.discreteGesture === 'PUSH_FORWARD' && lastGestureRef.current !== 'PUSH_FORWARD') {
        handleTriggerShockwave();
      } else if (cmd.discreteGesture === 'PULL_BACK' && lastGestureRef.current !== 'PULL_BACK') {
        handleReconstruct();
        handleResetTransform();
      }
      setActiveGestureFeedback(cmd.feedback.badgeText);
      lastGestureRef.current = g;
      return;
    }

    // Tier 5: Navigation Swipes
    if (cmd.priorityTier === 5 && cmd.navigationSwipe) {
      if (cmd.navigationSwipe === 'SWIPE_RIGHT' && lastGestureRef.current !== 'SWIPE_RIGHT') {
        handleNextModel();
      } else if (cmd.navigationSwipe === 'SWIPE_LEFT' && lastGestureRef.current !== 'SWIPE_LEFT') {
        handlePrevModel();
      }
      setActiveGestureFeedback(cmd.feedback.badgeText);
      lastGestureRef.current = g;
      return;
    }

    setActiveGestureFeedback(cmd.feedback.badgeText);
    lastGestureRef.current = g;
  }, [
    calibration,
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

  // Sync Right Drawer sub-tabs deterministically when activeDrawer changes
  useEffect(() => {
    if (hudState.activeDrawer === 'MODELS') {
      setRequestedDiagnosticsTab({ tab: 'MODELS', nonce: nextNonce() });
    } else if (hudState.activeDrawer === 'TELEMETRY') {
      setRequestedDiagnosticsTab({ tab: 'DIAGNOSTICS', nonce: nextNonce() });
    } else if (hudState.activeDrawer === 'CONFIG') {
      setRequestedDiagnosticsTab({ tab: 'SETTINGS', nonce: nextNonce() });
    } else if (hudState.activeDrawer === 'LAB') {
      setRequestedWorkspaceTab({ tab: 'LAB', nonce: nextNonce() });
    } else if (hudState.activeDrawer === 'TASKS') {
      setRequestedTaskTab({ tab: taskSubTab, nonce: nextNonce() });
    }
  }, [hudState.activeDrawer, taskSubTab]);

  // Global keyboard shortcuts: Escape (drawer/focus), Ctrl+Z (Undo), Ctrl+Y / Ctrl+Shift+Z (Redo)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditable =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if ((e.ctrlKey || e.metaKey) && !isEditable && mode !== 'STANDBY' && !isAIConfigOpen) {
        const key = e.key.toLowerCase();
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault();
          handleUndo();
          return;
        }
        if (key === 'y' || (key === 'z' && e.shiftKey)) {
          e.preventDefault();
          handleRedo();
          return;
        }
      }

      if (e.key !== 'Escape') return;
      if (isAIConfigOpen) {
        setIsAIConfigOpen(false);
        return;
      }
      setHudState((prev) => handleEscapeKeyState(prev));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleRedo, handleUndo, isAIConfigOpen, mode]);

  // Project 2D component callout labels smoothly when Exploded View or VISION 1.2 CORE is active (hidden in Focus/Standby)
  useEffect(() => {
    const shouldShowLabels = shouldShowProjectedLabels({
      showComponentLabels: visualSettings.showComponentLabels,
      isFocusMode: hudState.isFocusMode,
      isStandby: mode === 'STANDBY',
      explosionAmount: visualSettings.explosionAmount,
      currentModelId,
      reducedEffects: visualSettings.reducedEffects,
      dispersionAmount: visualSettings.dispersionAmount
    });

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
    hudState.isFocusMode,
    mode,
    componentLabels.length
  ]);

  const selectedSpatialObj = spatialObjects.find((o) => o.id === selectedObjectId) || spatialObjects[0] || null;
  const isTrackingLost = Boolean(isCameraActive && gestureResult?.trackingLost);

  const buildWorkspaceSnapshot = useCallback((): WorkspaceContextSnapshot => {
    const cfg = contextualAI.getConfig();
    const sel = spatialObjects.find((o) => o.id === selectedObjectId) || spatialObjects[0] || null;
    return {
      mode,
      selectedObjectId: sel?.id || selectedObjectId || null,
      selectedObjectName: sel?.name || currentModelId.replace(/_/g, ' ').toUpperCase(),
      selectedModelId: sel?.modelId || currentModelId,
      objectCount: spatialObjects.length,
      objectsSummary: spatialObjects.map((o) => ({
        id: o.id,
        name: o.name,
        modelId: o.modelId,
        vertexCount: o.vertexCount,
        faceCount: o.faceCount,
        componentCount: o.componentCount,
        isLocked: o.isLocked,
        isDisintegrated: Boolean(o.isDisintegrated),
        dispersionPhase: o.dispersionPhase,
        renderMode: o.renderMode,
        selectedComponentId: o.selectedComponentId,
        isolatedComponentId: o.isolatedComponentId,
        components: o.components?.map((c) => ({ id: c.id, name: c.name }))
      })),
      renderMode: visualSettings.renderMode,
      explosionAmount: visualSettings.explosionAmount,
      dispersionAmount: visualSettings.dispersionAmount,
      isCameraActive,
      isVoiceActive,
      hasLabError: Boolean(labError),
      provider: cfg.provider,
      hasProviderKey:
        contextualAI.hasApiKey() ||
        cfg.provider === 'BACKEND' ||
        cfg.provider === 'GEMINI' ||
        cfg.provider === 'GROQ',
      modelName: cfg.modelName,
      notesPreview: notes.slice(0, 240),
      isInteracting: isCanvasInteracting
    };
  }, [
    currentModelId,
    isCameraActive,
    isCanvasInteracting,
    isVoiceActive,
    labError,
    mode,
    notes,
    selectedObjectId,
    spatialObjects,
    visualSettings.dispersionAmount,
    visualSettings.explosionAmount,
    visualSettings.renderMode
  ]);

  const buildWorkspaceSnapshotRef = useRef<() => WorkspaceContextSnapshot>(buildWorkspaceSnapshot);
  buildWorkspaceSnapshotRef.current = buildWorkspaceSnapshot;

  const toolHostActionsRef = useRef<WorkspaceToolHost | null>(null);
  toolHostActionsRef.current = {
    getContextSnapshot: () => buildWorkspaceSnapshot(),
    selectModel: (modelId) => {
      if (!sceneManagerRef.current) return false;
      handleSelectModel(modelId);
      return true;
    },
    setRenderMode: (renderMode) => {
      handleUpdateVisualSettingsWithHistory({
        renderMode,
        wireframe: renderMode !== 'SOLID_HOLO'
      });
      return true;
    },
    setExplosionAmount: (amount) => {
      const clamped = Math.max(0, Math.min(1, amount));
      handleUpdateVisualSettingsWithHistory({
        explodedView: clamped > 0.05,
        explosionAmount: clamped,
        showComponentLabels: true
      });
      return true;
    },
    disintegrate: () => handleDisintegrate(),
    reconstruct: () => handleReconstruct(),
    rotate360: () => handleRotate360(),
    frameModel: () => {
      if (!sceneManagerRef.current) return false;
      handleFrameSelectedObject();
      return true;
    },
    resetCamera: () => {
      if (!sceneManagerRef.current) return false;
      handleResetCamera();
      return true;
    },
    resetTransform: () => {
      if (!sceneManagerRef.current) return false;
      handleResetTransform();
      return true;
    },
    applyFormation: (formation) => {
      if (!sceneManagerRef.current) return false;
      handleApplyFormation(formation);
      return true;
    },
    duplicateSelected: () => {
      const targetId = selectedObjectId || spatialObjects[0]?.id;
      if (!targetId) return false;
      return handleDuplicateObject(targetId);
    },
    deleteSelected: async () => {
      const targetId = selectedObjectId || spatialObjects[0]?.id;
      if (!targetId) return false;
      return handleDeleteObject(targetId);
    },
    selectComponent: (componentId) => {
      const targetId = selectedObjectId || spatialObjects[0]?.id;
      if (!targetId) return false;
      handleSelectComponent(targetId, componentId);
      return true;
    },
    isolateComponent: (componentId) => {
      const targetId = selectedObjectId || spatialObjects[0]?.id;
      if (!targetId) return false;
      handleIsolateComponent(targetId, componentId);
      return true;
    },
    undo: () => handleUndo(),
    redo: () => handleRedo(),
    appendNote: (text) => {
      const line = text.trim();
      if (!line) return false;
      setNotes((prev) => `${prev.trimEnd()}\n• ${line}`);
      return true;
    },
    exportNotes: async () => {
      const approved = await desktopBridge.requestAuthorization(
        'FILE_WRITE',
        'stark_lab_notes.txt',
        'Export mission memorandum notes to authorized local file system.'
      );
      if (!approved) return false;
      return desktopBridge.saveAuthorizedFile('stark_lab_notes.txt', notes);
    },
    openDrawer: (drawer) => {
      setMode('WORKSPACE');
      setHudState((prev) => openDrawerState(prev, drawer));
      return true;
    },
    import3DModelFiles: (files) => handleImportMeshFiles(files)
  };

  useEffect(() => {
    const proxyHost: WorkspaceToolHost = {
      getContextSnapshot: () => toolHostActionsRef.current!.getContextSnapshot(),
      selectModel: (id) => toolHostActionsRef.current!.selectModel(id),
      setRenderMode: (m) => toolHostActionsRef.current!.setRenderMode(m),
      setExplosionAmount: (amt) => toolHostActionsRef.current!.setExplosionAmount(amt),
      disintegrate: () => toolHostActionsRef.current!.disintegrate(),
      reconstruct: () => toolHostActionsRef.current!.reconstruct(),
      rotate360: () => toolHostActionsRef.current!.rotate360(),
      frameModel: () => toolHostActionsRef.current!.frameModel(),
      resetCamera: () => toolHostActionsRef.current!.resetCamera(),
      resetTransform: () => toolHostActionsRef.current!.resetTransform(),
      applyFormation: (f) => toolHostActionsRef.current!.applyFormation(f),
      duplicateSelected: () => toolHostActionsRef.current!.duplicateSelected(),
      deleteSelected: () => toolHostActionsRef.current!.deleteSelected(),
      selectComponent: (c) => toolHostActionsRef.current!.selectComponent(c),
      isolateComponent: (c) => toolHostActionsRef.current!.isolateComponent(c),
      undo: () => toolHostActionsRef.current!.undo(),
      redo: () => toolHostActionsRef.current!.redo(),
      appendNote: (t) => toolHostActionsRef.current!.appendNote(t),
      exportNotes: () => toolHostActionsRef.current!.exportNotes(),
      openDrawer: (d) => toolHostActionsRef.current!.openDrawer!(d),
      import3DModelFiles: (files) => toolHostActionsRef.current!.import3DModelFiles!(files)
    };
    toolRegistry.setHost(proxyHost);
    return () => {
      toolRegistry.setHost(null);
    };
  }, []);

  useEffect(() => {
    const unsub = intelligenceEngine.subscribe((snap) => {
      setIntelligenceState(snap);
      const busy =
        snap.status === 'UNDERSTANDING' ||
        snap.status === 'ANALYZING' ||
        snap.status === 'PLANNING' ||
        snap.status === 'EXECUTING' ||
        snap.status === 'VERIFYING';
      setIsProcessingCommand(busy);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    intelligenceEngine.setListeningState(isVoiceActive);
  }, [isVoiceActive]);

  useEffect(() => {
    if (mode === 'STANDBY' || isCanvasInteracting) return;
    intelligenceEngine.refreshSuggestions(buildWorkspaceSnapshot());
  }, [
    buildWorkspaceSnapshot,
    isCanvasInteracting,
    labError,
    mode,
    selectedObjectId,
    spatialObjects.length,
    visualSettings.dispersionAmount,
    visualSettings.explosionAmount
  ]);

  useEffect(() => {
    if (!isCanvasInteracting) return;
    const clearInteracting = () => setIsCanvasInteracting(false);
    window.addEventListener('pointerup', clearInteracting);
    window.addEventListener('pointercancel', clearInteracting);
    return () => {
      window.removeEventListener('pointerup', clearInteracting);
      window.removeEventListener('pointercancel', clearInteracting);
    };
  }, [isCanvasInteracting]);

  const isBrainBusyStatus =
    intelligenceState.status === 'UNDERSTANDING' ||
    intelligenceState.status === 'ANALYZING' ||
    intelligenceState.status === 'PLANNING' ||
    intelligenceState.status === 'AWAITING_APPROVAL' ||
    intelligenceState.status === 'EXECUTING' ||
    intelligenceState.status === 'VERIFYING' ||
    intelligenceState.status === 'ERROR';

  const coreActivityLabel = isTrackingLost
    ? 'TRACKING LOST'
    : selectedSpatialObj?.dispersionPhase && selectedSpatialObj.dispersionPhase !== 'COMPLETE'
    ? `DISPERSION: ${selectedSpatialObj.dispersionPhase}`
    : selectedSpatialObj?.isDisintegrated
    ? 'DISINTEGRATED'
    : selectedSpatialObj?.isFrozen
    ? 'OBJECT FROZEN'
    : isBrainBusyStatus
    ? intelligenceState.status.replace('_', ' ')
    : isSpeaking
    ? 'SPEAKING'
    : isVoiceActive
    ? 'LISTENING'
    : 'ACTIVE';

  const handleSelectVisionHome = useCallback(() => {
    setMode('WORKSPACE');
    setHudState(enterVisionHomeState());
  }, []);

  const handleSelectDrawer = useCallback((drawer: HudDrawerId) => {
    setMode('WORKSPACE');
    setHudState((prev) => toggleDrawerState(prev, drawer));
  }, []);

  const handleSwitchDrawer = useCallback((drawer: HudDrawerId) => {
    setMode('WORKSPACE');
    setHudState((prev) => openDrawerState(prev, drawer));
  }, []);

  const handleToggleFocusMode = useCallback(() => {
    setMode('WORKSPACE');
    setHudState((prev) => toggleFocusModeState(prev));
  }, []);

  const handleResetEnvironment = useCallback(() => {
    setVisualSettings((v) => ({
      ...v,
      explodedView: false,
      explosionAmount: 0,
      dispersionAmount: 0,
      sliceEnabled: false
    }));
    handleReconstruct();
    handleResetTransform();
  }, [handleReconstruct, handleResetTransform]);

  const handleSubmitBrainPrompt = useCallback(
    async (prompt: string) => {
      const res = await intelligenceEngine.processRequest({
        input: prompt,
        snapshot: buildWorkspaceSnapshot(),
        source: 'CONSOLE'
      });
      if (res.pendingPermission) {
        setRequestedBrainTab({ tab: 'PERMISSIONS', nonce: nextNonce() });
      }
      appendMessage('USER', prompt, 'COMMAND');
      appendMessage('JARVIS', res.reply, res.error ? 'ALERT' : 'RESPONSE');
    },
    [appendMessage, buildWorkspaceSnapshot]
  );

  const handleBootProgress = useCallback((p: number) => {
    sceneManagerRef.current?.setInitializationProgress(p);
  }, []);

  const handleBootComplete = useCallback(() => {
    sceneManagerRef.current?.skipInitialization();
    setShowBootOverlay(false);
  }, []);

  const showLeftDrawer =
    mode !== 'STANDBY' && !hudState.isFocusMode && hudState.activeDrawer === 'GESTURE';
  const showRightDrawer =
    mode !== 'STANDBY' && !hudState.isFocusMode && isRightDrawer(hudState.activeDrawer);
  const showTaskConsole =
    mode !== 'STANDBY' && !hudState.isFocusMode && hudState.activeDrawer === 'TASKS';
  const showVoiceConsole =
    mode !== 'STANDBY' && !hudState.isFocusMode && hudState.activeDrawer === 'VOICE';
  const showBrainConsole =
    mode !== 'STANDBY' && !hudState.isFocusMode && hudState.activeDrawer === 'BRAIN';

  const topSuggestion = intelligenceState.activeSuggestions[0] || null;
  const showSuggestionToast =
    Boolean(topSuggestion) &&
    mode !== 'STANDBY' &&
    !hudState.isFocusMode &&
    !isCanvasInteracting &&
    !isProcessingCommand &&
    hudState.activeDrawer !== 'BRAIN';

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#02060c] font-mono text-cyan-400 select-none flex flex-col">
      {/* 0. Skippable Live-3D Initialization Telemetry */}
      {showBootOverlay && (
        <BootSequenceOverlay
          onProgress={handleBootProgress}
          onComplete={handleBootComplete}
        />
      )}

      {/* CommandCenter Dashboard Interface */}
      {mode !== 'STANDBY' && (
        <CommandCenterDashboard
          currentModelId={currentModelId}
          visualSettings={visualSettings}
          sceneManagerRef={sceneManagerRef}
          onModelChange={handleSelectModel}
          onSelectObject={(id) => {
            setSelectedObjectId(id);
            syncSpatialStates();
            syncVisualDisplayToSelected();
          }}
          onSelectComponent={handleSelectComponent}
          onHighlightComponent={handleHighlightComponent}
          onTransformStart={() => {
            setIsCanvasInteracting(true);
            pendingCanvasBeforeRef.current = captureUndoState();
          }}
          onTransformChange={() => {
            const before = pendingCanvasBeforeRef.current;
            syncSpatialStates();
            if (before) {
              recordHistoryTransition(before, 'Interactive Viewport Transform', 'canvas-transform');
              pendingCanvasBeforeRef.current = captureUndoState();
            }
          }}
          onImportMeshFiles={handleImportMeshFiles}
          onReconstructImages={handleReconstructImages}
          onImportError={(msg) => {
            setLabError(msg);
            appendMessage('JARVIS', msg, 'ALERT');
          }}
          cameraControlMode={cameraControlMode}
          laserTarget={laserTarget}
          componentLabels={componentLabels}
          activeGestureFeedback={activeGestureFeedback}
          spatialFeedback={spatialFeedback}
          isTrackingLost={isTrackingLost}
          autostart={autostart}
          fps={fps}
          isCameraActive={isCameraActive}
          isVoiceActive={isVoiceActive}
          onToggleVoice={handleToggleVoice}
          intelligenceState={intelligenceState}
          onSendCommand={handleSendConsoleCommand}
          onApprovePermission={(permId) => void intelligenceEngine.resolvePendingPermission('APPROVE_ONCE', permId)}
          onDenyPermission={(permId) => void intelligenceEngine.resolvePendingPermission('DENY', permId)}
          onOpenAIConfig={() => setIsAIConfigOpen(true)}
          onOpenObjectLab={() => {
            setMode('WORKSPACE');
            setHudState((prev) => openDrawerState(prev, 'LAB'));
            setRequestedWorkspaceTab({ tab: 'LAB', nonce: nextNonce() });
          }}
          onOpenTasks={() => {
            setMode('WORKSPACE');
            setHudState((prev) => openDrawerState(prev, 'TASKS'));
            setTaskSubTab('AUTOMATION');
            setRequestedTaskTab({ tab: 'AUTOMATION', nonce: nextNonce() });
          }}
          onOpenVoiceConsole={() => {
            setMode('WORKSPACE');
            setHudState((prev) => openDrawerState(prev, 'VOICE'));
          }}
          onOpenBrain={() => {
            setMode('WORKSPACE');
            setRequestedBrainTab({ tab: 'CHAT', nonce: nextNonce() });
            setHudState((prev) => openDrawerState(prev, 'BRAIN'));
          }}
          onOpenPermissions={() => {
            setMode('WORKSPACE');
            setRequestedBrainTab({ tab: 'PERMISSIONS', nonce: nextNonce() });
            setHudState((prev) => openDrawerState(prev, 'BRAIN'));
          }}
          onOpenMemory={() => {
            setMode('WORKSPACE');
            setRequestedBrainTab({ tab: 'MEMORY', nonce: nextNonce() });
            setHudState((prev) => openDrawerState(prev, 'BRAIN'));
          }}
          onTriggerRescan={handleTriggerRescan}
          memoryCount={memoryManager.getMemories().length}
          isFocusMode={hudState.isFocusMode}
          onToggleFocus={handleToggleFocusMode}
        />
      )}

      {/* 3. Contextual Drawers & Floating Consoles (Overlay with pointer-events-none wrapper so 3D canvas remains unobstructed) */}
      {mode !== 'STANDBY' && !hudState.isFocusMode && (
        <div className="pointer-events-none fixed inset-0 z-30">
          {/* Left Sliding Drawer: Optical Sensor, Gesture Engine, Calibration, Manual */}
          {showLeftDrawer && (
            <aside
              aria-label="Optical and Gesture Drawer"
              data-testid="left-gesture-drawer"
              className="pointer-events-auto fixed left-3 top-14 bottom-20 w-[min(340px,92vw)] flex flex-col rounded-xl bg-[#020914]/88 border border-cyan-500/35 shadow-[0_0_28px_rgba(0,240,255,0.16)] overflow-hidden animate-fade-in"
            >
              <div className="flex items-center justify-between px-3 py-2 border-b border-cyan-500/25 bg-black/40 shrink-0">
                <span className="font-orbitron font-bold text-[10px] tracking-[0.16em] text-white">
                  OPTICAL & GESTURE SYSTEM
                </span>
                <button
                  type="button"
                  onClick={() => {
                    audioService.playChirp(1000);
                    setHudState(closeDrawerState);
                  }}
                  aria-label="Close Gesture Drawer"
                  className="p-1 rounded border border-cyan-500/30 text-cyan-300 hover:text-white hover:border-cyan-400 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2.5">
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
            </aside>
          )}

          {/* Right Sliding Drawer: Models, Reconstruction Lab, Telemetry, Configuration */}
          {showRightDrawer && (
            <aside
              aria-label="Workspace and Telemetry Drawer"
              data-testid="right-workspace-drawer"
              className="pointer-events-auto fixed right-3 top-14 bottom-20 w-[min(368px,92vw)] flex flex-col rounded-xl bg-[#020914]/88 border border-cyan-500/35 shadow-[0_0_28px_rgba(0,240,255,0.16)] overflow-hidden animate-fade-in"
            >
              <div className="flex items-center justify-between gap-2 px-2.5 py-2 border-b border-cyan-500/25 bg-black/40 shrink-0">
                <div className="flex items-center gap-1 overflow-x-auto no-scrollbar" role="tablist" aria-label="Right Drawer Sections">
                  {(['MODELS', 'LAB', 'TELEMETRY', 'CONFIG'] as const).map((tab) => {
                    const isTabActive = hudState.activeDrawer === tab;
                    return (
                      <button
                        key={tab}
                        type="button"
                        role="tab"
                        aria-selected={isTabActive}
                        onClick={() => {
                          audioService.playChirp(1300);
                          handleSwitchDrawer(tab);
                        }}
                        className={`px-2 py-1 rounded font-orbitron text-[9.5px] tracking-wider whitespace-nowrap shrink-0 border transition-colors ${
                          isTabActive
                            ? 'border-cyan-400 bg-cyan-500/25 text-white font-bold'
                            : 'border-transparent text-cyan-300/75 hover:text-white hover:border-cyan-500/30'
                        }`}
                      >
                        {tab}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    audioService.playChirp(1000);
                    setHudState(closeDrawerState);
                  }}
                  aria-label="Close Workspace Drawer"
                  className="p-1 rounded border border-cyan-500/30 text-cyan-300 hover:text-white hover:border-cyan-400 shrink-0 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-2.5">
                {hudState.activeDrawer === 'LAB' ? (
                  <FloatingSpatialPanels
                    spatialObjects={spatialObjects}
                    selectedObjectId={selectedObjectId}
                    visualSettings={visualSettings}
                    isCameraActive={isCameraActive}
                    onUpdateVisualSettings={handleUpdateVisualSettingsWithHistory}
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
                    onImportMeshFiles={handleImportMeshFiles}
                    labError={labError}
                    onClearLabError={() => setLabError(null)}
                    cameraControlMode={cameraControlMode}
                    onSetCameraControlMode={setCameraControlMode}
                    onFrameSelectedObject={handleFrameSelectedObject}
                    onResetCamera={handleResetCamera}
                    onSelectComponent={handleSelectComponent}
                    onIsolateComponent={handleIsolateComponent}
                    onHighlightComponent={handleHighlightComponent}
                    canUndo={historyStatus.canUndo}
                    canRedo={historyStatus.canRedo}
                    undoLabel={historyStatus.undoLabel}
                    redoLabel={historyStatus.redoLabel}
                    onUndo={handleUndo}
                    onRedo={handleRedo}
                    onReconstructImages={handleReconstructImages}
                    onCaptureWebcamScan={handleCaptureWebcamScan}
                    onTriggerRescan={handleTriggerRescan}
                    onRotate360={handleRotate360}
                    onDisintegrate={handleDisintegrate}
                    onReconstruct={handleReconstruct}
                    notes={notes}
                    onUpdateNotes={setNotes}
                    requestedTab={requestedWorkspaceTab}
                    visibleTabs={['OBJECTS', 'LAB']}
                  />
                ) : (
                  <RightDiagnosticsHUD
                    currentModelId={currentModelId}
                    selectedObject={selectedSpatialObj}
                    onSelectModel={handleSelectModel}
                    visualSettings={visualSettings}
                    onUpdateVisualSettings={(settings) =>
                      setVisualSettings((v) => ({ ...v, ...settings }))
                    }
                    onOpenAIConfig={() => setIsAIConfigOpen(true)}
                    isCameraActive={isCameraActive}
                    onToggleCamera={handleToggleCamera}
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
                    requestedTab={requestedDiagnosticsTab}
                    hideTabBar
                  />
                )}
              </div>
            </aside>
          )}

          {/* Bottom-Center Contextual Panel: Autonomous Task Engine (+ Memo & Clock) */}
          {showTaskConsole && (
            <section
              aria-label="Autonomous Task Engine"
              data-testid="tasks-console-drawer"
              className="pointer-events-auto fixed bottom-20 left-1/2 -translate-x-1/2 w-[min(560px,94vw)] max-h-[50vh] flex flex-col rounded-xl bg-[#020914]/90 border border-cyan-500/35 shadow-[0_0_28px_rgba(0,240,255,0.18)] overflow-hidden animate-fade-in"
            >
              <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-cyan-500/25 bg-black/40 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-orbitron font-bold text-[10px] tracking-[0.14em] text-white whitespace-nowrap">
                    TASK ENGINE
                  </span>
                  <div className="flex items-center gap-1" role="tablist" aria-label="Task Engine Sections">
                    {(
                      [
                        { id: 'AUTOMATION', label: 'TASKS' },
                        { id: 'NOTES', label: 'MEMO' },
                        { id: 'TIMER', label: 'CLOCK' }
                      ] as const
                    ).map((sub) => (
                      <button
                        key={sub.id}
                        type="button"
                        role="tab"
                        aria-selected={taskSubTab === sub.id}
                        onClick={() => {
                          audioService.playChirp(1250);
                          setTaskSubTab(sub.id);
                          setRequestedTaskTab({ tab: sub.id, nonce: nextNonce() });
                        }}
                        className={`px-2 py-0.5 rounded font-orbitron text-[9px] tracking-wider border transition-colors ${
                          taskSubTab === sub.id
                            ? 'border-cyan-400 bg-cyan-500/25 text-white font-bold'
                            : 'border-transparent text-cyan-300/75 hover:text-white'
                        }`}
                      >
                        {sub.label}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    audioService.playChirp(1000);
                    setHudState(closeDrawerState);
                  }}
                  aria-label="Close Task Console"
                  className="p-1 rounded border border-cyan-500/30 text-cyan-300 hover:text-white hover:border-cyan-400 shrink-0 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-2.5">
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
                  requestedTab={requestedTaskTab}
                  visibleTabs={['AUTOMATION', 'NOTES', 'TIMER']}
                  hideTabBar
                />
              </div>
            </section>
          )}

          {/* Bottom-Center Contextual Panel: Vocal Console */}
          {showVoiceConsole && (
            <section
              aria-label="JARVIS Vocal Console"
              data-testid="voice-console-drawer"
              className="pointer-events-auto fixed bottom-20 left-1/2 -translate-x-1/2 w-[min(540px,94vw)] max-h-[52vh] overflow-y-auto rounded-xl animate-fade-in"
            >
              <VoiceConsoleHUD
                messages={messages}
                onSendCommand={handleSendConsoleCommand}
                isListening={isVoiceActive}
                isSpeaking={isSpeaking}
                isProcessing={isProcessingCommand}
                intelligenceStatus={intelligenceState.status}
                voiceError={voiceError}
                onToggleVoice={handleToggleVoice}
                onCancelRequest={() => speechService.interruptAndCancel()}
                onOpenBrain={() => {
                  setRequestedBrainTab({ tab: 'CHAT', nonce: nextNonce() });
                  setHudState((prev) => openDrawerState(prev, 'BRAIN'));
                }}
                onClearHistory={() => setMessages((prev) => prev.slice(0, 1))}
                onClose={() => setHudState(closeDrawerState)}
              />
            </section>
          )}

          {/* Bottom-Center Contextual Panel: AI Intelligence Brain */}
          {showBrainConsole && (
            <section
              aria-label="JARVIS AI Intelligence Brain"
              data-testid="intelligence-brain-drawer"
              className="pointer-events-auto fixed bottom-20 left-1/2 -translate-x-1/2 w-[min(600px,94vw)] rounded-xl animate-fade-in"
            >
              <IntelligenceHUD
                intelligenceState={intelligenceState}
                workspaceSnapshot={buildWorkspaceSnapshot()}
                requestedTab={requestedBrainTab}
                onSubmitPrompt={(prompt) => void handleSubmitBrainPrompt(prompt)}
                onCancelRequest={() => intelligenceEngine.cancelActiveRequest()}
                onOpenAIConfig={() => setIsAIConfigOpen(true)}
                onOpenTasksDrawer={() => {
                  setTaskSubTab('AUTOMATION');
                  setRequestedTaskTab({ tab: 'AUTOMATION', nonce: nextNonce() });
                  setHudState((prev) => openDrawerState(prev, 'TASKS'));
                }}
                onClose={() => setHudState(closeDrawerState)}
              />
            </section>
          )}

          {/* Non-Intrusive Proactive Suggestion Toast (Suppressed during active canvas interaction & Focus mode) */}
          {showSuggestionToast && topSuggestion && (
            <div
              role="status"
              data-testid="proactive-suggestion-toast"
              className="pointer-events-auto fixed bottom-20 right-4 w-[min(300px,88vw)] p-2.5 rounded-xl bg-[#020914]/92 border border-cyan-400/55 shadow-[0_0_24px_rgba(0,240,255,0.2)] space-y-1.5 animate-fade-in"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 font-orbitron text-[9.5px] font-bold text-cyan-200 truncate">
                  <Sparkles className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span className="truncate">{topSuggestion.title}</span>
                </div>
                <button
                  type="button"
                  onClick={() => suggestionEngine.rejectSuggestion(topSuggestion.id)}
                  aria-label="Dismiss Suggestion"
                  className="text-cyan-400/70 hover:text-white shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-[10px] text-cyan-100/90 leading-snug">
                {topSuggestion.explanation}
              </p>
              <div className="flex items-center gap-1.5 pt-0.5">
                <button
                  type="button"
                  onClick={() => {
                    audioService.playChirp(1400);
                    void suggestionEngine.acceptSuggestion(topSuggestion.id);
                  }}
                  className="px-2 py-0.5 rounded border border-emerald-400/60 bg-emerald-950/50 text-emerald-200 text-[9px] font-orbitron"
                >
                  APPLY
                </button>
                <button
                  type="button"
                  onClick={() => {
                    audioService.playChirp(1250);
                    setRequestedBrainTab({ tab: 'SUGGESTIONS', nonce: nextNonce() });
                    setHudState((prev) => openDrawerState(prev, 'BRAIN'));
                  }}
                  className="px-2 py-0.5 rounded border border-cyan-500/40 text-cyan-200 text-[9px] font-orbitron"
                >
                  DETAILS
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Hidden video element preserved when Optical drawer is collapsed so camera tracking keeps running */}
      {!showLeftDrawer && (
        <video ref={videoRef} className="hidden" playsInline muted />
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
