import React from 'react';
import { AlertTriangle, RotateCcw, Home } from 'lucide-react';

interface ErrorBoundaryProps {
  name: string;
  fallbackTitle?: string;
  children: React.ReactNode;
  onReset?: () => void;
  onNavigateHome?: () => void;
  compact?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'Unexpected rendering error.'
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.warn(`[ErrorBoundary:${this.props.name}] Caught error:`, error.message, errorInfo.componentStack);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, errorMessage: null });
    this.props.onReset?.();
  };

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const title = this.props.fallbackTitle || `${this.props.name} encountered a recoverable error`;

    return (
      <div
        role="alert"
        className={`rounded-xl border border-rose-500/45 bg-[#0a050b]/95 text-rose-100 font-mono ${
          this.props.compact ? 'p-3 space-y-2' : 'p-5 space-y-3'
        }`}
      >
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div className="min-w-0 space-y-1">
            <div className="font-orbitron font-bold text-xs tracking-wider text-white">
              {title}
            </div>
            <p className="text-[11px] text-rose-200/85 break-words">
              {this.state.errorMessage || 'Subsystem isolated safely so other JARVIS controls remain responsive.'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={this.handleRetry}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cyan-400/60 bg-cyan-950/50 hover:bg-cyan-500/25 text-cyan-200 text-xs font-orbitron transition-colors focus-visible:outline-2 focus-visible:outline-cyan-400"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            RETRY MODULE
          </button>
          {this.props.onNavigateHome && (
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, errorMessage: null });
                this.props.onNavigateHome?.();
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cyan-500/30 bg-black/50 hover:bg-cyan-950/40 text-cyan-300 text-xs font-orbitron transition-colors focus-visible:outline-2 focus-visible:outline-cyan-400"
            >
              <Home className="w-3.5 h-3.5" />
              RETURN TO DASHBOARD
            </button>
          )}
        </div>
      </div>
    );
  }
}
