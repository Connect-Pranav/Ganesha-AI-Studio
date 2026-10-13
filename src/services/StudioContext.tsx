// One live connection to the studio backend, shared by every page.
// - health: public, booleans only (loads for everyone)
// - summary: owner-only (admin token); refreshed every 30 s while the tab is visible
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AUTH_EVENT, ApiError, getToken, setToken } from './adminService';
import { loadHealth, loadSummary, type Health, type Summary } from './studioService';

const POLL_MS = 30_000;

export interface StudioState {
  health: Health | null;
  healthError: string | null;
  summary: Summary | null;
  summaryError: string | null;
  locked: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  lock: () => void;
}

const Ctx = createContext<StudioState | null>(null);

export function StudioProvider({ children }: { children: ReactNode }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [locked, setLocked] = useState(!getToken());
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const h = loadHealth()
      .then((x) => (setHealth(x), setHealthError(null)))
      .catch((e: unknown) => setHealthError(e instanceof Error ? e.message : 'Backend unreachable'));
    const s = (async () => {
      if (!getToken()) {
        setLocked(true);
        setSummary(null);
        return;
      }
      try {
        setSummary(await loadSummary());
        setSummaryError(null);
        setLocked(false);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          setToken(null);
          setLocked(true);
          setSummary(null);
        } else setSummaryError(e instanceof Error ? e.message : 'Could not load studio data');
      }
    })();
    await Promise.all([h, s]);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(() => document.visibilityState === 'visible' && refresh(), POLL_MS);
    const onAuth = () => refresh();
    const onGoal = () => refresh();
    window.addEventListener(AUTH_EVENT, onAuth);
    window.addEventListener('ganesha:goal-created', onGoal);
    return () => {
      clearInterval(t);
      window.removeEventListener(AUTH_EVENT, onAuth);
      window.removeEventListener('ganesha:goal-created', onGoal);
    };
  }, [refresh]);

  const value = useMemo<StudioState>(
    () => ({ health, healthError, summary, summaryError, locked, loading, refresh, lock: () => setToken(null) }),
    [health, healthError, summary, summaryError, locked, loading, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStudio(): StudioState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStudio must be used inside <StudioProvider>');
  return v;
}

/* ---------- shared vocabulary ---------- */
export const WF_STATUS: Record<string, { label: string; cls: string }> = {
  queued: { label: 'Queued', cls: 'pill-idle' },
  running: { label: 'Working', cls: 'pill-running' },
  paused: { label: 'Paused', cls: 'pill-paused' },
  waiting_for_approval: { label: 'Needs your approval', cls: 'pill-warn' },
  waiting_for_external_action: { label: 'Waiting for you', cls: 'pill-warn' },
  completed: { label: 'Done', cls: 'pill-running' },
  failed: { label: 'Failed', cls: 'pill-error' },
  cancelled: { label: 'Cancelled', cls: 'pill-idle' },
};

export const OPEN_STATUSES = ['queued', 'running', 'paused', 'waiting_for_approval', 'waiting_for_external_action'];
