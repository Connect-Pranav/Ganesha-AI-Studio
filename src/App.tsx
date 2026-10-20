import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Sidebar, TopNav } from './components/Sidebar';
import { ViewBoundary } from './components/ViewBoundary';
import { SettingsView } from './components/SettingsView';
import { withViewTransition } from './services/premiumFx';
import { Icon } from './components/Icon';
import { ConnectionPage, EnginePill, SetupModal, useEngineOverall } from './components/Connection';
import { GoalModal, NEW_GOAL_EVENT } from './components/GoalModal';
import { AgentsView, OverviewView, PipelinesView } from './components/Views';
import { AnalyticsView } from './components/AnalyticsView';
import { BrandWorkspace } from './components/BrandWorkspace';
import { NotificationCenter } from './components/NotificationCenter';
import { ChatDock } from './components/ChatDock';
import { GrowthView } from './components/growth/GrowthView';
import { CboView } from './components/cbo/CboView';
import { TaskManager } from './components/cbo/TaskManager';
import { FinanceView } from './components/cbo/FinanceView';
import { VideoStudio } from './components/cbo/VideoStudio';
import { VoiceLibrary } from './components/cbo/VoiceLibrary';
import { CharactersView } from './components/cbo/CharactersView';
import { SubscriptionIntel } from './components/cbo/SubscriptionIntel';
import { CosmicBackground, FX_EVENT, readFx, writeFx, type CosmicFx } from './components/cosmic/CosmicBackground';
import { ErrorState, SkeletonDashboard } from './components/ui';
import type { QuickActionKind } from './components/Widgets';
import { loadDashboard } from './services/dashboardService';
import { deriveAiStatus } from './services/aiStatusService';
import type { AiStatus, DashboardData, ProductId, View } from './types';

const Universe3D = lazy(() => import('./components/universe/Universe3D'));

const VIEWS: View[] = ['universe', 'overview', 'cbo', 'tasks', 'finance', 'subscriptions', 'pipelines', 'analytics', 'studio', 'voices', 'characters', 'littleloop', 'sunverse', 'foliocraft', 'agents', 'connection', 'settings', 'growth'];
const TITLES: Record<View, string> = {
  universe: '3D Command Center',
  overview: 'Studio overview',
  cbo: 'GANESHA CBO — Executive',
  tasks: 'Task Manager',
  finance: 'CFO & Cost Intelligence',
  subscriptions: 'Subscription Intelligence',
  studio: 'AI Video & Filmmaking Studio',
  voices: 'Signature Voice Library',
  characters: 'Characters & Assets',
  pipelines: 'Pipelines',
  analytics: 'Analytics (SOMA)',
  littleloop: 'LittleLoop',
  sunverse: 'Sunverse',
  foliocraft: 'Foliocraft',
  agents: 'Agents',
  connection: 'AI Connection',
  settings: 'Settings',
  growth: 'GANESHA GROWTH AI',
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
  const [lastProduct, setLastProduct] = useState<View>('overview');
  useEffect(() => {
    if (PRODUCT_VIEWS.includes(view)) setLastProduct(view);
  }, [view]);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [showConnect, setShowConnect] = useState(false);
  // In-panel goal form (no GitHub). undefined = closed; '' = open with default type.
  const [goalTemplate, setGoalTemplate] = useState<string | undefined>(undefined);
  const [toast, setToast] = useState<string | null>(null);
  const [fx, setFx] = useState<CosmicFx>(readFx);
  useEffect(() => {
    const on = (e: Event) => setFx((e as CustomEvent<CosmicFx>).detail);
    window.addEventListener(FX_EVENT, on);
    return () => window.removeEventListener(FX_EVENT, on);
  }, []);

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
  const engine = useEngineOverall();

  /* ---- routing ---- */
  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = (v: View) => {
    withViewTransition(() => {
      window.location.hash = `/${v}`;
      setView(v);
      setMobileOpen(false);
      window.scrollTo({ top: 0 });
    });
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

  /* ---- goals: started inside Ganesha on the studio backend ---- */
  useEffect(() => {
    const open = (e: Event) => setGoalTemplate((e as CustomEvent<{ template?: string }>).detail?.template ?? '');
    window.addEventListener(NEW_GOAL_EVENT, open);
    return () => window.removeEventListener(NEW_GOAL_EVENT, open);
  }, []);
  const QUICK_TEMPLATE: Record<Exclude<QuickActionKind, 'analytics'>, (p: ProductId | 'studio') => string> = {
    content: (p) => (p === 'littleloop' ? 'littleloop_episode' : p === 'foliocraft' ? 'foliocraft_feature' : 'sunverse_song_release'),
    research: () => 'research_brief',
    code: () => 'foliocraft_feature',
  };
  const goalCreated = (title: string) => {
    setGoalTemplate(undefined);
    setToast(`Started: ${title}. GANESHA is assigning the team.`);
    window.dispatchEvent(new Event('ganesha:goal-created'));
    if (view !== 'overview' && view !== 'pipelines') navigate('pipelines');
  };

  const defaultProduct: ProductId | 'studio' = PRODUCT_VIEWS.includes(view) ? (view as ProductId) : 'studio';

  // Hide the loading screen once the first data load finishes (ok or error).
  useEffect(() => {
    if (load.status === 'loading') return;
    (window as unknown as { __gasReady?: boolean }).__gasReady = true;
    const el = document.getElementById('gas-splash');
    if (!el) return;
    const t = setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 380);
    }, 250);
    return () => clearTimeout(t);
  }, [load.status]);

  /* ---- render ---- */
  const renderBody = () => {
    if (load.status === 'loading') return <SkeletonDashboard />;
    if (load.status === 'error') return <ErrorState message={load.message} onRetry={() => fetchData()} />;
    const common = {
      data: load.data,
      ai,
      aiChecking,
      onOpenProduct: (id: ProductId) => navigate(id),
      // Analytics shows the real report; other quick actions open the in-panel goal form.
      onQuickAction: (k: QuickActionKind) => (k === 'analytics' ? navigate('analytics') : setGoalTemplate(QUICK_TEMPLATE[k](defaultProduct))),
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
      ) : view === 'cbo' ? (
        <CboView onNavigate={navigate} />
      ) : view === 'tasks' ? (
        <TaskManager />
      ) : view === 'finance' ? (
        <FinanceView />
      ) : view === 'subscriptions' ? (
        <SubscriptionIntel />
      ) : view === 'studio' ? (
        <VideoStudio />
      ) : view === 'voices' ? (
        <VoiceLibrary />
      ) : view === 'characters' ? (
        <CharactersView />
      ) : view === 'agents' ? (
        <AgentsView {...common} />
      ) : view === 'analytics' ? (
        <AnalyticsView initialBrand={PRODUCT_VIEWS.includes(lastProduct) ? (lastProduct as ProductId) : 'sunverse'} />
      ) : view === 'pipelines' ? (
        <PipelinesView {...common} />
      ) : view === 'growth' ? (
        <GrowthView />
      ) : view === 'settings' ? (
        <SettingsView />
      ) : view === 'connection' ? (
        <ConnectionPage data={load.data} ai={ai} aiChecking={aiChecking} onRecheck={() => fetchData(true)} />
      ) : view === 'overview' ? (
        <OverviewView {...common} onNavigate={navigate} />
      ) : (
        <BrandWorkspace data={load.data} productId={view as ProductId} onNavigate={navigate} />
      );
    return (
      <>
        {notice}
        {body}
      </>
    );
  };

  return (
    <div className={`app ${collapsed ? 'is-collapsed' : ''}`} data-view={view} data-fx={fx}>
      <CosmicBackground fx={fx} />
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
        aiState={engine.dot}
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
            <label className="fx-select" title="Cosmic effects: Full, Balanced or Minimal. Reduced-motion settings always win.">
              <span className="sr-only">Cosmic effects</span>
              <span aria-hidden="true">✦</span>
              <select value={fx} onChange={(e) => writeFx(e.target.value as CosmicFx)} aria-label="Cosmic effects">
                <option value="full">Full</option>
                <option value="balanced">Balanced</option>
                <option value="minimal">Minimal</option>
              </select>
            </label>
            <NotificationCenter data={load.status === 'ready' ? load.data : null} />
            <button className="icon-btn" onClick={() => navigate('settings')} aria-label="Settings" title="Settings">
              <Icon name="settings" />
            </button>
            <span className={isLive ? 'mode-banner live' : 'mode-banner'}>{isLive ? 'Live agents' : 'No agent data yet'}</span>
            <button className="ai-pill-btn" onClick={() => navigate('connection')} aria-label="Open AI connection">
              <EnginePill />
            </button>
          </div>
          <TopNav view={view} onNavigate={navigate} />
        </header>

        <main id="main" className="content">
          <ViewBoundary key={view}>
            <div className="view-enter">{renderBody()}</div>
          </ViewBoundary>
        </main>

        <footer className="foot">
          Every number here is counted from real agent runs. Empty sections mean nothing has been recorded yet.
        </footer>
      </div>

      <ChatDock hidden={view === 'cbo'} />
      {showConnect && <SetupModal onClose={() => setShowConnect(false)} />}
      {goalTemplate !== undefined && (
        <GoalModal initialTemplate={goalTemplate || undefined} onClose={() => setGoalTemplate(undefined)} onCreated={goalCreated} />
      )}
      {toast && (
        <div className="toast" role="status">
          <Icon name="check" size={16} /> {toast}
        </div>
      )}
    </div>
  );
}
