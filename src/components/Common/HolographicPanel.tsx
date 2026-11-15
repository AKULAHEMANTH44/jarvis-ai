import React from 'react';

interface HolographicPanelProps {
  title?: string;
  subtitle?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  headerRight?: React.ReactNode;
  reactive?: boolean;
  scanLine?: boolean;
}

export const HolographicPanel: React.FC<HolographicPanelProps> = ({
  title,
  subtitle,
  icon,
  children,
  className = '',
  headerRight,
  reactive = false,
  scanLine = true
}) => {
  return (
    <div
      className={`relative overflow-hidden bg-[#020914]/90 border rounded-lg p-3 text-cyan-400 transition-colors duration-200 ${
        reactive
          ? 'border-cyan-300/75 shadow-[0_0_24px_rgba(0,240,255,0.22)]'
          : 'border-cyan-500/30 shadow-[0_0_16px_rgba(0,240,255,0.12)]'
      } ${className}`}
    >
      {/* Subtle Holographic Scan Sweep Layer */}
      {scanLine && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-transparent via-cyan-400/10 to-transparent hud-scan-line"
        />
      )}

      {/* Corner Bracket Accents */}
      <div className="absolute -top-[1px] -left-[1px] w-3 h-3 border-t-2 border-l-2 border-cyan-400 pointer-events-none" />
      <div className="absolute -top-[1px] -right-[1px] w-3 h-3 border-t-2 border-r-2 border-cyan-400 pointer-events-none" />
      <div className="absolute -bottom-[1px] -left-[1px] w-3 h-3 border-b-2 border-l-2 border-cyan-400 pointer-events-none" />
      <div className="absolute -bottom-[1px] -right-[1px] w-3 h-3 border-b-2 border-r-2 border-cyan-400 pointer-events-none" />

      {/* Header bar */}
      {(title || icon) && (
        <div className="relative z-10 flex items-center justify-between pb-2 mb-2 border-b border-cyan-500/20 text-xs tracking-wider">
          <div className="flex items-center space-x-2 font-orbitron font-semibold text-cyan-300">
            {icon && <span className="text-cyan-400">{icon}</span>}
            <div className="flex flex-col">
              <span className="uppercase">{title}</span>
              {subtitle && <span className="text-[10px] text-cyan-500/70 font-mono">{subtitle}</span>}
            </div>
          </div>
          {headerRight && <div className="flex items-center space-x-1.5">{headerRight}</div>}
        </div>
      )}

      {/* Body Content */}
      <div className="relative z-10">{children}</div>
    </div>
  );
};
