import React from 'react';
import { ShieldAlert, CheckCircle, XCircle } from 'lucide-react';
import { HolographicPanel } from '../Common/HolographicPanel';
import { DesktopPermissionRequest } from '../../types/assistant';
import { audioService } from '../../services/soundFx';

interface PermissionModalProps {
  request: DesktopPermissionRequest | null;
  onConfirm: () => void;
  onReject: () => void;
}

export const PermissionConfirmationModal: React.FC<PermissionModalProps> = ({
  request,
  onConfirm,
  onReject
}) => {
  if (!request) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in select-none">
      <div className="w-full max-w-md border-2 border-amber-400/80 shadow-[0_0_35px_rgba(255,170,0,0.5)] rounded-lg overflow-hidden">
        <HolographicPanel
          title="SECURITY PROTOCOL // AUTHORIZATION REQUIRED"
          subtitle="STARK INDUSTRIES DIRECTIVE 10-A"
          icon={<ShieldAlert className="w-5 h-5 text-amber-400 animate-pulse" />}
          className="bg-black/95 border-none"
        >
          <div className="space-y-4 py-2 font-mono text-xs">
            <div className="p-3 bg-amber-950/30 border border-amber-500/40 rounded text-amber-200 space-y-1">
              <div className="flex justify-between text-[11px] font-bold">
                <span className="text-amber-400">ACTION TYPE:</span>
                <span className="font-orbitron">{request.action}</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-amber-400">TARGET:</span>
                <span className="text-white font-bold truncate max-w-[220px]">{request.target}</span>
              </div>
              <div className="text-[10px] text-amber-300/80 pt-1 border-t border-amber-500/20">
                {request.reason}
              </div>
            </div>

            <p className="text-[11px] text-cyan-300/90 leading-relaxed">
              J.A.R.V.I.S. requires your explicit verification before executing this consequential operation. Proceed with authorized directive?
            </p>

            <div className="flex space-x-3 pt-2">
              <button
                onClick={() => {
                  audioService.playChirp(800);
                  onReject();
                }}
                className="flex-1 py-2 px-3 rounded border border-red-500/50 bg-red-950/40 hover:bg-red-900/50 text-red-300 font-orbitron font-bold text-xs flex items-center justify-center space-x-1.5 transition-all"
              >
                <XCircle className="w-4 h-4" />
                <span>DENY & ABORT</span>
              </button>
              <button
                onClick={() => {
                  audioService.playActivationWhoosh();
                  onConfirm();
                }}
                className="flex-1 py-2 px-3 rounded border border-emerald-400 bg-emerald-500/30 hover:bg-emerald-500/50 text-white font-orbitron font-bold text-xs flex items-center justify-center space-x-1.5 shadow-[0_0_15px_rgba(0,255,170,0.4)] transition-all"
              >
                <CheckCircle className="w-4 h-4 text-emerald-300" />
                <span>AUTHORIZE</span>
              </button>
            </div>
          </div>
        </HolographicPanel>
      </div>
    </div>
  );
};
