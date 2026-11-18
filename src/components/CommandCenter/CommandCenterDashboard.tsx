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
import { OpticalGesturePanel } from './OpticalGesturePanel';
import { CustomGestureStudioPanel } from './CustomGestureStudioPanel';
import { DesktopSuperpowersPanel } from './DesktopSuperpowersPanel';
import { DevStudioPanel } from './DevStudioPanel';
import { SystemHealthPanel } from './SystemHealthPanel';
import { VoiceCommandDock } from './VoiceCommandDock';
import { ErrorBoundary } from '../ErrorBoundary';
import { HologramSceneManager } from '../../three/HologramScene';
import {
  CameraControlMode,
  ComponentLabel2D,
  HologramModelId,
  HologramVisualSettings,
  LaserTargetInfo
} from '../../types/hologram';
import { GestureDetectionResult } from '../../types/gesture';
import { CameraPermissionStatus } from '../../services/handTracking';
import { VoiceLifecycleState } from '../../services/speechService';
import { IntelligenceStateSnapshot } from '../../services/intelligenceEngine';
import { planningEngine } from '../../services/planningEngine';
import { ToolActivityRecord } from '../../types/assistant';

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
  cameraError: string | null;
  cameraPermissionStatus: CameraPermissionStatus;
  gestureResult: GestureDetectionResult | null;
  mirrorX: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onToggleCamera: () => void;
  onOpenGestureDrawer: () => void;
  isVoiceActive: boolean;
  voiceLifecycleState?: VoiceLifecycleState;
  onToggleVoice: () => void;
  intelligenceState: IntelligenceStateSnapshot;
  recentTools: ToolActivityRecord[];
  isProcessingCommand?: boolean;
  hasProviderKey?: boolean;
  overallHealth?: 'READY' | 'DEGRADED' | 'LIMITED';
  onCancelRequest?: () => void;
  onSendCommand: (text: string) => void;
  onApprovePermission: (permId: string) => void;
  onDenyPermission: (permId: string) => void;
  onCancelPermission: (permId: string) => void;
  onOpenAIConfig: () => void;
  onOpenObjectLab: () => void;
  onOpenTasks: () => void;
  onOpenVoiceConsole: () => void;
  onOpenBrain: () => void;
  onOpenPermissions: () => void;
  onOpenMemory: () => void;
  onOpenSetupWizard?: () => void;
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
  cameraError,
  cameraPermissionStatus,
  gestureResult,
  mirrorX,
  videoRef,
  onToggleCamera,
  onOpenGestureDrawer,
  isVoiceActive,
  voiceLifecycleState = isVoiceActive ? 'LISTENING' : 'IDLE',
  onToggleVoice,
  intelligenceState,
  recentTools,
  isProcessingCommand = false,
  hasProviderKey = false,
  overallHealth = 'READY',
  onCancelRequest,
  onSendCommand,
  onApprovePermission,
  onDenyPermission,
  onCancelPermission,
  onOpenAIConfig,
  onOpenObjectLab,
  onOpenTasks,
  onOpenVoiceConsole,
  onOpenBrain,
  onOpenPermissions,
  onOpenMemory,
  onOpenSetupWizard,
  onTriggerRescan,
  memoryCount,
  isFocusMode,
  onToggleFocus
}) => {
  const [activeNav, setActiveNav] = useState<CommandCenterNavId>('DASHBOARD');
  const [searchQuery, setSearchQuery] = useState('');

  const handleNavSelect = (nav: CommandCenterNavId) => {
    setActiveNav(nav);
    if (nav === 'OPTICAL') onOpenGestureDrawer();
    else if (nav === 'AI_CORE') onOpenBrain();
    else if (nav === 'AGENTS' || nav === 'TASKS' || nav === 'CALENDAR') onOpenTasks();
    else if (nav === 'WORKFLOWS' || nav === 'DESKTOP') setActiveNav('DESKTOP');
    else if (nav === 'DEV_STUDIO') setActiveNav('DEV_STUDIO');
    else if (nav === 'SYSTEM_HEALTH') setActiveNav('SYSTEM_HEALTH');
    else if (nav === 'MEMORY') onOpenMemory();
    else if (nav === 'CONVERSATIONS' || nav === 'KNOWLEDGE') onOpenBrain();
    else if (nav === 'TOOLS' || nav === 'PERMISSIONS') onOpenPermissions();
    else if (nav === 'FOCUS') onToggleFocus();
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#02060c] font-mono text-cyan-400 select-none flex flex-col">
      {/* Top Header */}
      <SystemHeader
        fps={fps}
        intelligenceStatus={intelligenceState.status}
        overallHealth={overallHealth}
        pendingPermissionCount={intelligenceState.pendingPermission ? 1 : 0}
        onOpenAIConfig={onOpenAIConfig}
        onOpenPermissions={onOpenPermissions}
        onOpenHealth={() => setActiveNav('SYSTEM_HEALTH')}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      {/* Main Body Layout: Sidebar + Structured Dashboard Grid */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Sidebar */}
        <CommandSidebar
          activeNav={activeNav}
          onSelectNav={handleNavSelect}
          isCameraActive={isCameraActive}
          onToggleCamera={onToggleCamera}
          isVoiceActive={isVoiceActive}
          isFocusMode={isFocusMode}
          onToggleVoice={onToggleVoice}
          onToggleFocus={onToggleFocus}
          pendingPermissionCount={intelligenceState.pendingPermission ? 1 : 0}
        />

        {/* Structured Dashboard Grid Viewport */}
        <main className="flex-1 overflow-y-auto p-3.5 bg-[#02060c] space-y-3.5 no-scrollbar">
          {activeNav === 'DESKTOP' ? (
            <ErrorBoundary name="Desktop Control" onNavigateHome={() => setActiveNav('DASHBOARD')}>
              <DesktopSuperpowersPanel
                onApprovePermission={onApprovePermission}
                onDenyPermission={onDenyPermission}
                onCancelPermission={onCancelPermission}
                pendingPermission={intelligenceState.pendingPermission}
                recentTools={recentTools}
                onClose={() => setActiveNav('DASHBOARD')}
              />
            </ErrorBoundary>
          ) : activeNav === 'DEV_STUDIO' ? (
            <ErrorBoundary name="AI Development Studio" onNavigateHome={() => setActiveNav('DASHBOARD')}>
              <DevStudioPanel
                pendingPermission={intelligenceState.pendingPermission}
                onApprovePermission={onApprovePermission}
                onDenyPermission={onDenyPermission}
                onCancelPermission={onCancelPermission}
                onClose={() => setActiveNav('DASHBOARD')}
              />
            </ErrorBoundary>
          ) : activeNav === 'SYSTEM_HEALTH' ? (
            <ErrorBoundary name="System Health" onNavigateHome={() => setActiveNav('DASHBOARD')}>
              <SystemHealthPanel
                hasActiveSceneManager={Boolean(sceneManagerRef.current)}
                onOpenSetupWizard={onOpenSetupWizard}
                onOpenPermissions={onOpenPermissions}
                onClose={() => setActiveNav('DASHBOARD')}
              />
            </ErrorBoundary>
          ) : (
            <>
              {/* Top Row: AI Core + Optical/Gesture (~25%), Holographic Core Panel (~50%), Live Intelligence Feed (~25%) */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-start">
                <div className="lg:col-span-3 space-y-3.5">
                  <AICoreOverview
                    intelligenceStatus={intelligenceState.status}
                    memoryCount={memoryCount}
                    isVoiceActive={isVoiceActive}
                    isCameraActive={isCameraActive}
                    provider={intelligenceState.lastProviderUsed}
                    hasApiKey={hasProviderKey}
                    onOpenAIConfig={onOpenAIConfig}
                    onOpenMemory={onOpenMemory}
                    onToggleCamera={onToggleCamera}
                  />
                  <OpticalGesturePanel
                    isCameraActive={isCameraActive}
                    cameraError={cameraError}
                    cameraPermissionStatus={cameraPermissionStatus}
                    gestureResult={gestureResult}
                    mirrorX={mirrorX}
                    videoRef={videoRef}
                    onToggleCamera={onToggleCamera}
                    onOpenGestureDrawer={onOpenGestureDrawer}
                  />
                  <ErrorBoundary name="Custom Gesture Studio" compact>
                    <CustomGestureStudioPanel
                      gestureResult={gestureResult}
                      onActionTriggered={(actionId) => {
                        if (actionId === 'NEXT_MODEL') onModelChange(sceneManagerRef.current?.nextModel() || currentModelId);
                        else if (actionId === 'PREV_MODEL') onModelChange(sceneManagerRef.current?.prevModel() || currentModelId);
                        else if (actionId === 'TRIGGER_SHOCKWAVE') sceneManagerRef.current?.triggerShockwave();
                        else if (actionId === 'RESET_CAMERA') sceneManagerRef.current?.resetCamera();
                      }}
                    />
                  </ErrorBoundary>
                </div>
                <div className="lg:col-span-6">
                  <ErrorBoundary name="Holographic 3D Viewport">
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
                  </ErrorBoundary>
                </div>
                <div className="lg:col-span-3">
                  <LiveIntelligenceFeed
                    suggestions={intelligenceState.activeSuggestions}
                    recentTools={recentTools}
                    pendingPermission={intelligenceState.pendingPermission}
                    onApprovePermission={onApprovePermission}
                    onDenyPermission={onDenyPermission}
                    onCancelPermission={onCancelPermission}
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
                    hasProviderKey={hasProviderKey}
                    intelligenceStatus={intelligenceState.status}
                    activeAgentRun={intelligenceState.activeAgentRun}
                  />
                </div>
                <div className="lg:col-span-3">
                  <MissionTimeline
                    latestPlan={intelligenceState.latestPlan}
                    onOpenPlan={onOpenBrain}
                    onOpenTasks={onOpenTasks}
                    onCancelPlan={(planId) => {
                      planningEngine.cancelPlan(planId);
                    }}
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
                    hasApiKey={hasProviderKey}
                    onOpenAIConfig={onOpenAIConfig}
                  />
                </div>
              </div>
            </>
          )}
        </main>
      </div>

      {/* Bottom Command Dock */}
      <VoiceCommandDock
        isVoiceActive={isVoiceActive}
        voiceLifecycleState={voiceLifecycleState}
        onToggleVoice={onToggleVoice}
        onSendCommand={onSendCommand}
        isProcessing={isProcessingCommand}
        onCancelRequest={onCancelRequest}
        onOpenVoiceConsole={onOpenVoiceConsole}
      />
    </div>
  );
};
