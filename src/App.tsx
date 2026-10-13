import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { Icon } from './components/Icon';
import { AiStatusPill, ConnectAiModal } from './components/AiConnection';
import { QuickActionModal } from './components/QuickActionModal';
import { AgentsView, ConnectionView, OverviewView, PipelinesView, ProductView } from './components/Views';
import { ErrorState, SkeletonDashboard } from './components/ui';
import type { QuickActionKind } from './components/Widgets';
import { loadDashboard } from './services/dashboardService';
import { deriveAiStatus } from './services/aiStatusService';
import type { AiStatus, DashboardData, ProductId, Task, View } from './types';
import { newGoalUrl } from './data/agentsMeta';

const Universe3D = lazy(() => import('./components/universe/Universe3D'));

const VIEWS: View[] = ['universe', 'overview', 'pipelines', 'littleloop', 'sunverse', 'foliocraft', 'agents', 'connection'];
const TITLES: Record<View, string> = {
  universe: '3D Command Center',
  overview: 'Studio overview',
  pipelines: 'Pipelines',
  littleloop: 'LittleLoop',
  sunverse: 'Sunverse',
  foliocraft: 'Foliocraft',
  agents: 'Agents',
  connection: 'AI Connection',
};
const PRODUCT_VIEWS: View[] = ['littleloop', 'sunverse', 'foliocraft'];

function viewFromHash(): View {
  const v = window.location.hash.replace(/^#\/?/, '') as View;
  return VIEWS.includes(v) ? v : 'universe';
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

  /* ---- quick actions: file a real goal in the private vault (no local fake tasks) ---- */
  const LABEL: Record<QuickActionKind, string> = { content: '', research: 'research', code: 'foliocraft', analytics: 'ops' };
  const createTask = (input: Omit<Task, 'id' | 'status'>) => {
    const label = input.product !== 'studio' ? input.product : LABEL[quick ?? 'content'] || 'research';
    window.open(newGoalUrl(label, input.title), '_blank', 'noopener');
    setQuick(null);
    setToast('Goal opened in your private vault. Submit it there to start the pipeline.');
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
      onQuickAction: setQuick,
      onRecheckAi: () => fetchData(true),
      onConnectAi: () => setShowConnect(true),
    };
    const notice = load.agentDataError ? (
      <div className="notice" role="status">
        Live agent data couldn’t be read ({load.agentDataError}). Sections are empty until it loads.
      </div>
    ) : null;
    const body =
      view === 'universe' ? (
        <Suspense fallback={<div className="u-loading">Loading 3D command center…</div>}>
          <Universe3D data={load.data} ai={ai} onNavigate={navigate} />
        </Suspense>
      ) : view === 'agents' ? (
        <AgentsView {...common} />
      ) : view === 'pipelines' ? (
        <PipelinesView {...common} />
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

      <div className={`main ${view === 'universe' ? 'is-universe' : ''}`}>
        <header className="topbar">
          <button className="icon-btn mobile-only" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Icon name="menu" />
          </button>
          <div className="topbar-title">
            <p className="eyebrow">GANESHA AI STUDIO</p>
            <h1>{TITLES[view]}</h1>
          </div>
          <div className="topbar-right">
            <span className={isLive ? 'mode-banner live' : 'mode-banner'}>{isLive ? 'Live agents' : 'No agent data yet'}</span>
            <button className="ai-pill-btn" onClick={() => navigate('connection')} aria-label="Open AI connection">
              <AiStatusPill status={aiChecking ? null : ai} />
            </button>
          </div>
        </header>

        <main id="main" className="content">
          {renderBody()}
        </main>

        <footer className="foot">
          Every number here is counted from real agent runs. Empty sections mean nothing has been recorded yet.
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
