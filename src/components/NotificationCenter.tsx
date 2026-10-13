// Bell in the top bar + slide-over panel: everything that needs the owner.
// Sources (all real): Worker approvals/failures/events (owner-only, needs the admin token),
// vault pipelines waiting for approval and failed agent runs (public status files).
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Icon } from './Icon';
import { formatWhen } from './ui';
import { AGENTS_WORKFLOW_URL } from '../config';
import { VAULT_URL, agentName } from '../data/agentsMeta';
import { ApiError, api, getToken, setToken, type Notifications } from '../services/adminService';
import type { DashboardData } from '../types';

const POLL_MS = 60_000;
const RECENT_FAIL_MS = 48 * 3_600_000;

type Backend = { status: 'locked' } | { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; n: Notifications };

export function NotificationCenter({ data }: { data: DashboardData | null }) {
  const [open, setOpen] = useState(false);
  const [backend, setBackend] = useState<Backend>(getToken() ? { status: 'loading' } : { status: 'locked' });
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ title: string; text: string } | null>(null);

  const refresh = useCallback(async () => {
    if (!getToken()) return setBackend({ status: 'locked' });
    try {
      setBackend({ status: 'ready', n: await api<Notifications>('/api/notifications') });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setToken(null);
        setBackend({ status: 'locked' });
      } else setBackend({ status: 'error', message: e instanceof Error ? e.message : 'Could not load' });
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Public items, counted from the real status files.
  const vaultApprovals = useMemo(() => (data?.pipelines ?? []).filter((p) => p.status === 'approval_required'), [data]);
  const failedRuns = useMemo(() => {
    const latest = new Map<string, NonNullable<DashboardData['runs']>[number]>();
    for (const r of data?.runs ?? []) {
      const key = `${r.agent}:${r.engine}`;
      if (!latest.has(key)) latest.set(key, r);
    }
    return [...latest.values()].filter((r) => r.status === 'failed' && Date.now() - Date.parse(r.finishedAt) < RECENT_FAIL_MS);
  }, [data]);

  const n = backend.status === 'ready' ? backend.n : null;
  const count = vaultApprovals.length + failedRuns.length + (n ? n.counts.approvals + n.counts.external + n.counts.failures : 0);

  const act = async (id: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(id);
    setNotice(null);
    try {
      await fn();
      setNotice(done);
      await refresh();
    } catch (e) {
      setNotice(e instanceof Error ? `Failed: ${e.message}` : 'Failed');
    } finally {
      setBusy(null);
    }
  };

  const showDeliverable = async (artifactId: string, title: string) => {
    setBusy(artifactId);
    try {
      const a = await api<{ content: { deliverable?: string; summary?: string } }>(`/api/artifacts/${artifactId}`);
      setPreview({ title, text: a.content.deliverable ?? a.content.summary ?? JSON.stringify(a.content, null, 2) });
    } catch (e) {
      setNotice(e instanceof Error ? `Failed: ${e.message}` : 'Failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <button className="icon-btn bell-btn" onClick={() => setOpen(true)} aria-label={`Notifications${count ? `, ${count} need attention` : ''}`}>
        <Icon name="bell" />
        {count > 0 && <span className="bell-badge">{count > 99 ? '99+' : count}</span>}
      </button>

      {open && (
        <div className="drawer-scrim" onClick={() => setOpen(false)}>
          <aside className="drawer" role="dialog" aria-modal="true" aria-label="Notifications" onClick={(e) => e.stopPropagation()}>
            <header className="drawer-head">
              <h2>Notifications</h2>
              <button className="icon-btn" onClick={refresh} aria-label="Refresh">
                <Icon name="refresh" size={16} />
              </button>
              <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close">
                <Icon name="close" />
              </button>
            </header>

            {notice && <p className="drawer-notice" role="status">{notice}</p>}

            {backend.status === 'locked' && <Unlock onUnlocked={refresh} />}
            {backend.status === 'error' && <p className="drawer-notice error">Backend: {backend.message}</p>}

            <section className="nt-section">
              <h3>Needs your approval</h3>
              {n?.approvals.map((a) => (
                <article key={a.id} className="nt-item nt-approval">
                  <p className="nt-title">{a.workflow_title}</p>
                  <p className="nt-meta">
                    {agentName(a.agent_id)} · {a.deliverable} · {a.brand} · {formatWhen(a.created_at)}
                  </p>
                  <p className="nt-text">{a.summary}</p>
                  <div className="nt-actions">
                    {a.output_artifact && (
                      <button className="btn btn-small" disabled={busy === a.output_artifact} onClick={() => showDeliverable(a.output_artifact!, a.deliverable)}>
                        View
                      </button>
                    )}
                    <button className="btn btn-small btn-primary" disabled={busy === a.id} onClick={() => act(a.id, () => api(`/api/approvals/${a.id}`, { method: 'POST', body: JSON.stringify({ decision: 'approved' }) }), `Approved: ${a.workflow_title}`)}>
                      Approve
                    </button>
                    <button className="btn btn-small" disabled={busy === a.id} onClick={() => act(a.id, () => api(`/api/approvals/${a.id}`, { method: 'POST', body: JSON.stringify({ decision: 'rejected' }) }), `Rejected: ${a.workflow_title}`)}>
                      Reject
                    </button>
                  </div>
                </article>
              ))}
              {vaultApprovals.map((p) => (
                <article key={p.id} className="nt-item nt-approval">
                  <p className="nt-title">{p.title}</p>
                  <p className="nt-meta">
                    {p.steps.filter((s) => s.status === 'approval_required').map((s) => agentName(s.agent)).join(', ')} · {p.brand} · updated {formatWhen(p.updatedAt)}
                  </p>
                  <p className="nt-text">This goal lives in your private vault. Approve by commenting <code>approve</code> (or <code>reject</code>) on its issue.</p>
                  {p.goalRef && (
                    <div className="nt-actions">
                      <a className="btn btn-small btn-primary" href={`${VAULT_URL}/issues/${p.goalRef.split('#')[1]}`} target="_blank" rel="noreferrer">
                        Open issue to approve
                      </a>
                    </div>
                  )}
                </article>
              ))}
              {!n?.approvals.length && !vaultApprovals.length && <p className="nt-empty">Nothing waiting for approval.</p>}
            </section>

            {n && n.external.length > 0 && (
              <section className="nt-section">
                <h3>Approved — confirm when done</h3>
                {n.external.map((t) => (
                  <article key={t.task_id} className="nt-item">
                    <p className="nt-title">{t.workflow_title}</p>
                    <p className="nt-meta">{agentName(t.agent_id)} · {t.deliverable} · {formatWhen(t.updated_at)}</p>
                    <p className="nt-text">Publishing isn’t connected yet, so this step is done by hand. Mark it done once it’s live.</p>
                    <div className="nt-actions">
                      <button className="btn btn-small btn-primary" disabled={busy === t.task_id} onClick={() => act(t.task_id, () => api(`/api/tasks/${t.task_id}/complete-external`, { method: 'POST', body: '{}' }), `Marked done: ${t.workflow_title}`)}>
                        Mark done
                      </button>
                    </div>
                  </article>
                ))}
              </section>
            )}

            <section className="nt-section">
              <h3>Problems</h3>
              {n?.failures.map((f) => (
                <article key={f.task_id} className="nt-item nt-problem">
                  <p className="nt-title">{f.workflow_title}</p>
                  <p className="nt-meta">{agentName(f.agent_id)} · {f.step_key} · {formatWhen(f.updated_at)}</p>
                  {f.error && <p className="nt-text">{f.error}</p>}
                  <div className="nt-actions">
                    <button className="btn btn-small" disabled={busy === f.task_id} onClick={() => act(f.task_id, () => api(`/api/tasks/${f.task_id}/retry`, { method: 'POST', body: '{}' }), `Retrying ${f.step_key}`)}>
                      Retry
                    </button>
                  </div>
                </article>
              ))}
              {failedRuns.map((r) => (
                <article key={r.id} className="nt-item nt-problem">
                  <p className="nt-title">{agentName(r.agent)} run failed</p>
                  <p className="nt-meta">{r.engine} · {formatWhen(r.finishedAt)}</p>
                  <p className="nt-text">{(r.error ?? r.summary).slice(0, 220)}</p>
                  <div className="nt-actions">
                    <a className="btn btn-small" href={AGENTS_WORKFLOW_URL} target="_blank" rel="noreferrer">Open runs</a>
                  </div>
                </article>
              ))}
              {!n?.failures.length && !failedRuns.length && <p className="nt-empty">No problems in the last 48 hours.</p>}
            </section>

            {n && n.events.length > 0 && (
              <section className="nt-section">
                <h3>Recent activity</h3>
                <ul className="nt-events">
                  {n.events.slice(0, 15).map((e) => (
                    <li key={e.id}>
                      <span>{e.message}</span>
                      <span className="nt-meta">{formatWhen(e.created_at)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {backend.status !== 'locked' && (
              <button className="btn btn-small drawer-lock" onClick={() => (setToken(null), setBackend({ status: 'locked' }))}>
                Lock this browser
              </button>
            )}
          </aside>
        </div>
      )}

      {preview && (
        <div className="drawer-scrim preview-scrim" onClick={() => setPreview(null)}>
          <div className="modal preview" role="dialog" aria-modal="true" aria-label={preview.title} onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2>{preview.title}</h2>
              <button className="icon-btn" onClick={() => setPreview(null)} aria-label="Close">
                <Icon name="close" />
              </button>
            </header>
            <pre className="preview-text">{preview.text}</pre>
          </div>
        </div>
      )}
    </>
  );
}

function Unlock({ onUnlocked }: { onUnlocked: () => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setChecking(true);
    setError('');
    try {
      await api('/api/notifications', {}, value.trim());
      setToken(value.trim());
      onUnlocked();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? 'That token is not correct.' : err instanceof Error ? err.message : 'Could not check the token');
    } finally {
      setChecking(false);
    }
  };
  return (
    <form className="nt-unlock" onSubmit={submit}>
      <p>
        <strong>Unlock owner actions</strong> to approve tasks here. Enter your <code>ADMIN_TOKEN</code>; it stays in this browser only.
      </p>
      <input id="admin-token" type="password" autoComplete="current-password" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Admin token" aria-label="Admin token" />
      {error && <p className="form-error">{error}</p>}
      <button className="btn btn-small btn-primary" disabled={checking || value.trim().length < 8}>
        {checking ? 'Checking…' : 'Unlock'}
      </button>
    </form>
  );
}
