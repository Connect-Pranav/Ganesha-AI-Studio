import { useCallback, useEffect, useMemo, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { Icon } from './components/Icon';
import { AiStatusPill, ConnectAiModal } from './components/AiConnection';
import { QuickActionModal } from './components/QuickActionModal';
import { AgentsView, ConnectionView, OverviewView, ProductView } from './components/Views';
import { ErrorState, SkeletonDashboard, agentNames } from './components/ui';
import type { QuickActionKind } from './components/Widgets';
import { loadDashboard } from './services/dashboardService';
import { deriveAiStatus } from './services/aiStatusService';
import type { ActivityKind, AgentId, AiStatus, DashboardData, ProductId, Task, TaskStatus, View } from './types';

const VIEWS: View[] = ['overview', 'littleloop', 'sunverse', 'foliocraft', 'agents', 'connection'];
const TITLES: Record<View, string> = {
  overview: 'Studio overview',
  littleloop: 'LittleLoop',
  sunverse: 'Sunverse',
  foliocraft: 'Foliocraft',
  agents: 'Agents',
  connection: 'AI Connection',
};
const PRODUCT_VIEWS: View[] = ['littleloop', 'sunverse', 'foliocraft'];

function viewFromHash(): View {
  const v = window.location.hash.replace(/^#\/?/, '') as View;
  return VIEWS.includes(v) ? v : 'overview';
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem('gas.sidebarCollapsed') === '1';
  } catch {
    return false;
  }
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: DashboardData; agentDataError: string | null };

export default function App() {
  const [view, setView] = useState<View>(viewFromHash);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [showConnect, setShowConnect] = useState(false);
  const [quick, setQuick] = useState<QuickActionKind | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  /* ---- data ---- */
  const fetchData = useCallback((background = false) => {
    if (background) setRefreshing(true);
    else setLoad({ status: 'loading' });
    loadDashboard()
      .then((r) => setLoad({ status: 'ready', data: r.data, agentDataError: r.agentDataError }))
      .catch((e: unknown) => setLoad({ status: 'error', message: e instanceof Error ? e.message : 'Unknown error' }))
      .finally(() => setRefreshing(false));
  }, []);

  useEffect(() => {
    fetchData(); // once on load; never retries on its own
  }, [fetchData]);

  // AI status is derived from the real run log — no provider call.
  const ai: AiStatus | null = useMemo(
    () => (load.status === 'ready' ? deriveAiStatus(load.data.runs) : null),
    [load],
  );
  const aiChecking = load.status === 'loading' || refreshing;
  const isLive = load.status === 'ready' && Object.values(load.data.live).some(Boolean);

  /* ---- routing ---- */
  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = (v: View) => {
    window.location.hash = `/${v}`;
    setView(v);
    setMobileOpen(false);
    window.scrollTo({ top: 0 });
  };

  const toggleCollapse = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem('gas.sidebarCollapsed', c ? '0' : '1');
      } catch {
        /* storage unavailable — fine */
      }
      return !c;
    });
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  /* ---- local mutations (demo only, not persisted) ---- */
  const update = (fn: (d: DashboardData) => DashboardData) =>
    setLoad((s) => (s.status === 'ready' ? { ...s, data: fn(s.data) } : s));

  const advanceTask = (id: string, status: TaskStatus) =>
    update((d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === id ? { ...t, status } : t)) }));

  const toggleAgent = (id: AgentId) =>
    update((d) => ({
      ...d,
      agents: d.agents.map((a) =>
        a.id !== id ? a : { ...a, state: a.state === 'paused' ? (a.currentTask ? 'running' : 'idle') : 'paused' },
      ),
    }));

  const kindFor: Record<QuickActionKind, ActivityKind> = {
    content: 'task',
    research: 'research',
    code: 'code',
    analytics: 'task',
  };

  const createTask = (input: Omit<Task, 'id' | 'status'>) => {
    const id = `t${Date.now()}`;
    update((d) => ({
      ...d,
      tasks: [{ ...input, id, status: 'queued' }, ...d.tasks],
      activity: [
        {
          id: `a${Date.now()}`,
          minutesAgo: 0,
          product: input.product,
          agent: input.agent,
          kind: quick ? kindFor[quick] : 'task',
          text: `Queued: ${input.title}`,
        },
        ...d.activity,
      ],
    }));
    setQuick(null);
    setToast(`Task queued for ${agentNames[input.agent]} (demo, not saved)`);
  };

  const defaultProduct: ProductId | 'studio' = PRODUCT_VIEWS.includes(view) ? (view as ProductId) : 'studio';

  /* ---- render ---- */
  const renderBody = () => {
    if (load.status === 'loading') return <SkeletonDashboard />;
    if (load.status === 'error') return <ErrorState message={load.message} onRetry={() => fetchData()} />;
    const common = {
      data: load.data,
      ai,
      aiChecking,
      onOpenProduct: (id: ProductId) => navigate(id),
      onAdvanceTask: advanceTask,
      onToggleAgent: toggleAgent,
      onQuickAction: setQuick,
      onRecheckAi: () => fetchData(true),
      onConnectAi: () => setShowConnect(true),
    };
    const notice = load.agentDataError ? (
      <div className="notice" role="status">
        Live agent data couldn’t be read ({load.agentDataError}). Showing demo data.
      </div>
    ) : null;
    const body =
      view === 'agents' ? (
        <AgentsView {...common} />
      ) : view === 'connection' ? (
        <ConnectionView {...common} />
      ) : view === 'overview' ? (
        <OverviewView {...common} />
      ) : (
        <ProductView {...common} productId={view as ProductId} />
      );
    return (
      <>
        {notice}
        {body}
      </>
    );
  };

  return (
    <div className={`app ${collapsed ? 'is-collapsed' : ''}`}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <Sidebar
        view={view}
        onNavigate={navigate}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        aiState={aiChecking ? 'checking' : (ai?.state ?? 'not_configured')}
        live={isLive}
      />

      <div className="main">
        <header className="topbar">
          <button className="icon-btn mobile-only" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Icon name="menu" />
          </button>
          <div className="topbar-title">
            <p className="eyebrow">GANESHA AI STUDIO</p>
            <h1>{TITLES[view]}</h1>
          </div>
          <div className="topbar-right">
            <span className={isLive ? 'mode-banner live' : 'mode-banner'}>{isLive ? 'Live agents' : 'Demo Mode'}</span>
            <button className="ai-pill-btn" onClick={() => navigate('connection')} aria-label="Open AI connection">
              <AiStatusPill status={aiChecking ? null : ai} />
            </button>
          </div>
        </header>

        <main id="main" className="content">
          {renderBody()}
        </main>

        <footer className="foot">
          Sections marked <strong>Live</strong> come from real agent runs. Sections marked <strong>Demo</strong> are
          illustrative only. Changes you make here are kept until refresh.
        </footer>
      </div>

      {showConnect && <ConnectAiModal onClose={() => setShowConnect(false)} />}
      {quick && (
        <QuickActionModal
          kind={quick}
          defaultProduct={defaultProduct}
          onClose={() => setQuick(null)}
          onCreate={createTask}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <Icon name="check" size={16} /> {toast}
        </div>
      )}
    </div>
  );
}
