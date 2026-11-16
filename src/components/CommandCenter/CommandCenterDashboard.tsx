import React, { useState } from 'react';
import { CommandSidebar, CommandCenterNavId } from './CommandSidebar';
import { SystemHeader } from './SystemHeader';
import { AICoreOverview } from './AICoreOverview';
import { HolographicCorePanel } from './HolographicCorePanel';
import { LiveIntelligenceFeed } from './LiveIntelligenceFeed';
import { ActiveAgentsPanel } from './ActiveAgentsPanel';
import { MissionTimeline } from './MissionTimeline';
import { QuickCommandsPanel } from './QuickCommandsPanel';
import { SystemMonitorPanel } from './SystemMonitorPanel';
import { MemoryInsightsPanel } from './MemoryInsightsPanel';
import { LLMStatusPanel } from './LLMStatusPanel';
import { VoiceCommandDock } from './VoiceCommandDock';
import { HologramSceneManager } from '../../three/HologramScene';
import {
  CameraControlMode,
  ComponentLabel2D,
  HologramModelId,
  HologramVisualSettings,
  LaserTargetInfo
} from '../../types/hologram';
import { IntelligenceStateSnapshot } from '../../services/intelligenceEngine';

interface CommandCenterDashboardProps {
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
  fps: number;
  isCameraActive: boolean;
  isVoiceActive: boolean;
  onToggleVoice: () => void;
  intelligenceState: IntelligenceStateSnapshot;
  onSendCommand: (text: string) => void;
  onApprovePermission: (permId: string) => void;
  onDenyPermission: (permId: string) => void;
  onOpenAIConfig: () => void;
  onOpenObjectLab: () => void;
  onOpenTasks: () => void;
  onOpenVoiceConsole: () => void;
  onOpenBrain: () => void;
  onOpenPermissions: () => void;
  onOpenMemory: () => void;
  onTriggerRescan: () => void;
  memoryCount: number;
  isFocusMode: boolean;
  onToggleFocus: () => void;
}

export const CommandCenterDashboard: React.FC<CommandCenterDashboardProps> = ({
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
  fps,
  isCameraActive,
  isVoiceActive,
  onToggleVoice,
  intelligenceState,
  onSendCommand,
  onApprovePermission,
  onDenyPermission,
  onOpenAIConfig,
  onOpenObjectLab,
  onOpenTasks,
  onOpenVoiceConsole,
  onOpenBrain,
  onOpenPermissions,
  onOpenMemory,
  onTriggerRescan,
  memoryCount,
  isFocusMode,
  onToggleFocus
}) => {
  const [activeNav, setActiveNav] = useState<CommandCenterNavId>('DASHBOARD');
  const [searchQuery, setSearchQuery] = useState('');

  const handleNavSelect = (nav: CommandCenterNavId) => {
    setActiveNav(nav);
    if (nav === 'AI_CORE') onOpenBrain();
    else if (nav === 'AGENTS' || nav === 'TASKS' || nav === 'WORKFLOWS') onOpenTasks();
    else if (nav === 'MEMORY') onOpenMemory();
    else if (nav === 'CONVERSATIONS' || nav === 'KNOWLEDGE') onOpenBrain();
    else if (nav === 'TOOLS') onOpenPermissions();
    else if (nav === 'FOCUS') onToggleFocus();
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#02060c] font-mono text-cyan-400 select-none flex flex-col">
      {/* Top Header */}
      <SystemHeader
        fps={fps}
        intelligenceStatus={intelligenceState.status}
        pendingPermissionCount={intelligenceState.pendingPermission ? 1 : 0}
        onOpenAIConfig={onOpenAIConfig}
        onOpenPermissions={onOpenPermissions}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      {/* Main Body Layout: Sidebar + Structured Dashboard Grid */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Sidebar */}
        <CommandSidebar
          activeNav={activeNav}
          onSelectNav={handleNavSelect}
          isVoiceActive={isVoiceActive}
          isFocusMode={isFocusMode}
          onToggleVoice={onToggleVoice}
          onToggleFocus={onToggleFocus}
          pendingPermissionCount={intelligenceState.pendingPermission ? 1 : 0}
        />

        {/* Structured Dashboard Grid Viewport */}
        <div className="flex-1 overflow-y-auto p-3.5 bg-[#02060c] space-y-3.5 no-scrollbar">
          {/* Top Row: AI Core Overview (~20%), Holographic Core Panel (~55%), Live Intelligence Feed (~25%) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-start">
            <div className="lg:col-span-3">
              <AICoreOverview
                intelligenceStatus={intelligenceState.status}
                memoryCount={memoryCount}
                isVoiceActive={isVoiceActive}
                isCameraActive={isCameraActive}
                provider={intelligenceState.lastProviderUsed}
                hasApiKey={true}
                onOpenAIConfig={onOpenAIConfig}
                onOpenMemory={onOpenMemory}
              />
            </div>
            <div className="lg:col-span-6">
              <HolographicCorePanel
                currentModelId={currentModelId}
                visualSettings={visualSettings}
                sceneManagerRef={sceneManagerRef}
                onModelChange={onModelChange}
                onSelectObject={onSelectObject}
                onSelectComponent={onSelectComponent}
                onHighlightComponent={onHighlightComponent}
                onTransformStart={onTransformStart}
                onTransformChange={onTransformChange}
                onImportMeshFiles={onImportMeshFiles}
                onReconstructImages={onReconstructImages}
                onImportError={onImportError}
                cameraControlMode={cameraControlMode}
                laserTarget={laserTarget}
                componentLabels={componentLabels}
                activeGestureFeedback={activeGestureFeedback}
                spatialFeedback={spatialFeedback}
                isTrackingLost={isTrackingLost}
                autostart={autostart}
                isFocusMode={isFocusMode}
                onToggleFocus={onToggleFocus}
                onOpenObjectLab={onOpenObjectLab}
              />
            </div>
            <div className="lg:col-span-3">
              <LiveIntelligenceFeed
                suggestions={intelligenceState.activeSuggestions}
                recentTools={[]}
                pendingPermission={intelligenceState.pendingPermission}
                onApprovePermission={onApprovePermission}
                onDenyPermission={onDenyPermission}
                onOpenPermissions={onOpenPermissions}
              />
            </div>
          </div>

          {/* Middle Row: Active Agents (~50%), Mission Timeline (~25%), Quick Commands (~25%) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-start">
            <div className="lg:col-span-6">
              <ActiveAgentsPanel
                isVoiceActive={isVoiceActive}
                isCameraActive={isCameraActive}
                hasProviderKey={true}
              />
            </div>
            <div className="lg:col-span-3">
              <MissionTimeline
                latestPlan={intelligenceState.latestPlan}
                onOpenPlan={onOpenBrain}
                onOpenTasks={onOpenTasks}
              />
            </div>
            <div className="lg:col-span-3">
              <QuickCommandsPanel
                onOpenObjectLab={onOpenObjectLab}
                onOpenTasks={onOpenTasks}
                onOpenVoiceConsole={onOpenVoiceConsole}
                onOpenBrain={onOpenBrain}
                onTriggerRescan={onTriggerRescan}
              />
            </div>
          </div>

          {/* Bottom Row: System Monitor (~25%), Memory Insights (~25%), LLM Status (~50%) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-start pb-4">
            <div className="lg:col-span-3">
              <SystemMonitorPanel fps={fps} />
            </div>
            <div className="lg:col-span-3">
              <MemoryInsightsPanel memoryCount={memoryCount} onOpenMemory={onOpenMemory} />
            </div>
            <div className="lg:col-span-6">
              <LLMStatusPanel
                provider={intelligenceState.lastProviderUsed}
                hasApiKey={true}
                onOpenAIConfig={onOpenAIConfig}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Command Dock */}
      <VoiceCommandDock
        isVoiceActive={isVoiceActive}
        onToggleVoice={onToggleVoice}
        onSendCommand={onSendCommand}
        isProcessing={false}
        onOpenVoiceConsole={onOpenVoiceConsole}
      />
    </div>
  );
};
