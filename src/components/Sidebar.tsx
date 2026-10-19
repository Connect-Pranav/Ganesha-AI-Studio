import { Icon, type IconName } from './Icon';
import { InstallApp } from './InstallApp';
import type { AiConnectionState, View } from '../types';

interface NavItem {
  id: View;
  label: string;
  icon: IconName;
}

/** Main sections live in the top navigation bar; the sidebar keeps the tools. */
export const TOP_NAV: NavItem[] = [
  { id: 'universe', label: 'Command Center', icon: 'universe' },
  { id: 'overview', label: 'Overview', icon: 'overview' },
  { id: 'cbo', label: 'CBO', icon: 'cbo' },
  { id: 'agents', label: 'Agents', icon: 'agents' },
  { id: 'littleloop', label: 'LittleLoop', icon: 'littleloop' },
  { id: 'sunverse', label: 'Sunverse', icon: 'sunverse' },
  { id: 'foliocraft', label: 'Foliocraft', icon: 'foliocraft' },
  { id: 'analytics', label: 'Analytics', icon: 'analytics' },
  { id: 'growth', label: 'Growth', icon: 'growth' },
];
const work: NavItem[] = [
  { id: 'pipelines', label: 'Pipelines', icon: 'pipelines' },
  { id: 'tasks', label: 'Task Manager', icon: 'tasks' },
];
const money: NavItem[] = [
  { id: 'finance', label: 'CFO & Costs', icon: 'finance' },
  { id: 'subscriptions', label: 'Subscriptions', icon: 'subs' },
];
const production: NavItem[] = [
  { id: 'studio', label: 'Video & Film Studio', icon: 'film' },
  { id: 'voices', label: 'Voice Library', icon: 'mic' },
  { id: 'characters', label: 'Characters', icon: 'characters' },
];
const system: NavItem[] = [
  { id: 'connection', label: 'AI Connection', icon: 'connection' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

export function TopNav({ view, onNavigate }: { view: View; onNavigate: (v: View) => void }) {
  return (
    <nav className="topnav" aria-label="Main sections">
      {TOP_NAV.map((item) => (
        <button key={item.id} className={`topnav-item ${view === item.id ? 'active' : ''}`} onClick={() => onNavigate(item.id)} aria-current={view === item.id ? 'page' : undefined}>
          <Icon name={item.icon} size={16} />
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

interface Props {
  view: View;
  onNavigate: (v: View) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  aiState: AiConnectionState | 'checking';
  live: boolean;
}

export function Sidebar({ view, onNavigate, collapsed, onToggleCollapse, mobileOpen, onCloseMobile, aiState, live }: Props) {
  const group = (label: string, items: NavItem[]) => (
    <div className="nav-group">
      <p className="nav-label">{label}</p>
      {items.map((item) => (
        <button
          key={item.id}
          className={`nav-item ${view === item.id ? 'active' : ''}`}
          onClick={() => onNavigate(item.id)}
          aria-current={view === item.id ? 'page' : undefined}
          title={collapsed ? item.label : undefined}
        >
          <Icon name={item.icon} />
          <span className="nav-text">{item.label}</span>
          {item.id === 'connection' && <span className={`dot dot-${aiState}`} aria-hidden="true" />}
        </button>
      ))}
    </div>
  );

  return (
    <>
      <div className={`scrim ${mobileOpen ? 'show' : ''}`} onClick={onCloseMobile} aria-hidden="true" />
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'open' : ''}`} aria-label="Main navigation">
        <div className="brand">
          <img className="brand-mark" src="./brand/mark-96.png" alt="" width="40" height="40" />
          <div className="brand-text">
            <span className="brand-name">Ganesha</span>
            <span className="brand-sub">AI Studio</span>
          </div>
          <button className="icon-btn mobile-only" onClick={onCloseMobile} aria-label="Close menu">
            <Icon name="close" />
          </button>
        </div>

        <nav className="nav">
          <div className="mobile-only-block">{group('Main', TOP_NAV)}</div>
          {group('Work', work)}
          {group('Money', money)}
          {group('Production', production)}
          {group('System', system)}
        </nav>

        <div className="install-wrap">
          <InstallApp />
        </div>
        <div className="sidebar-foot">
          <div className="mode-chip">
            <span className={`dot ${live ? 'dot-connected' : 'dot-demo'}`} aria-hidden="true" />
            <span className="nav-text">{live ? 'Live agents' : 'No agent data yet'}</span>
          </div>
          <button
            className="icon-btn desktop-only"
            onClick={onToggleCollapse}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <Icon name={collapsed ? 'expand' : 'collapse'} />
          </button>
        </div>
      </aside>
    </>
  );
}
