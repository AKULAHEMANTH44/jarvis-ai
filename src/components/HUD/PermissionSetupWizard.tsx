import React, { useEffect, useState } from 'react';
import {
  ALL_CAPABILITY_IDS,
  PERMISSION_CAPABILITY_METADATA,
  permissionPolicy
} from '../../services/permissionPolicy';
import { ApprovedAppInfo, desktopBridge } from '../../services/desktopBridge';
import {
  ApprovedFolderEntry,
  PermissionCapabilityId,
  PermissionDisplayState,
  PermissionGrantDecision
} from '../../types/assistant';
import { audioService } from '../../services/soundFx';
import {
  AppWindow,
  Camera,
  Check,
  FolderOpen,
  Globe,
  Mic,
  Music,
  RefreshCw,
  Shield,
  ShieldAlert,
  Trash2,
  X
} from 'lucide-react';

interface PermissionSetupWizardProps {
  isOpen: boolean;
  isFirstRun: boolean;
  onClose: () => void;
  onCompleted?: () => void;
}

const CAPABILITY_ICONS: Record<PermissionCapabilityId, React.ReactNode> = {
  APPLICATION_ACCESS: <AppWindow className="w-4 h-4 text-cyan-300 shrink-0" />,
  BROWSER_ACCESS: <Globe className="w-4 h-4 text-cyan-300 shrink-0" />,
  FOLDER_ACCESS: <FolderOpen className="w-4 h-4 text-cyan-300 shrink-0" />,
  MUSIC_ACCESS: <Music className="w-4 h-4 text-cyan-300 shrink-0" />,
  CAMERA_ACCESS: <Camera className="w-4 h-4 text-cyan-300 shrink-0" />,
  MICROPHONE_ACCESS: <Mic className="w-4 h-4 text-cyan-300 shrink-0" />
};

function formatDisplayStateLabel(state: PermissionDisplayState): {
  text: string;
  colorClass: string;
} {
  switch (state) {
    case 'GRANTED_BY_USER':
      return { text: 'Granted by user', colorClass: 'text-emerald-300' };
    case 'DENIED_BY_USER':
      return { text: 'Denied by user', colorClass: 'text-red-300' };
    case 'BLOCKED_BY_OS_OR_BROWSER':
      return { text: 'Blocked by OS / Browser', colorClass: 'text-amber-300' };
    case 'TEMPORARILY_UNAVAILABLE':
      return { text: 'Temporarily unavailable', colorClass: 'text-amber-200' };
    default:
      return { text: 'Not yet requested', colorClass: 'text-cyan-300/80' };
  }
}

export const PermissionSetupWizard: React.FC<PermissionSetupWizardProps> = ({
  isOpen,
  isFirstRun,
  onClose,
  onCompleted
}) => {
  const [draftCapabilities, setDraftCapabilities] = useState<
    Record<PermissionCapabilityId, PermissionGrantDecision>
  >(() => {
    const cfg = permissionPolicy.getConfig();
    return {
      APPLICATION_ACCESS: cfg.capabilities.APPLICATION_ACCESS.decision,
      BROWSER_ACCESS: cfg.capabilities.BROWSER_ACCESS.decision,
      FOLDER_ACCESS: cfg.capabilities.FOLDER_ACCESS.decision,
      MUSIC_ACCESS: cfg.capabilities.MUSIC_ACCESS.decision,
      CAMERA_ACCESS: cfg.capabilities.CAMERA_ACCESS.decision,
      MICROPHONE_ACCESS: cfg.capabilities.MICROPHONE_ACCESS.decision
    };
  });
  const [draftAppIds, setDraftAppIds] = useState<Record<string, boolean>>(
    () => permissionPolicy.getConfig().allowedAppIds
  );
  const [draftFolders, setDraftFolders] = useState<ApprovedFolderEntry[]>(
    () => permissionPolicy.getConfig().approvedFolders
  );
  const [approvedApps, setApprovedApps] = useState<ApprovedAppInfo[]>([]);
  const [manualFolderPath, setManualFolderPath] = useState('');
  const [folderNotice, setFolderNotice] = useState<string | null>(null);
  const [showManualFolderInput, setShowManualFolderInput] = useState(false);
  const [hwRefreshTick, setHwRefreshTick] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    const cfg = permissionPolicy.getConfig();
    setDraftCapabilities({
      APPLICATION_ACCESS: cfg.capabilities.APPLICATION_ACCESS.decision,
      BROWSER_ACCESS: cfg.capabilities.BROWSER_ACCESS.decision,
      FOLDER_ACCESS: cfg.capabilities.FOLDER_ACCESS.decision,
      MUSIC_ACCESS: cfg.capabilities.MUSIC_ACCESS.decision,
      CAMERA_ACCESS: cfg.capabilities.CAMERA_ACCESS.decision,
      MICROPHONE_ACCESS: cfg.capabilities.MICROPHONE_ACCESS.decision
    });
    setDraftAppIds({ ...cfg.allowedAppIds });
    setDraftFolders(cfg.approvedFolders.map((f) => ({ ...f })));
    setFolderNotice(null);

    void desktopBridge.getApprovedApplications().then((apps) => {
      setApprovedApps(apps);
    });
    void permissionPolicy.refreshHardwarePermissionStates().then(() => {
      setHwRefreshTick((n) => n + 1);
    });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const unsub = permissionPolicy.subscribe(() => {
      setHwRefreshTick((n) => n + 1);
    });
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isFirstRun) {
          permissionPolicy.completeSetupDeferred();
        }
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      unsub();
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, isFirstRun, onClose]);

  if (!isOpen) return null;

  const setCapabilityChoice = (id: PermissionCapabilityId, decision: PermissionGrantDecision) => {
    audioService.playChirp(decision === 'GRANTED' ? 1400 : decision === 'DENIED' ? 880 : 1100);
    setDraftCapabilities((prev) => ({ ...prev, [id]: decision }));
  };

  const handleApplyRecommendedSafeDefaults = () => {
    audioService.playChirp(1450);
    setDraftCapabilities((prev) => ({
      ...prev,
      APPLICATION_ACCESS: 'GRANTED',
      BROWSER_ACCESS: 'GRANTED',
      MUSIC_ACCESS: 'GRANTED'
    }));
  };

  const handlePickFolder = async () => {
    setFolderNotice(null);
    const res = await desktopBridge.pickFolder();
    if (res.cancelled) return;
    if (res.folder) {
      const picked = res.folder;
      setDraftFolders((prev) =>
        prev.some((f) => f.path === picked.path)
          ? prev
          : [...prev, { path: picked.path, name: picked.name, grantedAt: Date.now() }]
      );
      setDraftCapabilities((prev) => ({
        ...prev,
        FOLDER_ACCESS: prev.FOLDER_ACCESS === 'NOT_REQUESTED' ? 'GRANTED' : prev.FOLDER_ACCESS
      }));
      return;
    }
    if (res.error) {
      setFolderNotice(res.error);
      setShowManualFolderInput(true);
    }
  };

  const handleAddManualFolder = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = manualFolderPath.trim();
    if (!cleaned) return;
    if (/(^|[\\/])\.\.([\\/]|$)|%2e%2e/i.test(cleaned) || cleaned.includes('\0')) {
      setFolderNotice('Relative traversal segments (..) are blocked for security.');
      return;
    }
    const inferredName = cleaned.split(/[\\/]/).filter(Boolean).pop() || cleaned;
    setDraftFolders((prev) =>
      prev.some((f) => f.path === cleaned)
        ? prev
        : [...prev, { path: cleaned, name: inferredName, grantedAt: Date.now() }]
    );
    setDraftCapabilities((prev) => ({
      ...prev,
      FOLDER_ACCESS: prev.FOLDER_ACCESS === 'NOT_REQUESTED' ? 'GRANTED' : prev.FOLDER_ACCESS
    }));
    setManualFolderPath('');
    setFolderNotice(null);
  };

  const handleSave = () => {
    audioService.playChirp(1500);
    permissionPolicy.applySetupSelections({
      capabilities: draftCapabilities,
      allowedAppIds: draftAppIds,
      approvedFolders: draftFolders
    });
    for (const f of draftFolders) {
      desktopBridge.registerApprovedPath(f.path);
    }
    onCompleted?.();
    onClose();
  };

  const handleSkip = () => {
    audioService.playChirp(1000);
    if (isFirstRun) {
      permissionPolicy.completeSetupDeferred();
    }
    onClose();
  };

  // Trigger recompute on hardware state refresh
  void hwRefreshTick;
  const camDisplay = formatDisplayStateLabel(permissionPolicy.getDisplayState('CAMERA_ACCESS'));
  const micDisplay = formatDisplayStateLabel(permissionPolicy.getDisplayState('MICROPHONE_ACCESS'));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="permission-wizard-title"
      data-testid="permission-setup-wizard"
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-mono text-cyan-100"
    >
      <div className="w-full max-w-4xl max-h-[88vh] flex flex-col rounded-xl bg-[#020914] border border-cyan-500/45 shadow-[0_0_48px_rgba(0,240,255,0.22)] overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-cyan-500/25 bg-black/50 shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            <div className="p-2 rounded-lg border border-cyan-400/45 bg-cyan-950/50 text-cyan-300 shrink-0">
              <Shield className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2
                id="permission-wizard-title"
                className="font-orbitron font-bold text-sm tracking-[0.14em] text-white"
              >
                JARVIS PERMISSION SETUP WIZARD
              </h2>
              <p className="text-[11px] text-cyan-300/85 mt-0.5 leading-relaxed">
                Configure persistent permissions once, or keep individual capabilities set to Ask Every Time.
                You can modify or revoke any permission later in the Permissions panel.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSkip}
            aria-label="Close Permission Setup Wizard"
            className="p-1.5 rounded border border-cyan-500/30 hover:border-cyan-400 text-cyan-300 hover:text-white shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Security Tier Summary Strip */}
        <div className="px-5 py-2.5 border-b border-cyan-500/20 bg-cyan-950/20 flex flex-wrap items-center justify-between gap-2 text-[10.5px] shrink-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-cyan-200/90">
            <span>
              <strong className="text-emerald-300 font-semibold">Level 1</strong> Pre-Approved (Apps, Search, Music, Saved Folders)
            </span>
            <span aria-hidden="true" className="text-cyan-500/50">|</span>
            <span>
              <strong className="text-cyan-300 font-semibold">Level 2</strong> Session Confirm (Newly picked folders)
            </span>
            <span aria-hidden="true" className="text-cyan-500/50">|</span>
            <span>
              <strong className="text-amber-300 font-semibold">Level 3</strong> Always Confirm Once (Delete, Write, Settings)
            </span>
          </div>

          <button
            type="button"
            data-testid="wizard-recommended-btn"
            onClick={handleApplyRecommendedSafeDefaults}
            className="px-2.5 py-1 rounded border border-cyan-400/55 bg-cyan-500/15 hover:bg-cyan-500/30 text-white text-[10px] font-orbitron whitespace-nowrap shrink-0"
          >
            Allow Recommended Safe Defaults
          </button>
        </div>

        {/* Scrollable Capability List */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {ALL_CAPABILITY_IDS.map((capId) => {
            const meta = PERMISSION_CAPABILITY_METADATA[capId];
            const choice = draftCapabilities[capId];

            return (
              <div
                key={capId}
                data-testid={`wizard-capability-${capId}`}
                className="p-3.5 rounded-lg border border-cyan-500/30 bg-black/45 space-y-2.5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                    <div className="mt-0.5">{CAPABILITY_ICONS[capId]}</div>
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-orbitron font-bold text-xs text-white">
                          {meta.name}
                        </span>
                        {capId === 'CAMERA_ACCESS' && (
                          <span className={`text-[10px] ${camDisplay.colorClass}`}>
                            OS Status: {camDisplay.text}
                          </span>
                        )}
                        {capId === 'MICROPHONE_ACCESS' && (
                          <span className={`text-[10px] ${micDisplay.colorClass}`}>
                            OS Status: {micDisplay.text}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-cyan-200/85 leading-snug">{meta.description}</p>
                      <p className="text-[10px] text-cyan-400/75">{meta.levelSummary}</p>
                    </div>
                  </div>

                  {/* Decision Toggle Group */}
                  <div className="flex items-center gap-1 shrink-0" role="group" aria-label={`${meta.name} permission choice`}>
                    <button
                      type="button"
                      data-testid={`wizard-${capId}-allow`}
                      onClick={() => setCapabilityChoice(capId, 'GRANTED')}
                      className={`px-2.5 py-1 rounded border text-[10px] font-orbitron whitespace-nowrap transition-colors ${
                        choice === 'GRANTED'
                          ? 'border-emerald-400 bg-emerald-950/75 text-emerald-100 font-bold'
                          : 'border-cyan-500/30 bg-black/40 text-cyan-300 hover:text-white'
                      }`}
                    >
                      Allow
                    </button>
                    <button
                      type="button"
                      data-testid={`wizard-${capId}-ask`}
                      onClick={() => setCapabilityChoice(capId, 'NOT_REQUESTED')}
                      className={`px-2.5 py-1 rounded border text-[10px] font-orbitron whitespace-nowrap transition-colors ${
                        choice === 'NOT_REQUESTED'
                          ? 'border-cyan-400 bg-cyan-950/70 text-white font-bold'
                          : 'border-cyan-500/30 bg-black/40 text-cyan-300 hover:text-white'
                      }`}
                    >
                      Ask Every Time
                    </button>
                    <button
                      type="button"
                      data-testid={`wizard-${capId}-deny`}
                      onClick={() => setCapabilityChoice(capId, 'DENIED')}
                      className={`px-2.5 py-1 rounded border text-[10px] font-orbitron whitespace-nowrap transition-colors ${
                        choice === 'DENIED'
                          ? 'border-red-400 bg-red-950/75 text-red-100 font-bold'
                          : 'border-cyan-500/30 bg-black/40 text-cyan-300 hover:text-white'
                      }`}
                    >
                      Deny
                    </button>
                  </div>
                </div>

                {/* Per-App Allowlist Sub-controls */}
                {capId === 'APPLICATION_ACCESS' && approvedApps.length > 0 && (
                  <div className="pt-2 border-t border-cyan-500/20 space-y-1.5">
                    <div className="text-[10px] text-cyan-300/85">
                      Individual Application Allowlist ({Object.values(draftAppIds).filter(Boolean).length} enabled):
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {approvedApps.map((app) => {
                        const isAppEnabled = draftAppIds[app.id] !== false;
                        return (
                          <button
                            key={app.id}
                            type="button"
                            data-testid={`wizard-app-${app.id}`}
                            onClick={() => {
                              audioService.playChirp(isAppEnabled ? 920 : 1320);
                              setDraftAppIds((prev) => ({
                                ...prev,
                                [app.id]: !isAppEnabled
                              }));
                            }}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-[10px] whitespace-nowrap transition-colors ${
                              isAppEnabled
                                ? 'border-emerald-400/60 bg-emerald-950/45 text-emerald-100'
                                : 'border-red-400/40 bg-red-950/30 text-red-200/80'
                            }`}
                          >
                            {isAppEnabled ? (
                              <Check className="w-3 h-3 shrink-0" />
                            ) : (
                              <X className="w-3 h-3 shrink-0" />
                            )}
                            <span>{app.displayName}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Approved Folders Sub-controls */}
                {capId === 'FOLDER_ACCESS' && (
                  <div className="pt-2 border-t border-cyan-500/20 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[10px] text-cyan-300/85 tabular-nums">
                        Approved Folder Paths ({draftFolders.length}):
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void handlePickFolder()}
                          className="flex items-center gap-1 px-2.5 py-1 rounded border border-cyan-400/55 bg-cyan-500/15 hover:bg-cyan-500/30 text-white text-[10px] font-orbitron whitespace-nowrap"
                        >
                          <FolderOpen className="w-3 h-3" />
                          <span>Add Folder</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowManualFolderInput((v) => !v)}
                          className="px-2 py-1 rounded border border-cyan-500/35 text-cyan-300 hover:text-white text-[10px] whitespace-nowrap"
                        >
                          {showManualFolderInput ? 'Hide Path Entry' : 'Enter Path'}
                        </button>
                      </div>
                    </div>

                    {folderNotice && (
                      <p className="text-[10px] text-amber-300">{folderNotice}</p>
                    )}

                    {showManualFolderInput && (
                      <form onSubmit={handleAddManualFolder} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={manualFolderPath}
                          onChange={(e) => setManualFolderPath(e.target.value)}
                          placeholder="e.g. C:\\Projects\\jarvis-ai or /home/user/projects"
                          className="flex-1 bg-black/60 border border-cyan-500/40 rounded px-2.5 py-1 text-[10.5px] text-white placeholder-cyan-500/50 focus:outline-none focus:border-cyan-400"
                        />
                        <button
                          type="submit"
                          className="px-2.5 py-1 rounded border border-emerald-400/60 bg-emerald-950/50 text-emerald-100 text-[10px] font-orbitron whitespace-nowrap"
                        >
                          Stage Folder
                        </button>
                      </form>
                    )}

                    {draftFolders.length === 0 ? (
                      <p className="text-[10px] text-cyan-400/75">
                        No persistent folders selected yet.
                      </p>
                    ) : (
                      <div className="space-y-1">
                        {draftFolders.map((folder) => (
                          <div
                            key={folder.path}
                            className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded border border-cyan-500/25 bg-black/50 text-[10px]"
                          >
                            <div className="min-w-0 truncate">
                              <span className="text-white font-semibold">{folder.name}</span>
                              <span className="text-cyan-400/75 ml-2">{folder.path}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                setDraftFolders((prev) =>
                                  prev.filter((item) => item.path !== folder.path)
                                )
                              }
                              className="flex items-center gap-1 px-2 py-0.5 rounded border border-red-400/50 text-red-200 hover:bg-red-950/50 text-[9.5px] whitespace-nowrap shrink-0"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>Revoke</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Hardware OS Refresh Note */}
                {(capId === 'CAMERA_ACCESS' || capId === 'MICROPHONE_ACCESS') && (
                  <div className="pt-1 flex items-center justify-between gap-2 text-[10px] text-cyan-300/80">
                    <span>
                      Note: Enabling inside JARVIS also respects OS and browser hardware permission prompts.
                    </span>
                    <button
                      type="button"
                      onClick={() => void permissionPolicy.refreshHardwarePermissionStates()}
                      className="flex items-center gap-1 px-2 py-0.5 rounded border border-cyan-500/35 hover:border-cyan-400 text-cyan-200 whitespace-nowrap shrink-0"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Refresh OS Status</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {/* Level 3 Protected Actions Notice */}
          <div className="p-3 rounded-lg border border-amber-400/45 bg-amber-950/30 flex items-start gap-2.5 text-[10.5px] text-amber-100">
            <ShieldAlert className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
            <div>
              <div className="font-orbitron font-bold text-amber-200 text-[10px]">
                LEVEL 3 IRREVERSIBLE & SYSTEM-SENSITIVE OPERATIONS
              </div>
              <p className="text-amber-100/90 mt-0.5">
                Deleting objects or files, overwriting files, clearing persistent memory, installing software,
                or changing system settings can never be permanently pre-approved and will always require explicit once-per-action confirmation.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-t border-cyan-500/25 bg-black/60 shrink-0">
          <span className="text-[10px] text-cyan-300/80 tabular-nums">
            {Object.values(draftCapabilities).filter((d) => d === 'GRANTED').length} Allowed
            <span aria-hidden="true"> · </span>
            {Object.values(draftCapabilities).filter((d) => d === 'DENIED').length} Denied
            <span aria-hidden="true"> · </span>
            {Object.values(draftCapabilities).filter((d) => d === 'NOT_REQUESTED').length} Ask Every Time
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="wizard-skip-btn"
              onClick={handleSkip}
              className="px-3.5 py-1.5 rounded border border-cyan-500/40 bg-black/40 hover:border-cyan-400 text-cyan-200 hover:text-white text-[10.5px] font-orbitron whitespace-nowrap"
            >
              Skip (Ask Every Time)
            </button>
            <button
              type="button"
              data-testid="wizard-save-btn"
              onClick={handleSave}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded border border-emerald-400/80 bg-emerald-950/65 hover:bg-emerald-900/75 text-emerald-100 text-[10.5px] font-orbitron font-bold whitespace-nowrap"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Save Permissions</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
