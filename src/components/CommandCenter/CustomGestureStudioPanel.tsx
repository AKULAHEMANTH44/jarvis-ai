import React, { useState, useEffect } from 'react';
import { Sparkles, Plus, Trash2, Edit2, Play, CheckCircle, AlertTriangle, RefreshCw, Hand, Shield } from 'lucide-react';
import { customGestureService, CustomGestureProfile } from '../../services/customGestureService';
import { handTrackingService } from '../../services/handTracking';
import { GestureDetectionResult } from '../../types/gesture';

interface CustomGestureStudioPanelProps {
  onActionTriggered?: (actionId: string) => void;
  gestureResult?: GestureDetectionResult | null;
}

const AVAILABLE_ACTIONS = [
  { id: 'NEXT_MODEL', label: 'Cycle Next 3D Hologram Model' },
  { id: 'PREV_MODEL', label: 'Cycle Previous 3D Hologram Model' },
  { id: 'TRIGGER_SHOCKWAVE', label: 'Trigger Holographic Energy Shockwave' },
  { id: 'TOGGLE_DISPERSION', label: 'Toggle 3D Dispersion / Explosion' },
  { id: 'RESET_CAMERA', label: 'Reset Camera & Framing' },
  { id: 'ROTATE_360', label: 'Trigger 360-Degree Spatial Rotation' },
  { id: 'VOICE_LISTEN', label: 'Activate Voice Console Listen' },
  { id: 'SYSTEM_DIAGNOSTICS', label: 'Run System AI Diagnostics' }
];

export const CustomGestureStudioPanel: React.FC<CustomGestureStudioPanelProps> = ({ onActionTriggered, gestureResult }) => {
  const [profiles, setProfiles] = useState<CustomGestureProfile[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [actionId, setActionId] = useState('NEXT_MODEL');
  const [tolerance, setTolerance] = useState(0.045);

  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [recordingCount, setRecordingCount] = useState(0);
  const [recordingStatus, setRecordingStatus] = useState<string>('');
  const [lastDetectedCustom, setLastDetectedCustom] = useState<string | null>(null);

  useEffect(() => {
    refreshProfiles();
  }, []);

  useEffect(() => {
    if (gestureResult && gestureResult.customGestureMatch) {
      setLastDetectedCustom(gestureResult.customGestureMatch.name);
      if (onActionTriggered) {
        onActionTriggered(gestureResult.customGestureMatch.actionId);
      }
      const t = setTimeout(() => setLastDetectedCustom(null), 2500);
      return () => clearTimeout(t);
    }
  }, [gestureResult, onActionTriggered]);

  const refreshProfiles = () => {
    setProfiles(customGestureService.getProfiles());
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    if (editingId) {
      customGestureService.updateProfile(editingId, {
        name,
        description,
        actionId,
        tolerance
      });
      setEditingId(null);
    } else {
      customGestureService.createProfile({
        name,
        description,
        actionId,
        tolerance,
        enabled: true
      });
    }

    setName('');
    setDescription('');
    setActionId('NEXT_MODEL');
    setTolerance(0.045);
    setIsCreating(false);
    refreshProfiles();
  };

  const startRecording = (profileId: string) => {
    setRecordingId(profileId);
    setRecordingCount(0);
    setRecordingStatus('Hold hand in custom gesture position in front of webcam...');

    let samplesCaptured = 0;
    const timer = setInterval(() => {
      const state = handTrackingService.getLastResult();
      if (state && state.landmarks && state.landmarks.length > 0) {
        const rawLandmarks = state.landmarks[0];
        const landmarks = rawLandmarks.map((l) => ({ x: l.x, y: l.y, z: l.z || 0 }));
        const ok = customGestureService.addSampleToProfile(profileId, landmarks);
        if (ok) {
          samplesCaptured++;
          setRecordingCount(samplesCaptured);
          setRecordingStatus(`Captured sample ${samplesCaptured} / 15... Hold steady.`);
        }
      }

      if (samplesCaptured >= 15) {
        clearInterval(timer);
        setRecordingId(null);
        setRecordingStatus('Training complete! Gesture profile updated.');
        refreshProfiles();
        setTimeout(() => setRecordingStatus(''), 3000);
      }
    }, 200);
  };

  const handleEdit = (profile: CustomGestureProfile) => {
    setEditingId(profile.id);
    setName(profile.name);
    setDescription(profile.description);
    setActionId(profile.actionId);
    setTolerance(profile.tolerance);
    setIsCreating(true);
  };

  const handleDelete = (id: string) => {
    customGestureService.deleteProfile(id);
    refreshProfiles();
  };

  const handleToggle = (id: string) => {
    customGestureService.toggleProfile(id);
    refreshProfiles();
  };

  const handleReset = () => {
    if (window.confirm('Reset all custom gestures to default Stark profiles?')) {
      customGestureService.resetToDefaults();
      refreshProfiles();
    }
  };

  return (
    <div className="bg-slate-900/90 border border-cyan-500/30 rounded-xl p-5 text-cyan-200 shadow-[0_0_25px_rgba(0,240,255,0.15)] backdrop-blur-md">
      <div className="flex items-center justify-between mb-4 border-b border-cyan-500/20 pb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-cyan-400 animate-pulse" />
          <h2 className="text-lg font-semibold tracking-wider text-cyan-100 uppercase">Custom Gesture Studio</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setEditingId(null);
              setName('');
              setDescription('');
              setActionId('NEXT_MODEL');
              setTolerance(0.045);
              setIsCreating(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 rounded-lg text-xs font-semibold text-cyan-200 transition-all shadow-[0_0_10px_rgba(0,240,255,0.2)]"
          >
            <Plus className="w-4 h-4" /> New Gesture
          </button>
          <button
            onClick={handleReset}
            title="Reset to defaults"
            className="p-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-slate-400 hover:text-cyan-300 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {lastDetectedCustom && (
        <div className="mb-4 bg-cyan-500/20 border border-cyan-400/60 p-3 rounded-lg flex items-center gap-3 animate-bounce">
          <CheckCircle className="w-5 h-5 text-cyan-300" />
          <div>
            <div className="text-xs uppercase tracking-wider text-cyan-300 font-bold">Custom Gesture Triggered</div>
            <div className="text-sm font-semibold text-white">{lastDetectedCustom}</div>
          </div>
        </div>
      )}

      {recordingStatus && (
        <div className="mb-4 bg-amber-500/20 border border-amber-500/40 p-3 rounded-lg flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 animate-spin" />
          <div className="text-sm text-amber-200 font-medium">{recordingStatus}</div>
        </div>
      )}

      {isCreating && (
        <form onSubmit={handleSaveProfile} className="bg-slate-950/80 border border-cyan-500/40 rounded-xl p-4 mb-5 space-y-3">
          <h3 className="text-sm font-semibold text-cyan-300 uppercase tracking-wide">
            {editingId ? 'Edit Custom Gesture Profile' : 'Create New Custom Gesture'}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-cyan-400 mb-1">Gesture Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Stark Snap"
                className="w-full bg-slate-900 border border-cyan-500/30 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-400"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-cyan-400 mb-1">Assigned JARVIS Action</label>
              <select
                value={actionId}
                onChange={(e) => setActionId(e.target.value)}
                className="w-full bg-slate-900 border border-cyan-500/30 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-400"
              >
                {AVAILABLE_ACTIONS.map((act) => (
                  <option key={act.id} value={act.id}>
                    {act.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-cyan-400 mb-1">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief explanation of hand posture"
              className="w-full bg-slate-900 border border-cyan-500/30 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-400"
            />
          </div>
          <div>
            <label className="block text-xs text-cyan-400 mb-1">Matching Tolerance: {tolerance.toFixed(3)}</label>
            <input
              type="range"
              min="0.02"
              max="0.09"
              step="0.005"
              value={tolerance}
              onChange={(e) => setTolerance(parseFloat(e.target.value))}
              className="w-full accent-cyan-400"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold rounded-lg text-xs shadow-[0_0_12px_rgba(0,240,255,0.4)]"
            >
              {editingId ? 'Update Profile' : 'Save & Train'}
            </button>
          </div>
        </form>
      )}

      <div className="space-y-3">
        {profiles.map((profile) => {
          const isRecordingThis = recordingId === profile.id;
          const mappedAction = AVAILABLE_ACTIONS.find((a) => a.id === profile.actionId)?.label || profile.actionId;

          return (
            <div
              key={profile.id}
              className={`bg-slate-950/60 border rounded-xl p-4 transition-all flex flex-col md:flex-row items-start md:items-center justify-between gap-4 ${
                profile.enabled ? 'border-cyan-500/40 shadow-[0_0_15px_rgba(0,240,255,0.08)]' : 'border-slate-800 opacity-60'
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Hand className="w-4 h-4 text-cyan-400" />
                  <h4 className="font-bold text-white text-sm">{profile.name}</h4>
                  <span className="text-xs bg-cyan-500/20 text-cyan-300 px-2 py-0.5 rounded border border-cyan-500/30">
                    {profile.samples.length} samples trained
                  </span>
                </div>
                <p className="text-xs text-slate-400">{profile.description || 'No description provided.'}</p>
                <div className="text-xs text-cyan-400 font-mono flex items-center gap-1.5 pt-1">
                  <Shield className="w-3.5 h-3.5 text-cyan-400" /> Action: {mappedAction}
                </div>
              </div>

              <div className="flex items-center gap-2 self-end md:self-center">
                <button
                  onClick={() => startRecording(profile.id)}
                  disabled={isRecordingThis}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    isRecordingThis
                      ? 'bg-amber-500 text-slate-950 animate-pulse'
                      : 'bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-200'
                  }`}
                >
                  <Play className="w-3.5 h-3.5" /> {isRecordingThis ? `Recording (${recordingCount}/15)...` : 'Train / Record'}
                </button>
                <button
                  onClick={() => handleToggle(profile.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                    profile.enabled
                      ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                      : 'bg-slate-800 border-slate-700 text-slate-400'
                  }`}
                >
                  {profile.enabled ? 'Active' : 'Disabled'}
                </button>
                <button
                  onClick={() => handleEdit(profile)}
                  className="p-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-slate-300 hover:text-white"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleDelete(profile.id)}
                  className="p-1.5 bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 rounded-lg text-rose-300"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}

        {profiles.length === 0 && (
          <div className="text-center py-8 text-slate-500 text-sm">
            No custom gesture profiles configured. Click "New Gesture" to train custom hand postures.
          </div>
        )}
      </div>
    </div>
  );
};
