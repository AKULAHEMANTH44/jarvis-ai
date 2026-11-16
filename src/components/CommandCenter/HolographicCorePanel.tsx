import React from 'react';
import { Box, Eye, Maximize2, Shield, Sparkles } from 'lucide-react';
import { HologramCanvas } from '../HologramCanvas';
import { HologramSceneManager } from '../../three/HologramScene';
import {
  CameraControlMode,
  ComponentLabel2D,
  HologramModelId,
  HologramVisualSettings,
  LaserTargetInfo
} from '../../types/hologram';
import { audioService } from '../../services/soundFx';

interface HolographicCorePanelProps {
  currentModelId: HologramModelId;
  visualSettings: HologramVisualSettings;
  sceneManagerRef: React.MutableRefObject<HologramSceneManager | null>;
  onModelChange: (modelId: HologramModelId) => void;
  onSelectObject: (id: string | null) => void;
  onSelectComponent: (instanceId: string, componentId: string | null) => void;
  onHighlightComponent: (instanceId: string, componentId: string | null) => void;
  onTransformStart: () => void;
  onTransformChange: () => void;
  onImportMeshFiles: (files: File[]) => Promise<void>;
  onReconstructImages: (files: File[]) => Promise<void>;
  onImportError: (msg: string) => void;
  cameraControlMode: CameraControlMode;
  laserTarget: LaserTargetInfo | null;
  componentLabels: ComponentLabel2D[];
  activeGestureFeedback: string | null;
  spatialFeedback: any;
  isTrackingLost: boolean;
  autostart: boolean;
  isFocusMode: boolean;
  onToggleFocus: () => void;
  onOpenObjectLab: () => void;
}

export const HolographicCorePanel: React.FC<HolographicCorePanelProps> = ({
  currentModelId,
  visualSettings,
  sceneManagerRef,
  onModelChange,
  onSelectObject,
  onSelectComponent,
  onHighlightComponent,
  onTransformStart,
  onTransformChange,
  onImportMeshFiles,
  onReconstructImages,
  onImportError,
  cameraControlMode,
  laserTarget,
  componentLabels,
  activeGestureFeedback,
  spatialFeedback,
  isTrackingLost,
  autostart,
  isFocusMode,
  onToggleFocus,
  onOpenObjectLab
}) => {
  return (
    <div
      className={`relative bg-[#020814]/95 border border-cyan-500/40 rounded-xl overflow-hidden flex flex-col shadow-[0_0_28px_rgba(0,240,255,0.18)] ${
        isFocusMode ? 'fixed inset-4 z-50' : 'h-[360px] lg:h-[400px]'
      }`}
    >
      {/* Panel Header */}
      <div className="h-9 px-3 bg-black/60 border-b border-cyan-500/25 flex items-center justify-between shrink-0 select-none z-10">
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
          <span className="font-orbitron font-bold text-xs text-white tracking-wider">
            HOLOGRAPHIC CORE // {currentModelId.toUpperCase().replace('_', ' ')}
          </span>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[10px]">
          <button
            type="button"
            onClick={() => {
              audioService.playChirp(1300);
              onOpenObjectLab();
            }}
            className="px-2 py-0.5 rounded border border-cyan-500/30 bg-cyan-950/40 hover:bg-cyan-500/20 text-cyan-200 font-orbitron"
          >
            LAB
          </button>
          <button
            type="button"
            onClick={() => {
              audioService.playChirp(1400);
              onToggleFocus();
            }}
            title={isFocusMode ? 'Exit Focus Mode' : 'Expand Holographic Core'}
            className="p-1 rounded border border-cyan-500/30 text-cyan-300 hover:text-white transition-colors"
          >
            <Maximize2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Central Bounded Hologram Canvas Viewport */}
      <div className="flex-1 relative overflow-hidden bg-[#02060c]">
        <HologramCanvas
          currentModelId={currentModelId}
          visualSettings={visualSettings}
          sceneManagerRef={sceneManagerRef}
          onModelChange={onModelChange}
          onSelectObject={onSelectObject}
          onSelectComponent={onSelectComponent}
          onHighlightComponent={onHighlightComponent}
          onTransformStart={onTransformStart}
          onTransformChange={onTransformChange}
          onDropModelFiles={onImportMeshFiles}
          onDropImageFiles={onReconstructImages}
          onImportError={onImportError}
          cameraControlMode={cameraControlMode}
          laserTarget={laserTarget}
          componentLabels={componentLabels}
          activeGestureFeedback={activeGestureFeedback}
          spatialFeedback={spatialFeedback}
          isTrackingLost={isTrackingLost}
          startAtInitZero={!autostart}
        />

        {/* HUD Overlay Technical Brackets */}
        <div className="absolute inset-2 pointer-events-none border border-cyan-500/15 rounded-lg flex flex-col justify-between p-2">
          <div className="flex justify-between text-[9px] font-mono text-cyan-400/50">
            <span>[X: 0.00 Y: 0.00 Z: 0.00]</span>
            <span>FLUX: 142.8 GHz</span>
          </div>
          <div className="flex justify-between text-[9px] font-mono text-cyan-400/50">
            <span>CONTAINMENT: 99.8%</span>
            <span>GRID: ACTIVE</span>
          </div>
        </div>
      </div>
    </div>
  );
};
