import React from 'react';

interface HolographicPanelProps {
  title?: string;
  subtitle?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  headerRight?: React.ReactNode;
}

export const HolographicPanel: React.FC<HolographicPanelProps> = ({
  title,
  subtitle,
  icon,
  children,
  className = '',
  headerRight
}) => {
  return (
    <div
      className={`relative backdrop-blur-md bg-opacity-70 bg-[#041424] border border-cyan-500/30 rounded-lg p-3 text-cyan-400 shadow-[0_0_20px_rgba(0,240,255,0.15)] transition-all duration-300 ${className}`}
    >
      {/* Corner Bracket Accents */}
      <div className="absolute -top-[1px] -left-[1px] w-3 h-3 border-t-2 border-l-2 border-cyan-400 pointer-events-none" />
      <div className="absolute -top-[1px] -right-[1px] w-3 h-3 border-t-2 border-r-2 border-cyan-400 pointer-events-none" />
      <div className="absolute -bottom-[1px] -left-[1px] w-3 h-3 border-b-2 border-l-2 border-cyan-400 pointer-events-none" />
      <div className="absolute -bottom-[1px] -right-[1px] w-3 h-3 border-b-2 border-r-2 border-cyan-400 pointer-events-none" />

      {/* Header bar */}
      {(title || icon) && (
        <div className="flex items-center justify-between pb-2 mb-2 border-b border-cyan-500/20 text-xs tracking-wider">
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
