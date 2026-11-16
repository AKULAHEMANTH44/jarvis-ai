import React from 'react';
import { ListTodo, CheckCircle2, Clock, ArrowRight } from 'lucide-react';
import { ExecutionPlan } from '../../types/assistant';

interface MissionTimelineProps {
  latestPlan: ExecutionPlan | null;
  onOpenPlan: () => void;
  onOpenTasks: () => void;
}

export const MissionTimeline: React.FC<MissionTimelineProps> = ({
  latestPlan,
  onOpenPlan,
  onOpenTasks
}) => {
  return (
    <div className="bg-[#020814]/90 border border-cyan-500/30 rounded-xl p-3.5 flex flex-col space-y-3 shadow-[0_0_20px_rgba(0,240,255,0.1)]">
      <div className="flex items-center justify-between border-b border-cyan-500/20 pb-2">
        <div className="flex items-center gap-2">
          <ListTodo className="w-4 h-4 text-cyan-400" />
          <span className="font-orbitron font-bold text-xs text-white tracking-wider">MISSION TIMELINE</span>
        </div>
        <button
          type="button"
          onClick={onOpenTasks}
          className="text-[10px] font-mono text-cyan-300 hover:text-white flex items-center gap-1"
        >
          <span>View All</span>
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      <div className="space-y-2 font-mono text-[11px]">
        {latestPlan ? (
          <div className="p-2.5 rounded bg-black/40 border border-cyan-500/30 space-y-2">
            <div className="flex items-center justify-between text-[10px]">
              <span className="font-orbitron font-bold text-cyan-200">{latestPlan.objective}</span>
              <span className="text-cyan-400/70 capitalize">{latestPlan.status.toLowerCase()}</span>
            </div>
            <div className="space-y-1">
              {latestPlan.steps.slice(0, 3).map((step, idx) => (
                <div key={step.id} className="flex items-center gap-2 text-[10px]">
                  <span className={`w-3 h-3 rounded-full flex items-center justify-center text-[8px] ${step.status === 'COMPLETED' ? 'bg-emerald-500 text-black font-bold' : 'bg-cyan-950 border border-cyan-500/40 text-cyan-300'}`}>
                    {idx + 1}
                  </span>
                  <span className={`truncate ${step.status === 'COMPLETED' ? 'line-through text-cyan-500/60' : 'text-white'}`}>
                    {step.description}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="p-3 rounded bg-black/40 border border-cyan-500/20 text-center text-cyan-400/60 text-[11px]">
            No active multi-step mission plan. Say "Prepare my project for demonstration" to initiate.
          </div>
        )}
      </div>
    </div>
  );
};
