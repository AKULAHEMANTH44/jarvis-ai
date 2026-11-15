import React, { useEffect, useRef } from 'react';
import { HologramModelId, HologramVisualSettings } from '../types/hologram';
import { HologramSceneManager } from '../three/HologramScene';

interface HologramCanvasProps {
  currentModelId: HologramModelId;
  visualSettings: HologramVisualSettings;
  sceneManagerRef: React.MutableRefObject<HologramSceneManager | null>;
  onModelChange: (modelId: HologramModelId) => void;
  onSelectObject?: (id: string) => void;
}

export const HologramCanvas: React.FC<HologramCanvasProps> = ({
  currentModelId,
  visualSettings,
  sceneManagerRef,
  onModelChange,
  onSelectObject
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!mountRef.current) return;

    const manager = new HologramSceneManager(mountRef.current, visualSettings);
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

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!mountRef.current || !sceneManagerRef.current) return;
    const rect = mountRef.current.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    const selectedId = sceneManagerRef.current.raycastSelect(ndcX, ndcY);
    if (selectedId && onSelectObject) {
      onSelectObject(selectedId);
    }
  };

  return (
    <div
      ref={mountRef}
      onClick={handleClick}
      className="absolute inset-0 z-10 w-full h-full overflow-hidden flex items-center justify-center cursor-crosshair"
    />
  );
};
