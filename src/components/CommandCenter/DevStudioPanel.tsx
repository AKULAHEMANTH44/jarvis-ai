import React, { useEffect, useState } from 'react';
import {
  Code2,
  FolderTree,
  FileCode2,
  Sparkles,
  Bug,
  GitCompare,
  Terminal,
  FlaskConical,
  BookText,
  ListChecks,
  History,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RotateCcw,
  ShieldCheck,
  Play,
  Square,
  ArrowLeft,
  Lock
} from 'lucide-react';
import {
  AppliedPatchBackup,
  DevAuditEntry,
  DevCommandResult,
  DevCommandTool,
  DevTaskPlan,
  DevToolAvailability,
  PermissionRequest,
  ProjectWorkspaceReport,
  ProposedPatchEntry,
  SourceFileAnalysis
} from '../../types/assistant';
import { desktopBridge } from '../../services/desktopBridge';
import { permissionManager } from '../../services/permissionManager';
import { permissionPolicy } from '../../services/permissionPolicy';
import { DocGeneratorType, ErrorAnalysisReport, devStudioService } from '../../services/devStudioService';
import { devPlannerService } from '../../services/devPlannerService';
import { audioService } from '../../services/soundFx';

export type DevStudioTab =
  | 'WORKSPACE'
  | 'UNDERSTAND'
  | 'GENERATE'
  | 'DEBUG'
  | 'DIFF_REVIEW'
  | 'TERMINAL'
  | 'TESTS'
  | 'DOCS'
  | 'PLANNER'
  | 'AUDIT';

interface DevStudioPanelProps {
  pendingPermission: PermissionRequest | null;
  onApprovePermission: (permId: string) => void;
  onDenyPermission: (permId: string) => void;
  onCancelPermission: (permId: string) => void;
  onClose?: () => void;
}

const ALLOWED_CMD_TOOLS: DevCommandTool[] = ['npm', 'npx', 'node', 'python', 'pytest', 'tsc', 'git'];

export const DevStudioPanel: React.FC<DevStudioPanelProps> = ({
  pendingPermission,
  onApprovePermission,
  onDenyPermission,
  onCancelPermission,
  onClose
}) => {
  const [activeTab, setActiveTab] = useState<DevStudioTab>('WORKSPACE');
  const [approvedFolders, setApprovedFolders] = useState(permissionPolicy.getApprovedFolders());
  const [projectPathInput, setProjectPathInput] = useState(
    devStudioService.getActiveProjectPath() ||
      desktopBridge.getSelectedFolder()?.path ||
      permissionPolicy.getApprovedFolders()[0]?.path ||
      ''
  );
  const [report, setReport] = useState<ProjectWorkspaceReport | null>(devStudioService.getActiveReport());
  const [isInspecting, setIsInspecting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Code Understanding state
  const [selectedSource, setSelectedSource] = useState<SourceFileAnalysis | null>(null);
  const [understandQuestion, setUnderstandQuestion] = useState('Explain the architecture and key entry points.');
  const [understandAnswer, setUnderstandAnswer] = useState<string>('');
  const [useExternalAIExplain, setUseExternalAIExplain] = useState(false);
  const [isAnalyzingCode, setIsAnalyzingCode] = useState(false);

  // Code Generation state
  const [genPrompt, setGenPrompt] = useState('Create a Python calculator with divide-by-zero protection');
  const [genTargetPath, setGenTargetPath] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  // Debug & Error Analysis state
  const [errorInput, setErrorInput] = useState('');
  const [logFileInput, setLogFileInput] = useState('');
  const [errorAnalysis, setErrorAnalysis] = useState<ErrorAnalysisReport | null>(null);
  const [isDebugging, setIsDebugging] = useState(false);

  // Patches & Rollback state
  const [patches, setPatches] = useState<ProposedPatchEntry[]>(devStudioService.getProposedPatches());
  const [backups, setBackups] = useState<AppliedPatchBackup[]>(devStudioService.getBackups());
  const [overwriteConfirmMap, setOverwriteConfirmMap] = useState<Record<string, boolean>>({});
  const [selectedPatchId, setSelectedPatchId] = useState<string | null>(null);

  // Terminal & Command Runner state
  const [devTools, setDevTools] = useState<DevToolAvailability[]>(devStudioService.getDevTools());
  const [cmdTool, setCmdTool] = useState<DevCommandTool>('npm');
  const [cmdArgsInput, setCmdArgsInput] = useState('test');
  const [isRunningCmd, setIsRunningCmd] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [lastCmdResult, setLastCmdResult] = useState<DevCommandResult | null>(null);

  // Docs state
  const [docType, setDocType] = useState<DocGeneratorType>('README');
  const [docDestInput, setDocDestInput] = useState('');

  // Planner state
  const [planObjective, setPlanObjective] = useState('Inspect workspace, generate module tests, and verify');
  const [activePlan, setActivePlan] = useState<DevTaskPlan | null>(devPlannerService.getActivePlan());
  const [planHistory, setPlanHistory] = useState<DevTaskPlan[]>(devPlannerService.getHistory());

  // Audit state
  const [auditEntries, setAuditEntries] = useState<DevAuditEntry[]>(devStudioService.getAuditEntries());

  useEffect(() => {
    const syncStudio = () => {
      setReport(devStudioService.getActiveReport());
      setPatches(devStudioService.getProposedPatches());
      setBackups(devStudioService.getBackups());
      setDevTools(devStudioService.getDevTools());
      setAuditEntries(devStudioService.getAuditEntries());
    };
    const syncPlanner = () => {
      setActivePlan(devPlannerService.getActivePlan());
      setPlanHistory(devPlannerService.getHistory());
    };
    const syncPolicy = () => {
      setApprovedFolders(permissionPolicy.getApprovedFolders());
    };

    const u1 = devStudioService.subscribe(syncStudio);
    const u2 = devPlannerService.subscribe(syncPlanner);
    const u3 = permissionPolicy.subscribe(syncPolicy);

    devStudioService.refreshDevTools().catch(() => {});
    devStudioService.refreshBackups().catch(() => {});

    return () => {
      u1();
      u2();
      u3();
    };
  }, []);

  const handleInspectProject = async (targetPath = projectPathInput) => {
    const clean = targetPath.trim();
    if (!clean) {
      setStatusMsg('Select or enter an approved project folder path first.');
      return;
    }
    audioService.playChirp(1300);
    setIsInspecting(true);
    setStatusMsg(null);
    try {
      const res = await devStudioService.inspectProject(clean);
      if (!res.ok) {
        setStatusMsg(res.error || 'Project inspection failed.');
      } else {
        setProjectPathInput(res.projectPath);
        setStatusMsg(
          `Inspected "${res.projectName}" (${res.totalFilesScanned} files, ${res.excludedSecretFiles.length} secret file(s) excluded).`
        );
      }
    } finally {
      setIsInspecting(false);
    }
  };

  const handleOpenSourceFile = async (relativeOrFull: string) => {
    if (!report?.ok) return;
    audioService.playChirp(1200);
    const full =
      relativeOrFull.startsWith(report.projectPath) || /^[A-Za-z]:[\\/]/.test(relativeOrFull) || relativeOrFull.startsWith('/')
        ? relativeOrFull
        : `${report.projectPath.replace(/[\\/]+$/, '')}/${relativeOrFull}`;
    const res = await devStudioService.readSourceFile(report.projectPath, full);
    setSelectedSource(res);
    setActiveTab('UNDERSTAND');
  };

  const handleUnderstandCode = async () => {
    if (!projectPathInput.trim()) {
      setStatusMsg('Inspect an approved project folder first.');
      return;
    }
    setIsAnalyzingCode(true);
    setStatusMsg(null);
    try {
      let extPermId: string | undefined;
      if (useExternalAIExplain) {
        const perm = devStudioService.requestExternalAIUploadPermission(
          projectPathInput.trim(),
          selectedSource ? 1 : 4,
          12000
        );
        const approved = permissionManager.approveOnce(perm.id);
        if (approved?.status === 'APPROVED') {
          extPermId = approved.id;
        }
      }

      const res = await devStudioService.understandCodeOrProject({
        projectPath: projectPathInput.trim(),
        question: understandQuestion,
        focusFilePath: selectedSource?.path,
        useExternalAI: useExternalAIExplain,
        externalUploadPermissionId: extPermId
      });
      setUnderstandAnswer(res.summary);
      if (!res.ok && res.error) setStatusMsg(res.error);
    } finally {
      setIsAnalyzingCode(false);
    }
  };

  const handleGenerateCode = async () => {
    if (!projectPathInput.trim()) {
      setStatusMsg('Inspect an approved project folder before generating code.');
      return;
    }
    setIsGenerating(true);
    setStatusMsg(null);
    try {
      const res = await devStudioService.generateCodeProposal({
        projectPath: projectPathInput.trim(),
        prompt: genPrompt,
        targetRelativePath: genTargetPath || undefined
      });
      if (res.ok && res.patch) {
        setSelectedPatchId(res.patch.id);
        setActiveTab('DIFF_REVIEW');
        setStatusMsg(`Prepared diff preview for "${res.patch.relativePath}". Explicit approval required before writing.`);
      } else {
        setStatusMsg(res.error || 'Code generation failed.');
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDebugError = async () => {
    if (!projectPathInput.trim() || !errorInput.trim()) {
      setStatusMsg('Enter an error or stack trace and select an approved project.');
      return;
    }
    setIsDebugging(true);
    setStatusMsg(null);
    try {
      const res = await devStudioService.analyzeErrorAndProposeFix({
        projectPath: projectPathInput.trim(),
        errorText: errorInput,
        logFilePath: logFileInput || undefined
      });
      setErrorAnalysis(res);
    } finally {
      setIsDebugging(false);
    }
  };

  const handleApproveAndApplyPatch = async (patch: ProposedPatchEntry) => {
    const overwriteConfirmed = Boolean(overwriteConfirmMap[patch.id]);
    if (patch.preview.overwriteWarning && !overwriteConfirmed) {
      setStatusMsg(`Confirm overwrite checkbox on "${patch.relativePath}" before applying.`);
      return;
    }
    const perm = devStudioService.requestPatchPermission(patch.id);
    if (!perm) return;
    permissionManager.approveOnce(perm.id);
    const res = await devStudioService.applyProposedPatch(patch.id, perm.id, overwriteConfirmed);
    setStatusMsg(
      res.ok
        ? `Applied patch to "${patch.relativePath}" with backup snapshot.`
        : res.error || 'Failed to apply patch.'
    );
  };

  const handleRollbackBackup = async (backup: AppliedPatchBackup) => {
    if (!projectPathInput.trim()) return;
    const perm = devStudioService.requestRollbackPermission(backup.patchId, backup.relativePath);
    permissionManager.approveOnce(perm.id);
    const res = await devStudioService.rollbackPatch(backup.patchId, projectPathInput.trim(), perm.id);
    setStatusMsg(
      res.ok
        ? `Rolled back "${backup.relativePath}" (${res.restoredAction}).`
        : res.error || 'Rollback failed.'
    );
  };

  const handleRunCommand = async (toolOverride?: DevCommandTool, argsOverride?: string[]) => {
    if (!projectPathInput.trim()) {
      setStatusMsg('Select an approved project directory before executing commands.');
      return;
    }
    const tool = toolOverride || cmdTool;
    const parsedArgs =
      argsOverride ||
      cmdArgsInput
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    const perm = devStudioService.requestDevCommandPermission(projectPathInput.trim(), tool, parsedArgs);
    permissionManager.approveOnce(perm.id);

    const taskId = `devcmd-${Date.now().toString(36)}`;
    setActiveTaskId(taskId);
    setIsRunningCmd(true);
    setStatusMsg(null);
    try {
      const res = await devStudioService.runApprovedCommand({
        projectPath: projectPathInput.trim(),
        tool,
        args: parsedArgs,
        permissionId: perm.id,
        taskId
      });
      setLastCmdResult(res);
      if (!res.ok && res.error) setStatusMsg(res.error);
    } finally {
      setIsRunningCmd(false);
      setActiveTaskId(null);
    }
  };

  const handleCancelRunningCommand = async () => {
    if (!activeTaskId) return;
    await devStudioService.cancelCommand(activeTaskId);
    setStatusMsg(`Cancellation signal sent for task ${activeTaskId}.`);
  };

  const handleGenerateDocs = async () => {
    if (!projectPathInput.trim()) {
      setStatusMsg('Inspect an approved project first.');
      return;
    }
    const res = await devStudioService.generateGroundedDocumentation(
      projectPathInput.trim(),
      docType,
      docDestInput || undefined
    );
    if (res.ok && res.patch) {
      setSelectedPatchId(res.patch.id);
      setActiveTab('DIFF_REVIEW');
      setStatusMsg(`Generated ${docType} preview (${res.patch.relativePath}). Review and approve to save.`);
    } else {
      setStatusMsg(res.error || 'Documentation generation failed.');
    }
  };

  const handleCreateAndRunPlan = async () => {
    if (!projectPathInput.trim()) {
      setStatusMsg('Inspect an approved project folder first.');
      return;
    }
    const plan = devPlannerService.createPlan({
      projectPath: projectPathInput.trim(),
      objective: planObjective,
      includePatchStep: true,
      includeTestStep: true
    });
    const out = await devPlannerService.executePlan(plan.id, {
      generationPrompt: planObjective
    });
    setActivePlan(out);
    if (out.status === 'AWAITING_APPROVAL') {
      setStatusMsg('Plan paused cleanly before consequential step. Review proposed diff or run tests with explicit approval.');
    }
  };

  const testSummary = devStudioService.discoverTests(report);
  const selectedPatch = patches.find((p) => p.id === selectedPatchId) || patches[0] || null;

  const tabs: { id: DevStudioTab; label: string; icon: React.ReactNode }[] = [
    { id: 'WORKSPACE', label: 'Workspace', icon: <FolderTree className="w-3.5 h-3.5" /> },
    { id: 'UNDERSTAND', label: 'Understand', icon: <FileCode2 className="w-3.5 h-3.5" /> },
    { id: 'GENERATE', label: 'Generate', icon: <Sparkles className="w-3.5 h-3.5" /> },
    { id: 'DEBUG', label: 'Debug', icon: <Bug className="w-3.5 h-3.5" /> },
    { id: 'DIFF_REVIEW', label: `Diffs (${patches.filter((p) => p.status === 'PENDING_REVIEW').length})`, icon: <GitCompare className="w-3.5 h-3.5" /> },
    { id: 'TERMINAL', label: 'Terminal', icon: <Terminal className="w-3.5 h-3.5" /> },
    { id: 'TESTS', label: 'Tests', icon: <FlaskConical className="w-3.5 h-3.5" /> },
    { id: 'DOCS', label: 'Docs', icon: <BookText className="w-3.5 h-3.5" /> },
    { id: 'PLANNER', label: 'Planner', icon: <ListChecks className="w-3.5 h-3.5" /> },
    { id: 'AUDIT', label: 'Audit', icon: <History className="w-3.5 h-3.5" /> }
  ];

  return (
    <div className="bg-[#040b16] border border-cyan-500/30 rounded-xl p-4 space-y-4">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/20 pb-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-cyan-500/15 border border-cyan-400/40 flex items-center justify-center text-cyan-300">
            <Code2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-orbitron text-sm font-bold tracking-wider text-white">
              AI DEVELOPMENT STUDIO
            </h2>
            <p className="text-[11px] text-cyan-300/75 font-mono">
              Approved Project Analysis • Diff Review & Rollback • Allowlisted Command Runner
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {report?.ok && (
            <span className="px-2.5 py-1 rounded border border-emerald-500/40 bg-emerald-950/30 text-emerald-300 text-[10px] font-mono tabular-nums">
              {report.projectName} ({report.totalFilesScanned} files)
            </span>
          )}
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

      {/* Inline Pending Permission Banner (if Intelligence Engine issued a Dev Studio approval prompt) */}
      {pendingPermission && (
        <div className="p-3 rounded-lg border border-amber-400/50 bg-amber-950/25 flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 text-amber-300 text-xs font-orbitron font-bold">
              <ShieldCheck className="w-4 h-4" />
              AUTHORIZATION REQUIRED: {pendingPermission.category}
            </div>
            <div className="text-xs text-amber-100/90 font-mono">
              {pendingPermission.requestedAction} — <span className="text-white">{pendingPermission.target}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onApprovePermission(pendingPermission.id)}
              className="px-3 py-1.5 rounded border border-emerald-400/60 bg-emerald-900/40 text-emerald-200 text-xs font-orbitron hover:bg-emerald-800/60"
            >
              APPROVE ONCE
            </button>
            <button
              type="button"
              onClick={() => onDenyPermission(pendingPermission.id)}
              className="px-3 py-1.5 rounded border border-rose-400/50 bg-rose-950/40 text-rose-200 text-xs font-orbitron hover:bg-rose-900/50"
            >
              DENY
            </button>
            <button
              type="button"
              onClick={() => onCancelPermission(pendingPermission.id)}
              className="px-2.5 py-1.5 rounded border border-cyan-500/30 text-cyan-300 text-xs font-orbitron hover:bg-cyan-950/50"
            >
              CANCEL
            </button>
          </div>
        </div>
      )}

      {/* Segmented Navigation */}
      <div className="flex flex-wrap gap-1.5 border-b border-cyan-500/20 pb-3">
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                audioService.playChirp(1250);
                setActiveTab(tab.id);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-orbitron tracking-wider border transition-colors ${
                active
                  ? 'bg-cyan-500/20 border-cyan-400 text-white font-bold'
                  : 'bg-[#02060c] border-cyan-500/20 text-cyan-300/80 hover:text-white hover:border-cyan-400/50'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {statusMsg && (
        <div className="px-3 py-2 rounded-lg border border-cyan-500/30 bg-cyan-950/25 text-xs text-cyan-100 font-mono">
          {statusMsg}
        </div>
      )}

      {/* TAB 1: WORKSPACE */}
      {activeTab === 'WORKSPACE' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 items-center">
            <input
              type="text"
              value={projectPathInput}
              onChange={(e) => setProjectPathInput(e.target.value)}
              placeholder="Enter an approved project folder path..."
              className="flex-1 min-w-[260px] px-3 py-2 rounded-lg bg-[#02060c] border border-cyan-500/30 text-xs text-white font-mono focus:outline-none focus:border-cyan-400"
            />
            <button
              type="button"
              disabled={isInspecting}
              onClick={() => handleInspectProject()}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-cyan-400/60 bg-cyan-500/20 hover:bg-cyan-500/30 text-xs text-white font-orbitron disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isInspecting ? 'animate-spin' : ''}`} />
              {isInspecting ? 'Inspecting...' : 'Inspect Project'}
            </button>
          </div>

          {approvedFolders.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
              <span className="text-cyan-400/80">Approved Folders:</span>
              {approvedFolders.map((f) => (
                <button
                  key={f.path}
                  type="button"
                  onClick={() => {
                    setProjectPathInput(f.path);
                    handleInspectProject(f.path);
                  }}
                  className="px-2 py-1 rounded border border-cyan-500/30 bg-[#02060c] hover:border-cyan-400 text-cyan-200"
                >
                  {f.name || f.path}
                </button>
              ))}
            </div>
          )}

          {report?.ok ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-5 p-3 rounded-lg border border-cyan-500/25 bg-[#02060c] space-y-3">
                <div className="text-xs font-orbitron text-white font-bold">PROJECT METADATA</div>
                <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                  <div className="p-2 rounded border border-cyan-500/15 bg-[#040b16]">
                    <div className="text-[10px] text-cyan-400/70">FILES SCANNED</div>
                    <div className="text-white font-bold tabular-nums">{report.totalFilesScanned}</div>
                  </div>
                  <div className="p-2 rounded border border-cyan-500/15 bg-[#040b16]">
                    <div className="text-[10px] text-cyan-400/70">SECRETS EXCLUDED</div>
                    <div className="text-amber-300 font-bold tabular-nums">{report.excludedSecretFiles.length}</div>
                  </div>
                </div>
                <div className="space-y-1.5 text-xs font-mono">
                  <div>
                    <span className="text-cyan-400/80">Frameworks: </span>
                    <span className="text-white">{report.frameworks.join(', ') || 'None detected'}</span>
                  </div>
                  <div>
                    <span className="text-cyan-400/80">Package Managers: </span>
                    <span className="text-white">{report.packageManagers.join(', ') || 'None detected'}</span>
                  </div>
                  <div>
                    <span className="text-cyan-400/80">Languages: </span>
                    <span className="text-white">
                      {report.languages.map((l) => `${l.language} (${l.fileCount})`).join(', ') || 'None'}
                    </span>
                  </div>
                  <div>
                    <span className="text-cyan-400/80">Entry Points: </span>
                    <span className="text-cyan-200">{report.entryPoints.slice(0, 6).join(', ') || 'None'}</span>
                  </div>
                  <div>
                    <span className="text-cyan-400/80">Config Files: </span>
                    <span className="text-cyan-200">{report.configFiles.slice(0, 6).join(', ') || 'None'}</span>
                  </div>
                </div>
                {report.dependencies.length > 0 && (
                  <div className="pt-2 border-t border-cyan-500/15 space-y-1">
                    <div className="text-[10px] font-orbitron text-cyan-400">KEY DEPENDENCIES</div>
                    <div className="max-h-36 overflow-y-auto space-y-1 text-[11px] font-mono">
                      {report.dependencies.slice(0, 20).map((d) => (
                        <div key={`${d.scope}-${d.name}`} className="flex justify-between gap-2 text-cyan-100">
                          <span className="truncate">{d.name} ({d.version})</span>
                          <span className="text-cyan-400/75 truncate">{d.role}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="lg:col-span-7 p-3 rounded-lg border border-cyan-500/25 bg-[#02060c] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-orbitron text-white font-bold">PROJECT TREE (CLICK TO INSPECT)</span>
                  <span className="text-[10px] font-mono text-cyan-400/75 flex items-center gap-1">
                    <Lock className="w-3 h-3" /> Secret files hidden
                  </span>
                </div>
                <div className="max-h-80 overflow-y-auto divide-y divide-cyan-500/10 text-xs font-mono">
                  {report.files.map((node) => (
                    <button
                      key={node.relativePath}
                      type="button"
                      disabled={node.isDirectory}
                      onClick={() => !node.isDirectory && handleOpenSourceFile(node.fullPath)}
                      className="w-full text-left py-1.5 px-2 hover:bg-cyan-500/10 flex items-center justify-between gap-2 disabled:opacity-65 disabled:cursor-default"
                    >
                      <span className="truncate text-cyan-100">
                        {node.isDirectory ? `📁 ${node.relativePath}/` : node.relativePath}
                      </span>
                      <span className="text-[10px] text-cyan-400/75 shrink-0 tabular-nums">
                        {node.isDirectory ? 'DIR' : `${node.language || node.extension} • ${node.sizeBytes} B`}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-lg border border-cyan-500/20 bg-[#02060c] text-xs font-mono text-cyan-300/80">
              Select an approved folder in Permissions & Desktop Control or enter an approved path above to inspect a project workspace.
            </div>
          )}
        </div>
      )}

      {/* TAB 2: CODE UNDERSTANDING */}
      {activeTab === 'UNDERSTAND' && (
        <div className="space-y-4">
          <div className="p-3 rounded-lg border border-cyan-500/25 bg-[#02060c] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-orbitron text-white font-bold">CODEBASE & MODULE Q&A</div>
              <label className="flex items-center gap-2 text-[11px] font-mono text-cyan-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useExternalAIExplain}
                  onChange={(e) => setUseExternalAIExplain(e.target.checked)}
                />
                Allow bounded EXTERNAL_AI_UPLOAD context (secrets always excluded)
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={understandQuestion}
                onChange={(e) => setUnderstandQuestion(e.target.value)}
                placeholder="Ask about modules, functions, imports, or architecture..."
                className="flex-1 min-w-[240px] px-3 py-2 rounded-lg bg-[#040b16] border border-cyan-500/30 text-xs text-white font-mono"
              />
              <button
                type="button"
                disabled={isAnalyzingCode}
                onClick={handleUnderstandCode}
                className="px-3.5 py-2 rounded-lg border border-cyan-400/60 bg-cyan-500/20 hover:bg-cyan-500/30 text-xs text-white font-orbitron disabled:opacity-50"
              >
                {isAnalyzingCode ? 'Analyzing...' : 'Analyze & Explain'}
              </button>
            </div>
            {understandAnswer && (
              <pre className="p-3 rounded border border-cyan-500/20 bg-[#040b16] text-xs text-cyan-100 font-mono whitespace-pre-wrap max-h-64 overflow-y-auto">
                {understandAnswer}
              </pre>
            )}
          </div>

          {selectedSource && (
            <div className="p-3 rounded-lg border border-cyan-500/25 bg-[#02060c] space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-orbitron text-white font-bold">
                  {selectedSource.relativePath}
                </span>
                <span className="text-[11px] font-mono text-cyan-300 tabular-nums">
                  {selectedSource.language} • {selectedSource.lineCount} lines • {selectedSource.symbols.length} symbols
                </span>
              </div>
              {selectedSource.ok ? (
                <>
                  {selectedSource.imports.length > 0 && (
                    <div className="text-[11px] font-mono text-cyan-300/80">
                      Imports: {selectedSource.imports.slice(0, 12).join(', ')}
                    </div>
                  )}
                  <pre className="p-3 rounded border border-cyan-500/15 bg-[#040b16] text-[11px] text-cyan-100 font-mono overflow-auto max-h-72">
                    {selectedSource.content}
                  </pre>
                </>
              ) : (
                <div className="text-xs text-rose-300 font-mono">{selectedSource.error}</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: CODE GENERATION */}
      {activeTab === 'GENERATE' && (
        <div className="p-3 rounded-lg border border-cyan-500/25 bg-[#02060c] space-y-3">
          <div className="text-xs font-orbitron text-white font-bold">
            AI CODE GENERATION (PREVIEW FIRST — NO SILENT WRITES)
          </div>
          <textarea
            value={genPrompt}
            onChange={(e) => setGenPrompt(e.target.value)}
            rows={3}
            placeholder="Describe the module, endpoint, component, or test to generate..."
            className="w-full px-3 py-2 rounded-lg bg-[#040b16] border border-cyan-500/30 text-xs text-white font-mono"
          />
          <div className="flex flex-wrap gap-2 items-center">
            <input
              type="text"
              value={genTargetPath}
              onChange={(e) => setGenTargetPath(e.target.value)}
              placeholder="Optional target relative path (e.g. calculator.py or src/components/LoginPage.tsx)"
              className="flex-1 min-w-[240px] px-3 py-2 rounded-lg bg-[#040b16] border border-cyan-500/30 text-xs text-white font-mono"
            />
            <button
              type="button"
              disabled={isGenerating}
              onClick={handleGenerateCode}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-cyan-400/60 bg-cyan-500/20 hover:bg-cyan-500/30 text-xs text-white font-orbitron disabled:opacity-50"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {isGenerating ? 'Preparing Diff...' : 'Generate Preview Diff'}
            </button>
          </div>
        </div>
      )}

      {/* TAB 4: DEBUG & ERROR ANALYSIS */}
      {activeTab === 'DEBUG' && (
        <div className="p-3 rounded-lg border border-cyan-500/25 bg-[#02060c] space-y-3">
          <div className="text-xs font-orbitron text-white font-bold">
            DEBUGGING & STACK TRACE ROOT CAUSE ANALYSIS
          </div>
          <textarea
            value={errorInput}
            onChange={(e) => setErrorInput(e.target.value)}
            rows={4}
            placeholder="Paste TypeScript error, Vite build failure, Vitest/Jest output, or Python traceback..."
            className="w-full px-3 py-2 rounded-lg bg-[#040b16] border border-cyan-500/30 text-xs text-white font-mono"
          />
          <div className="flex flex-wrap gap-2 items-center">
            <input
              type="text"
              value={logFileInput}
              onChange={(e) => setLogFileInput(e.target.value)}
              placeholder="Optional approved log file path (e.g. build.log)"
              className="flex-1 min-w-[240px] px-3 py-2 rounded-lg bg-[#040b16] border border-cyan-500/30 text-xs text-white font-mono"
            />
            <button
              type="button"
              disabled={isDebugging}
              onClick={handleDebugError}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-cyan-400/60 bg-cyan-500/20 hover:bg-cyan-500/30 text-xs text-white font-orbitron disabled:opacity-50"
            >
              <Bug className="w-3.5 h-3.5" />
              {isDebugging ? 'Analyzing...' : 'Analyze Stack Trace'}
            </button>
          </div>
          {errorAnalysis && (
            <div className="p-3 rounded border border-cyan-500/25 bg-[#040b16] space-y-2 text-xs font-mono">
              <div className="text-amber-300 font-bold">{errorAnalysis.rootCauseCategory}</div>
              <div className="text-cyan-100">{errorAnalysis.summary}</div>
              {errorAnalysis.affectedFiles.length > 0 && (
                <div className="text-cyan-300">
                  Referenced locations:{' '}
                  {errorAnalysis.affectedFiles
                    .slice(0, 6)
                    .map((f) => `${f.file}${f.line ? `:${f.line}` : ''}`)
                    .join(', ')}
                </div>
              )}
              <div className="text-[11px] text-amber-200/90 border-t border-cyan-500/15 pt-1.5">
                {errorAnalysis.verificationNote}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 5: DIFF REVIEW & SAFE PATCH ROLLBACK */}
      {activeTab === 'DIFF_REVIEW' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-4 space-y-2">
            <div className="text-xs font-orbitron text-white font-bold">PROPOSED PATCH QUEUE</div>
            {patches.length === 0 ? (
              <div className="p-3 rounded border border-cyan-500/20 bg-[#02060c] text-xs font-mono text-cyan-300/75">
                No pending or recent code patches.
              </div>
            ) : (
              patches.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedPatchId(p.id)}
                  className={`w-full text-left p-2.5 rounded-lg border transition-colors ${
                    selectedPatch?.id === p.id
                      ? 'border-cyan-400 bg-cyan-500/15'
                      : 'border-cyan-500/20 bg-[#02060c] hover:border-cyan-400/50'
                  }`}
                >
                  <div className="flex justify-between items-center gap-2 text-xs font-mono">
                    <span className="text-white font-bold truncate">{p.relativePath}</span>
                    <span className="text-[10px] text-cyan-300 shrink-0">{p.status}</span>
                  </div>
                  <div className="text-[11px] text-cyan-300/75 font-mono truncate">{p.title}</div>
                </button>
              ))
            )}

            <div className="pt-3 space-y-2">
              <div className="text-xs font-orbitron text-white font-bold">BACKUP SNAPSHOTS & ROLLBACK</div>
              {backups.length === 0 ? (
                <div className="p-2.5 rounded border border-cyan-500/20 bg-[#02060c] text-[11px] font-mono text-cyan-300/70">
                  No applied patch backups yet.
                </div>
              ) : (
                backups.map((b) => (
                  <div key={b.patchId} className="p-2.5 rounded border border-cyan-500/20 bg-[#02060c] space-y-1.5 text-[11px] font-mono">
                    <div className="flex justify-between gap-2 text-cyan-100">
                      <span className="truncate">{b.relativePath}</span>
                      <span className={b.rolledBack ? 'text-amber-300' : 'text-emerald-300'}>
                        {b.rolledBack ? 'ROLLED BACK' : 'ACTIVE'}
                      </span>
                    </div>
                    {!b.rolledBack && (
                      <button
                        type="button"
                        onClick={() => handleRollbackBackup(b)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded border border-amber-400/50 bg-amber-950/30 hover:bg-amber-900/40 text-amber-200 text-[10px] font-orbitron"
                      >
                        <RotateCcw className="w-3 h-3" /> Rollback Snapshot
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="lg:col-span-8 p-3 rounded-lg border border-cyan-500/25 bg-[#02060c] space-y-3">
            {selectedPatch ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cyan-500/15 pb-2">
                  <div>
                    <div className="text-xs font-orbitron text-white font-bold">{selectedPatch.title}</div>
                    <div className="text-[11px] font-mono text-cyan-300">
                      Target: {selectedPatch.relativePath} (+{selectedPatch.preview.addedLines}/-{selectedPatch.preview.removedLines} lines)
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded border border-cyan-500/30 text-[10px] font-mono text-cyan-200">
                    {selectedPatch.status}
                  </span>
                </div>
                <p className="text-xs font-mono text-cyan-100/90">{selectedPatch.explanation}</p>

                {selectedPatch.preview.validationWarnings.length > 0 && (
                  <div className="p-2 rounded border border-amber-400/50 bg-amber-950/25 text-[11px] font-mono text-amber-200 space-y-1">
                    {selectedPatch.preview.validationWarnings.map((w, idx) => (
                      <div key={idx} className="flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>{w}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="max-h-64 overflow-auto rounded border border-cyan-500/20 bg-[#040b16] p-2 text-[11px] font-mono">
                  {selectedPatch.preview.lines.map((ln, idx) => (
                    <div
                      key={idx}
                      className={`px-1.5 whitespace-pre ${
                        ln.type === 'add'
                          ? 'bg-emerald-950/50 text-emerald-200'
                          : ln.type === 'remove'
                          ? 'bg-rose-950/50 text-rose-200'
                          : 'text-cyan-200/75'
                      }`}
                    >
                      {ln.type === 'add' ? '+ ' : ln.type === 'remove' ? '- ' : '  '}
                      {ln.text}
                    </div>
                  ))}
                </div>

                {selectedPatch.status === 'PENDING_REVIEW' && (
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-cyan-500/15">
                    {selectedPatch.preview.overwriteWarning ? (
                      <label className="flex items-center gap-2 text-xs font-mono text-amber-200 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(overwriteConfirmMap[selectedPatch.id])}
                          onChange={(e) =>
                            setOverwriteConfirmMap((prev) => ({ ...prev, [selectedPatch.id]: e.target.checked }))
                          }
                        />
                        Confirm overwriting existing file (backup will be created)
                      </label>
                    ) : (
                      <span className="text-[11px] font-mono text-cyan-300/75">New file creation inside approved root</span>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => devStudioService.rejectProposedPatch(selectedPatch.id)}
                        className="flex items-center gap-1 px-3 py-1.5 rounded border border-rose-400/50 bg-rose-950/40 text-rose-200 text-xs font-orbitron hover:bg-rose-900/50"
                      >
                        <XCircle className="w-3.5 h-3.5" /> Reject
                      </button>
                      <button
                        type="button"
                        onClick={() => handleApproveAndApplyPatch(selectedPatch)}
                        className="flex items-center gap-1 px-3 py-1.5 rounded border border-emerald-400/60 bg-emerald-900/40 text-emerald-200 text-xs font-orbitron hover:bg-emerald-800/60"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> Approve & Write File
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-xs font-mono text-cyan-300/75">
                Select a proposed patch on the left to inspect its diff before writing.
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 6: TERMINAL & COMMAND CENTER */}
      {activeTab === 'TERMINAL' && (
        <div className="space-y-4">
          <div className="p-3 rounded-lg border border-cyan-500/25 bg-[#02060c] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-orbitron text-white font-bold">ALLOWLISTED COMMAND RUNNER (SHELL: FALSE)</div>
              <div className="flex flex-wrap gap-1.5 text-[10px] font-mono">
                {devTools.map((t) => (
                  <span
                    key={t.tool}
                    className={`px-2 py-0.5 rounded border ${
                      t.available
                        ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-200'
                        : 'border-rose-500/30 bg-rose-950/25 text-rose-300'
                    }`}
                  >
                    {t.tool}: {t.available ? t.version || 'OK' : 'N/A'}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 items-center">
              <select
                value={cmdTool}
                onChange={(e) => setCmdTool(e.target.value as DevCommandTool)}
                className="px-3 py-2 rounded-lg bg-[#040b16] border border-cyan-500/30 text-xs text-white font-mono"
              >
                {ALLOWED_CMD_TOOLS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={cmdArgsInput}
                onChange={(e) => setCmdArgsInput(e.target.value)}
                placeholder="Arguments (e.g. test or run build or status)"
                className="flex-1 min-w-[220px] px-3 py-2 rounded-lg bg-[#040b16] border border-cyan-500/30 text-xs text-white font-mono"
              />
              {!isRunningCmd ? (
                <button
                  type="button"
                  onClick={() => handleRunCommand()}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-emerald-400/60 bg-emerald-900/40 hover:bg-emerald-800/60 text-xs text-emerald-100 font-orbitron"
                >
                  <Play className="w-3.5 h-3.5" /> Approve & Run
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleCancelRunningCommand}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-rose-400/60 bg-rose-900/40 hover:bg-rose-800/60 text-xs text-rose-100 font-orbitron"
                >
                  <Square className="w-3.5 h-3.5" /> Cancel Running Command
                </button>
              )}
            </div>

            <div className="text-[11px] font-mono text-cyan-300/80">
              Preview: <span className="text-white">{cmdTool} {cmdArgsInput}</span> inside cwd <span className="text-cyan-200">{projectPathInput || '(select project)'}</span>
            </div>
          </div>

          {lastCmdResult && (
            <div className="p-3 rounded-lg border border-cyan-500/25 bg-[#02060c] space-y-2 text-xs font-mono">
              <div className="flex flex-wrap justify-between gap-2">
                <span className={lastCmdResult.ok ? 'text-emerald-300 font-bold' : 'text-rose-300 font-bold'}>
                  {lastCmdResult.commandDisplay} — exit {lastCmdResult.exitCode ?? 'null'} ({lastCmdResult.durationMs} ms)
                </span>
                {lastCmdResult.truncatedOutput && (
                  <span className="text-amber-300">Output truncated at 64 KB safety limit</span>
                )}
              </div>
              {lastCmdResult.stdout && (
                <pre className="p-2.5 rounded border border-cyan-500/15 bg-[#040b16] text-[11px] text-cyan-100 max-h-60 overflow-auto whitespace-pre-wrap">
                  {lastCmdResult.stdout}
                </pre>
              )}
              {lastCmdResult.stderr && (
                <pre className="p-2.5 rounded border border-rose-500/25 bg-rose-950/20 text-[11px] text-rose-200 max-h-48 overflow-auto whitespace-pre-wrap">
                  {lastCmdResult.stderr}
                </pre>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 7: AUTOMATED TESTING ASSISTANT */}
      {activeTab === 'TESTS' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="p-3 rounded-lg border border-cyan-500/25 bg-[#02060c] space-y-2.5 text-xs font-mono">
              <div className="font-orbitron text-white font-bold">DISCOVERED TEST INFRASTRUCTURE</div>
              <div>
                <span className="text-cyan-400">Frameworks: </span>
                <span className="text-white">{testSummary.testFrameworks.join(', ') || 'None detected'}</span>
              </div>
              <div>
                <span className="text-cyan-400">Existing Test Files ({testSummary.existingTestFiles.length}): </span>
                <span className="text-cyan-200">{testSummary.existingTestFiles.slice(0, 8).join(', ') || 'None'}</span>
              </div>
              <div className="pt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!projectPathInput.trim() || isRunningCmd}
                  onClick={() => {
                    setActiveTab('TERMINAL');
                    handleRunCommand('npm', ['test']);
                  }}
                  className="px-3 py-1.5 rounded border border-emerald-400/60 bg-emerald-900/40 text-emerald-100 text-xs font-orbitron disabled:opacity-50"
                >
                  Approve & Run npm test
                </button>
              </div>
            </div>

            <div className="p-3 rounded-lg border border-cyan-500/25 bg-[#02060c] space-y-2 text-xs font-mono">
              <div className="font-orbitron text-white font-bold">SUGGESTED MODULES MISSING TESTS</div>
              {testSummary.suggestedUntestedFiles.length === 0 ? (
                <div className="text-cyan-300/75">Inspect a project to discover untested source files.</div>
              ) : (
                <div className="space-y-1.5 max-h-44 overflow-y-auto">
                  {testSummary.suggestedUntestedFiles.map((fileRel) => (
                    <div key={fileRel} className="flex items-center justify-between gap-2">
                      <span className="truncate text-cyan-100">{fileRel}</span>
                      <button
                        type="button"
                        onClick={async () => {
                          const res = await devStudioService.generateUnitTestsForFile(projectPathInput.trim(), fileRel);
                          if (res.ok && res.patch) {
                            setSelectedPatchId(res.patch.id);
                            setActiveTab('DIFF_REVIEW');
                            setStatusMsg(`Proposed unit tests for "${fileRel}" (NOT executed yet — review & approve first).`);
                          }
                        }}
                        className="px-2 py-1 rounded border border-cyan-400/50 bg-cyan-500/15 hover:bg-cyan-500/30 text-[10px] font-orbitron text-cyan-100 shrink-0"
                      >
                        Propose Tests
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {lastCmdResult?.testReport && (
            <div className="p-3 rounded-lg border border-cyan-500/25 bg-[#02060c] space-y-2 text-xs font-mono">
              <div className="font-orbitron text-white font-bold">EXECUTED TEST REPORT INTERPRETATION</div>
              <div className="text-cyan-100">{lastCmdResult.testReport.summary}</div>
              <div className="grid grid-cols-4 gap-2 tabular-nums">
                <div className="p-2 rounded border border-cyan-500/15 bg-[#040b16]">Framework: {lastCmdResult.testReport.framework}</div>
                <div className="p-2 rounded border border-emerald-500/30 bg-emerald-950/20 text-emerald-300">Passed: {lastCmdResult.testReport.passed}</div>
                <div className="p-2 rounded border border-rose-500/30 bg-rose-950/20 text-rose-300">Failed: {lastCmdResult.testReport.failed}</div>
                <div className="p-2 rounded border border-amber-500/30 bg-amber-950/20 text-amber-300">Skipped: {lastCmdResult.testReport.skipped}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 8: PROJECT DOCUMENTATION GENERATOR */}
      {activeTab === 'DOCS' && (
        <div className="p-3 rounded-lg border border-cyan-500/25 bg-[#02060c] space-y-3">
          <div className="text-xs font-orbitron text-white font-bold">
            GROUNDED DOCUMENTATION GENERATOR (BUILT FROM REAL INSPECTED FILES ONLY)
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value as DocGeneratorType)}
              className="px-3 py-2 rounded-lg bg-[#040b16] border border-cyan-500/30 text-xs text-white font-mono"
            >
              <option value="README">README</option>
              <option value="ARCHITECTURE">Architecture Summary</option>
              <option value="API_DOCS">API & Script Reference</option>
              <option value="SETUP_GUIDE">Developer Setup Guide</option>
              <option value="MODULE_SUMMARY">Module Summary</option>
              <option value="DEV_REPORT">Development Inspection Report</option>
            </select>
            <input
              type="text"
              value={docDestInput}
              onChange={(e) => setDocDestInput(e.target.value)}
              placeholder="Optional output path (defaults to README.generated.md / docs/*.md)"
              className="flex-1 min-w-[220px] px-3 py-2 rounded-lg bg-[#040b16] border border-cyan-500/30 text-xs text-white font-mono"
            />
            <button
              type="button"
              onClick={handleGenerateDocs}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-cyan-400/60 bg-cyan-500/20 hover:bg-cyan-500/30 text-xs text-white font-orbitron"
            >
              <BookText className="w-3.5 h-3.5" /> Generate & Preview Doc
            </button>
          </div>
        </div>
      )}

      {/* TAB 9: DEVELOPMENT TASK PLANNER */}
      {activeTab === 'PLANNER' && (
        <div className="space-y-4">
          <div className="p-3 rounded-lg border border-cyan-500/25 bg-[#02060c] space-y-3">
            <div className="text-xs font-orbitron text-white font-bold">MULTI-STEP DEVELOPMENT TASK PLANNER</div>
            <div className="flex flex-wrap gap-2 items-center">
              <input
                type="text"
                value={planObjective}
                onChange={(e) => setPlanObjective(e.target.value)}
                placeholder="Objective (e.g. Generate Python calculator, review diff, and verify tests)"
                className="flex-1 min-w-[240px] px-3 py-2 rounded-lg bg-[#040b16] border border-cyan-500/30 text-xs text-white font-mono"
              />
              <button
                type="button"
                onClick={handleCreateAndRunPlan}
                className="px-3.5 py-2 rounded-lg border border-cyan-400/60 bg-cyan-500/20 hover:bg-cyan-500/30 text-xs text-white font-orbitron"
              >
                Create & Start Plan
              </button>
              {activePlan && (activePlan.status === 'RUNNING' || activePlan.status === 'AWAITING_APPROVAL') && (
                <button
                  type="button"
                  onClick={() => devPlannerService.cancelPlan(activePlan.id)}
                  className="px-3 py-2 rounded-lg border border-rose-400/50 bg-rose-950/40 text-rose-200 text-xs font-orbitron"
                >
                  Cancel Plan
                </button>
              )}
            </div>

            {activePlan && (
              <div className="space-y-2 pt-2 border-t border-cyan-500/15 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-white font-bold">{activePlan.objective}</span>
                  <span className="text-cyan-300 tabular-nums">
                    {activePlan.status} ({activePlan.progressPercent}%)
                  </span>
                </div>
                <div className="w-full h-1.5 rounded bg-cyan-950 overflow-hidden">
                  <div className="h-full bg-cyan-400 transition-all" style={{ width: `${activePlan.progressPercent}%` }} />
                </div>
                <div className="space-y-1.5">
                  {activePlan.steps.map((s) => (
                    <div key={s.id} className="p-2 rounded border border-cyan-500/15 bg-[#040b16] flex justify-between gap-2">
                      <div>
                        <div className="text-cyan-100 font-bold">{s.title}</div>
                        <div className="text-[11px] text-cyan-300/75">{s.outputSummary || s.error || s.description}</div>
                      </div>
                      <span className="text-[10px] text-cyan-200 shrink-0">{s.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {planHistory.length > 0 && (
            <div className="p-3 rounded-lg border border-cyan-500/20 bg-[#02060c] space-y-1.5 text-xs font-mono">
              <div className="font-orbitron text-white font-bold">PLAN EXECUTION HISTORY</div>
              {planHistory.slice(0, 6).map((h) => (
                <div key={h.id} className="flex justify-between gap-2 text-cyan-200">
                  <span className="truncate">{h.objective}</span>
                  <span className="shrink-0">{h.status} ({h.progressPercent}%)</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 10: AUDIT LOG */}
      {activeTab === 'AUDIT' && (
        <div className="p-3 rounded-lg border border-cyan-500/25 bg-[#02060c] space-y-2 text-xs font-mono">
          <div className="font-orbitron text-white font-bold">DEV STUDIO AUDIT TRAIL</div>
          {auditEntries.length === 0 ? (
            <div className="text-cyan-300/75">No Dev Studio operations recorded yet.</div>
          ) : (
            <div className="max-h-72 overflow-y-auto divide-y divide-cyan-500/10">
              {auditEntries.map((entry) => (
                <div key={entry.id} className="py-1.5 flex justify-between gap-3">
                  <div className="min-w-0">
                    <span className={entry.ok ? 'text-emerald-300' : 'text-rose-300'}>[{entry.category}]</span>{' '}
                    <span className="text-cyan-100">{entry.summary}</span>
                  </div>
                  <span className="text-[10px] text-cyan-400/70 shrink-0 tabular-nums">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
