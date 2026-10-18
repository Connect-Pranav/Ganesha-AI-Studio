// Catches a crash inside one page so the studio never goes blank; shows the real error + reload.
import { Component, type ErrorInfo, type ReactNode } from 'react';

export class ViewBoundary extends Component<{ children: ReactNode }, { error: Error | null; where: string }> {
  state = { error: null as Error | null, where: '' };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('View crashed:', error, info.componentStack);
    const where = (info.componentStack ?? '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 4).join(' ← ');
    this.setState({ where });
  }
  render() {
    const { error, where } = this.state;
    if (!error) return this.props.children;
    const stale = /dynamically imported module|Loading chunk|Importing a module script/i.test(error.message);
    return (
      <div className="error-state" role="alert">
        <div>
          <p className="error-title">{stale ? 'A newer version of the studio is available' : 'This page hit an error'}</p>
          <p className="error-msg">{stale ? 'Reload to get the latest version.' : error.message}</p>
          {!stale && where && <p className="cx-sub">Where: {where}</p>}
        </div>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }
}
