import React, { useRef, useEffect, useState } from 'react';
import { HolographicPanel } from '../Common/HolographicPanel';
import { GestureCalibrationSettings, GestureDetectionResult } from '../../types/gesture';
import { Camera, Eye, Sliders, Hand, ShieldAlert, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { audioService } from '../../services/soundFx';

interface LeftVisionHUDProps {
  isCameraActive: boolean;
  onToggleCamera: () => void;
  gestureResult: GestureDetectionResult | null;
  calibration: GestureCalibrationSettings;
  onUpdateCalibration: (cal: Partial<GestureCalibrationSettings>) => void;
  videoRef: React.RefObject<HTMLVideoElement>;
}

// MediaPipe hand connections pairs
const HAND_CONNECTIONS = [
  // Thumb
  [0, 1], [1, 2], [2, 3], [3, 4],
  // Index
  [0, 5], [5, 6], [6, 7], [7, 8],
  // Middle
  [9, 10], [10, 11], [11, 12],
  // Ring
  [13, 14], [14, 15], [15, 16],
  // Pinky
  [0, 17], [17, 18], [18, 19], [19, 20],
  // Palm base
  [5, 9], [9, 13], [13, 17]
];

export const LeftVisionHUD: React.FC<LeftVisionHUDProps> = ({
  isCameraActive,
  onToggleCamera,
  gestureResult,
  calibration,
  onUpdateCalibration,
  videoRef
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [showCalibration, setShowCalibration] = useState<boolean>(false);
  const [showGuide, setShowGuide] = useState<boolean>(false);

  // Draw glowing futuristic hand skeleton on overlay canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!isCameraActive || !gestureResult || !gestureResult.hands || gestureResult.hands.length === 0) {
      return;
    }

    const w = canvas.width;
    const h = canvas.height;

    gestureResult.hands.forEach((hand, hIdx) => {
      const isRight = hand.handedness === 'Right';
      const color = isRight ? '#00f0ff' : '#00ffaa';
      const glow = isRight ? 'rgba(0, 240, 255, 0.8)' : 'rgba(0, 255, 170, 0.8)';

      // 1. Draw connecting bone lines
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.shadowColor = glow;
      ctx.shadowBlur = 8;

      HAND_CONNECTIONS.forEach(([startIdx, endIdx]) => {
        const p1 = hand.landmarks[startIdx];
        const p2 = hand.landmarks[endIdx];
        if (p1 && p2) {
          ctx.beginPath();
          // Mirror horizontally for selfie view
          ctx.moveTo((1 - p1.x) * w, p1.y * h);
          ctx.lineTo((1 - p2.x) * w, p2.y * h);
          ctx.stroke();
        }
      });

      // 2. Draw joint landmarks
      hand.landmarks.forEach((p, idx) => {
        const isFingertip = [4, 8, 12, 16, 20].includes(idx);
        ctx.beginPath();
        ctx.arc((1 - p.x) * w, p.y * h, isFingertip ? 4.5 : 2.5, 0, 2 * Math.PI);
        ctx.fillStyle = isFingertip ? '#ffffff' : color;
        ctx.shadowColor = glow;
        ctx.shadowBlur = isFingertip ? 12 : 5;
        ctx.fill();
      });

      // 3. Pinch indicator circle
      if (hand.isPinching) {
        const pThumb = hand.landmarks[4];
        const pIndex = hand.landmarks[8];
        const midX = (1 - (pThumb.x + pIndex.x) / 2) * w;
        const midY = ((pThumb.y + pIndex.y) / 2) * h;
        ctx.beginPath();
        ctx.arc(midX, midY, 14, 0, 2 * Math.PI);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = 15;
        ctx.stroke();
      }
    });
  }, [gestureResult, isCameraActive]);

  const activeHand = gestureResult?.hands[0];

  return (
    <div className="flex flex-col space-y-3 w-80 text-xs">
      {/* 1. Camera & Skeleton Vision Viewport */}
      <HolographicPanel
        title="OPTICAL SENSOR // CV-MK7"
        subtitle="MEDIAPIPE 3D HAND LANDMARKER"
        icon={<Eye className="w-4 h-4 text-cyan-400" />}
        headerRight={
          <button
            onClick={() => {
              audioService.playChirp(isCameraActive ? 800 : 1600);
              onToggleCamera();
            }}
            className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold border transition-all ${
              isCameraActive
                ? 'border-emerald-500/60 text-emerald-300 bg-emerald-950/40 hover:bg-emerald-900/50'
                : 'border-red-500/60 text-red-300 bg-red-950/40 hover:bg-red-900/50'
            }`}
          >
            {isCameraActive ? 'CAM ACTIVE' : 'ENABLE CAM'}
          </button>
        }
      >
        <div className="relative w-full h-44 bg-black/80 rounded border border-cyan-500/30 overflow-hidden flex items-center justify-center">
          {/* Hidden or mirrored Video Element */}
          <video
            ref={videoRef}
            className={`absolute inset-0 w-full h-full object-cover transform -scale-x-100 opacity-35 filter brightness-110 contrast-125 ${
              isCameraActive ? 'block' : 'hidden'
            }`}
            playsInline
            muted
          />

          {/* Canvas for Skeleton Landmarks */}
          <canvas
            ref={canvasRef}
            width={320}
            height={180}
            className="absolute inset-0 w-full h-full pointer-events-none"
          />

          {/* Scanning HUD Crosshair overlay */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-30">
            <div className="w-16 h-16 border border-cyan-400/40 rounded-full animate-ping" />
            <div className="w-1 h-full border-r border-cyan-400/20" />
            <div className="h-1 w-full border-b border-cyan-400/20" />
          </div>

          {!isCameraActive && (
            <div className="flex flex-col items-center justify-center p-4 text-center z-10 space-y-2">
              <Camera className="w-8 h-8 text-cyan-500/40 animate-pulse" />
              <span className="text-cyan-400/80 font-mono text-[11px]">
                OPTICAL SENSOR OFFLINE
              </span>
              <button
                onClick={() => {
                  audioService.playChirp(1600);
                  onToggleCamera();
                }}
                className="px-3 py-1 bg-cyan-500/20 hover:bg-cyan-500/40 text-white rounded border border-cyan-400 font-orbitron text-[10px] tracking-wider transition-all"
              >
                INITIALIZE SENSOR
              </button>
            </div>
          )}

          {isCameraActive && (!gestureResult || gestureResult.hands.length === 0) && (
            <div className="absolute bottom-2 left-2 z-10 flex items-center space-x-1.5 bg-black/70 px-2 py-0.5 rounded border border-cyan-500/30 font-mono text-[10px] text-cyan-300">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
              <span>SEARCHING HANDS...</span>
            </div>
          )}

          {isCameraActive && gestureResult && gestureResult.hands.length > 0 && (
            <div className="absolute bottom-2 left-2 z-10 flex items-center space-x-1.5 bg-black/70 px-2 py-0.5 rounded border border-cyan-500/30 font-mono text-[10px] text-cyan-300">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>{gestureResult.hands.length} HAND(S) TRACKED</span>
            </div>
          )}
        </div>
      </HolographicPanel>

      {/* 2. Detected Gesture & Telemetry Card */}
      <HolographicPanel
        title="NEURAL GESTURE ENGINE"
        subtitle="REAL-TIME SPATIAL RECOGNITION"
        icon={<Hand className="w-4 h-4 text-cyan-400" />}
      >
        <div className="space-y-2.5">
          {/* Active Gesture Banner */}
          <div className="flex items-center justify-between p-2 rounded bg-cyan-950/40 border border-cyan-500/40">
            <div className="flex flex-col">
              <span className="text-[10px] font-mono text-cyan-400/70">ACTIVE GESTURE:</span>
              <span className="font-orbitron font-bold text-sm tracking-wide text-white">
                {gestureResult?.activeGesture || 'NONE'}
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-[10px] font-mono text-cyan-400/70">CONFIDENCE:</span>
              <span className="font-mono font-bold text-xs text-emerald-400">
                {gestureResult?.confidence ? `${Math.round(gestureResult.confidence * 100)}%` : '--'}
              </span>
            </div>
          </div>

          <div className="text-[11px] font-mono text-cyan-300/90 italic bg-black/40 px-2 py-1 rounded border border-cyan-500/20">
            {gestureResult?.description || 'Awaiting input...'}
          </div>

          {/* Coordinate Readouts */}
          {activeHand && (
            <div className="grid grid-cols-3 gap-1.5 font-mono text-[10px]">
              <div className="bg-cyan-950/30 p-1.5 rounded border border-cyan-500/20 text-center">
                <span className="text-cyan-400/70 block">POS X</span>
                <span className="text-white font-bold">{activeHand.centroid.x.toFixed(2)}</span>
              </div>
              <div className="bg-cyan-950/30 p-1.5 rounded border border-cyan-500/20 text-center">
                <span className="text-cyan-400/70 block">POS Y</span>
                <span className="text-white font-bold">{activeHand.centroid.y.toFixed(2)}</span>
              </div>
              <div className="bg-cyan-950/30 p-1.5 rounded border border-cyan-500/20 text-center">
                <span className="text-cyan-400/70 block">POS Z</span>
                <span className="text-white font-bold">{activeHand.centroid.z.toFixed(2)}</span>
              </div>
            </div>
          )}

          {/* Pinch Distance Bar */}
          {activeHand && (
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] font-mono">
                <span className="text-cyan-400/80">PINCH SPAN:</span>
                <span className={activeHand.isPinching ? 'text-amber-300 font-bold' : 'text-cyan-300'}>
                  {activeHand.pinchDistance.toFixed(3)} {activeHand.isPinching && '(PINCH ACQUIRED)'}
                </span>
              </div>
              <div className="w-full h-1.5 bg-black/60 rounded-full overflow-hidden border border-cyan-500/30">
                <div
                  className={`h-full transition-all duration-100 ${
                    activeHand.isPinching ? 'bg-amber-400 shadow-[0_0_8px_#ffaa00]' : 'bg-cyan-400'
                  }`}
                  style={{ width: `${Math.min(100, (activeHand.pinchDistance / 0.25) * 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Wrist Roll / Pitch Gauges */}
          {activeHand && (
            <div className="flex justify-between text-[10px] font-mono text-cyan-400/80 pt-1 border-t border-cyan-500/20">
              <span>ROLL: {activeHand.wristRotation.roll.toFixed(2)} rad</span>
              <span>PITCH: {activeHand.wristRotation.pitch.toFixed(2)} rad</span>
            </div>
          )}
        </div>
      </HolographicPanel>

      {/* 3. Calibration & Sensitivity Accordion */}
      <HolographicPanel
        title="CALIBRATION // SENSITIVITY"
        icon={<Sliders className="w-4 h-4 text-cyan-400" />}
        headerRight={
          <button
            onClick={() => {
              audioService.playChirp(1200);
              setShowCalibration(!showCalibration);
            }}
            className="text-cyan-400 hover:text-white"
          >
            {showCalibration ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        }
      >
        {showCalibration ? (
          <div className="space-y-2.5 pt-1">
            {/* Pinch Threshold */}
            <div>
              <div className="flex justify-between text-[10px] font-mono">
                <span>PINCH SENSITIVITY</span>
                <span>{calibration.pinchThreshold.toFixed(3)}</span>
              </div>
              <input
                type="range"
                min="0.02"
                max="0.10"
                step="0.005"
                value={calibration.pinchThreshold}
                onChange={(e) => onUpdateCalibration({ pinchThreshold: parseFloat(e.target.value) })}
                className="w-full accent-cyan-400 h-1 bg-cyan-950 rounded cursor-pointer"
              />
            </div>

            {/* Smoothing Factor */}
            <div>
              <div className="flex justify-between text-[10px] font-mono">
                <span>SMOOTHING FACTOR</span>
                <span>{calibration.smoothingFactor.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.2"
                max="0.9"
                step="0.05"
                value={calibration.smoothingFactor}
                onChange={(e) => onUpdateCalibration({ smoothingFactor: parseFloat(e.target.value) })}
                className="w-full accent-cyan-400 h-1 bg-cyan-950 rounded cursor-pointer"
              />
            </div>

            {/* Push Sensitivity */}
            <div>
              <div className="flex justify-between text-[10px] font-mono">
                <span>PUSH WAVE SENSITIVITY</span>
                <span>{Math.abs(calibration.pushSensitivity).toFixed(3)}</span>
              </div>
              <input
                type="range"
                min="0.015"
                max="0.06"
                step="0.005"
                value={Math.abs(calibration.pushSensitivity)}
                onChange={(e) => onUpdateCalibration({ pushSensitivity: -parseFloat(e.target.value) })}
                className="w-full accent-cyan-400 h-1 bg-cyan-950 rounded cursor-pointer"
              />
            </div>
          </div>
        ) : (
          <div className="text-[10px] font-mono text-cyan-400/60 cursor-pointer" onClick={() => setShowCalibration(true)}>
            Click to tune pinch, push, and filter smoothing parameters...
          </div>
        )}
      </HolographicPanel>

      {/* 4. Gesture Quick Guide Accordion */}
      <HolographicPanel
        title="GESTURE MANUAL"
        icon={<Sparkles className="w-4 h-4 text-cyan-400" />}
        headerRight={
          <button
            onClick={() => {
              audioService.playChirp(1200);
              setShowGuide(!showGuide);
            }}
            className="text-cyan-400 hover:text-white"
          >
            {showGuide ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        }
      >
        {showGuide ? (
          <div className="space-y-1.5 text-[10px] font-mono text-cyan-300 max-h-44 overflow-y-auto pr-1">
            <div className="border-b border-cyan-500/20 pb-1">
              <strong className="text-white">✋ OPEN PALM:</strong> Wake & activate hologram
            </div>
            <div className="border-b border-cyan-500/20 pb-1">
              <strong className="text-white">✊ CLOSED FIST:</strong> Pause movement & standby
            </div>
            <div className="border-b border-cyan-500/20 pb-1">
              <strong className="text-white">🤏 PINCH (Thumb+Index):</strong> Grab 3D object
            </div>
            <div className="border-b border-cyan-500/20 pb-1">
              <strong className="text-white">🫱 MOVE PINCHED:</strong> Translate object in 3D
            </div>
            <div className="border-b border-cyan-500/20 pb-1">
              <strong className="text-white">🔄 ROTATE WRIST:</strong> Rotate object on 3 axes
            </div>
            <div className="border-b border-cyan-500/20 pb-1">
              <strong className="text-white">👐 TWO HANDS:</strong> Expand or shrink scale (zoom)
            </div>
            <div className="border-b border-cyan-500/20 pb-1">
              <strong className="text-white">💨 QUICK SWIPE:</strong> Switch holographic model
            </div>
            <div className="border-b border-cyan-500/20 pb-1">
              <strong className="text-white">💥 PUSH FORWARD:</strong> Trigger cinematic energy shockwave
            </div>
            <div className="pb-1">
              <strong className="text-white">↩️ PULL BACK:</strong> Return object to original anchor
            </div>
          </div>
        ) : (
          <div className="text-[10px] font-mono text-cyan-400/60 cursor-pointer" onClick={() => setShowGuide(true)}>
            View complete 12-gesture neural protocol guide...
          </div>
        )}
      </HolographicPanel>
    </div>
  );
};
