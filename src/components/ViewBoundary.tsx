// Catches a crash inside one page so the studio never goes blank; shows the real error + reload.
import { Component, type ReactNode } from 'react';

export class ViewBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error('View crashed:', error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    const stale = /dynamically imported module|Failed to fetch|Loading chunk|Importing a module script/i.test(this.state.error.message);
    return (
      <div className="error-state" role="alert">
        <div>
          <p className="error-title">{stale ? 'A newer version of the studio is available' : 'This page hit an error'}</p>
          <p className="error-msg">{stale ? 'Reload to get the latest version.' : this.state.error.message}</p>
        </div>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }
}
