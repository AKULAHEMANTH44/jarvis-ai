import React, { useState, useEffect } from 'react';
import { HolographicPanel } from '../Common/HolographicPanel';
import { SpatialObjectState, LayoutFormation, HologramModelId } from '../../types/hologram';
import { AutomationTask } from '../../types/assistant';
import { automationEngine } from '../../services/automationEngine';
import { desktopBridge } from '../../services/desktopBridge';
import { audioService } from '../../services/soundFx';
import {
  Layers,
  Copy,
  Trash2,
  Plus,
  Play,
  RotateCcw,
  Clock,
  Save,
  FolderOpen,
  ClipboardCheck,
  CheckCircle,
  AlertTriangle,
  Move,
  Pin,
  Minimize2,
  Maximize2,
  Workflow,
  Sparkles
} from 'lucide-react';

interface FloatingSpatialPanelsProps {
  spatialObjects: SpatialObjectState[];
  selectedObjectId: string | null;
  onSelectObject: (id: string) => void;
  onAddObject: (modelId: HologramModelId) => void;
  onDuplicateObject: (id: string) => void;
  onDeleteObject: (id: string) => void;
  onApplyFormation: (formation: LayoutFormation) => void;
  notes: string;
  onUpdateNotes: (notes: string) => void;
}

export const FloatingSpatialPanels: React.FC<FloatingSpatialPanelsProps> = ({
  spatialObjects,
  selectedObjectId,
  onSelectObject,
  onAddObject,
  onDuplicateObject,
  onDeleteObject,
  onApplyFormation,
  notes,
  onUpdateNotes
}) => {
  const [tasks, setTasks] = useState<AutomationTask[]>([]);
  const [timerSeconds, setTimerSeconds] = useState<number>(0);
  const [timerActive, setTimerActive] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'OBJECTS' | 'AUTOMATION' | 'NOTES' | 'TIMER'>('OBJECTS');
  const [copiedNote, setCopiedNote] = useState<boolean>(false);

  // Subscribe to automation tasks
  useEffect(() => {
    return automationEngine.subscribe((updated) => {
      setTasks(updated);
    });
  }, []);

  // Timer interval
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (timerActive) {
      interval = setInterval(() => {
        setTimerSeconds(s => s + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [timerActive]);

  const handleSaveNotesFile = async () => {
    audioService.playChirp(1200);
    const approved = await desktopBridge.requestAuthorization(
      'FILE_WRITE',
      'stark_lab_notes.txt',
      'Export mission telemetry notes to authorized local file system.'
    );
    if (approved) {
      await desktopBridge.saveAuthorizedFile('stark_lab_notes.txt', notes);
    }
  };

  const handleOpenFile = async () => {
    audioService.playChirp(1200);
    const file = await desktopBridge.readAuthorizedFile();
    if (file) {
      onUpdateNotes(`${notes}\n\n[IMPORTED: ${file.name}]\n${file.content}`);
    }
  };

  const handleCopyNotes = async () => {
    const ok = await desktopBridge.copyToClipboard(notes);
    if (ok) {
      setCopiedNote(true);
      setTimeout(() => setCopiedNote(false), 2000);
    }
  };

  const runQuickAutomation = (type: 'DIAGNOSTIC' | 'ORBIT_SWEEP' | 'OVERCLOCK') => {
    audioService.playChirp(1400);
    if (type === 'DIAGNOSTIC') {
      automationEngine.createTask(
        'Autonomous Sensor & Optical Calibration Sweep',
        'Verify camera frames, landmark smoothing, and containment flux.',
        [
          { description: 'Testing optical sensor stream fidelity', action: () => audioService.playChirp(1200) },
          { description: 'Synchronizing 21 3D hand landmarks', action: () => audioService.playChirp(1400) },
          { description: 'Evaluating magnetic containment coherence', action: () => audioService.playActivationWhoosh() }
        ]
      );
    } else if (type === 'ORBIT_SWEEP') {
      automationEngine.createTask(
        'Spatial Orbital Matrix Reconfiguration',
        'Reorganize active models into satellite orbital geometry.',
        [
          { description: 'Duplicating selected primary module', action: () => {
            if (selectedObjectId) onDuplicateObject(selectedObjectId);
          }},
          { description: 'Calculating equidistant orbital trajectories', action: () => audioService.playChirp(1500) },
          { description: 'Applying 3D orbital formation vectors', action: () => onApplyFormation('ORBIT') }
        ]
      );
    } else if (type === 'OVERCLOCK') {
      automationEngine.createTask(
        'Reactor Overclock & High-Yield Pulse Protocol',
        'Overclock containment output and discharge radial shockwave wave.',
        [
          { description: 'Diverting secondary plasma channels to primary core', action: () => audioService.playChirp(1600) },
          { description: 'Discharging radial energy shockwave wave', action: () => audioService.playShockwave() },
          { description: 'Engaging exploded component telemetry view', action: () => audioService.playActivationWhoosh() }
        ],
        ['HIGH_ENERGY_DISCHARGE']
      );
    }
  };

  return (
    <div className="w-96 flex flex-col space-y-2 pointer-events-auto text-xs select-none">
      {/* Workspace Navigation Tabs */}
      <div className="flex bg-black/70 border border-cyan-500/40 rounded-lg p-1 space-x-1">
        <button
          onClick={() => { audioService.playChirp(1200); setActiveTab('OBJECTS'); }}
          className={`flex-1 py-1 rounded font-orbitron text-[10px] tracking-wider transition-all ${
            activeTab === 'OBJECTS'
              ? 'bg-cyan-500/30 text-white border border-cyan-400 font-bold'
              : 'text-cyan-400/70 hover:text-cyan-200'
          }`}
        >
          SPATIAL
        </button>
        <button
          onClick={() => { audioService.playChirp(1200); setActiveTab('AUTOMATION'); }}
          className={`flex-1 py-1 rounded font-orbitron text-[10px] tracking-wider transition-all ${
            activeTab === 'AUTOMATION'
              ? 'bg-cyan-500/30 text-white border border-cyan-400 font-bold'
              : 'text-cyan-400/70 hover:text-cyan-200'
          }`}
        >
          AUTONOMY
        </button>
        <button
          onClick={() => { audioService.playChirp(1200); setActiveTab('NOTES'); }}
          className={`flex-1 py-1 rounded font-orbitron text-[10px] tracking-wider transition-all ${
            activeTab === 'NOTES'
              ? 'bg-cyan-500/30 text-white border border-cyan-400 font-bold'
              : 'text-cyan-400/70 hover:text-cyan-200'
          }`}
        >
          MEMO
        </button>
        <button
          onClick={() => { audioService.playChirp(1200); setActiveTab('TIMER'); }}
          className={`flex-1 py-1 rounded font-orbitron text-[10px] tracking-wider transition-all ${
            activeTab === 'TIMER'
              ? 'bg-cyan-500/30 text-white border border-cyan-400 font-bold'
              : 'text-cyan-400/70 hover:text-cyan-200'
          }`}
        >
          CLOCK
        </button>
      </div>

      {/* TAB 1: Multi-Object Spatial Hierarchy & Layout */}
      {activeTab === 'OBJECTS' && (
        <HolographicPanel
          title="SPATIAL OBJECT MATRIX"
          subtitle={`${spatialObjects.length} ACTIVE 3D ENTITIES`}
          icon={<Layers className="w-4 h-4 text-cyan-400" />}
        >
          <div className="space-y-3">
            {/* Object Instances List */}
            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
              {spatialObjects.map((obj) => (
                <div
                  key={obj.id}
                  onClick={() => { audioService.playChirp(1400); onSelectObject(obj.id); }}
                  className={`p-2 rounded border flex items-center justify-between cursor-pointer transition-all ${
                    obj.id === selectedObjectId
                      ? 'border-cyan-400 bg-cyan-500/25 shadow-[0_0_12px_rgba(0,240,255,0.4)] text-white'
                      : 'border-cyan-500/20 bg-black/40 hover:bg-cyan-950/40 text-cyan-300'
                  }`}
                >
                  <div className="flex flex-col">
                    <span className="font-orbitron font-bold text-[11px]">{obj.name}</span>
                    <span className="font-mono text-[9px] text-cyan-400/70">
                      ID: {obj.id.slice(0, 12)} • SCALE: {obj.scale.toFixed(2)}x
                    </span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); onDuplicateObject(obj.id); }}
                      title="Duplicate Object"
                      className="p-1 hover:text-white rounded border border-cyan-500/30 bg-cyan-950/40"
                    >
                      <Copy className="w-3 h-3 text-cyan-300" />
                    </button>
                    {spatialObjects.length > 1 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onDeleteObject(obj.id); }}
                        title="Delete Object"
                        className="p-1 hover:text-red-300 rounded border border-red-500/30 bg-red-950/40"
                      >
                        <Trash2 className="w-3 h-3 text-red-400" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Spawn New Spatial Object */}
            <div className="pt-2 border-t border-cyan-500/20">
              <span className="text-[10px] font-mono text-cyan-400/70 block mb-1">
                SPAWN SPATIAL PROJECTION:
              </span>
              <div className="grid grid-cols-2 gap-1.5 font-mono text-[10px]">
                <button
                  onClick={() => onAddObject('arc_reactor')}
                  className="p-1.5 rounded bg-cyan-950/40 hover:bg-cyan-500/20 border border-cyan-500/30 text-left"
                >
                  + Arc Reactor MK-7
                </button>
                <button
                  onClick={() => onAddObject('quantum_tesseract')}
                  className="p-1.5 rounded bg-cyan-950/40 hover:bg-cyan-500/20 border border-cyan-500/30 text-left"
                >
                  + Quantum Tesseract
                </button>
                <button
                  onClick={() => onAddObject('carbon_buckyball')}
                  className="p-1.5 rounded bg-cyan-950/40 hover:bg-cyan-500/20 border border-cyan-500/30 text-left"
                >
                  + Fullerene C60
                </button>
                <button
                  onClick={() => onAddObject('hologram_datachart')}
                  className="p-1.5 rounded bg-cyan-950/40 hover:bg-cyan-500/20 border border-cyan-500/30 text-left"
                >
                  + Telemetry Chart
                </button>
              </div>
            </div>

            {/* Spatial Layout Formations */}
            <div className="pt-2 border-t border-cyan-500/20">
              <span className="text-[10px] font-mono text-cyan-400/70 block mb-1">
                SPATIAL FORMATIONS:
              </span>
              <div className="flex space-x-1.5">
                <button
                  onClick={() => { audioService.playActivationWhoosh(); onApplyFormation('ORBIT'); }}
                  className="flex-1 py-1 rounded bg-cyan-950/50 hover:bg-cyan-500/30 border border-cyan-500/40 font-orbitron text-[9px] text-white"
                >
                  ORBIT
                </button>
                <button
                  onClick={() => { audioService.playActivationWhoosh(); onApplyFormation('GRID'); }}
                  className="flex-1 py-1 rounded bg-cyan-950/50 hover:bg-cyan-500/30 border border-cyan-500/40 font-orbitron text-[9px] text-white"
                >
                  GRID
                </button>
                <button
                  onClick={() => { audioService.playActivationWhoosh(); onApplyFormation('LINE'); }}
                  className="flex-1 py-1 rounded bg-cyan-950/50 hover:bg-cyan-500/30 border border-cyan-500/40 font-orbitron text-[9px] text-white"
                >
                  LINEUP
                </button>
                <button
                  onClick={() => { audioService.playActivationWhoosh(); onApplyFormation('SINGLE'); }}
                  className="flex-1 py-1 rounded bg-cyan-950/50 hover:bg-cyan-500/30 border border-cyan-500/40 font-orbitron text-[9px] text-white"
                >
                  CENTER
                </button>
              </div>
            </div>
          </div>
        </HolographicPanel>
      )}

      {/* TAB 2: Autonomous Task Execution Pipeline */}
      {activeTab === 'AUTOMATION' && (
        <HolographicPanel
          title="AUTONOMOUS TASK ENGINE"
          subtitle="MULTI-STEP PIPELINE"
          icon={<Workflow className="w-4 h-4 text-cyan-400" />}
          headerRight={
            <button
              onClick={() => automationEngine.clearCompleted()}
              className="text-[9px] font-mono text-cyan-400/70 hover:text-white"
            >
              CLEAR DONE
            </button>
          }
        >
          <div className="space-y-3">
            {/* Quick Automation Protocol Buttons */}
            <div>
              <span className="text-[10px] font-mono text-cyan-400/70 block mb-1">
                EXECUTE STARK PROTOCOL:
              </span>
              <div className="flex flex-col space-y-1">
                <button
                  onClick={() => runQuickAutomation('DIAGNOSTIC')}
                  className="p-1.5 rounded bg-cyan-950/40 hover:bg-cyan-500/20 border border-cyan-500/30 text-left font-mono text-[10px] text-cyan-200 flex items-center justify-between"
                >
                  <span>▶ Diagnostic Sensor Sweep</span>
                  <Sparkles className="w-3 h-3 text-cyan-400" />
                </button>
                <button
                  onClick={() => runQuickAutomation('ORBIT_SWEEP')}
                  className="p-1.5 rounded bg-cyan-950/40 hover:bg-cyan-500/20 border border-cyan-500/30 text-left font-mono text-[10px] text-cyan-200 flex items-center justify-between"
                >
                  <span>▶ Reconfigure Orbital Array</span>
                  <Sparkles className="w-3 h-3 text-cyan-400" />
                </button>
                <button
                  onClick={() => runQuickAutomation('OVERCLOCK')}
                  className="p-1.5 rounded bg-amber-950/30 hover:bg-amber-900/40 border border-amber-500/40 text-left font-mono text-[10px] text-amber-200 flex items-center justify-between"
                >
                  <span>▶ High-Yield Overclock Pulse</span>
                  <AlertTriangle className="w-3 h-3 text-amber-400" />
                </button>
              </div>
            </div>

            {/* Active & Queued Tasks */}
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {tasks.length === 0 ? (
                <div className="text-[11px] font-mono text-cyan-400/60 p-3 bg-black/40 rounded border border-cyan-500/20 text-center">
                  Task execution queue idle. Speak or trigger a protocol to execute.
                </div>
              ) : (
                tasks.map((task) => (
                  <div
                    key={task.id}
                    className="p-2 rounded bg-black/60 border border-cyan-500/30 space-y-1.5 text-xs font-mono"
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-orbitron font-bold text-white text-[11px]">
                        {task.title}
                      </span>
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded border ${
                          task.status === 'COMPLETED'
                            ? 'border-emerald-500 text-emerald-300 bg-emerald-950/40'
                            : task.status === 'RUNNING'
                            ? 'border-cyan-400 text-cyan-300 bg-cyan-950/40 animate-pulse'
                            : task.status === 'WAITING_CONFIRMATION'
                            ? 'border-amber-400 text-amber-300 bg-amber-950/40'
                            : 'border-red-500 text-red-300 bg-red-950/40'
                        }`}
                      >
                        {task.status}
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full h-1 bg-black rounded-full overflow-hidden border border-cyan-500/30">
                      <div
                        className="h-full bg-cyan-400 transition-all duration-300"
                        style={{ width: `${task.progressPercent}%` }}
                      />
                    </div>

                    {/* Step details */}
                    <div className="space-y-0.5 pt-1 text-[10px]">
                      {task.steps.map((st, idx) => (
                        <div key={st.id} className="flex items-center space-x-1.5 text-cyan-300/80">
                          {st.status === 'DONE' ? (
                            <CheckCircle className="w-3 h-3 text-emerald-400" />
                          ) : st.status === 'EXECUTING' ? (
                            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                          ) : (
                            <span className="w-2 h-2 rounded-full bg-cyan-800" />
                          )}
                          <span>
                            {idx + 1}. {st.description}
                          </span>
                        </div>
                      ))}
                    </div>

                    {task.status === 'WAITING_CONFIRMATION' && (
                      <div className="flex space-x-1 pt-1">
                        <button
                          onClick={() => automationEngine.confirmTask(task.id)}
                          className="flex-1 py-1 rounded bg-emerald-500/30 hover:bg-emerald-500/50 text-white font-bold text-[10px] border border-emerald-400"
                        >
                          CONFIRM & EXECUTE
                        </button>
                        <button
                          onClick={() => automationEngine.cancelTask(task.id)}
                          className="py-1 px-2 rounded bg-red-950/40 text-red-300 text-[10px] border border-red-500/40"
                        >
                          CANCEL
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </HolographicPanel>
      )}

      {/* TAB 3: Mission Notes & File Integration */}
      {activeTab === 'NOTES' && (
        <HolographicPanel
          title="MISSION MEMORANDUM // NOTES"
          subtitle="LOCAL-FIRST PERSISTENT SCRATCHPAD"
          icon={<Save className="w-4 h-4 text-cyan-400" />}
          headerRight={
            <div className="flex space-x-1">
              <button
                onClick={handleCopyNotes}
                title="Copy to Clipboard"
                className="p-1 text-cyan-400 hover:text-white rounded border border-cyan-500/30"
              >
                {copiedNote ? <ClipboardCheck className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={handleOpenFile}
                title="Open Local File"
                className="p-1 text-cyan-400 hover:text-white rounded border border-cyan-500/30"
              >
                <FolderOpen className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleSaveNotesFile}
                title="Save Notes to Local File"
                className="p-1 text-cyan-400 hover:text-white rounded border border-cyan-500/30"
              >
                <Save className="w-3.5 h-3.5" />
              </button>
            </div>
          }
        >
          <div className="space-y-2">
            <textarea
              value={notes}
              onChange={(e) => onUpdateNotes(e.target.value)}
              rows={7}
              placeholder="Record Stark Industries mission logs, code snippets, or diagnostics..."
              className="w-full bg-black/70 border border-cyan-500/40 rounded p-2 font-mono text-[11px] text-cyan-100 placeholder-cyan-500/40 focus:outline-none focus:border-cyan-400 resize-none"
            />
            <div className="flex justify-between items-center text-[10px] font-mono text-cyan-400/70">
              <span>{notes.length} characters</span>
              <span>DESKTOP BRIDGE: SECURE LOCAL ACCESS</span>
            </div>
          </div>
        </HolographicPanel>
      )}

      {/* TAB 4: Chronometer & Overclock Timer */}
      {activeTab === 'TIMER' && (
        <HolographicPanel
          title="OVERCLOCK CHRONOMETER"
          subtitle="REACTOR RUNTIME TRACKER"
          icon={<Clock className="w-4 h-4 text-cyan-400" />}
        >
          <div className="space-y-4 py-2 text-center">
            <div className="font-mono text-4xl font-extrabold text-white tracking-widest drop-shadow-[0_0_15px_rgba(0,240,255,0.6)]">
              {Math.floor(timerSeconds / 60).toString().padStart(2, '0')}:{(timerSeconds % 60).toString().padStart(2, '0')}
            </div>

            <div className="flex justify-center space-x-2">
              <button
                onClick={() => {
                  audioService.playChirp(timerActive ? 900 : 1600);
                  setTimerActive(!timerActive);
                }}
                className={`py-1.5 px-4 rounded font-orbitron font-bold text-xs border transition-all ${
                  timerActive
                    ? 'border-red-500 bg-red-950/40 text-red-300'
                    : 'border-cyan-400 bg-cyan-500/30 text-white'
                }`}
              >
                {timerActive ? 'PAUSE TIMER' : 'START TIMER'}
              </button>
              <button
                onClick={() => {
                  audioService.playChirp(1000);
                  setTimerActive(false);
                  setTimerSeconds(0);
                }}
                className="py-1.5 px-3 rounded font-orbitron text-xs border border-cyan-500/40 bg-cyan-950/30 text-cyan-300 hover:bg-cyan-500/20"
              >
                RESET
              </button>
            </div>

            {/* Quick Presets */}
            <div className="flex justify-center space-x-2 pt-2 border-t border-cyan-500/20">
              <button
                onClick={() => { audioService.playChirp(1200); setTimerSeconds(300); }}
                className="px-2 py-0.5 rounded bg-cyan-950/40 border border-cyan-500/30 text-[10px] font-mono text-cyan-300"
              >
                +5 MIN
              </button>
              <button
                onClick={() => { audioService.playChirp(1200); setTimerSeconds(900); }}
                className="px-2 py-0.5 rounded bg-cyan-950/40 border border-cyan-500/30 text-[10px] font-mono text-cyan-300"
              >
                +15 MIN
              </button>
              <button
                onClick={() => { audioService.playChirp(1200); setTimerSeconds(1800); }}
                className="px-2 py-0.5 rounded bg-cyan-950/40 border border-cyan-500/30 text-[10px] font-mono text-cyan-300"
              >
                +30 MIN
              </button>
            </div>
          </div>
        </HolographicPanel>
      )}
    </div>
  );
};
