import { Icon, type IconName } from './Icon';
import type { AiConnectionState, View } from '../types';

interface NavItem {
  id: View;
  label: string;
  icon: IconName;
}

const workspace: NavItem[] = [
  { id: 'universe', label: '3D Command Center', icon: 'universe' },
  { id: 'overview', label: 'Overview', icon: 'overview' },
  { id: 'pipelines', label: 'Pipelines', icon: 'pipelines' },
];
const brands: NavItem[] = [
  { id: 'littleloop', label: 'LittleLoop', icon: 'littleloop' },
  { id: 'sunverse', label: 'Sunverse', icon: 'sunverse' },
  { id: 'foliocraft', label: 'Foliocraft', icon: 'foliocraft' },
];
const system: NavItem[] = [
  { id: 'agents', label: 'Agents', icon: 'agents' },
  { id: 'connection', label: 'AI Connection', icon: 'connection' },
];

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
          <div className="brand-mark" aria-hidden="true">G</div>
          <div className="brand-text">
            <span className="brand-name">Ganesha</span>
            <span className="brand-sub">AI Studio</span>
          </div>
          <button className="icon-btn mobile-only" onClick={onCloseMobile} aria-label="Close menu">
            <Icon name="close" />
          </button>
        </div>

        <nav className="nav">
          {group('Workspace', workspace)}
          {group('Brands', brands)}
          {group('System', system)}
        </nav>

        <div className="sidebar-foot">
          <div className="mode-chip">
            <span className={`dot ${live ? 'dot-connected' : 'dot-demo'}`} aria-hidden="true" />
            <span className="nav-text">{live ? 'Live agents' : 'Demo Mode'}</span>
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
