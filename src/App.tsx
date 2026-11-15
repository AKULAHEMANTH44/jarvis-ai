import React, { useState, useEffect, useRef, useCallback } from 'react';
import { HologramCanvas } from './components/HologramCanvas';
import { TopStatusBar } from './components/HUD/TopStatusBar';
import { LeftVisionHUD } from './components/HUD/LeftVisionHUD';
import { RightDiagnosticsHUD } from './components/HUD/RightDiagnosticsHUD';
import { BottomControlHUD } from './components/HUD/BottomControlHUD';
import { VoiceConsoleHUD } from './components/HUD/VoiceConsoleHUD';
import { StandbyHUD } from './components/HUD/StandbyHUD';
import { HologramSceneManager } from './three/HologramScene';
import {
  HologramModelId,
  HologramVisualSettings,
  InteractionMode
} from './types/hologram';
import {
  GestureCalibrationSettings,
  GestureDetectionResult,
  GestureType
} from './types/gesture';
import { AssistantMessage, VoiceCommand } from './types/assistant';
import { handTrackingService } from './services/handTracking';
import { gestureEngine, DEFAULT_CALIBRATION } from './services/gestureEngine';
import { audioService } from './services/soundFx';
import { speechService } from './services/speechService';

export const App: React.FC = () => {
  // Modes & Models State
  const [mode, setMode] = useState<InteractionMode>('GESTURE');
  const [currentModelId, setCurrentModelId] = useState<HologramModelId>('arc_reactor');

  // Visual & Calibration Settings
  const [visualSettings, setVisualSettings] = useState<HologramVisualSettings>({
    wireframe: true,
    glowIntensity: 1.5,
    rotationSpeed: 1.0,
    particleCount: 1500,
    colorTheme: 'cyan',
    hologramColor: '#00f0ff',
    explodedView: false,
    pulseEnabled: true
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
      text: 'Good evening. Holographic systems are online. Mark VII interface awaiting your gesture or voice command.',
      timestamp: new Date().toLocaleTimeString(),
      type: 'RESPONSE'
    }
  ]);

  // Three.js Scene Reference
  const sceneManagerRef = useRef<HologramSceneManager | null>(null);
  const lastGestureRef = useRef<GestureType>('NONE');

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

  // Next / Prev 3D Model
  const handleNextModel = useCallback(() => {
    if (sceneManagerRef.current) {
      const nextId = sceneManagerRef.current.nextModel();
      setCurrentModelId(nextId);
      audioService.playSwipeSound();
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
  }, []);

  const handlePrevModel = useCallback(() => {
    if (sceneManagerRef.current) {
      const prevId = sceneManagerRef.current.prevModel();
      setCurrentModelId(prevId);
      audioService.playSwipeSound();
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
  }, []);

  // Register Voice Commands with SpeechService
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
        patterns: ['initialize holographic interface', 'initialize hologram', 'open interface'],
        description: 'Initialize main hologram',
        category: 'NAVIGATION',
        action: () => {
          setMode('HOLOGRAM');
          audioService.playActivationWhoosh();
        },
        feedbackText: 'Initializing holographic interface. Mark VII core engaged.'
      },
      {
        patterns: ['rotate the object', 'rotate object', 'spin object'],
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
        patterns: ['switch to arc reactor', 'arc reactor'],
        description: 'Select Arc Reactor',
        category: 'NAVIGATION',
        action: () => setCurrentModelId('arc_reactor'),
        feedbackText: 'Displaying Arc Reactor Mark VII core.'
      },
      {
        patterns: ['switch to tesseract', 'quantum cube', 'tesseract'],
        description: 'Select Quantum Tesseract',
        category: 'NAVIGATION',
        action: () => setCurrentModelId('quantum_tesseract'),
        feedbackText: 'Projecting Quantum Tesseract 4D hypercube.'
      },
      {
        patterns: ['switch to mark suit', 'iron man armor', 'helmet', 'mark suit'],
        description: 'Select Armor Blueprint',
        category: 'NAVIGATION',
        action: () => setCurrentModelId('ironman_armor'),
        feedbackText: 'Loading Iron Man Mark VII chassis schematics.'
      },
      {
        patterns: ['switch to planetary defense', 'defense grid', 'earth hologram'],
        description: 'Select Planetary Globe',
        category: 'NAVIGATION',
        action: () => setCurrentModelId('planetary_defense'),
        feedbackText: 'Acquiring orbital planetary defense telemetry.'
      },
      {
        patterns: ['switch to dna', 'molecular helix', 'dna'],
        description: 'Select Molecular Helix',
        category: 'NAVIGATION',
        action: () => setCurrentModelId('molecular_dna'),
        feedbackText: 'Synthesizing nanotech molecular double helix.'
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
        action: () => setMode('GESTURE'),
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
  }, [handleResetTransform, handleTriggerShockwave]);

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

  // Handle direct command string from console input
  const handleSendConsoleCommand = useCallback((text: string) => {
    speechService.handleTranscript(text);
  }, []);

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

  // GESTURE DISPATCH ENGINE: Translates gesture detection results into 3D interactions
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
        setMode('GESTURE');
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
        onModelChange={setCurrentModelId}
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

          {/* Center Space: Open view of 3D Hologram with floating Voice Console */}
          <div className="flex-1 flex flex-col justify-end items-center pointer-events-none px-4 pb-2">
            <div className="pointer-events-auto">
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
              onSelectModel={setCurrentModelId}
              visualSettings={visualSettings}
              onUpdateVisualSettings={(settings) =>
                setVisualSettings((v) => ({ ...v, ...settings }))
              }
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
      {mode === 'STANDBY' && <StandbyHUD onWake={() => setMode('GESTURE')} />}
    </div>
  );
};

export default App;
