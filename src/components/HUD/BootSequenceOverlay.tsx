import React, { useEffect, useState } from 'react';

interface BootSequenceOverlayProps {
  onProgress?: (progress: number) => void;
  onComplete: () => void;
}

const BOOT_STEPS = [
  'CALIBRATING VOLUMETRIC PROJECTION MATRIX',
  'IGNITING FRESNEL PLASMA CORE',
  'ALIGNING GYROSCOPIC ORBITAL ARCS',
  'VISION X SPATIAL INTELLIGENCE READY'
];

export const BootSequenceOverlay: React.FC<BootSequenceOverlayProps> = ({ onProgress, onComplete }) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [fadingOut, setFadingOut] = useState(false);

  useEffect(() => {
    const start = performance.now();
    const duration = 2100;
    let rafId = 0;

    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setProgress(p);
      onProgress?.(p);

      if (p < 0.28) setStepIndex(0);
      else if (p < 0.56) setStepIndex(1);
      else if (p < 0.85) setStepIndex(2);
      else setStepIndex(3);

      if (p < 1) {
        rafId = requestAnimationFrame(tick);
      } else {
        setFadingOut(true);
      }
    };

    rafId = requestAnimationFrame(tick);
    const doneTimer = window.setTimeout(() => {
      onProgress?.(1);
      onComplete();
    }, duration + 260);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(doneTimer);
    };
  }, [onComplete, onProgress]);

  const handleSkip = () => {
    onProgress?.(1);
    onComplete();
  };

  return (
    <div
      onClick={handleSkip}
      data-testid="boot-sequence-overlay"
      title="Click anywhere to skip initialization sequence"
      className={`fixed inset-x-0 bottom-8 z-50 flex flex-col items-center justify-end pointer-events-auto cursor-pointer transition-opacity duration-300 select-none ${
        fadingOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      <div className="w-[360px] max-w-[90vw] px-4 py-3 rounded-lg bg-[#020812]/80 border border-cyan-500/35 shadow-[0_0_24px_rgba(0,240,255,0.18)]">
        <div className="flex items-center justify-between mb-2">
          <span className="font-orbitron font-bold text-xs tracking-[0.22em] text-white">
            J.A.R.V.I.S. // VISION X
          </span>
          <span className="font-mono text-[10px] text-cyan-300 tabular-nums">
            {Math.round(progress * 100)}%
          </span>
        </div>

        <div className="w-full h-1 bg-cyan-950/80 rounded-full overflow-hidden mb-2.5">
          <div
            className="h-full bg-gradient-to-r from-cyan-400 to-white transition-all duration-75"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>

        <div className="space-y-1 font-mono text-[10px] text-cyan-300/85">
          {BOOT_STEPS.map((label, idx) => (
            <div
              key={label}
              className={`flex items-center justify-between transition-opacity duration-200 ${
                idx <= stepIndex ? 'opacity-100' : 'opacity-30'
              }`}
            >
              <span className="truncate">{label}</span>
              <span className={idx <= stepIndex ? 'text-emerald-400 font-bold' : 'text-cyan-700'}>
                {idx < stepIndex || progress >= 1 ? 'OK' : idx === stepIndex ? 'INIT' : '...'}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-2 text-center text-[9px] font-mono text-cyan-400/60 tracking-widest">
          CLICK ANYWHERE TO SKIP INITIALIZATION
        </div>
      </div>
    </div>
  );
};
