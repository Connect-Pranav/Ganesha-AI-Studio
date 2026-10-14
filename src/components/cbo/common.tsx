import { useState, type ReactNode } from 'react';
import { Card, EmptyState } from '../ui';
import { Unlock } from '../NotificationCenter';
import { setToken } from '../../services/adminService';

/** Locked / loading / error states shared by every CBO page. */
export function Gate({ title, locked, ready, error, onRetry, children }: { title: string; locked: boolean; ready: boolean; error: string | null; onRetry: () => void; children: ReactNode }) {
  if (locked)
    return (
      <Card title={title}>
        <Unlock onUnlocked={onRetry} />
      </Card>
    );
  if (error)
    return (
      <Card title={title}>
        <div className="error-state" role="alert">
          <div>
            <p className="error-title">Couldn’t load</p>
            <p className="error-msg">{error}</p>
          </div>
          <button className="btn btn-ghost" onClick={onRetry}>
            Try again
          </button>
          {/401|token/i.test(error) && (
            <button className="btn btn-ghost" onClick={() => setToken(null)}>
              Re-enter token
            </button>
          )}
        </div>
      </Card>
    );
  if (!ready)
    return (
      <Card title={title}>
        <EmptyState title="Loading…" />
      </Card>
    );
  return <>{children}</>;
}

export function Tile({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'warn' | 'err' | 'ok' }) {
  return (
    <div className={`stat ${tone ? `cx-tone-${tone}` : ''}`}>
      <p className="stat-label">{label}</p>
      <p className="stat-value cx-stat-value">{value}</p>
      {hint && (
        <div className="stat-foot">
          <span className="stat-hint">{hint}</span>
        </div>
      )}
    </div>
  );
}

export function Pill({ cls, children, title }: { cls: string; children: ReactNode; title?: string }) {
  return (
    <span className={`pill ${cls}`} title={title}>
      {children}
    </span>
  );
}

/** Runs an async action with busy + error state. */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      after?.();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, run, setError };
}

export function Honest({ children }: { children: ReactNode }) {
  return <p className="cx-honest">{children}</p>;
}

export const BRANDS = [
  { id: 'littleloop', name: 'LittleLoop' },
  { id: 'sunverse', name: 'Sunverse' },
  { id: 'foliocraft', name: 'Foliocraft' },
  { id: 'studio', name: 'Studio' },
];
export const TEMPLATE_OPTIONS = [
  { id: 'littleloop_episode', name: 'LittleLoop episode' },
  { id: 'sunverse_song_release', name: 'Sunverse song release' },
  { id: 'foliocraft_feature', name: 'Foliocraft feature' },
  { id: 'research_brief', name: 'Research brief' },
  { id: 'ops_weekly_review', name: 'Ops weekly review' },
];
