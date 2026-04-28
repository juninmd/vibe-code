import { Component, cloneElement, type ReactElement, type ReactNode } from "react";

interface FallbackProps {
  error: Error;
  resetError: () => void;
}

interface Props {
  children: ReactNode;
  fallback?: ReactElement<FallbackProps> | null;
  onError?: (error: Error, info: React.ErrorInfo) => void;
}

interface State {
  error: Error | null;
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null, hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error, hasError: true };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  resetError = (): void => {
    this.setState({ error: null, hasError: false });
  };

  override render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return cloneElement(this.props.fallback, {
          error: this.state.error,
          resetError: this.resetError,
        });
      }

      return (
        <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
          <div className="flex flex-col items-center gap-4 text-center max-w-md">
            <div className="w-16 h-16 rounded-full bg-danger/15 border border-danger/30 flex items-center justify-center">
<svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-danger"
                  aria-label="Error icon"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>

            <div className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold text-primary">Algo deu errado</h2>
              <p className="text-sm text-secondary">
                Ocorreu um erro inesperado. Você pode tentar novamente ou reportar o problema.
              </p>
            </div>

            <div className="w-full p-3 rounded-lg bg-surface/50 border border-strong/40 text-xs font-mono text-dimmed overflow-auto max-h-24">
              {this.state.error.message}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={this.resetError}
              className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors cursor-pointer"
            >
              Tentar novamente
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-lg border border-strong text-secondary text-sm font-medium hover:bg-surface-hover transition-colors cursor-pointer"
            >
              Recarregar página
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
