import React, { useEffect, useRef, useState } from 'react';
import {
  CameraControlMode,
  ComponentLabel2D,
  HologramModelId,
  HologramVisualSettings,
  LaserTargetInfo
} from '../types/hologram';
import { SpatialVisualFeedback } from '../types/gesture';
import { HologramSceneManager } from '../three/HologramScene';
import { Upload, AlertTriangle } from 'lucide-react';

interface HologramCanvasProps {
  currentModelId: HologramModelId;
  visualSettings: HologramVisualSettings;
  sceneManagerRef: React.MutableRefObject<HologramSceneManager | null>;
  onModelChange: (modelId: HologramModelId) => void;
  onSelectObject?: (id: string) => void;
  onSelectComponent?: (instanceId: string, componentId: string | null) => void;
  onHighlightComponent?: (instanceId: string, componentId: string | null) => void;
  onTransformStart?: () => void;
  onTransformChange?: () => void;
  onDropModelFiles?: (files: File[]) => void | Promise<void>;
  onDropImageFiles?: (files: File[]) => void | Promise<void>;
  onImportError?: (message: string) => void;
  cameraControlMode?: CameraControlMode;
  laserTarget?: LaserTargetInfo | null;
  componentLabels?: ComponentLabel2D[];
  activeGestureFeedback?: string | null;
  spatialFeedback?: SpatialVisualFeedback | null;
  isTrackingLost?: boolean;
  startAtInitZero?: boolean;
  hideProjectedLabels?: boolean;
}

const MODEL_EXT_RE = /\.(glb|gltf|obj|stl)$/i;
const COMPANION_EXT_RE = /\.(bin|png|jpe?g|webp|gif|bmp|ktx2)$/i;
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|bmp)$/i;

export const HologramCanvas: React.FC<HologramCanvasProps> = ({
  currentModelId,
  visualSettings,
  sceneManagerRef,
  onSelectObject,
  onSelectComponent,
  onHighlightComponent,
  onTransformStart,
  onTransformChange,
  onDropModelFiles,
  onDropImageFiles,
  onImportError,
  cameraControlMode = 'OBJECT',
  laserTarget,
  componentLabels = [],
  activeGestureFeedback,
  spatialFeedback,
  isTrackingLost = false,
  startAtInitZero = false,
  hideProjectedLabels = false
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const dragDepthRef = useRef<number>(0);
  const lastHoverCheckRef = useRef<number>(0);
  const hoveredComponentRef = useRef<{ instanceId: string; componentId: string } | null>(null);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [isImportingDrop, setIsImportingDrop] = useState<boolean>(false);
  const [dropError, setDropError] = useState<string | null>(null);

  const dragStateRef = useRef<{
    active: boolean;
    button: number;
    shiftKey: boolean;
    altKey: boolean;
    lastX: number;
    lastY: number;
    movedDistance: number;
    didMutateObject: boolean;
  }>({
    active: false,
    button: 0,
    shiftKey: false,
    altKey: false,
    lastX: 0,
    lastY: 0,
    movedDistance: 0,
    didMutateObject: false
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

  // Sync camera interaction mode (OBJECT vs CAMERA OrbitControls)
  useEffect(() => {
    if (sceneManagerRef.current) {
      sceneManagerRef.current.setCameraControlMode(cameraControlMode);
    }
  }, [cameraControlMode]);

  const clearHoveredComponent = () => {
    const prev = hoveredComponentRef.current;
    if (prev && sceneManagerRef.current) {
      sceneManagerRef.current.highlightComponent(prev.instanceId, null);
      onHighlightComponent?.(prev.instanceId, null);
      hoveredComponentRef.current = null;
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    clearHoveredComponent();
    dragStateRef.current = {
      active: true,
      button: e.button,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      lastX: e.clientX,
      lastY: e.clientY,
      movedDistance: 0,
      didMutateObject: false
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!sceneManagerRef.current) return;

    if (!drag.active) {
      if (cameraControlMode === 'OBJECT' && !isDragOver && mountRef.current) {
        const now = performance.now();
        if (now - lastHoverCheckRef.current < 55) return;
        lastHoverCheckRef.current = now;

        const rect = mountRef.current.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
        const selectedId = sceneManagerRef.current.spatialManager.getSelectedId();
        const comps = selectedId ? sceneManagerRef.current.spatialManager.getComponents(selectedId) : [];

        if (selectedId && comps.length > 1) {
          const hit = sceneManagerRef.current.raycastComponent(ndcX, ndcY);
          if (hit && hit.instanceId === selectedId) {
            if (
              !hoveredComponentRef.current ||
              hoveredComponentRef.current.instanceId !== hit.instanceId ||
              hoveredComponentRef.current.componentId !== hit.componentId
            ) {
              hoveredComponentRef.current = { instanceId: hit.instanceId, componentId: hit.componentId };
              sceneManagerRef.current.highlightComponent(hit.instanceId, hit.componentId);
              onHighlightComponent?.(hit.instanceId, hit.componentId);
            }
            return;
          }
        }
        clearHoveredComponent();
      }
      return;
    }

    const dx = e.clientX - drag.lastX;
    const dy = e.clientY - drag.lastY;
    drag.movedDistance += Math.hypot(dx, dy);
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;

    // When CAMERA mode is active, OrbitControls handles drag directly on the WebGL canvas
    if (cameraControlMode === 'CAMERA') {
      return;
    }

    // Alt+Drag or Middle-Mouse drag orbits/pans camera without leaving OBJECT manipulation mode
    if (drag.altKey || e.altKey || drag.button === 1) {
      if (drag.shiftKey || e.shiftKey || drag.button === 2) {
        sceneManagerRef.current.panCamera(dx, dy);
      } else {
        sceneManagerRef.current.orbitCamera(dx, dy);
      }
      return;
    }

    if (!drag.didMutateObject) {
      drag.didMutateObject = true;
      onTransformStart?.();
    }

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
    dragStateRef.current.didMutateObject = false;

    if (wasClick && mountRef.current && sceneManagerRef.current) {
      const rect = mountRef.current.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);

      const previouslySelectedId = sceneManagerRef.current.spatialManager.getSelectedId();
      const selectedId = sceneManagerRef.current.raycastSelect(ndcX, ndcY);

      if (selectedId) {
        onSelectObject?.(selectedId);
        // Inspect sub-component when clicking on an already-selected multi-part model or Alt+Click
        if (onSelectComponent && (e.altKey || selectedId === previouslySelectedId)) {
          const compHit = sceneManagerRef.current.raycastComponent(ndcX, ndcY);
          if (compHit && compHit.instanceId === selectedId) {
            onTransformStart?.();
            sceneManagerRef.current.selectComponent(compHit.instanceId, compHit.componentId);
            onSelectComponent(compHit.instanceId, compHit.componentId);
          }
        }
      }
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!sceneManagerRef.current) return;
    if (cameraControlMode === 'CAMERA') {
      // OrbitControls handles zoom directly on the canvas
      return;
    }
    const factor = e.deltaY < 0 ? 1.07 : 0.93;
    if (e.altKey) {
      sceneManagerRef.current.zoomCamera(e.deltaY < 0 ? 0.92 : 1.08);
      return;
    }
    onTransformStart?.();
    sceneManagerRef.current.applyScaleMultiplier(factor);
    onTransformChange?.();
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    setDropError(null);
    if (e.dataTransfer?.types?.includes('Files')) {
      setIsDragOver(true);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
    if (!isDragOver) setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragOver(false);
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragOver(false);
    setDropError(null);

    const droppedFiles = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
    if (droppedFiles.length === 0) return;

    const modelFiles = droppedFiles.filter((f) => MODEL_EXT_RE.test(f.name));
    const companionFiles = droppedFiles.filter((f) => COMPANION_EXT_RE.test(f.name));
    const imageFiles = droppedFiles.filter(
      (f) => f.type.startsWith('image/') || IMAGE_EXT_RE.test(f.name)
    );

    try {
      setIsImportingDrop(true);
      if (modelFiles.length > 0 && onDropModelFiles) {
        const bundle = [...modelFiles, ...companionFiles];
        await onDropModelFiles(bundle);
      } else if (imageFiles.length > 0 && onDropImageFiles) {
        await onDropImageFiles(imageFiles);
      } else {
        const msg =
          'Unsupported file format. Drop .glb, .gltf (+companion .bin/textures), .obj, .stl, or image files.';
        setDropError(msg);
        onImportError?.(msg);
        setTimeout(() => setDropError(null), 4500);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to load dropped 3D asset.';
      setDropError(msg);
      onImportError?.(msg);
      setTimeout(() => setDropError(null), 5000);
    } finally {
      setIsImportingDrop(false);
    }
  };

  return (
    <div
      ref={mountRef}
      data-testid="hologram-canvas-dropzone"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={clearHoveredComponent}
      onPointerCancel={() => { dragStateRef.current.active = false; dragStateRef.current.didMutateObject = false; clearHoveredComponent(); }}
      onContextMenu={(e) => e.preventDefault()}
      onWheel={handleWheel}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative absolute inset-0 z-10 w-full h-full overflow-hidden flex items-center justify-center ${
        cameraControlMode === 'CAMERA' ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'
      }`}
    >
      {/* Holographic Drag-and-Drop Overlay */}
      {(isDragOver || isImportingDrop) && (
        <div
          data-testid="hologram-drop-overlay"
          className="pointer-events-none absolute inset-4 z-40 rounded-2xl border-2 border-dashed border-cyan-400 bg-[#020c18]/85 flex flex-col items-center justify-center p-6 text-center shadow-[0_0_40px_rgba(0,240,255,0.28)]"
        >
          <div className="relative p-6 max-w-md border border-cyan-400/50 rounded-xl bg-black/70">
            <span className="absolute -top-1 -left-1 w-3 h-3 border-t-2 border-l-2 border-cyan-300" />
            <span className="absolute -top-1 -right-1 w-3 h-3 border-t-2 border-r-2 border-cyan-300" />
            <span className="absolute -bottom-1 -left-1 w-3 h-3 border-b-2 border-l-2 border-cyan-300" />
            <span className="absolute -bottom-1 -right-1 w-3 h-3 border-b-2 border-r-2 border-cyan-300" />

            <Upload className="w-10 h-10 text-cyan-300 mx-auto mb-3" />
            <h3 className="font-orbitron font-bold text-sm tracking-[0.18em] text-white mb-1.5">
              {isImportingDrop ? 'MATERIALIZING 3D HOLOGRAM...' : 'DROP 3D ASSET INTO OBJECT LAB'}
            </h3>
            <p className="font-mono text-[11px] text-cyan-200/85 leading-relaxed">
              {isImportingDrop
                ? 'Normalizing bounds, building wireframe & point layers, and framing viewport.'
                : 'Supports .GLB, .GLTF (+ companion .BIN / textures), .OBJ, .STL, or PNG/JPG images.'}
            </p>
          </div>
        </div>
      )}

      {/* Transient Drop Validation Alert */}
      {dropError && (
        <div
          role="alert"
          data-testid="canvas-drop-error"
          className="pointer-events-none absolute top-20 left-1/2 -translate-x-1/2 z-40 max-w-lg px-3.5 py-2 rounded border border-red-400/80 bg-[#1a0509]/92 text-red-200 font-mono text-[11px] flex items-center gap-2 shadow-[0_0_18px_rgba(255,60,80,0.3)]"
        >
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{dropError}</span>
        </div>
      )}

      {/* Camera Orbit Mode Status Hint */}
      {!hideProjectedLabels && cameraControlMode === 'CAMERA' && !isDragOver && (
        <div
          data-testid="camera-mode-indicator"
          className="pointer-events-none absolute top-14 left-1/2 -translate-x-1/2 z-20 px-3 py-0.5 rounded border border-cyan-400/55 bg-[#020c18]/85 text-cyan-200 font-mono text-[9.5px] tracking-wider"
        >
          CAMERA ORBIT // DRAG ORBIT · RIGHT-DRAG PAN · SCROLL ZOOM
        </div>
      )}

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
