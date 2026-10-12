import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';
import { Card } from './ui';
import type { AiConnectionState, AiStatus } from '../types';

export const aiStateMeta: Record<AiConnectionState, { label: string; tone: string }> = {
  not_configured: { label: 'Not configured', tone: 'muted' },
  connected: { label: 'Connected', tone: 'ok' },
  disconnected: { label: 'Disconnected', tone: 'warn' },
  error: { label: 'Error', tone: 'error' },
};

export function AiStatusPill({ status }: { status: AiStatus | null }) {
  if (!status) return <span className="ai-pill tone-muted">Checking AI…</span>;
  const meta = aiStateMeta[status.state];
  return (
    <span className={`ai-pill tone-${meta.tone}`} title={status.message}>
      <span className="ai-dot" aria-hidden="true" />
      AI: {meta.label}
    </span>
  );
}

export function AiStatusCard({
  status,
  checking,
  onRecheck,
  onConnect,
  full = false,
}: {
  status: AiStatus | null;
  checking: boolean;
  onRecheck: () => void;
  onConnect: () => void;
  full?: boolean;
}) {
  const state = status?.state;
  return (
    <Card title="API connection status" className={full ? 'ai-card-full' : ''}>
      <div className="ai-status">
        <AiStatusPill status={checking ? null : status} />
        <p className="ai-msg">{checking ? 'Checking connection…' : status?.message}</p>
        {status?.provider && <p className="ai-provider">Provider: {status.provider}</p>}
      </div>

      <ul className="ai-legend" aria-label="Connection states">
        {(Object.keys(aiStateMeta) as AiConnectionState[]).map((s) => (
          <li key={s} className={state === s ? 'current' : ''}>
            <span className={`ai-dot tone-${aiStateMeta[s].tone}`} aria-hidden="true" />
            {aiStateMeta[s].label}
          </li>
        ))}
      </ul>

      <div className="ai-actions">
        {state !== 'connected' && (
          <button className="btn btn-primary" onClick={onConnect}>
            <Icon name="connection" size={16} /> Connect AI
          </button>
        )}
        <button className="btn btn-ghost" onClick={onRecheck} disabled={checking}>
          <Icon name="refresh" size={16} /> Re-check
        </button>
      </div>
      <p className="ai-note">
        The dashboard works fully without AI. Nothing retries automatically, and no provider is called from the
        browser.
      </p>
    </Card>
  );
}

/* ---------- Modal shell ---------- */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function ConnectAiModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Connect AI (setup guide)" onClose={onClose}>
      <p className="modal-lead">
        API keys never go into this dashboard. They live on a small server-side adapter that the dashboard asks
        for status only.
      </p>
      <ol className="setup-steps">
        <li>
          <strong>Choose a provider</strong> and create a key in its console. Free tiers are fine for testing.
        </li>
        <li>
          <strong>Store the key server-side</strong> as <code>AI_API_KEY</code> (plus <code>AI_PROVIDER</code>) in
          your backend's environment — never in a <code>VITE_</code> variable.
        </li>
        <li>
          <strong>Expose a status route</strong> on that backend returning{' '}
          <code>{'{ "status": "connected" | "disconnected" | "error" }'}</code>.
        </li>
        <li>
          <strong>Point the dashboard at it</strong>: set <code>VITE_AI_STATUS_ENDPOINT</code> in{' '}
          <code>.env.local</code> and restart <code>npm run dev</code>.
        </li>
      </ol>
      <p className="modal-note">
        Until then, Ganesha AI Studio stays in Demo Mode. The backend adapter is planned for Milestone 3.
      </p>
      <div className="modal-actions">
        <button className="btn btn-primary" onClick={onClose}>
          Got it
        </button>
      </div>
    </Modal>
  );
}
