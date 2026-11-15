import React, { useEffect, useState } from 'react';
import { audioService } from '../../services/soundFx';

interface StandbyHUDProps {
  onWake: () => void;
}

export const StandbyHUD: React.FC<StandbyHUDProps> = ({ onWake }) => {
  const [time, setTime] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString('en-US', { hour12: false }));
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleWake = () => {
    audioService.playActivationWhoosh();
    onWake();
  };

  return (
    <div
      onClick={handleWake}
      className="absolute inset-0 z-50 bg-[#02070e]/95 backdrop-blur-xl flex flex-col items-center justify-center cursor-pointer select-none transition-all duration-700"
    >
      {/* Central Pulsing Arc Reactor */}
      <div className="relative flex items-center justify-center mb-8">
        <div className="absolute w-72 h-72 rounded-full border border-cyan-400/20 animate-spin-slow pointer-events-none" />
        <div className="absolute w-56 h-56 rounded-full border border-cyan-500/30 animate-spin-reverse pointer-events-none" />
        <div className="w-40 h-40 rounded-full border-2 border-cyan-400/60 flex items-center justify-center shadow-[0_0_50px_rgba(0,240,255,0.4)] animate-pulse-slow">
          <img src="/jarvis-arc.svg" alt="Arc Reactor Standby" className="w-28 h-28" />
        </div>
      </div>

      {/* Standby Typography */}
      <div className="text-center space-y-2">
        <div className="font-orbitron font-extrabold text-2xl tracking-[0.3em] text-white">
          J.A.R.V.I.S.
        </div>
        <div className="font-mono text-cyan-400/70 tracking-widest text-xs">
          SYSTEM STANDBY // POWER CONSERVATION MODE
        </div>
        <div className="font-mono text-3xl font-bold text-white tracking-widest pt-2">
          {time}
        </div>
      </div>

      {/* Wakeup Prompt */}
      <div className="mt-12 flex items-center space-x-2 px-4 py-2 rounded-full border border-cyan-500/40 bg-cyan-950/40 text-cyan-300 font-mono text-xs tracking-wider animate-bounce">
        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
        <span>SHOW OPEN PALM OR CLICK ANYWHERE TO WAKE SYSTEM</span>
      </div>
    </div>
  );
};
