import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';
import { Card, formatWhen } from './ui';
import { AGENTS_WORKFLOW_URL, SECRETS_URL } from '../config';
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
  const allConnected = status?.engines.every((e) => e.state === 'connected');
  return (
    <Card title="API connection status" className={full ? 'ai-card-full' : ''}>
      <div className="ai-status">
        <AiStatusPill status={checking ? null : status} />
        <p className="ai-msg">{checking ? 'Reading agent run log…' : status?.message}</p>
      </div>

      {status && !checking && (
        <ul className="engines">
          {status.engines.map((e) => {
            const meta = aiStateMeta[e.state];
            return (
              <li key={e.engine} className="engine">
                <div className="engine-top">
                  <span className="engine-name">{e.label}</span>
                  <span className={`ai-pill tone-${meta.tone}`}>
                    <span className="ai-dot" aria-hidden="true" />
                    {meta.label}
                  </span>
                </div>
                <p className="engine-where">{e.where}</p>
                <p className={`engine-msg ${e.state === 'error' ? 'meta-error' : ''}`}>
                  {e.lastRun ? `Last run ${formatWhen(e.lastRun.finishedAt)} — ` : ''}
                  {e.message}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      <div className="ai-actions">
        {!allConnected && (
          <button className="btn btn-primary" onClick={onConnect}>
            <Icon name="connection" size={16} /> Connect AI
          </button>
        )}
        <button className="btn btn-ghost" onClick={onRecheck} disabled={checking}>
          <Icon name="refresh" size={16} /> Re-check
        </button>
      </div>
      <p className="ai-note">
        Status comes from the real agent run log. Keys stay in GitHub Secrets or Claude — never in this page. Nothing
        retries automatically.
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
    <Modal title="Connect AI engines" onClose={onClose}>
      <p className="modal-lead">Two free engines power the agents. Keys never go into this page or into Git.</p>

      <h3 className="modal-sub">Gemini — daily backup in GitHub Actions</h3>
      <ol className="setup-steps">
        <li>
          Create a free API key at <strong>aistudio.google.com</strong> → Get API key.
        </li>
        <li>
          Open{' '}
          <a href={SECRETS_URL} target="_blank" rel="noreferrer">
            repo Settings → Secrets → Actions
          </a>{' '}
          → New repository secret. Name <code>GEMINI_API_KEY</code>, paste the key, save.
        </li>
        <li>
          Open{' '}
          <a href={AGENTS_WORKFLOW_URL} target="_blank" rel="noreferrer">
            Actions → Agents
          </a>{' '}
          → Run workflow. Results appear here in ~3 minutes.
        </li>
      </ol>

      <h3 className="modal-sub">Claude — research + coding</h3>
      <p className="modal-lead">
        Runs as Claude scheduled tasks on your Claude plan. No key needed. Its runs show up in the run history
        automatically.
      </p>

      <div className="modal-actions">
        <button className="btn btn-primary" onClick={onClose}>
          Got it
        </button>
      </div>
    </Modal>
  );
}
