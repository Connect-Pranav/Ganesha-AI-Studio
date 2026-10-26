import type { ReactNode } from 'react';
import { Icon } from './Icon';
import type { AgentId, ProductId } from '../types';

export const productNames: Record<ProductId | 'studio', string> = {
  littleloop: 'LittleLoop',
  sunverse: 'Sunverse',
  foliocraft: 'Foliocraft',
  studio: 'Studio',
};

export const agentNames: Record<AgentId, string> = {
  ganesha: 'GANESHA',
  narada: 'NARADA',
  'code-shakti': 'CODE-SHAKTI',
};

export function timeAgo(minutes: number): string {
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const h = Math.floor(minutes / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

/** Shown when a section has no real records yet. */
export function DemoBadge({ label = 'No data yet' }: { label?: string }) {
  return (
    <span className="demo-badge" title="Nothing recorded by an agent yet">
      {label}
    </span>
  );
}

export function LiveBadge({ label = 'Live' }: { label?: string }) {
  return (
    <span className="live-badge" title="Written by a real agent run">
      <span className="live-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

/** Live badge when the section shows real agent output, "No data yet" otherwise. */
export function SourceBadge({ live, demoLabel }: { live: boolean; demoLabel?: string }) {
  return live ? <LiveBadge /> : <DemoBadge label={demoLabel} />;
}

export const engineNames: Record<string, string> = { claude: 'Claude', gemini: 'Gemini', groq: 'Groq', openai: 'ChatGPT (OpenAI)' };

export function formatWhen(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  return timeAgo(Math.max(0, Math.round((Date.now() - t) / 60000)));
}

export function Card({
  title,
  action,
  children,
  className = '',
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="card-head">
          {title && <h2 className="card-title">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty">
      <div className="empty-mark" aria-hidden="true">
        <Icon name="plus" />
      </div>
      <p className="empty-title">{title}</p>
      {hint && <p className="empty-hint">{hint}</p>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="error-state" role="alert">
      <Icon name="alert" size={22} />
      <div>
        <p className="error-title">Something went wrong</p>
        <p className="error-msg">{message}</p>
      </div>
      <button className="btn btn-primary" onClick={onRetry}>
        <Icon name="refresh" size={16} /> Try again
      </button>
    </div>
  );
}

export function SkeletonDashboard() {
  return (
    <div className="skeleton-wrap" aria-busy="true" aria-label="Loading dashboard">
      <div className="grid-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton sk-stat" />
        ))}
      </div>
      <div className="grid-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton sk-product" />
        ))}
      </div>
      <div className="skeleton sk-wide" />
    </div>
  );
}
