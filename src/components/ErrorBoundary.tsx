import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { downloadText } from '../lib/download';
import { STORAGE_KEY } from '../lib/storage';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last line of defence. Persisted data is validated before it reaches the app,
 * so a crash here should not be able to destroy anything; the raw blob is
 * still downloadable so a bad release cannot trap a user's history.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error', error, info.componentStack);
  }

  private downloadRaw = () => {
    try {
      const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
      if (!raw) return;
      downloadText(raw, 'fitbod-raw-state.json');
    } catch {
      // The fallback screen has nothing more it can safely do.
    }
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="recovery">
        <h1 className="greeting">Something went wrong</h1>
        <p className="muted">
          The interface hit an unexpected error. Your saved data has not been deleted.
        </p>
        <pre className="error-detail">{this.state.error.message}</pre>
        <div className="data-actions">
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload app
          </button>
          <button className="btn" onClick={this.downloadRaw}>
            Download stored data
          </button>
        </div>
        <p className="muted">
          If reloading repeats the error, download the data and restore it after the app is fixed.
        </p>
      </div>
    );
  }
}
