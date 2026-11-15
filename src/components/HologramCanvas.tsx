import React, { useEffect, useRef } from 'react';
import {
  ComponentLabel2D,
  HologramModelId,
  HologramVisualSettings,
  LaserTargetInfo
} from '../types/hologram';
import { SpatialVisualFeedback } from '../types/gesture';
import { HologramSceneManager } from '../three/HologramScene';

interface HologramCanvasProps {
  currentModelId: HologramModelId;
  visualSettings: HologramVisualSettings;
  sceneManagerRef: React.MutableRefObject<HologramSceneManager | null>;
  onModelChange: (modelId: HologramModelId) => void;
  onSelectObject?: (id: string) => void;
  onTransformChange?: () => void;
  laserTarget?: LaserTargetInfo | null;
  componentLabels?: ComponentLabel2D[];
  activeGestureFeedback?: string | null;
  spatialFeedback?: SpatialVisualFeedback | null;
  isTrackingLost?: boolean;
  startAtInitZero?: boolean;
  hideProjectedLabels?: boolean;
}

export const HologramCanvas: React.FC<HologramCanvasProps> = ({
  currentModelId,
  visualSettings,
  sceneManagerRef,
  onSelectObject,
  onTransformChange,
  laserTarget,
  componentLabels = [],
  activeGestureFeedback,
  spatialFeedback,
  isTrackingLost = false,
  startAtInitZero = false,
  hideProjectedLabels = false
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    active: boolean;
    button: number;
    shiftKey: boolean;
    lastX: number;
    lastY: number;
    movedDistance: number;
  }>({
    active: false,
    button: 0,
    shiftKey: false,
    lastX: 0,
    lastY: 0,
    movedDistance: 0
  });

  useEffect(() => {
    if (!mountRef.current) return;

    const manager = new HologramSceneManager(mountRef.current, visualSettings, startAtInitZero);
    sceneManagerRef.current = manager;

    return () => {
      manager.destroy();
      sceneManagerRef.current = null;
    };
  }, []);

  // Sync visual settings changes
  useEffect(() => {
    if (sceneManagerRef.current) {
      sceneManagerRef.current.updateVisualSettings(visualSettings);
    }
  }, [visualSettings]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragStateRef.current = {
      active: true,
      button: e.button,
      shiftKey: e.shiftKey,
      lastX: e.clientX,
      lastY: e.clientY,
      movedDistance: 0
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag.active || !sceneManagerRef.current) return;

    const dx = e.clientX - drag.lastX;
    const dy = e.clientY - drag.lastY;
    drag.movedDistance += Math.hypot(dx, dy);
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;

    if (drag.button === 2 || drag.shiftKey) {
      sceneManagerRef.current.applyDeltaTranslation(dx * 0.012, -dy * 0.012, 0);
    } else {
      sceneManagerRef.current.applyDeltaRotation(dy * 0.012, dx * 0.012, 0);
    }
    onTransformChange?.();
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    const wasClick = drag.active && drag.movedDistance < 5 && drag.button === 0;
    dragStateRef.current.active = false;

    if (wasClick && mountRef.current && sceneManagerRef.current) {
      const rect = mountRef.current.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      const selectedId = sceneManagerRef.current.raycastSelect(ndcX, ndcY);
      if (selectedId && onSelectObject) {
        onSelectObject(selectedId);
      }
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!sceneManagerRef.current) return;
    const multiplier = e.deltaY < 0 ? 1.07 : 0.93;
    sceneManagerRef.current.applyScaleMultiplier(multiplier);
    onTransformChange?.();
  };

  return (
    <div
      ref={mountRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => { dragStateRef.current.active = false; }}
      onContextMenu={(e) => e.preventDefault()}
      onWheel={handleWheel}
      className="absolute inset-0 z-10 w-full h-full overflow-hidden flex items-center justify-center cursor-crosshair"
    >
      {/* Floating Component & VISION 1.2 Telemetry Callout Labels */}
      {!hideProjectedLabels &&
        visualSettings.showComponentLabels &&
        (visualSettings.explosionAmount > 0.15 ||
          (currentModelId === 'vision_sphere' &&
            !visualSettings.reducedEffects &&
            visualSettings.dispersionAmount < 0.85)) &&
        componentLabels.map((lbl, idx) => (
          <div
            key={lbl.id}
            style={{ transform: `translate3d(${lbl.x}px, ${lbl.y}px, 0) translate(-50%, -100%)` }}
            className={`pointer-events-none absolute top-0 left-0 z-20 ${idx >= 3 ? 'hidden sm:block' : ''}`}
          >
            <div className="flex flex-col items-center">
              <div className="px-1.5 sm:px-2 py-0.5 rounded bg-[#020c18]/85 border border-cyan-400/70 text-[7.5px] sm:text-[9px] font-mono text-cyan-200 whitespace-nowrap shadow-[0_0_10px_rgba(0,240,255,0.3)]">
                {lbl.name}
              </div>
              <div className="w-[1px] h-2.5 sm:h-3 bg-cyan-400/70" />
              <div className="w-1.5 h-1.5 rounded-full bg-cyan-300 border border-white" />
            </div>
          </div>
        ))}

      {/* Active Hand Gesture & Phase F Spatial Feedback Overlay */}
      {!hideProjectedLabels && (activeGestureFeedback || (spatialFeedback && spatialFeedback.isRotating)) && (
        <div
          data-testid="spatial-interaction-badge"
          className="pointer-events-none absolute top-16 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2.5 px-3 py-1 rounded border border-cyan-400/70 bg-black/75 text-cyan-200 font-orbitron text-[10px] tracking-widest shadow-[0_0_14px_rgba(0,240,255,0.28)]"
        >
          {spatialFeedback?.isRotating && (
            <span className="text-white font-bold">
              {spatialFeedback.rotationDirection === 'RIGHT'
                ? '→'
                : spatialFeedback.rotationDirection === 'LEFT'
                ? '←'
                : spatialFeedback.rotationDirection === 'UP'
                ? '↑'
                : spatialFeedback.rotationDirection === 'DOWN'
                ? '↓'
                : '↻'}
            </span>
          )}
          <span>{spatialFeedback?.badgeText || activeGestureFeedback}</span>
          {spatialFeedback?.isRotating && (
            <span className="font-mono text-[9.5px] text-cyan-300 border-l border-cyan-500/40 pl-2">
              {spatialFeedback.rotationSpeed.toFixed(1)} rad/s
            </span>
          )}
        </div>
      )}

      {/* Radial Dispersion & Reconstruction Progress Telemetry Bar */}
      {!hideProjectedLabels &&
        (visualSettings.dispersionAmount > 0.02 ||
          spatialFeedback?.dispersionPhase === 'RECONSTRUCTING') && (
          <div
            data-testid="dispersion-progress-hud"
            className="pointer-events-none absolute bottom-20 left-1/2 -translate-x-1/2 z-20 w-56 px-2.5 py-1.5 rounded border border-cyan-400/45 bg-[#020c18]/80 font-mono text-[9.5px] text-cyan-200 shadow-[0_0_14px_rgba(0,240,255,0.22)]"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="tracking-wider uppercase">
                {spatialFeedback?.dispersionPhase === 'RECONSTRUCTING'
                  ? 'RECONSTRUCTING'
                  : 'RADIAL DISPERSION'}
              </span>
              <span className="text-white font-bold">
                {spatialFeedback?.dispersionPhase === 'RECONSTRUCTING'
                  ? `${spatialFeedback.reconstructionProgress}%`
                  : `${Math.round(visualSettings.dispersionAmount * 100)}%`}
              </span>
            </div>
            <div className="w-full h-1 bg-black/70 rounded-full overflow-hidden border border-cyan-500/30">
              <div
                className={`h-full transition-all duration-100 ${
                  spatialFeedback?.dispersionPhase === 'RECONSTRUCTING'
                    ? 'bg-gradient-to-r from-emerald-400 to-cyan-300'
                    : 'bg-gradient-to-r from-cyan-400 to-white'
                }`}
                style={{
                  width: `${
                    spatialFeedback?.dispersionPhase === 'RECONSTRUCTING'
                      ? spatialFeedback.reconstructionProgress
                      : Math.round(visualSettings.dispersionAmount * 100)
                  }%`
                }}
              />
            </div>
          </div>
        )}

      {/* Hand Tracking Loss Stabilization Badge */}
      {isTrackingLost && (
        <div
          data-testid="tracking-lost-badge"
          className="pointer-events-none absolute top-24 left-1/2 -translate-x-1/2 z-30 px-3 py-1 rounded border border-amber-400/80 bg-amber-950/80 text-amber-200 font-mono text-[10px] tracking-wider shadow-[0_0_12px_rgba(255,170,0,0.35)]"
        >
          OPTICAL TRACKING LOST // HOLDING HOLOGRAM STATE
        </div>
      )}

      {laserTarget && (
        <div className="pointer-events-none absolute top-16 left-1/2 -translate-x-1/2 z-30 px-3 py-1 rounded border border-emerald-400/70 bg-black/75 text-emerald-300 font-mono text-[10px] tracking-wider shadow-[0_0_12px_rgba(0,255,170,0.35)]">
          LASER LOCK // {laserTarget.objectName} [{laserTarget.point.x.toFixed(2)}, {laserTarget.point.y.toFixed(2)}, {laserTarget.point.z.toFixed(2)}]
        </div>
      )}
    </div>
  );
};
