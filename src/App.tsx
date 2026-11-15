import React, { useState, useEffect, useRef, useCallback } from 'react';
import { HologramCanvas } from './components/HologramCanvas';
import { TopStatusBar } from './components/HUD/TopStatusBar';
import { LeftVisionHUD } from './components/HUD/LeftVisionHUD';
import { RightDiagnosticsHUD } from './components/HUD/RightDiagnosticsHUD';
import { BottomControlHUD } from './components/HUD/BottomControlHUD';
import { VoiceConsoleHUD } from './components/HUD/VoiceConsoleHUD';
import { StandbyHUD } from './components/HUD/StandbyHUD';
import { FloatingSpatialPanels } from './components/Workspace/FloatingSpatialPanels';
import { PermissionConfirmationModal } from './components/Workspace/PermissionConfirmationModal';
import { AIConfigModal } from './components/HUD/AIConfigModal';
import { HologramSceneManager } from './three/HologramScene';
import {
  HologramModelId,
  HologramVisualSettings,
  InteractionMode,
  LayoutFormation,
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
  // Modes & Models State
  const [mode, setMode] = useState<InteractionMode>('WORKSPACE');
  const [currentModelId, setCurrentModelId] = useState<HologramModelId>('arc_reactor');
  const [spatialObjects, setSpatialObjects] = useState<SpatialObjectState[]>([]);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);

  // Modals & Panels State
  const [permissionRequest, setPermissionRequest] = useState<DesktopPermissionRequest | null>(null);
  const [isAIConfigOpen, setIsAIConfigOpen] = useState<boolean>(false);
  const [notes, setNotes] = useState<string>(
    'STARK INDUSTRIES // MARK VII MEMORANDUM\n• Fusion harmonic stabilized at 142.8 GHz\n• Multi-object spatial collision matrix active\n• Local-first autonomous intelligence engaged'
  );

  // Visual & Calibration Settings
  const [visualSettings, setVisualSettings] = useState<HologramVisualSettings>({
    wireframe: true,
    glowIntensity: 1.5,
    rotationSpeed: 1.0,
    particleCount: 1500,
    colorTheme: 'cyan',
    hologramColor: '#00f0ff',
    explodedView: false,
    pulseEnabled: true,
    showBoundingBoxes: true,
    spatialFormation: 'FREE'
  });

  const [calibration, setCalibration] = useState<GestureCalibrationSettings>({
    ...DEFAULT_CALIBRATION
  });

  // Camera & Tracking State
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [gestureResult, setGestureResult] = useState<GestureDetectionResult | null>(null);
  const [fps, setFps] = useState<number>(60);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Voice Assistant State
  const [isVoiceActive, setIsVoiceActive] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([
    {
      id: 'init-1',
      sender: 'JARVIS',
      text: 'Good evening, sir. Mark VII spatial workspace online. Multiple holographic entities, desktop bridge, and autonomous task engines are ready.',
      timestamp: new Date().toLocaleTimeString(),
      type: 'RESPONSE'
    }
  ]);

  // Three.js Scene Reference
  const sceneManagerRef = useRef<HologramSceneManager | null>(null);
  const lastGestureRef = useRef<GestureType>('NONE');

  // Sync spatial objects from Three.js scene
  const syncSpatialStates = useCallback(() => {
    if (sceneManagerRef.current) {
      const states = sceneManagerRef.current.getSpatialStates();
      setSpatialObjects(states);
      setSelectedObjectId(sceneManagerRef.current.spatialManager.getSelectedId());
    }
  }, []);

  // Wire up desktop bridge confirmation modal
  useEffect(() => {
    desktopBridge.setPromptCallback((req) => {
      setPermissionRequest(req);
    });
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
    setMessages((prev) => [
      ...prev,
      {
        id: Math.random().toString(36).substring(7),
        sender: 'JARVIS',
        text: 'Radial holographic energy shockwave discharged.',
        timestamp: new Date().toLocaleTimeString(),
        type: 'ALERT'
      }
    ]);
  }, []);

  // Reset 3D Object Transform
  const handleResetTransform = useCallback(() => {
    audioService.playChirp(1100);
    if (sceneManagerRef.current) {
      sceneManagerRef.current.resetTransform();
    }
    setMessages((prev) => [
      ...prev,
      {
        id: Math.random().toString(36).substring(7),
        sender: 'JARVIS',
        text: 'Holographic anchor position re-centered.',
        timestamp: new Date().toLocaleTimeString(),
        type: 'INFO'
      }
    ]);
  }, []);

  // Multi-Object Operations
  const handleAddSpatialObject = useCallback((modelId: HologramModelId) => {
    if (sceneManagerRef.current) {
      audioService.playActivationWhoosh();
      const inst = sceneManagerRef.current.addSpatialObject(modelId);
      setCurrentModelId(modelId);
      syncSpatialStates();
      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(36).substring(7),
          sender: 'JARVIS',
          text: `Spawned new ${inst.name} in spatial workspace.`,
          timestamp: new Date().toLocaleTimeString(),
          type: 'INFO'
        }
      ]);
    }
  }, [syncSpatialStates]);

  const handleDuplicateObject = useCallback((id: string) => {
    if (sceneManagerRef.current) {
      audioService.playChirp(1500);
      const dup = sceneManagerRef.current.spatialManager.duplicate(id);
      syncSpatialStates();
      if (dup) {
        setMessages((prev) => [
          ...prev,
          {
            id: Math.random().toString(36).substring(7),
            sender: 'JARVIS',
            text: `Cloned ${dup.name}. Both instances ready for independent spatial manipulation.`,
            timestamp: new Date().toLocaleTimeString(),
            type: 'INFO'
          }
        ]);
      }
    }
  }, [syncSpatialStates]);

  const handleDeleteObject = useCallback(async (id: string) => {
    const target = spatialObjects.find(o => o.id === id);
    const targetName = target ? target.name : 'Selected Hologram';

    // Consequential action confirmation gate
    const approved = await desktopBridge.requestAuthorization(
      'DELETE_OBJECT',
      targetName,
      `De-materialize spatial 3D instance from active scene.`
    );

    if (approved && sceneManagerRef.current) {
      audioService.playChirp(800);
      sceneManagerRef.current.spatialManager.delete(id);
      syncSpatialStates();
      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(36).substring(7),
          sender: 'JARVIS',
          text: `${targetName} de-materialized from workspace.`,
          timestamp: new Date().toLocaleTimeString(),
          type: 'INFO'
        }
      ]);
    }
  }, [spatialObjects, syncSpatialStates]);

  const handleSelectObject = useCallback((id: string) => {
    if (sceneManagerRef.current) {
      sceneManagerRef.current.selectObject(id);
      syncSpatialStates();
    }
  }, [syncSpatialStates]);

  const handleApplyFormation = useCallback((formation: LayoutFormation) => {
    if (sceneManagerRef.current) {
      audioService.playActivationWhoosh();
      sceneManagerRef.current.applyFormation(formation);
      syncSpatialStates();
      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(36).substring(7),
          sender: 'JARVIS',
          text: `Applied ${formation} spatial layout formation.`,
          timestamp: new Date().toLocaleTimeString(),
          type: 'INFO'
        }
      ]);
    }
  }, [syncSpatialStates]);

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
      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(36).substring(7),
          sender: 'JARVIS',
          text: `Switched holographic module to ${nextId.toUpperCase().replace('_', ' ')}.`,
          timestamp: new Date().toLocaleTimeString(),
          type: 'INFO'
        }
      ]);
    }
  }, [syncSpatialStates]);

  const handlePrevModel = useCallback(() => {
    if (sceneManagerRef.current) {
      const prevId = sceneManagerRef.current.prevModel();
      setCurrentModelId(prevId);
      audioService.playSwipeSound();
      syncSpatialStates();
      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(36).substring(7),
          sender: 'JARVIS',
          text: `Switched holographic module to ${prevId.toUpperCase().replace('_', ' ')}.`,
          timestamp: new Date().toLocaleTimeString(),
          type: 'INFO'
        }
      ]);
    }
  }, [syncSpatialStates]);

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
        patterns: ['initialize holographic interface', 'initialize hologram', 'open interface', 'workspace mode'],
        description: 'Initialize main workspace',
        category: 'NAVIGATION',
        action: () => {
          setMode('WORKSPACE');
          audioService.playActivationWhoosh();
        },
        feedbackText: 'Initializing holographic workspace. Mark VII core engaged.'
      },
      {
        patterns: ['rotate the object', 'rotate object', 'spin object', 'rotate it'],
        description: 'Rotate object',
        category: 'MANIPULATION',
        action: () => {
          if (sceneManagerRef.current) {
            sceneManagerRef.current.applyDeltaRotation(0, 1.2, 0);
          }
        },
        feedbackText: 'Rotating the selected object 360 degrees.'
      },
      {
        patterns: ['expand it', 'expand', 'zoom in', 'enlarge'],
        description: 'Expand hologram',
        category: 'MANIPULATION',
        action: () => {
          if (sceneManagerRef.current) {
            sceneManagerRef.current.applyScaleMultiplier(1.35);
          }
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
          }
        },
        feedbackText: 'Contracting holographic dimensions.'
      },
      {
        patterns: ['reset object', 'reset', 'center object', 'recenter'],
        description: 'Reset hologram position',
        category: 'MANIPULATION',
        action: () => handleResetTransform(),
        feedbackText: 'Returning holographic object to origin.'
      },
      {
        patterns: ['duplicate it', 'duplicate object', 'clone object', 'make a copy'],
        description: 'Duplicate selected object',
        category: 'SPATIAL',
        action: () => {
          if (selectedObjectId) handleDuplicateObject(selectedObjectId);
        },
        feedbackText: 'Duplicating selected holographic entity.'
      },
      {
        patterns: ['delete it', 'delete object', 'remove object', 'dematerialize'],
        description: 'Delete selected object',
        category: 'SPATIAL',
        action: () => {
          if (selectedObjectId) handleDeleteObject(selectedObjectId);
        },
        feedbackText: 'Requesting confirmation to delete selected object.',
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
        patterns: ['exploded view', 'disassemble', 'breakdown view'],
        description: 'Toggle exploded view',
        category: 'MANIPULATION',
        action: () => {
          setVisualSettings((v) => ({ ...v, explodedView: true }));
        },
        feedbackText: 'Engaging exploded blueprint disassembly view.'
      },
      {
        patterns: ['assembled view', 'assemble', 'reconstruct'],
        description: 'Assemble object',
        category: 'MANIPULATION',
        action: () => {
          setVisualSettings((v) => ({ ...v, explodedView: false }));
        },
        feedbackText: 'Reconstructing holographic components.'
      },
      {
        patterns: ['run diagnostic sweep', 'diagnostic protocol', 'system sweep'],
        description: 'Autonomous diagnostic workflow',
        category: 'AUTOMATION',
        action: () => {
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
        feedbackText: 'Initiating autonomous sensor and containment diagnostic sweep.'
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
  }, [handleApplyFormation, handleDuplicateObject, handleDeleteObject, handleResetTransform, handleTriggerShockwave, notes, selectedObjectId]);

  // Voice Assistant toggle
  const handleToggleVoice = useCallback(() => {
    if (isVoiceActive) {
      speechService.stopListening();
      setIsVoiceActive(false);
    } else {
      const started = speechService.startListening();
      setIsVoiceActive(started);
      if (started) {
        audioService.playActivationWhoosh();
        setMessages((prev) => [
          ...prev,
          {
            id: Math.random().toString(36).substring(7),
            sender: 'JARVIS',
            text: 'Audio sensor online. Speak your command, sir.',
            timestamp: new Date().toLocaleTimeString(),
            type: 'INFO'
          }
        ]);
      }
    }
  }, [isVoiceActive]);

  // Handle direct command string from console input with Contextual AI
  const handleSendConsoleCommand = useCallback(async (text: string) => {
    contextualAI.addHistory('user', text);

    const activeObj = spatialObjects.find(o => o.id === selectedObjectId);
    const modelName = activeObj ? activeObj.name : 'Central Hologram';

    const intentResult = contextualAI.parseLocalIntent(text, modelName);

    // If external AI configured, try querying
    if (contextualAI.getConfig().provider !== 'LOCAL') {
      const extReply = await contextualAI.queryExternalAI(text);
      if (extReply) {
        setMessages((prev) => [
          ...prev,
          {
            id: Math.random().toString(36).substring(7),
            sender: 'USER',
            text,
            timestamp: new Date().toLocaleTimeString(),
            type: 'COMMAND'
          },
          {
            id: Math.random().toString(36).substring(7),
            sender: 'JARVIS',
            text: extReply,
            timestamp: new Date().toLocaleTimeString(),
            type: 'RESPONSE'
          }
        ]);
        speechService.speak(extReply);
        return;
      }
    }

    // Process via speech service / local intent
    speechService.handleTranscript(text);
  }, [selectedObjectId, spatialObjects]);

  // Camera & Tracking toggle
  const handleToggleCamera = useCallback(async () => {
    if (isCameraActive) {
      handTrackingService.stop();
      setIsCameraActive(false);
      setGestureResult(null);
      if (sceneManagerRef.current) {
        sceneManagerRef.current.setHandCentroid(undefined);
      }
    } else {
      if (!videoRef.current) return;
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
      }
    }
  }, [isCameraActive]);

  // GESTURE DISPATCH ENGINE
  useEffect(() => {
    if (!gestureResult) return;
    const g = gestureResult.activeGesture;
    const scene = sceneManagerRef.current;

    // Detect pinch release
    if (lastGestureRef.current === 'PINCH' && g !== 'PINCH' && g !== 'MOVE_PINCHED') {
      audioService.playPinchRelease();
    }

    if (g === 'NONE') {
      lastGestureRef.current = 'NONE';
      return;
    }

    // A. OPEN PALM
    if (g === 'OPEN_PALM') {
      if (mode === 'STANDBY') {
        setMode('WORKSPACE');
        audioService.playActivationWhoosh();
      }
    }
    // B. CLOSED FIST
    else if (g === 'CLOSED_FIST') {
      if (lastGestureRef.current !== 'CLOSED_FIST' && mode !== 'STANDBY') {
        audioService.playChirp(800);
        setMode('STANDBY');
      }
    }
    // C. PINCH
    else if (g === 'PINCH') {
      if (lastGestureRef.current !== 'PINCH' && lastGestureRef.current !== 'MOVE_PINCHED') {
        audioService.playPinchGrab();
      }
    }
    // D. MOVE PINCHED HAND
    else if (g === 'MOVE_PINCHED' && gestureResult.deltaTranslation && scene) {
      scene.applyDeltaTranslation(
        gestureResult.deltaTranslation.x,
        gestureResult.deltaTranslation.y,
        gestureResult.deltaTranslation.z
      );
    }
    // E. ROTATE WRIST
    else if (g === 'ROTATE_WRIST' && gestureResult.deltaRotation && scene) {
      scene.applyDeltaRotation(
        gestureResult.deltaRotation.x,
        gestureResult.deltaRotation.y,
        gestureResult.deltaRotation.z
      );
    }
    // F. TWO-HAND MOVEMENT (ZOOM / SCALE)
    else if (g === 'TWO_HAND_ZOOM' && gestureResult.deltaScale && scene) {
      scene.applyScaleMultiplier(gestureResult.deltaScale);
    }
    // G. TWO OPEN PALMS
    else if (g === 'TWO_OPEN_PALMS') {
      if (lastGestureRef.current !== 'TWO_OPEN_PALMS') {
        audioService.playActivationWhoosh();
        setMode('CINEMATIC');
      }
    }
    // H. QUICK SWIPES
    else if (g === 'SWIPE_RIGHT' && lastGestureRef.current !== 'SWIPE_RIGHT') {
      handleNextModel();
    } else if (g === 'SWIPE_LEFT' && lastGestureRef.current !== 'SWIPE_LEFT') {
      handlePrevModel();
    }
    // J. DOUBLE PINCH (Toggle Exploded View)
    else if (g === 'DOUBLE_PINCH' && lastGestureRef.current !== 'DOUBLE_PINCH') {
      audioService.playChirp(1500);
      setVisualSettings((v) => ({ ...v, explodedView: !v.explodedView }));
    }
    // K. HAND PUSH FORWARD (Cinematic Energy Shockwave)
    else if (g === 'PUSH_FORWARD' && lastGestureRef.current !== 'PUSH_FORWARD') {
      handleTriggerShockwave();
    }
    // L. HAND PULL BACK (Reset Object to Origin)
    else if (g === 'PULL_BACK' && lastGestureRef.current !== 'PULL_BACK') {
      handleResetTransform();
    }

    lastGestureRef.current = g;
  }, [gestureResult, handleNextModel, handlePrevModel, handleResetTransform, handleTriggerShockwave, mode]);

  // Audio Speech state watcher
  useEffect(() => {
    const timer = setInterval(() => {
      setIsSpeaking(speechService.isCurrentlySpeaking());
    }, 100);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#02070e] font-mono text-cyan-400 select-none">
      {/* 1. Central 3D Holographic Canvas */}
      <HologramCanvas
        currentModelId={currentModelId}
        visualSettings={visualSettings}
        sceneManagerRef={sceneManagerRef}
        onModelChange={handleSelectModel}
        onSelectObject={(id) => {
          setSelectedObjectId(id);
          syncSpatialStates();
        }}
      />

      {/* 2. Top Status Bar HUD */}
      <TopStatusBar
        mode={mode}
        fps={fps}
        onModeChange={setMode}
      />

      {/* 3. Main HUD Overlay Layout */}
      {mode !== 'STANDBY' && (
        <div className="relative z-20 pointer-events-none flex justify-between p-4 h-[calc(100vh-105px)]">
          {/* Left HUD: Hand Vision & Gestures */}
          <div className="pointer-events-auto overflow-y-auto max-h-full pr-2">
            <LeftVisionHUD
              isCameraActive={isCameraActive}
              onToggleCamera={handleToggleCamera}
              gestureResult={gestureResult}
              calibration={calibration}
              onUpdateCalibration={(cal) => {
                setCalibration((prev) => ({ ...prev, ...cal }));
                gestureEngine.updateCalibration(cal);
              }}
              onResetCalibration={() => {
                const defaults = gestureEngine.resetCalibrationToDefaults();
                setCalibration(defaults);
              }}
              videoRef={videoRef}
            />
          </div>

          {/* Center Space: Open view of 3D Hologram, Floating Workspace Panels & Voice Console */}
          <div className="flex-1 flex flex-col justify-between items-center pointer-events-none px-4 pb-2">
            {/* Top Center: Floating Workspace Multi-Object Panels */}
            {mode === 'WORKSPACE' && (
              <div className="pointer-events-auto pt-1 animate-fade-in">
                <FloatingSpatialPanels
                  spatialObjects={spatialObjects}
                  selectedObjectId={selectedObjectId}
                  onSelectObject={handleSelectObject}
                  onAddObject={handleAddSpatialObject}
                  onDuplicateObject={handleDuplicateObject}
                  onDeleteObject={handleDeleteObject}
                  onApplyFormation={handleApplyFormation}
                  notes={notes}
                  onUpdateNotes={setNotes}
                />
              </div>
            )}

            {/* Bottom Center: Floating Voice Console */}
            <div className="pointer-events-auto mt-auto">
              <VoiceConsoleHUD
                messages={messages}
                onSendCommand={handleSendConsoleCommand}
                isListening={isVoiceActive}
                isSpeaking={isSpeaking}
              />
            </div>
          </div>

          {/* Right HUD: Diagnostics & Hologram Selector */}
          <div className="pointer-events-auto overflow-y-auto max-h-full pl-2">
            <RightDiagnosticsHUD
              currentModelId={currentModelId}
              onSelectModel={handleSelectModel}
              visualSettings={visualSettings}
              onUpdateVisualSettings={(settings) =>
                setVisualSettings((v) => ({ ...v, ...settings }))
              }
              onOpenAIConfig={() => setIsAIConfigOpen(true)}
            />
          </div>
        </div>
      )}

      {/* 4. Bottom Control Bar HUD */}
      {mode !== 'STANDBY' && (
        <BottomControlHUD
          currentMode={mode}
          onSelectMode={setMode}
          isVoiceActive={isVoiceActive}
          onToggleVoice={handleToggleVoice}
          onTriggerShockwave={handleTriggerShockwave}
          onResetTransform={handleResetTransform}
          isCameraActive={isCameraActive}
          onToggleCamera={handleToggleCamera}
        />
      )}

      {/* 5. Minimalist Standby HUD Overlay */}
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
