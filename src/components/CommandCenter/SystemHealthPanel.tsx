import React, { useEffect, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  RefreshCw,
  Shield,
  FolderOpen,
  Trash2,
  Sliders
} from 'lucide-react';
import {
  HealthCheckStatus,
  SystemHealthSnapshot,
  systemHealthService
} from '../../services/systemHealthService';
import {
  ALL_CAPABILITY_IDS,
  PERMISSION_CAPABILITY_METADATA,
  permissionPolicy
} from '../../services/permissionPolicy';
import { PermissionGrantDecision } from '../../types/assistant';
import { audioService } from '../../services/soundFx';

interface SystemHealthPanelProps {
  hasActiveSceneManager: boolean;
  onOpenSetupWizard?: () => void;
  onOpenPermissions?: () => void;
  onClose?: () => void;
}

const STATUS_BADGE_MAP: Record<
  HealthCheckStatus,
  { label: string; badgeClass: string; icon: React.ReactNode }
> = {
  AVAILABLE: {
    label: 'AVAILABLE',
    badgeClass: 'border-emerald-500/40 bg-emerald-950/50 text-emerald-300',
    icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
  },
  UNAVAILABLE: {
    label: 'UNAVAILABLE',
    badgeClass: 'border-rose-500/40 bg-rose-950/50 text-rose-300',
    icon: <XCircle className="w-3.5 h-3.5 text-rose-400" />
  },
  UNSUPPORTED: {
    label: 'UNSUPPORTED',
    badgeClass: 'border-amber-500/40 bg-amber-950/50 text-amber-300',
    icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
  },
  UNTESTED: {
    label: 'UNTESTED',
    badgeClass: 'border-cyan-500/40 bg-cyan-950/50 text-cyan-300',
    icon: <HelpCircle className="w-3.5 h-3.5 text-cyan-400" />
  }
};

export const SystemHealthPanel: React.FC<SystemHealthPanelProps> = ({
  hasActiveSceneManager,
  onOpenSetupWizard,
  onOpenPermissions,
  onClose
}) => {
  const [health, setHealth] = useState<SystemHealthSnapshot>(() => systemHealthService.getSnapshot());
  const [policyTick, setPolicyTick] = useState(0);

  useEffect(() => {
    const unsubHealth = systemHealthService.subscribe(() => {
      setHealth(systemHealthService.getSnapshot());
    });
    const unsubPolicy = permissionPolicy.subscribe(() => {
      setPolicyTick((n) => n + 1);
    });
    void systemHealthService.probeAll({ hasActiveSceneManager, probeBackend: true });
    return () => {
      unsubHealth();
      unsubPolicy();
    };
  }, [hasActiveSceneManager]);

  const handleReprobe = () => {
    audioService.playChirp(1350);
    void systemHealthService.probeAll({ hasActiveSceneManager, probeBackend: true });
  };

  const approvedFolders = permissionPolicy.getApprovedFolders();
  void policyTick;

  return (
    <div className="bg-[#040b16] border border-cyan-500/30 rounded-xl p-4 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/20 pb-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-cyan-500/15 border border-cyan-400/40 flex items-center justify-center text-cyan-300">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-orbitron text-sm font-bold tracking-wider text-white">
              SYSTEM HEALTH & DIAGNOSTICS
            </h2>
            <p className="text-[11px] text-cyan-300/75 font-mono">
              Live Runtime Capabilities • Honest Hardware & Backend Reporting • Unified Permissions
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`px-2.5 py-1 rounded border text-[10px] font-mono font-bold ${
              health.overallStatus === 'READY'
                ? 'border-emerald-500/45 bg-emerald-950/40 text-emerald-300'
                : health.overallStatus === 'DEGRADED'
                ? 'border-amber-500/45 bg-amber-950/40 text-amber-300'
                : 'border-cyan-500/45 bg-cyan-950/40 text-cyan-300'
            }`}
          >
            OVERALL: {health.overallStatus}
          </span>
          <button
            type="button"
            onClick={handleReprobe}
            disabled={health.probing}
            aria-label="Re-probe All Subsystems"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cyan-400/60 bg-cyan-500/20 hover:bg-cyan-500/30 text-xs text-white font-orbitron disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${health.probing ? 'animate-spin' : ''}`} />
            {health.probing ? 'Probing...' : 'Run Probe'}
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cyan-500/30 bg-cyan-950/30 hover:bg-cyan-500/20 text-xs text-cyan-200 font-orbitron"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Command Center
            </button>
          )}
        </div>
      </div>

      {/* Subsystem Probe Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {health.subsystems.map((sub) => {
          const meta = STATUS_BADGE_MAP[sub.status];
          return (
            <div
              key={sub.id}
              data-testid={`health-card-${sub.id}`}
              className="p-3 rounded-lg border border-cyan-500/25 bg-[#02060c] flex flex-col justify-between space-y-2"
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-orbitron font-bold text-[11px] text-white truncate">
                    {sub.label}
                  </span>
                  {meta.icon}
                </div>
                <div className="text-xs font-mono text-cyan-100">{sub.summary}</div>
                <div className="text-[10px] font-mono text-cyan-400/75 leading-snug">{sub.detail}</div>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-cyan-500/15">
                <span className={`px-1.5 py-0.5 rounded border text-[9px] font-mono font-bold ${meta.badgeClass}`}>
                  {meta.label}
                </span>
                <span className="text-[9px] font-mono text-cyan-500/70 tabular-nums">
                  {sub.checkedAt ? new Date(sub.checkedAt).toLocaleTimeString() : 'Pending'}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Unified Permission Review & Revocation Section */}
      <div className="p-3.5 rounded-xl border border-cyan-500/25 bg-[#02060c] space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cyan-500/20 pb-2">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-cyan-400" />
            <span className="font-orbitron font-bold text-xs text-white tracking-wider">
              UNIFIED PERMISSION POLICY & QUICK REVOCATION
            </span>
          </div>
          <div className="flex items-center gap-2">
            {onOpenSetupWizard && (
              <button
                type="button"
                onClick={() => {
                  audioService.playChirp(1300);
                  onOpenSetupWizard();
                }}
                className="flex items-center gap-1 px-2.5 py-1 rounded border border-cyan-500/40 bg-cyan-950/40 hover:bg-cyan-500/20 text-[10px] font-orbitron text-cyan-200"
              >
                <Sliders className="w-3 h-3" />
                SETUP WIZARD
              </button>
            )}
            {onOpenPermissions && (
              <button
                type="button"
                onClick={() => {
                  audioService.playChirp(1300);
                  onOpenPermissions();
                }}
                className="px-2.5 py-1 rounded border border-cyan-400/50 bg-cyan-500/20 hover:bg-cyan-500/30 text-[10px] font-orbitron text-white"
              >
                AUDIT LOG & REQUESTS
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {ALL_CAPABILITY_IDS.map((capId) => {
            const meta = PERMISSION_CAPABILITY_METADATA[capId];
            const decision = permissionPolicy.getCapabilityDecision(capId);
            const setDecision = (next: PermissionGrantDecision) => {
              audioService.playChirp(1200);
              permissionPolicy.setCapabilityDecision(capId, next);
              void systemHealthService.probeAll({ hasActiveSceneManager, probeBackend: false });
            };
            return (
              <div
                key={capId}
                className="p-2.5 rounded-lg border border-cyan-500/20 bg-black/50 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-orbitron font-bold text-[10px] text-white truncate">
                    {meta.name}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[9px] font-mono border ${
                      decision === 'GRANTED'
                        ? 'border-emerald-500/40 text-emerald-300 bg-emerald-950/40'
                        : decision === 'DENIED'
                        ? 'border-rose-500/40 text-rose-300 bg-rose-950/40'
                        : 'border-amber-500/40 text-amber-300 bg-amber-950/40'
                    }`}
                  >
                    {decision}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setDecision('GRANTED')}
                    aria-label={`Allow ${meta.name}`}
                    className={`flex-1 py-1 rounded text-[10px] font-mono border transition-colors ${
                      decision === 'GRANTED'
                        ? 'border-emerald-400 bg-emerald-900/50 text-white font-bold'
                        : 'border-cyan-500/25 text-cyan-300 hover:border-emerald-400/50'
                    }`}
                  >
                    Allow
                  </button>
                  <button
                    type="button"
                    onClick={() => setDecision('DENIED')}
                    aria-label={`Deny ${meta.name}`}
                    className={`flex-1 py-1 rounded text-[10px] font-mono border transition-colors ${
                      decision === 'DENIED'
                        ? 'border-rose-400 bg-rose-900/50 text-white font-bold'
                        : 'border-cyan-500/25 text-cyan-300 hover:border-rose-400/50'
                    }`}
                  >
                    Deny
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Approved Folders */}
        <div className="pt-2 border-t border-cyan-500/15 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] font-orbitron text-cyan-300">
            <FolderOpen className="w-3.5 h-3.5" />
            <span>APPROVED WORKSPACE FOLDERS ({approvedFolders.length})</span>
          </div>
          {approvedFolders.length === 0 ? (
            <div className="text-[11px] font-mono text-cyan-400/65">
              No workspace folders permanently approved yet. Select folders explicitly inside Desktop Control or Dev Studio.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {approvedFolders.map((folder) => (
                <div
                  key={folder.path}
                  className="inline-flex items-center gap-2 px-2.5 py-1 rounded border border-cyan-500/30 bg-black/60 text-[11px] font-mono text-cyan-100"
                >
                  <span className="truncate max-w-[240px]" title={folder.path}>
                    {folder.name} ({folder.path})
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      audioService.playChirp(900);
                      void permissionPolicy.revokeApprovedFolder(folder.path);
                    }}
                    aria-label={`Revoke folder ${folder.name}`}
                    className="text-rose-300 hover:text-rose-200"
                    title="Revoke folder access"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
