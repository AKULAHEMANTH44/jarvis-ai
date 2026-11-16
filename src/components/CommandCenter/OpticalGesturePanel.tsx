import React, { useEffect, useRef } from 'react';
import {
  Camera,
  CameraOff,
  Eye,
  Hand,
  ShieldAlert,
  ShieldCheck,
  Sliders
} from 'lucide-react';
import { CameraPermissionStatus } from '../../services/handTracking';
import { GestureDetectionResult } from '../../types/gesture';
import { renderHandSkeletonOverlay } from '../../utils/handSkeletonRenderer';
import { audioService } from '../../services/soundFx';

interface OpticalGesturePanelProps {
  isCameraActive: boolean;
  cameraError: string | null;
  cameraPermissionStatus: CameraPermissionStatus;
  gestureResult: GestureDetectionResult | null;
  mirrorX: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onToggleCamera: () => void;
  onOpenGestureDrawer: () => void;
}

function formatPermissionBadge(
  status: CameraPermissionStatus,
  isCameraActive: boolean
): { label: string; className: string } {
  if (isCameraActive || status === 'active') {
    return {
      label: 'PERM: ACTIVE',
      className: 'bg-emerald-950/70 border-emerald-400/60 text-emerald-300'
    };
  }
  switch (status) {
    case 'granted':
      return {
        label: 'PERM: GRANTED',
        className: 'bg-cyan-950/70 border-cyan-400/50 text-cyan-200'
      };
    case 'checking':
      return {
        label: 'PERM: CHECKING',
        className: 'bg-cyan-950/70 border-cyan-400/50 text-cyan-300 animate-pulse'
      };
    case 'denied':
      return {
        label: 'PERM: DENIED',
        className: 'bg-red-950/70 border-red-400/60 text-red-300'
      };
    case 'unavailable':
      return {
        label: 'NO CAMERA',
        className: 'bg-amber-950/70 border-amber-400/60 text-amber-300'
      };
    case 'error':
      return {
        label: 'SENSOR ERROR',
        className: 'bg-red-950/70 border-red-400/60 text-red-300'
      };
    case 'prompt':
      return {
        label: 'PERM: PROMPT',
        className: 'bg-cyan-950/60 border-cyan-500/40 text-cyan-300'
      };
    default:
      return {
        label: 'PERM: STANDBY',
        className: 'bg-black/50 border-cyan-500/30 text-cyan-400/80'
      };
  }
}

export const OpticalGesturePanel: React.FC<OpticalGesturePanelProps> = ({
  isCameraActive,
  cameraError,
  cameraPermissionStatus,
  gestureResult,
  mirrorX,
  videoRef,
  onToggleCamera,
  onOpenGestureDrawer
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    renderHandSkeletonOverlay(canvasRef.current, gestureResult, isCameraActive, mirrorX);
  }, [gestureResult, isCameraActive, mirrorX]);

  const permissionBadge = formatPermissionBadge(cameraPermissionStatus, isCameraActive);
  const handsCount = gestureResult?.hands?.length ?? 0;
  const isTrackingLost = Boolean(isCameraActive && gestureResult?.trackingLost);

  const handStatusLabel = !isCameraActive
    ? 'SENSOR OFFLINE'
    : isTrackingLost
    ? 'TRACKING LOST // STABILIZING'
    : handsCount > 0
    ? `${handsCount} HAND${handsCount > 1 ? 'S' : ''} TRACKED`
    : 'SEARCHING HANDS...';

  const trackingStatusLabel = !isCameraActive
    ? 'STANDBY'
    : isTrackingLost
    ? 'REACQUIRING'
    : handsCount > 0
    ? 'TRACKING ACTIVE'
    : 'READY';

  const confidencePercent =
    isCameraActive && gestureResult?.confidence
      ? `${Math.round(gestureResult.confidence * 100)}%`
      : '--';

  return (
    <section
      aria-label="Optical Sensor and Hand Gesture Recognition"
      data-testid="optical-gesture-panel"
      className="bg-[#020814]/90 border border-cyan-500/30 rounded-xl p-3 flex flex-col space-y-2.5 shadow-[0_0_20px_rgba(0,240,255,0.1)]"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-cyan-500/20 pb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Eye className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <span className="font-orbitron font-bold text-[11px] text-white tracking-wider truncate">
            OPTICAL & GESTURE
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              audioService.playChirp(1200);
              onOpenGestureDrawer();
            }}
            title="Open Calibration & 12-Gesture Manual"
            className="p-1 rounded border border-cyan-500/30 bg-black/50 text-cyan-300 hover:text-white hover:border-cyan-400 transition-colors"
          >
            <Sliders className="w-3 h-3" />
          </button>

          <button
            type="button"
            data-testid="camera-toggle-button"
            onClick={() => {
              audioService.playChirp(isCameraActive ? 800 : 1600);
              onToggleCamera();
            }}
            className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold border flex items-center gap-1 transition-all ${
              isCameraActive
                ? 'border-emerald-400/70 text-emerald-200 bg-emerald-950/60 hover:bg-emerald-900/60'
                : 'border-cyan-400/60 text-cyan-100 bg-cyan-500/20 hover:bg-cyan-500/35'
            }`}
          >
            {isCameraActive ? (
              <>
                <CameraOff className="w-3 h-3" />
                <span>CAM ON</span>
              </>
            ) : (
              <>
                <Camera className="w-3 h-3" />
                <span>ENABLE CAM</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Permission & Tracking Status Strip */}
      <div className="flex items-center justify-between gap-1.5 font-mono text-[9px]">
        <span
          data-testid="camera-permission-status"
          className={`px-1.5 py-0.5 rounded border font-semibold flex items-center gap-1 ${permissionBadge.className}`}
        >
          {isCameraActive ? (
            <ShieldCheck className="w-2.5 h-2.5 shrink-0" />
          ) : (
            <ShieldAlert className="w-2.5 h-2.5 shrink-0" />
          )}
          <span>{permissionBadge.label}</span>
        </span>

        <span
          data-testid="gesture-tracking-status"
          className={`px-1.5 py-0.5 rounded border font-semibold ${
            isCameraActive && handsCount > 0
              ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
              : isTrackingLost
              ? 'bg-amber-950/60 border-amber-500/40 text-amber-200'
              : 'bg-black/50 border-cyan-500/25 text-cyan-300/80'
          }`}
        >
          {trackingStatusLabel}
        </span>
      </div>

      {/* Live Webcam Preview & MediaPipe Skeleton Viewport */}
      <div className="relative w-full h-36 bg-black/85 rounded-lg border border-cyan-500/30 overflow-hidden flex items-center justify-center">
        <video
          ref={videoRef as React.RefObject<HTMLVideoElement>}
          data-testid="webcam-preview-video"
          aria-label="Live Optical Webcam Feed"
          playsInline
          muted
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${
            mirrorX ? 'transform -scale-x-100' : ''
          } ${isCameraActive ? 'opacity-80 brightness-110 contrast-110' : 'opacity-0 pointer-events-none'}`}
        />

        <canvas
          ref={canvasRef}
          width={320}
          height={180}
          className="absolute inset-0 w-full h-full pointer-events-none"
        />

        {/* Subtle targeting crosshair */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-20">
          <div className="w-14 h-14 border border-cyan-400/50 rounded-full" />
        </div>

        {/* Offline / Error Overlay */}
        {!isCameraActive && (
          <div className="relative z-10 flex flex-col items-center justify-center p-2.5 text-center space-y-1.5">
            {cameraError ? (
              <>
                <ShieldAlert className="w-5 h-5 text-amber-400" />
                <span
                  data-testid="camera-error-message"
                  className="text-amber-300 font-mono text-[9.5px] leading-snug max-w-[230px]"
                >
                  {cameraError}
                </span>
              </>
            ) : (
              <>
                <Camera className="w-6 h-6 text-cyan-500/60" />
                <span className="text-cyan-300/80 font-mono text-[10px]">
                  OPTICAL SENSOR OFFLINE
                </span>
              </>
            )}

            <button
              type="button"
              onClick={() => {
                audioService.playChirp(1600);
                onToggleCamera();
              }}
              className="px-2.5 py-1 rounded bg-cyan-500/20 hover:bg-cyan-500/40 text-white border border-cyan-400 font-orbitron text-[9px] tracking-wider transition-all"
            >
              {cameraError ? 'RETRY PERMISSION' : 'START WEBCAM'}
            </button>
          </div>
        )}

        {/* Live Hand Detection Status Badge */}
        {isCameraActive && (
          <div
            data-testid="hand-detection-status"
            className="absolute bottom-1.5 left-1.5 z-10 flex items-center gap-1.5 bg-black/75 px-2 py-0.5 rounded border border-cyan-500/35 font-mono text-[9px] text-cyan-200"
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isTrackingLost
                  ? 'bg-amber-400 animate-ping'
                  : handsCount > 0
                  ? 'bg-emerald-400 animate-pulse'
                  : 'bg-cyan-400 animate-pulse'
              }`}
            />
            <span>{handStatusLabel}</span>
          </div>
        )}
      </div>

      {/* Recognized Gesture Telemetry */}
      <div className="p-2 rounded-lg bg-black/50 border border-cyan-500/25 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <Hand className="w-3 h-3 text-cyan-400 shrink-0" />
            <span
              data-testid="recognized-gesture-name"
              className="font-orbitron font-bold text-[10.5px] text-white truncate"
            >
              {isCameraActive ? gestureResult?.activeGesture || 'NONE' : 'OFFLINE'}
            </span>
          </div>
          <span
            data-testid="recognized-gesture-confidence"
            className="font-mono text-[10px] font-bold text-emerald-400 tabular-nums shrink-0"
          >
            {confidencePercent}
          </span>
        </div>

        <p className="font-mono text-[9.5px] text-cyan-300/80 truncate">
          {isCameraActive
            ? gestureResult?.description || 'Show palm or pinch to manipulate hologram'
            : cameraError || 'Enable camera to activate MediaPipe 21-landmark hand control'}
        </p>
      </div>
    </section>
  );
};
