import React, { useEffect, useRef } from 'react';
import { HologramModelId, HologramVisualSettings } from '../types/hologram';
import { HologramSceneManager } from '../three/HologramScene';

interface HologramCanvasProps {
  currentModelId: HologramModelId;
  visualSettings: HologramVisualSettings;
  sceneManagerRef: React.MutableRefObject<HologramSceneManager | null>;
  onModelChange: (modelId: HologramModelId) => void;
}

export const HologramCanvas: React.FC<HologramCanvasProps> = ({
  currentModelId,
  visualSettings,
  sceneManagerRef,
  onModelChange
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!mountRef.current) return;

    const manager = new HologramSceneManager(mountRef.current, visualSettings);
    sceneManagerRef.current = manager;
    manager.setModel(currentModelId);

    return () => {
      manager.destroy();
      sceneManagerRef.current = null;
    };
  }, []);

  // Sync model changes
  useEffect(() => {
    if (sceneManagerRef.current && sceneManagerRef.current.getModelId() !== currentModelId) {
      sceneManagerRef.current.setModel(currentModelId);
    }
  }, [currentModelId]);

  // Sync visual settings changes
  useEffect(() => {
    if (sceneManagerRef.current) {
      sceneManagerRef.current.updateVisualSettings(visualSettings);
    }
  }, [visualSettings]);

  return (
    <div
      ref={mountRef}
      className="absolute inset-0 z-10 w-full h-full overflow-hidden flex items-center justify-center cursor-grab active:cursor-grabbing"
    />
  );
};
