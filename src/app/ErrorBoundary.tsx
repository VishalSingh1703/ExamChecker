import { Component, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/**
 * Top-level error boundary: any render crash shows a recoverable screen
 * instead of a white page, and offers a reload.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-ink-50 dark:bg-ink-950 bg-desk flex items-center justify-center p-6">
          <div className="bg-white dark:bg-ink-900 rounded-xl border border-ink-200 dark:border-ink-700 shadow-lift p-8 max-w-md w-full text-center">
            <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
              </svg>
            </div>
            <h2 className="font-display text-lg font-semibold text-ink-900 dark:text-ink-100 mb-1">Something went wrong</h2>
            <p className="text-sm text-ink-500 dark:text-ink-400 mb-5 break-words">
              {this.state.error.message}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="w-full py-2.5 bg-accent-700 text-white rounded-xl text-sm font-semibold hover:bg-accent-800 transition-colors"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
