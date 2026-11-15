import React, { useEffect, useState } from 'react';

interface BootSequenceOverlayProps {
  onComplete: () => void;
}

const BOOT_STEPS = [
  'CALIBRATING VOLUMETRIC PROJECTION MATRIX',
  'INITIALIZING HOLOGRAPHIC CORE & GIMBAL RINGS',
  'LOADING MEDIAPIPE 21-LANDMARK HAND PIPELINE',
  'STARK MARK VII SPATIAL LAB READY'
];

export const BootSequenceOverlay: React.FC<BootSequenceOverlayProps> = ({ onComplete }) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [fadingOut, setFadingOut] = useState(false);

  useEffect(() => {
    const t1 = window.setTimeout(() => setStepIndex(1), 350);
    const t2 = window.setTimeout(() => setStepIndex(2), 700);
    const t3 = window.setTimeout(() => setStepIndex(3), 1050);
    const tFade = window.setTimeout(() => setFadingOut(true), 1350);
    const tDone = window.setTimeout(() => onComplete(), 1650);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(tFade);
      clearTimeout(tDone);
    };
  }, [onComplete]);

  return (
    <div
      onClick={onComplete}
      title="Click anywhere to skip initialization sequence"
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#02070e]/95 cursor-pointer transition-opacity duration-300 select-none ${
        fadingOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      <div className="relative w-44 h-44 flex items-center justify-center mb-6">
        <div className="absolute inset-0 rounded-full border-2 border-dashed border-cyan-400/60 animate-[spin_6s_linear_infinite]" />
        <div className="absolute inset-3 rounded-full border border-cyan-300/80 animate-[spin_3s_linear_infinite_reverse]" />
        <div className="absolute inset-7 rounded-full border border-cyan-500/40" />
        <img src="/jarvis-arc.svg" alt="JARVIS Core" className="w-16 h-16 drop-shadow-[0_0_20px_rgba(0,240,255,0.85)]" />
      </div>

      <h1 className="font-orbitron font-black text-xl tracking-[0.28em] text-white glow-cyan mb-2">
        J.A.R.V.I.S. // MARK VII
      </h1>

      <div className="w-72 space-y-1.5 font-mono text-[10px] text-cyan-300/85">
        {BOOT_STEPS.map((label, idx) => (
          <div
            key={label}
            className={`flex items-center justify-between transition-opacity duration-200 ${
              idx <= stepIndex ? 'opacity-100' : 'opacity-25'
            }`}
          >
            <span className="truncate">{label}</span>
            <span className={idx <= stepIndex ? 'text-emerald-400 font-bold' : 'text-cyan-700'}>
              {idx <= stepIndex ? 'OK' : '...'}
            </span>
          </div>
        ))}
      </div>

      <span className="mt-5 text-[9px] font-mono text-cyan-500/60 tracking-widest">
        TAP TO BYPASS INITIALIZATION
      </span>
    </div>
  );
};
