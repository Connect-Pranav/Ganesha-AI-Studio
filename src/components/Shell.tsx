// Simple shell: one header with 5 sections, one row of sub-tabs for the pages inside the
// current section, and a page heading. Every page keeps its own route (#/<view>), so links
// and buttons inside pages keep working; only where pages live in the navigation changed.
import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { HeroCast } from './HeroCast';
import { BrandMark } from './BrandMark';
import type { View } from '../types';

export type SectionId = 'home' | 'brands' | 'agents' | 'growth' | 'money' | 'system';

interface Page {
  id: View;
  label: string;
  hint: string;
}
interface Group {
  label?: string;
  pages: Page[];
}
interface Section {
  id: SectionId;
  label: string;
  icon: IconName;
  groups: Group[];
}

export const SECTIONS: Section[] = [
  {
    id: 'home',
    label: 'Home',
    icon: 'overview',
    groups: [{ pages: [{ id: 'overview', label: 'Home', hint: 'What needs you today, and how the studio is doing.' }] }],
  },
  {
    id: 'brands',
    label: 'Brands',
    icon: 'littleloop',
    groups: [
      {
        pages: [
          { id: 'littleloop', label: 'LittleLoop', hint: "Children's animated shorts on Instagram." },
          { id: 'sunverse', label: 'Sunverse', hint: 'Music and the @SURVERSE_09 YouTube channel.' },
          { id: 'foliocraft', label: 'Foliocraft', hint: 'Portfolio builder and premium conversions.' },
        ],
      },
      {
        label: 'Production',
        pages: [
          { id: 'characters', label: 'Characters', hint: 'Character sheets and assets for every brand.' },
          { id: 'studio', label: 'Film Studio', hint: 'Plan and make reels, shorts and films.' },
          { id: 'voices', label: 'Voices', hint: 'Signature voices for narration and songs.' },
        ],
      },
    ],
  },
  {
    id: 'agents',
    label: 'Agents',
    icon: 'agents',
    groups: [
      {
        pages: [
          { id: 'brain', label: 'Brain', hint: 'GANESHA Brain: give a goal — it thinks, plans, runs the agents step by step, checks the work, remembers lessons and delivers.' },
          { id: 'cbo', label: 'Saarthi', hint: 'SAARTHI, your Chief Business Officer: ask anything and hand out work.' },
          { id: 'agents', label: 'Team', hint: 'Every agent, what it does and how its runs went.' },
          { id: 'pipelines', label: 'Pipelines', hint: 'Work in progress, step by step.' },
          { id: 'tasks', label: 'Tasks', hint: 'Your to-do list across the studio.' },
          { id: 'analytics', label: 'Studio Ops', hint: 'How the studio machinery is running: runs, queues and storage. Channel numbers live in each brand.' },
        ],
      },
    ],
  },
  {
    id: 'growth',
    label: 'Growth',
    icon: 'growth',
    groups: [{ pages: [{ id: 'growth', label: 'Mushak', hint: 'Your Growth agent finds partners and customers. Nothing is sent without your approval.' }] }],
  },
  {
    id: 'money',
    label: 'Money',
    icon: 'finance',
    groups: [
      {
        pages: [
          { id: 'finance', label: 'Costs', hint: 'What the agents spend, and the budgets that stop them.' },
          { id: 'subscriptions', label: 'Subscriptions', hint: 'Your paid AI tools and how much you really use them.' },
        ],
      },
    ],
  },
  {
    id: 'system',
    label: 'Settings',
    icon: 'settings',
    groups: [
      {
        pages: [
          { id: 'settings', label: 'Settings', hint: 'Keys, preferences and studio settings.' },
          { id: 'connection', label: 'AI Connection', hint: 'Which AI engines are connected and working.' },
        ],
      },
    ],
  },
];

const PAGE_INDEX = new Map<View, { section: Section; page: Page }>();
for (const s of SECTIONS) for (const g of s.groups) for (const p of g.pages) PAGE_INDEX.set(p.id, { section: s, page: p });

export function pageInfo(view: View) {
  return PAGE_INDEX.get(view) ?? { section: SECTIONS[0], page: SECTIONS[0].groups[0].pages[0] };
}
const firstPage = (s: Section) => s.groups[0].pages[0].id;

/** Remembers the last page opened in each section, so a section opens where you left it. */
const lastInSection: Partial<Record<SectionId, View>> = {};

export function Header({ view, onNavigate, actions }: { view: View; onNavigate: (v: View) => void; actions: ReactNode }) {
  const current = pageInfo(view).section.id;
  lastInSection[current] = view;
  const main = SECTIONS.filter((s) => s.id !== 'system');
  return (
    <header className="topbar gx-head">
      <button className="gx-logo" onClick={() => onNavigate('overview')} aria-label="Ganesha AI Studio home">
        <img src="./brand/mark-96.png" alt="" width="30" height="30" />
        <span>
          Ganesha <b>Studio</b>
        </span>
      </button>
      <nav className="gx-sections" aria-label="Sections">
        {main.map((s) => (
          <button
            key={s.id}
            className={`gx-sec ${current === s.id ? 'active' : ''}`}
            aria-current={current === s.id ? 'page' : undefined}
            onClick={() => onNavigate(lastInSection[s.id] ?? firstPage(s))}
          >
            <Icon name={s.icon} size={16} />
            <span>{s.label}</span>
          </button>
        ))}
      </nav>
      <div className="gx-actions">
        {actions}
        <button
          className={`icon-btn ${current === 'system' ? 'active' : ''}`}
          onClick={() => onNavigate(lastInSection.system ?? 'settings')}
          aria-label="Settings"
          title="Settings"
        >
          <Icon name="settings" />
        </button>
      </div>
    </header>
  );
}

/** The pages of the current section. Hidden when the section has only one page. */
export function SubTabs({ view, onNavigate }: { view: View; onNavigate: (v: View) => void }) {
  const { section } = pageInfo(view);
  const count = section.groups.reduce((a, g) => a + g.pages.length, 0);
  if (count < 2) return null;
  return (
    <nav className="gx-sub" aria-label={`${section.label} pages`}>
      {section.groups.map((g, i) => (
        <div key={g.label ?? i} className="gx-sub-group">
          {g.label && <span className="gx-sub-label">{g.label}</span>}
          {g.pages.map((p) => (
            <button key={p.id} className={`gx-chip ${view === p.id ? 'active' : ''}`} aria-current={view === p.id ? 'page' : undefined} onClick={() => onNavigate(p.id)}>
              {(p.id === 'littleloop' || p.id === 'sunverse' || p.id === 'foliocraft') && <BrandMark id={p.id} size={22} iconSize={14} className="gx-chip-logo" />}
              {p.label}
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}

export function PageTitle({ view, onNavigate }: { view: View; onNavigate: (v: View) => void }) {
  // Brand workspaces open with their own header, so they don't get a second title.
  if (view === 'littleloop' || view === 'sunverse' || view === 'foliocraft') return null;
  const { page, section } = pageInfo(view);
  return (
    <div className="gx-page">
      <small>{section.id === 'home' ? 'Ganesha AI Studio' : section.label}</small>
      <h1>{page.label === 'Home' ? 'Command Center' : page.label}</h1>
      <p>{page.hint}</p>
      {section.id === 'home' && <HeroCast onOpen={onNavigate} />}
    </div>
  );
}
