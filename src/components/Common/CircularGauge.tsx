import React from 'react';

interface CircularGaugeProps {
  value: number; // 0 to 100
  label: string;
  unit?: string;
  size?: number;
  color?: string;
}

export const CircularGauge: React.FC<CircularGaugeProps> = ({
  value,
  label,
  unit = '%',
  size = 72,
  color = '#00f0ff'
}) => {
  const strokeWidth = 5;
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const clampedValue = Math.max(0, Math.min(100, value));
  const strokeDashoffset = circumference - (clampedValue / 100) * circumference;

  return (
    <div className="flex flex-col items-center justify-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg className="w-full h-full -rotate-90 transform" viewBox={`0 0 ${size} ${size}`}>
          {/* Background track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="transparent"
            stroke="rgba(0, 240, 255, 0.15)"
            strokeWidth={strokeWidth}
          />
          {/* Value track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="transparent"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-300 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center font-mono">
          <span className="text-xs font-bold leading-none text-white">
            {Math.round(clampedValue)}
            <span className="text-[9px] text-cyan-400 ml-0.5">{unit}</span>
          </span>
        </div>
      </div>
      <span className="text-[10px] uppercase font-mono tracking-wider text-cyan-400/80 mt-1">
        {label}
      </span>
    </div>
  );
};
