import React, { useState, useEffect } from 'react';
import {
  Monitor,
  Folder,
  FolderPlus,
  FileText,
  Globe,
  Music,
  Play,
  Pause,
  Square,
  Volume2,
  RefreshCw,
  Search,
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Workflow,
  Plus,
  FileCode,
  Eye,
  Sliders,
  History,
  Info
} from 'lucide-react';
import { desktopBridge, DiscoveredApplicationInfo, FolderItemEntry, WebPageInspectionResult } from '../../services/desktopBridge';
import { permissionManager } from '../../services/permissionManager';
import { permissionPolicy } from '../../services/permissionPolicy';
import { musicService } from '../../services/musicService';
import { desktopWorkflowService, DesktopWorkflow, WorkflowAuditEntry } from '../../services/desktopWorkflowService';
import { audioService } from '../../services/soundFx';
import { PermissionRequest, ToolActivityRecord } from '../../types/assistant';

export type DesktopSubTab =
  | 'APPS'
  | 'FILES'
  | 'BROWSER'
  | 'MEDIA'
  | 'WORKFLOWS'
  | 'APPROVAL'
  | 'AUDIT';

interface DesktopSuperpowersPanelProps {
  onApprovePermission: (permId: string) => void;
  onDenyPermission: (permId: string) => void;
  onCancelPermission: (permId: string) => void;
  pendingPermission: PermissionRequest | null;
  recentTools: ToolActivityRecord[];
  onClose?: () => void;
}

export const DesktopSuperpowersPanel: React.FC<DesktopSuperpowersPanelProps> = ({
  onApprovePermission,
  onDenyPermission,
  onCancelPermission,
  pendingPermission,
  recentTools,
  onClose
}) => {
  const [activeSubTab, setActiveSubTab] = useState<DesktopSubTab>(pendingPermission ? 'APPROVAL' : 'APPS');

  // Application Intelligence state
  const [apps, setApps] = useState<DiscoveredApplicationInfo[]>([]);
  const [appSearch, setAppSearch] = useState('');
  const [isRefreshingApps, setIsRefreshingApps] = useState(false);
  const [appLaunchStatus, setAppLaunchStatus] = useState<Record<string, string>>({});

  // File Explorer state
  const [selectedFolder, setSelectedFolder] = useState<string>('');
  const [folderItems, setFolderItems] = useState<FolderItemEntry[]>([]);
  const [fileSearch, setFileSearch] = useState('');
  const [isLoadingFolder, setIsLoadingFolder] = useState(false);
  const [selectedFileContent, setSelectedFileContent] = useState<{ name: string; content: string; lines: number; size: number } | null>(null);
  const [newFileName, setNewFileName] = useState('');
  const [newFileContent, setNewFileContent] = useState('');
  const [newFileOverwrite, setNewFileOverwrite] = useState(false);
  const [showCreateFileDialog, setShowCreateFileDialog] = useState(false);
  const [fileOperationMsg, setFileOperationMsg] = useState<string | null>(null);

  // Browser Assistant state
  const [browserUrl, setBrowserUrl] = useState('https://github.com');
  const [isInspectingUrl, setIsInspectingUrl] = useState(false);
  const [inspectionResult, setInspectionResult] = useState<WebPageInspectionResult | null>(null);
  const [browserStatusMsg, setBrowserStatusMsg] = useState<string | null>(null);

  // Media state
  const [musicState, setMusicState] = useState(musicService.getState());
  const [volume, setVolume] = useState(musicService.getState().volume);

  // Workflow state
  const [activeWorkflow, setActiveWorkflow] = useState<DesktopWorkflow | null>(desktopWorkflowService.getActiveWorkflow());
  const [workflowAudits, setWorkflowAudits] = useState<WorkflowAuditEntry[]>(desktopWorkflowService.getAuditHistory());
  const [wfFolderName, setWfFolderName] = useState('');
  const [wfFileName, setWfFileName] = useState('notes.txt');
  const [wfSaveName, setWfSaveName] = useState('summary.txt');

  // Load apps on mount
  useEffect(() => {
    loadApplications();
    const currentFolder = desktopBridge.getSelectedFolder()?.path || permissionPolicy.getApprovedFolders()[0]?.path || '';
    if (currentFolder) {
      setSelectedFolder(currentFolder);
      loadFolderContents(currentFolder);
      setWfFolderName(currentFolder);
    }

    const unsubMusic = musicService.subscribe((ms) => {
      setMusicState(ms);
      setVolume(ms.volume);
    });

    const unsubWorkflow = desktopWorkflowService.subscribe((wf) => {
      setActiveWorkflow(wf);
      setWorkflowAudits(desktopWorkflowService.getAuditHistory());
    });

    return () => {
      unsubMusic();
      unsubWorkflow();
    };
  }, []);

  // Auto-switch to approval tab when a permission request arrives
  useEffect(() => {
    if (pendingPermission) {
      setActiveSubTab('APPROVAL');
    }
  }, [pendingPermission]);

  const loadApplications = async () => {
    setIsRefreshingApps(true);
    try {
      const discovered = await desktopBridge.discoverApplications();
      setApps(discovered);
    } catch {
      // ignore
    } finally {
      setIsRefreshingApps(false);
    }
  };

  const handleLaunchApp = async (appId: string) => {
    audioService.playChirp(1200);
    setAppLaunchStatus((prev) => ({ ...prev, [appId]: 'Launching...' }));
    const res = await desktopBridge.launchApplication(appId);
    if (res.ok) {
      setAppLaunchStatus((prev) => ({ ...prev, [appId]: 'Launched' }));
      audioService.playActivationWhoosh();
    } else {
      setAppLaunchStatus((prev) => ({ ...prev, [appId]: res.error || 'Failed' }));
      audioService.playChirp(600);
    }
    setTimeout(() => {
      setAppLaunchStatus((prev) => {
        const copy = { ...prev };
        delete copy[appId];
        return copy;
      });
    }, 4000);
  };

  const handlePickFolder = async () => {
    audioService.playChirp(1100);
    const res = await desktopBridge.pickFolder();
    if (res.ok && res.folder) {
      setSelectedFolder(res.folder.path);
      setWfFolderName(res.folder.path);
      loadFolderContents(res.folder.path);
    }
  };

  const loadFolderContents = async (folderPath: string) => {
    setIsLoadingFolder(true);
    setFileOperationMsg(null);
    try {
      const res = await desktopBridge.listFilesInFolder(folderPath);
      if (res.ok) {
        setFolderItems(res.items);
      } else {
        setFileOperationMsg(res.error || 'Failed to list directory contents.');
      }
    } catch (err: unknown) {
      setFileOperationMsg(err instanceof Error ? err.message : 'Error listing directory.');
    } finally {
      setIsLoadingFolder(false);
    }
  };

  const handleReadFile = async (filePath: string) => {
    audioService.playChirp(1200);
    setFileOperationMsg('Reading file contents...');
    const res = await desktopBridge.readApprovedDesktopFile(filePath);
    if (res.ok && res.content !== undefined) {
      setSelectedFileContent({
        name: res.name || filePath,
        content: res.content,
        lines: res.lineCount || res.content.split('\n').length,
        size: res.sizeBytes || res.content.length
      });
      setFileOperationMsg(null);
    } else {
      setFileOperationMsg(res.error || 'Failed to read file.');
      setSelectedFileContent(null);
    }
  };

  const handleCreateFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFileName.trim()) return;
    if (!selectedFolder) {
      setFileOperationMsg('Please select or approve a folder first.');
      return;
    }

    const fullPath = `${selectedFolder.replace(/[\\/]+$/, '')}/${newFileName.trim()}`;
    audioService.playChirp(1300);

    // Request permission first
    const perm = permissionManager.createRequest({
      category: 'FILE_CREATE',
      requestedAction: `Create file "${newFileName.trim()}"`,
      target: fullPath,
      reason: 'User created new file via Desktop Superpowers panel',
      riskLevel: 'LOW',
      requestedScope: `Write new file to "${fullPath}"`
    });

    // Auto-approve once since user explicitly submitted the form in the UI
    permissionManager.approveRequest(perm.id, 'ONCE');

    const res = await desktopBridge.createApprovedDesktopFile(fullPath, newFileContent, newFileOverwrite, perm.id);
    if (res.ok) {
      audioService.playActivationWhoosh();
      setFileOperationMsg(`Successfully created "${newFileName.trim()}" (${res.sizeBytes || 0} bytes).`);
      setNewFileName('');
      setNewFileContent('');
      setShowCreateFileDialog(false);
      loadFolderContents(selectedFolder);
    } else {
      audioService.playChirp(600);
      setFileOperationMsg(`Creation failed: ${res.error}`);
    }
  };

  const handleOpenBrowser = async (url: string) => {
    audioService.playChirp(1200);
    setBrowserStatusMsg('Opening browser...');
    const res = await desktopBridge.openBrowser(url);
    if (res.ok) {
      setBrowserStatusMsg('Browser opened successfully.');
    } else {
      setBrowserStatusMsg(res.error || 'Failed to open browser.');
    }
    setTimeout(() => setBrowserStatusMsg(null), 3500);
  };

  const handleInspectWebPage = async () => {
    if (!browserUrl) return;
    audioService.playChirp(1300);
    setIsInspectingUrl(true);
    setInspectionResult(null);
    setBrowserStatusMsg('Inspecting webpage metadata safely...');
    try {
      const res = await desktopBridge.inspectWebPage(browserUrl);
      setInspectionResult(res);
      if (res.ok) {
        setBrowserStatusMsg('Inspection complete.');
      } else {
        setBrowserStatusMsg(`Inspection failed: ${res.error}`);
      }
    } catch (err: unknown) {
      setBrowserStatusMsg(err instanceof Error ? err.message : 'Error inspecting page.');
    } finally {
      setIsInspectingUrl(false);
    }
  };

  const handleLaunchWorkflow = async () => {
    if (!wfFolderName || !wfFileName) return;
    audioService.playActivationWhoosh();
    const wf = desktopWorkflowService.createProjectFileSummaryWorkflow(wfFolderName, wfFileName, wfSaveName);
    void desktopWorkflowService.runWorkflow(wf);
  };

  const filteredApps = apps.filter(
    (a) =>
      a.name.toLowerCase().includes(appSearch.toLowerCase()) ||
      a.category.toLowerCase().includes(appSearch.toLowerCase())
  );

  const filteredFolderItems = folderItems.filter((i) =>
    i.name.toLowerCase().includes(fileSearch.toLowerCase())
  );

  return (
    <div className="bg-[#020814]/95 border border-cyan-500/40 rounded-xl flex flex-col shadow-[0_0_30px_rgba(0,240,255,0.15)] overflow-hidden font-mono text-cyan-400 select-none">
      {/* Top Header Bar */}
      <div className="h-12 px-4 flex items-center justify-between border-b border-cyan-500/25 bg-black/60 shrink-0">
        <div className="flex items-center gap-2.5">
          <Monitor className="w-4 h-4 text-cyan-400 animate-pulse" />
          <span className="font-orbitron font-extrabold text-sm tracking-wider text-white">
            DESKTOP SUPERPOWERS & AUTOMATION
          </span>
          <span className="px-2 py-0.5 rounded bg-cyan-950/80 border border-cyan-500/30 text-[9px] text-cyan-300">
            PHASE 7.1 & BATCH 4
          </span>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-cyan-400/60 hover:text-white px-2 py-1 text-xs"
          >
            ✕
          </button>
        )}
      </div>

      {/* Sub Tabs Navigation */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-cyan-500/20 bg-black/40 overflow-x-auto no-scrollbar shrink-0">
        {[
          { id: 'APPS', label: 'App Intelligence', icon: <Monitor className="w-3.5 h-3.5" /> },
          { id: 'FILES', label: 'File & Folder Explorer', icon: <Folder className="w-3.5 h-3.5" /> },
          { id: 'BROWSER', label: 'Browser Assistant', icon: <Globe className="w-3.5 h-3.5" /> },
          { id: 'MEDIA', label: 'Media Control', icon: <Music className="w-3.5 h-3.5" /> },
          { id: 'WORKFLOWS', label: 'Multi-Step Workflows', icon: <Workflow className="w-3.5 h-3.5" /> },
          {
            id: 'APPROVAL',
            label: 'Action Approval',
            icon: <ShieldCheck className="w-3.5 h-3.5" />,
            badge: pendingPermission ? 1 : 0
          },
          { id: 'AUDIT', label: 'Audit History', icon: <History className="w-3.5 h-3.5" /> }
        ].map((tab) => {
          const isActive = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                audioService.playChirp(1300);
                setActiveSubTab(tab.id as DesktopSubTab);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-orbitron tracking-wider transition-all duration-150 shrink-0 ${
                isActive
                  ? 'bg-cyan-500/25 border border-cyan-400 text-white shadow-[0_0_12px_rgba(0,240,255,0.3)] font-bold'
                  : 'text-cyan-300/70 hover:text-white hover:bg-cyan-500/10 border border-transparent'
              }`}
            >
              <span className={isActive ? 'text-cyan-400' : 'text-cyan-400/60'}>{tab.icon}</span>
              <span>{tab.label}</span>
              {tab.badge && tab.badge > 0 ? (
                <span className="px-1.5 py-0.2 rounded-full bg-amber-500 text-black font-bold text-[9px]">
                  {tab.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Main Tab Viewport */}
      <div className="p-4 overflow-y-auto max-h-[640px] space-y-4 no-scrollbar">
        {/* ======================= TAB 1: APPLICATION INTELLIGENCE ======================= */}
        {activeSubTab === 'APPS' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-3.5 h-3.5 text-cyan-400/50 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  placeholder="Filter applications by name or category..."
                  value={appSearch}
                  onChange={(e) => setAppSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 bg-black/50 border border-cyan-500/30 rounded-lg text-xs text-white placeholder-cyan-500/40 focus:outline-none focus:border-cyan-400"
                />
              </div>
              <button
                type="button"
                onClick={loadApplications}
                disabled={isRefreshingApps}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-950/60 border border-cyan-500/40 text-cyan-200 hover:text-white text-xs font-orbitron disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingApps ? 'animate-spin text-cyan-400' : ''}`} />
                <span>{isRefreshingApps ? 'Discovering...' : 'Refresh Apps'}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredApps.map((app) => (
                <div
                  key={app.id}
                  className="p-3 rounded-xl bg-black/40 border border-cyan-500/20 hover:border-cyan-500/40 transition-colors flex flex-col justify-between space-y-3"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-orbitron font-bold text-xs text-white truncate">{app.name}</span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[9px] font-mono uppercase ${
                          app.available
                            ? 'bg-emerald-950/80 border border-emerald-500/40 text-emerald-300'
                            : 'bg-red-950/80 border border-red-500/30 text-red-300'
                        }`}
                      >
                        {app.available ? 'Available' : 'Not Detected'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-cyan-300/60">
                      <span>Category: {app.category}</span>
                      <span>•</span>
                      <span>Target: {app.id}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-cyan-500/10">
                    <span className="text-[10px] text-cyan-400/80">
                      {appLaunchStatus[app.id] ? (
                        <span className="text-amber-300">{appLaunchStatus[app.id]}</span>
                      ) : (
                        app.isApproved ? 'Approved by Policy' : 'Requires Approval'
                      )}
                    </span>
                    <button
                      type="button"
                      disabled={!app.available || Boolean(appLaunchStatus[app.id])}
                      onClick={() => handleLaunchApp(app.id)}
                      className="px-3 py-1 rounded bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400 text-white font-orbitron text-[10px] font-bold disabled:opacity-40 transition-all"
                    >
                      Launch
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ======================= TAB 2: FILE & FOLDER EXPLORER ======================= */}
        {activeSubTab === 'FILES' && (
          <div className="space-y-4">
            {/* Folder selection toolbar */}
            <div className="p-3 rounded-xl bg-black/40 border border-cyan-500/25 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <Folder className="w-4 h-4 text-cyan-400 shrink-0" />
                <div className="min-w-0">
                  <span className="text-[10px] text-cyan-400/60 block font-orbitron">CURRENT ROOT DIRECTORY</span>
                  <span className="text-xs text-white font-semibold truncate block">
                    {selectedFolder || 'No folder authorized or selected'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePickFolder}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-950/60 border border-cyan-500/40 text-cyan-200 hover:text-white text-xs font-orbitron"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                  <span>Choose Folder</span>
                </button>
                <button
                  type="button"
                  disabled={!selectedFolder}
                  onClick={() => setShowCreateFileDialog(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-950/60 border border-emerald-500/40 text-emerald-200 hover:text-white text-xs font-orbitron disabled:opacity-40"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New Text File</span>
                </button>
              </div>
            </div>

            {/* Status message */}
            {fileOperationMsg && (
              <div className="p-2.5 rounded-lg bg-cyan-950/40 border border-cyan-500/30 text-xs text-cyan-200">
                {fileOperationMsg}
              </div>
            )}

            {/* Create File Dialog / Form */}
            {showCreateFileDialog && (
              <form
                onSubmit={handleCreateFile}
                className="p-3.5 rounded-xl bg-black/60 border border-cyan-400/50 space-y-3"
              >
                <div className="flex items-center justify-between border-b border-cyan-500/20 pb-2">
                  <span className="font-orbitron font-bold text-xs text-white">CREATE NEW TEXT FILE</span>
                  <button
                    type="button"
                    onClick={() => setShowCreateFileDialog(false)}
                    className="text-cyan-400/60 hover:text-white text-xs"
                  >
                    Cancel
                  </button>
                </div>
                <div className="space-y-2">
                  <div>
                    <label className="text-[10px] text-cyan-400/70 block mb-1">FILE NAME (.txt, .md, .json, .log)</label>
                    <input
                      type="text"
                      placeholder="e.g. notes.txt or summary.md"
                      value={newFileName}
                      onChange={(e) => setNewFileName(e.target.value)}
                      className="w-full px-3 py-1.5 bg-black/50 border border-cyan-500/30 rounded-lg text-xs text-white placeholder-cyan-500/30 focus:outline-none focus:border-cyan-400"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-cyan-400/70 block mb-1">CONTENT</label>
                    <textarea
                      rows={4}
                      placeholder="Enter file text content..."
                      value={newFileContent}
                      onChange={(e) => setNewFileContent(e.target.value)}
                      className="w-full px-3 py-1.5 bg-black/50 border border-cyan-500/30 rounded-lg text-xs text-white placeholder-cyan-500/30 focus:outline-none focus:border-cyan-400 font-mono"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-xs text-cyan-300/80 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newFileOverwrite}
                      onChange={(e) => setNewFileOverwrite(e.target.checked)}
                      className="rounded bg-black border-cyan-500 text-cyan-400"
                    />
                    <span>Allow overwrite if file already exists</span>
                  </label>
                </div>
                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-orbitron text-xs font-bold"
                  >
                    Create With Approval
                  </button>
                </div>
              </form>
            )}

            {/* Read File Preview Card */}
            {selectedFileContent && (
              <div className="p-3.5 rounded-xl bg-black/60 border border-cyan-400/40 space-y-2">
                <div className="flex items-center justify-between border-b border-cyan-500/20 pb-2">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-cyan-400" />
                    <span className="font-orbitron font-bold text-xs text-white">{selectedFileContent.name}</span>
                    <span className="text-[10px] text-cyan-400/70">
                      ({selectedFileContent.lines} lines, {selectedFileContent.size} bytes)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedFileContent(null)}
                    className="text-cyan-400/60 hover:text-white text-xs"
                  >
                    Close Preview
                  </button>
                </div>
                <pre className="max-h-56 overflow-y-auto p-2.5 rounded bg-black/80 border border-cyan-500/20 text-xs text-cyan-100 font-mono whitespace-pre-wrap leading-relaxed no-scrollbar">
                  {selectedFileContent.content}
                </pre>
              </div>
            )}

            {/* File search & items listing */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-orbitron font-bold text-white">
                  DIRECTORY ITEMS ({filteredFolderItems.length})
                </span>
                <input
                  type="text"
                  placeholder="Filter files by name..."
                  value={fileSearch}
                  onChange={(e) => setFileSearch(e.target.value)}
                  className="px-2.5 py-1 bg-black/50 border border-cyan-500/30 rounded text-xs text-white placeholder-cyan-500/40 focus:outline-none focus:border-cyan-400 w-48"
                />
              </div>

              {isLoadingFolder ? (
                <div className="p-8 text-center text-xs text-cyan-400/60 font-mono">
                  Scanning directory contents...
                </div>
              ) : filteredFolderItems.length === 0 ? (
                <div className="p-8 text-center text-xs text-cyan-400/60 border border-cyan-500/10 rounded-xl bg-black/20">
                  {selectedFolder ? 'No matching files found in authorized folder.' : 'Select a folder to view files.'}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {filteredFolderItems.map((item) => (
                    <div
                      key={item.path}
                      className="p-2.5 rounded-lg bg-black/40 border border-cyan-500/20 hover:border-cyan-500/40 flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {item.isDirectory ? (
                          <Folder className="w-4 h-4 text-amber-400 shrink-0" />
                        ) : (
                          <FileText className="w-4 h-4 text-cyan-400 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <span className="text-xs text-white font-medium truncate block">{item.name}</span>
                          <span className="text-[10px] text-cyan-400/60 block">
                            {item.isDirectory ? 'Directory' : `${item.sizeBytes} bytes • ${item.extension || 'file'}`}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {!item.isDirectory && (
                          <button
                            type="button"
                            onClick={() => handleReadFile(item.path)}
                            className="px-2 py-0.5 rounded bg-cyan-950/80 border border-cyan-500/40 text-[10px] text-cyan-200 hover:text-white"
                          >
                            Read
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (item.isDirectory) {
                              setSelectedFolder(item.path);
                              loadFolderContents(item.path);
                            } else {
                              desktopBridge.openFile(item.path);
                            }
                          }}
                          className="px-2 py-0.5 rounded bg-cyan-500/20 border border-cyan-400/50 text-[10px] text-white hover:bg-cyan-500/30"
                        >
                          {item.isDirectory ? 'Open Dir' : 'Open'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ======================= TAB 3: BROWSER ASSISTANT ======================= */}
        {activeSubTab === 'BROWSER' && (
          <div className="space-y-4">
            <div className="p-3.5 rounded-xl bg-black/40 border border-cyan-500/25 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-orbitron font-bold text-xs text-white">WEB BROWSER ASSISTANT & INSPECTOR</span>
                <span className="px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-500/40 text-[9px] text-emerald-300">
                  SSRF SAFE
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="https://example.com"
                  value={browserUrl}
                  onChange={(e) => setBrowserUrl(e.target.value)}
                  className="flex-1 px-3 py-1.5 bg-black/50 border border-cyan-500/30 rounded-lg text-xs text-white placeholder-cyan-500/40 focus:outline-none focus:border-cyan-400 font-mono"
                />
                <button
                  type="button"
                  onClick={() => handleOpenBrowser(browserUrl)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/20 border border-cyan-400 text-white font-orbitron text-xs font-bold hover:bg-cyan-500/30"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open Browser</span>
                </button>
                <button
                  type="button"
                  disabled={isInspectingUrl}
                  onClick={handleInspectWebPage}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-950/70 border border-cyan-500/40 text-cyan-200 hover:text-white font-orbitron text-xs disabled:opacity-50"
                >
                  <Eye className={`w-3.5 h-3.5 ${isInspectingUrl ? 'animate-spin text-cyan-400' : ''}`} />
                  <span>{isInspectingUrl ? 'Inspecting...' : 'Inspect Page'}</span>
                </button>
              </div>

              {/* Quick Presets */}
              <div className="flex items-center gap-2 text-xs">
                <span className="text-[10px] text-cyan-400/60 font-orbitron">QUICK PRESETS:</span>
                {[
                  { name: 'GitHub', url: 'https://github.com' },
                  { name: 'Wikipedia', url: 'https://wikipedia.org' },
                  { name: 'Three.js Docs', url: 'https://threejs.org/docs/' },
                  { name: 'Spotify Web', url: 'https://open.spotify.com' }
                ].map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => setBrowserUrl(p.url)}
                    className="px-2 py-0.5 rounded bg-black/50 border border-cyan-500/20 text-[10px] text-cyan-300 hover:text-white"
                  >
                    {p.name}
                  </button>
                ))}
              </div>

              {browserStatusMsg && (
                <div className="p-2 rounded bg-cyan-950/40 border border-cyan-500/30 text-xs text-cyan-200">
                  {browserStatusMsg}
                </div>
              )}
            </div>

            {/* Web Inspection Result Card */}
            {inspectionResult && (
              <div className="p-3.5 rounded-xl bg-black/60 border border-cyan-400/40 space-y-2">
                <div className="flex items-center justify-between border-b border-cyan-500/20 pb-2">
                  <span className="font-orbitron font-bold text-xs text-white">PAGE INSPECTION SUMMARY</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[9px] font-mono ${
                      inspectionResult.ok
                        ? 'bg-emerald-950/80 border border-emerald-500/40 text-emerald-300'
                        : 'bg-red-950/80 border border-red-500/30 text-red-300'
                    }`}
                  >
                    {inspectionResult.ok ? `STATUS ${inspectionResult.status}` : 'INSPECTION ERROR'}
                  </span>
                </div>
                {inspectionResult.ok ? (
                  <div className="space-y-1.5 text-xs">
                    <div>
                      <span className="text-cyan-400/70 font-semibold">Title: </span>
                      <span className="text-white">{inspectionResult.title || 'Untitled'}</span>
                    </div>
                    <div>
                      <span className="text-cyan-400/70 font-semibold">URL: </span>
                      <span className="text-cyan-300 font-mono">{inspectionResult.url}</span>
                    </div>
                    {inspectionResult.description && (
                      <div>
                        <span className="text-cyan-400/70 font-semibold">Description: </span>
                        <span className="text-cyan-100">{inspectionResult.description}</span>
                      </div>
                    )}
                    {inspectionResult.previewText && (
                      <div className="pt-1">
                        <span className="text-cyan-400/70 font-semibold block mb-1">Snippet Preview:</span>
                        <p className="p-2.5 rounded bg-black/80 border border-cyan-500/20 text-[11px] text-cyan-200 leading-relaxed font-mono">
                          {inspectionResult.previewText}
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-red-300">{inspectionResult.error}</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ======================= TAB 4: MEDIA CONTROL ======================= */}
        {activeSubTab === 'MEDIA' && (
          <div className="space-y-4">
            <div className="p-3.5 rounded-xl bg-black/40 border border-cyan-500/25 space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-orbitron font-bold text-xs text-white">MEDIA & AUDIO CONTROLLER</span>
                <span className="px-2 py-0.5 rounded bg-cyan-950/80 border border-cyan-500/30 text-[9px] text-cyan-300 uppercase">
                  {musicState.status}
                </span>
              </div>

              {/* Status card */}
              <div className="p-3 rounded-lg bg-black/60 border border-cyan-500/20 space-y-1">
                <span className="text-[10px] text-cyan-400/60 block font-orbitron">ACTIVE TRACK / SOURCE</span>
                <span className="text-xs text-white font-semibold block">
                  {musicState.trackTitle || 'No active audio track'}
                </span>
                <span className="text-[10px] text-cyan-300/70 block">
                  {musicState.statusMessage}
                </span>
              </div>

              {/* Controls */}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    audioService.playChirp(1200);
                    musicService.resume();
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-orbitron text-xs font-bold"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Play / Resume</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    audioService.playChirp(1100);
                    musicService.pause();
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-orbitron text-xs font-bold"
                >
                  <Pause className="w-3.5 h-3.5" />
                  <span>Pause</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    audioService.playChirp(900);
                    musicService.stop();
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-red-950/70 border border-red-500/40 text-red-200 hover:text-white font-orbitron text-xs"
                >
                  <Square className="w-3.5 h-3.5" />
                  <span>Stop</span>
                </button>

                {/* Volume slider */}
                <div className="flex items-center gap-2 ml-auto">
                  <Volume2 className="w-4 h-4 text-cyan-400" />
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={volume}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      setVolume(v);
                      musicService.setVolume(v);
                    }}
                    className="w-24 accent-cyan-400 cursor-pointer"
                  />
                  <span className="text-[10px] text-cyan-300 tabular-nums w-8">
                    {Math.round(volume * 100)}%
                  </span>
                </div>
              </div>

              {/* External Music Service */}
              <div className="pt-2 border-t border-cyan-500/20 flex flex-wrap items-center justify-between gap-3">
                <span className="text-[10px] text-cyan-400/80">
                  External Music Applications & Streaming Services:
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      audioService.playActivationWhoosh();
                      desktopBridge.launchMusicApp('SPOTIFY');
                    }}
                    className="px-3 py-1 rounded-lg bg-emerald-950/80 border border-emerald-500/40 text-emerald-200 hover:text-white text-xs font-orbitron font-bold"
                  >
                    Launch Spotify
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      desktopBridge.openBrowser('https://open.spotify.com');
                    }}
                    className="px-3 py-1 rounded-lg bg-cyan-950/80 border border-cyan-500/40 text-cyan-200 hover:text-white text-xs font-orbitron"
                  >
                    Spotify Web
                  </button>
                </div>
              </div>
            </div>

            {/* Honest notification note */}
            <div className="p-3 rounded-lg bg-cyan-950/20 border border-cyan-500/20 flex items-start gap-2 text-[11px] text-cyan-300/80">
              <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
              <span>
                Direct playback control operates on local audio files and synthesis. External streaming applications (e.g. Spotify) are launched securely into their native desktop environment.
              </span>
            </div>
          </div>
        )}

        {/* ======================= TAB 5: MULTI-STEP WORKFLOWS ======================= */}
        {activeSubTab === 'WORKFLOWS' && (
          <div className="space-y-4">
            {/* Active Workflow Card */}
            {activeWorkflow ? (
              <div className="p-4 rounded-xl bg-black/60 border border-cyan-400/50 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <span className="font-orbitron font-bold text-sm text-white">{activeWorkflow.title}</span>
                    <span className="text-xs text-cyan-300/80 block">{activeWorkflow.description}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-orbitron font-bold uppercase ${
                        activeWorkflow.status === 'RUNNING'
                          ? 'bg-cyan-500/25 border border-cyan-400 text-cyan-200 animate-pulse'
                          : activeWorkflow.status === 'COMPLETED'
                          ? 'bg-emerald-950/80 border border-emerald-500/40 text-emerald-300'
                          : 'bg-red-950/80 border border-red-500/30 text-red-300'
                      }`}
                    >
                      {activeWorkflow.status}
                    </span>
                    {(activeWorkflow.status === 'RUNNING' || activeWorkflow.status === 'WAITING_PERMISSION') && (
                      <button
                        type="button"
                        onClick={() => {
                          audioService.playChirp(800);
                          desktopWorkflowService.cancelCurrentWorkflow();
                        }}
                        className="px-2.5 py-1 rounded bg-red-950/80 border border-red-500/40 text-red-200 hover:text-white text-xs font-orbitron font-bold"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-cyan-400/70">WORKFLOW PROGRESS</span>
                    <span className="text-white font-bold">{activeWorkflow.progressPercent}%</span>
                  </div>
                  <div className="w-full h-2 bg-black/60 rounded-full border border-cyan-500/30 overflow-hidden">
                    <div
                      className="h-full bg-cyan-400 transition-all duration-300 shadow-[0_0_8px_rgba(0,240,255,0.6)]"
                      style={{ width: `${activeWorkflow.progressPercent}%` }}
                    />
                  </div>
                </div>

                {/* Steps List */}
                <div className="space-y-2 pt-2 border-t border-cyan-500/20">
                  {activeWorkflow.steps.map((st, idx) => (
                    <div
                      key={st.id}
                      className={`p-2.5 rounded-lg border text-xs flex items-start justify-between gap-3 ${
                        st.status === 'COMPLETED'
                          ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-100'
                          : st.status === 'RUNNING'
                          ? 'bg-cyan-950/40 border-cyan-400 text-cyan-100 animate-pulse'
                          : st.status === 'FAILED'
                          ? 'bg-red-950/30 border-red-500/30 text-red-200'
                          : 'bg-black/40 border-cyan-500/10 text-cyan-400/60'
                      }`}
                    >
                      <div className="space-y-0.5">
                        <span className="font-orbitron font-bold text-white block">{st.name}</span>
                        <span className="text-[10px] text-cyan-300/70 block">{st.description}</span>
                        {st.resultSummary && (
                          <span className="text-[10px] text-emerald-300 block font-mono">
                            ✓ {st.resultSummary}
                          </span>
                        )}
                        {st.error && (
                          <span className="text-[10px] text-red-300 block font-mono">
                            ✕ {st.error}
                          </span>
                        )}
                      </div>
                      <span className="text-[9px] uppercase font-mono px-1.5 py-0.5 rounded bg-black/40">
                        {st.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Workflow Launcher Card */}
            <div className="p-3.5 rounded-xl bg-black/40 border border-cyan-500/25 space-y-3">
              <span className="font-orbitron font-bold text-xs text-white">
                LAUNCH PRE-CONFIGURED WORKFLOW TEMPLATE
              </span>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-cyan-400/70 block mb-1">TARGET FOLDER</label>
                  <input
                    type="text"
                    value={wfFolderName}
                    onChange={(e) => setWfFolderName(e.target.value)}
                    placeholder="Folder path or name"
                    className="w-full px-2.5 py-1.5 bg-black/50 border border-cyan-500/30 rounded text-xs text-white placeholder-cyan-500/30 focus:outline-none focus:border-cyan-400"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-cyan-400/70 block mb-1">FILE TO AUDIT</label>
                  <input
                    type="text"
                    value={wfFileName}
                    onChange={(e) => setWfFileName(e.target.value)}
                    placeholder="notes.txt"
                    className="w-full px-2.5 py-1.5 bg-black/50 border border-cyan-500/30 rounded text-xs text-white placeholder-cyan-500/30 focus:outline-none focus:border-cyan-400"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-cyan-400/70 block mb-1">SUMMARY OUTPUT FILE</label>
                  <input
                    type="text"
                    value={wfSaveName}
                    onChange={(e) => setWfSaveName(e.target.value)}
                    placeholder="summary.txt"
                    className="w-full px-2.5 py-1.5 bg-black/50 border border-cyan-500/30 rounded text-xs text-white placeholder-cyan-500/30 focus:outline-none focus:border-cyan-400"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleLaunchWorkflow}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-cyan-500/20 border border-cyan-400 text-white font-orbitron text-xs font-bold hover:bg-cyan-500/30"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Start Audit & Summary Workflow</span>
                </button>
              </div>
            </div>

            {/* Workflow Audit History */}
            <div className="space-y-2">
              <span className="font-orbitron font-bold text-xs text-white">WORKFLOW AUDIT HISTORY</span>
              {workflowAudits.length === 0 ? (
                <div className="p-4 text-center text-xs text-cyan-400/60 border border-cyan-500/10 rounded-lg bg-black/20">
                  No workflow history recorded yet.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {workflowAudits.map((a) => (
                    <div
                      key={a.id}
                      className="p-2.5 rounded-lg bg-black/40 border border-cyan-500/20 flex items-center justify-between text-xs"
                    >
                      <div className="space-y-0.5">
                        <span className="font-orbitron font-bold text-white">{a.title}</span>
                        <span className="text-[10px] text-cyan-400/60 block">
                          {new Date(a.timestamp).toLocaleTimeString()} • {a.stepsCompleted}/{a.stepsTotal} steps completed
                        </span>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded text-[9px] font-mono uppercase ${
                          a.status === 'COMPLETED'
                            ? 'bg-emerald-950/80 border border-emerald-500/40 text-emerald-300'
                            : 'bg-red-950/80 border border-red-500/30 text-red-300'
                        }`}
                      >
                        {a.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ======================= TAB 6: ACTION APPROVAL CENTER ======================= */}
        {activeSubTab === 'APPROVAL' && (
          <div className="space-y-4">
            {pendingPermission ? (
              <div
                data-testid="approval-center-card"
                className="p-4 rounded-xl border border-amber-400/80 bg-amber-950/40 text-amber-100 space-y-3 shadow-[0_0_24px_rgba(245,158,11,0.2)]"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="w-5 h-5 text-amber-400" />
                    <span className="font-orbitron font-extrabold text-sm text-amber-200">
                      ACTION REQUIRING USER APPROVAL
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-400/50 text-amber-300 text-[10px] font-mono uppercase">
                    {pendingPermission.category}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div className="p-2.5 rounded bg-black/50 border border-amber-500/20 space-y-1">
                    <span className="text-[10px] text-amber-300/70 font-orbitron block">REQUESTED ACTION</span>
                    <span className="text-white font-bold block">{pendingPermission.requestedAction}</span>
                  </div>
                  <div className="p-2.5 rounded bg-black/50 border border-amber-500/20 space-y-1">
                    <span className="text-[10px] text-amber-300/70 font-orbitron block">TARGET SYSTEM RESOURCE</span>
                    <span className="text-white font-bold block break-all">{pendingPermission.target}</span>
                  </div>
                </div>

                <div className="p-2.5 rounded bg-black/50 border border-amber-500/20 space-y-1 text-xs">
                  <span className="text-[10px] text-amber-300/70 font-orbitron block">JUSTIFICATION & REASON</span>
                  <p className="text-amber-100 leading-relaxed">{pendingPermission.reason}</p>
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      audioService.playActivationWhoosh();
                      onApprovePermission(pendingPermission.id);
                    }}
                    className="flex-1 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-orbitron text-xs font-bold transition-all shadow-[0_0_12px_rgba(16,185,129,0.3)]"
                  >
                    APPROVE ONCE (Execute Single-Use)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      audioService.playChirp(700);
                      onDenyPermission(pendingPermission.id);
                    }}
                    className="px-5 py-2 rounded-lg bg-red-950/80 hover:bg-red-900 border border-red-500/50 text-red-200 font-orbitron text-xs font-bold"
                  >
                    DENY
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      audioService.playChirp(600);
                      onCancelPermission(pendingPermission.id);
                    }}
                    className="px-4 py-2 rounded-lg bg-black/60 hover:text-white border border-cyan-500/30 text-cyan-300 font-orbitron text-xs"
                  >
                    CANCEL
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-8 text-center rounded-xl bg-black/30 border border-cyan-500/20 space-y-2">
                <ShieldCheck className="w-8 h-8 text-emerald-400 mx-auto" />
                <span className="font-orbitron font-bold text-sm text-white block">
                  NO PENDING ACTIONS AWAITING APPROVAL
                </span>
                <p className="text-xs text-cyan-400/60 max-w-md mx-auto">
                  When JARVIS requests access to your desktop, applications, files, or external browser, a single-use approval prompt will appear here for verification.
                </p>
              </div>
            )}

            {/* Permission Policy & Security Summary */}
            <div className="p-3.5 rounded-xl bg-black/40 border border-cyan-500/25 space-y-2.5 text-xs">
              <span className="font-orbitron font-bold text-xs text-white block">
                SECURITY ARCHITECTURE & RESTRICTIONS
              </span>
              <ul className="space-y-1 text-cyan-300/80 text-[11px] list-disc list-inside">
                <li>Strict allowlist enforcement: Only pre-mapped safe executables can be invoked.</li>
                <li>Zero arbitrary shell execution: Direct command injection and scripts are strictly rejected.</li>
                <li>Path traversal protection: Relative parent escapes (..) and encoded paths are blocked.</li>
                <li>Executable file prevention: .exe, .bat, .cmd, .sh, .ps1 cannot be created or read.</li>
                <li>SSRF protection: Localhost and internal private subnets cannot be inspected.</li>
                <li>Single-use approval tokens: Permissions expire immediately after execution.</li>
              </ul>
            </div>
          </div>
        )}

        {/* ======================= TAB 7: AUDIT & HISTORY ======================= */}
        {activeSubTab === 'AUDIT' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <span className="font-orbitron font-bold text-xs text-white">
                RECENT DESKTOP TOOLS & OPERATIONS
              </span>
              {recentTools.length === 0 ? (
                <div className="p-8 text-center text-xs text-cyan-400/60 border border-cyan-500/10 rounded-xl bg-black/20">
                  No tool execution records yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {recentTools.map((rec) => (
                    <div
                      key={rec.id}
                      className="p-3 rounded-lg bg-black/40 border border-cyan-500/20 space-y-1 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-orbitron font-bold text-cyan-300">{rec.name}</span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-mono uppercase ${
                            rec.ok
                              ? 'bg-emerald-950/80 border border-emerald-500/40 text-emerald-300'
                              : 'bg-red-950/80 border border-red-500/30 text-red-300'
                          }`}
                        >
                          {rec.ok ? 'SUCCESS' : 'FAILED'}
                        </span>
                      </div>
                      <p className="text-cyan-100/90 text-[11px] leading-snug">{rec.summary}</p>
                      <span className="text-[9px] text-cyan-400/50 block">
                        {new Date(rec.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
