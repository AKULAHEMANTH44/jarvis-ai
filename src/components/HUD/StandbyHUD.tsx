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
      data-testid="standby-overlay"
      className="absolute inset-0 z-40 bg-[#02060c]/25 flex flex-col items-center justify-between py-12 cursor-pointer select-none transition-opacity duration-500"
    >
      <div className="text-center space-y-1.5">
        <div className="font-orbitron font-extrabold text-lg tracking-[0.35em] text-white/90">
          J.A.R.V.I.S. // STANDBY
        </div>
        <div className="font-mono text-cyan-300/70 tracking-widest text-[11px]">
          POWER CONSERVATION · VISION X CORE IDLE
        </div>
      </div>

      <div className="text-center space-y-4">
        <div className="font-mono text-3xl font-bold text-white/90 tracking-widest drop-shadow-[0_0_16px_rgba(0,240,255,0.45)]">
          {time}
        </div>
        <div className="px-5 py-2 rounded border border-cyan-400/45 bg-[#020914]/80 text-cyan-200 font-mono text-xs tracking-widest">
          SHOW OPEN PALM OR CLICK ANYWHERE TO WAKE SYSTEM
        </div>
      </div>
    </div>
  );
};
