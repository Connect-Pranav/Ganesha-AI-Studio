// Live goals running on the studio backend: steps, deliverables and approvals — all in the panel.
import { useCallback, useEffect, useState } from 'react';
import { Icon } from './Icon';
import { Card, EmptyState, LiveBadge, formatWhen } from './ui';
import { Unlock } from './NotificationCenter';
import { openNewGoal, GOAL_TYPES } from './GoalModal';
import { agentName } from '../data/agentsMeta';
import { ApiError, api, getToken } from '../services/adminService';

interface WfRow { id: string; template: string; brand: string; title: string; status: string; created_at: string; updated_at: string }
interface Task { id: string; step_key: string; agent_id: string; deliverable: string; status: string; attempts: number; max_attempts: number; output_artifact: string | null; error: string | null; provider: string | null; model: string | null; is_gate: number; qa: string | null }
interface Detail { workflow: WfRow & { goal: string }; tasks: Task[]; approvals: { id: string; task_id: string; status: string }[] }

const STATUS: Record<string, { label: string; cls: string }> = {
  queued: { label: 'Queued', cls: 'pill-idle' },
  running: { label: 'Working', cls: 'pill-running' },
  paused: { label: 'Paused', cls: 'pill-paused' },
  waiting_for_approval: { label: 'Needs your approval', cls: 'pill-warn' },
  waiting_for_external_action: { label: 'Waiting for you', cls: 'pill-warn' },
  completed: { label: 'Done', cls: 'pill-running' },
  failed: { label: 'Failed', cls: 'pill-error' },
  cancelled: { label: 'Cancelled', cls: 'pill-idle' },
};
const pill = (s: string) => <span className={`pill ${STATUS[s]?.cls ?? 'pill-idle'}`}>{STATUS[s]?.label ?? s}</span>;

export function StudioWorkflows() {
  const [locked, setLocked] = useState(!getToken());
  const [rows, setRows] = useState<WfRow[] | null>(null);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [preview, setPreview] = useState<{ title: string; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!getToken()) return setLocked(true);
    try {
      const r = await api<{ workflows: WfRow[] }>('/api/workflows');
      setRows(r.workflows);
      setError('');
      if (openId) setDetail(await api<Detail>(`/api/workflows/${openId}`));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setLocked(true);
      else setError(e instanceof Error ? e.message : 'Could not load');
    }
  }, [openId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 20_000);
    const onCreated = () => load();
    window.addEventListener('ganesha:goal-created', onCreated);
    return () => (clearInterval(t), window.removeEventListener('ganesha:goal-created', onCreated));
  }, [load]);

  const toggle = async (id: string) => {
    if (openId === id) return (setOpenId(null), setDetail(null));
    setOpenId(id);
    setDetail(null);
    try {
      setDetail(await api<Detail>(`/api/workflows/${id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load');
    }
  };

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  };

  const view = (t: Task) =>
    act(t.output_artifact!, async () => {
      const a = await api<{ content: { deliverable?: string; summary?: string; verdict?: string; issues?: string[] } }>(`/api/artifacts/${t.output_artifact}`);
      const c = a.content;
      const text = c.deliverable ?? (c.verdict ? `Verdict: ${c.verdict}\n\n${c.summary ?? ''}\n\n${(c.issues ?? []).map((i) => `• ${i}`).join('\n')}` : JSON.stringify(c, null, 2));
      setPreview({ title: `${agentName(t.agent_id)} · ${t.deliverable}`, text });
    });

  if (locked) {
    return (
      <Card title="Studio goals">
        <Unlock onUnlocked={() => (setLocked(false), load())} />
      </Card>
    );
  }

  return (
    <Card title="Studio goals" action={rows?.length ? <LiveBadge /> : undefined}>
      <div className="goal-row">
        <span className="goal-label">New goal</span>
        <div className="goal-btns">
          {GOAL_TYPES.slice(0, 4).map((g) => (
            <button key={g.template} className="btn btn-small" onClick={() => openNewGoal(g.template)}>
              <Icon name="plus" size={14} /> {g.label}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="drawer-notice error">{error}</p>}
      {rows === null ? (
        <p className="ai-note">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState title="No goals yet" hint="Start one above. GANESHA assigns the team and the agents start within a few minutes." />
      ) : (
        <ul className="wf-list">
          {rows.map((w) => (
            <li key={w.id} className="wf-item">
              <button className="wf-row" onClick={() => toggle(w.id)} aria-expanded={openId === w.id}>
                <span className="wf-row-main">
                  <span className="wf-name">{w.title}</span>
                  <span className="wf-meta">
                    {GOAL_TYPES.find((g) => g.template === w.template)?.label ?? w.template} · updated {formatWhen(w.updated_at)}
                  </span>
                </span>
                {pill(w.status)}
              </button>
              {openId === w.id && (
                <div className="wf-detail">
                  {!detail ? (
                    <p className="ai-note">Loading…</p>
                  ) : (
                    <>
                      {detail.workflow.goal && <p className="wf-goal">{detail.workflow.goal}</p>}
                      <ol className="wf-steps">
                        {detail.tasks.map((t) => {
                          const ap = detail.approvals.find((a) => a.task_id === t.id && a.status === 'pending');
                          return (
                            <li key={t.id} className={`wf-step wf-${t.status}`}>
                              <div className="wf-step-head">
                                <span>
                                  <strong>{agentName(t.agent_id)}</strong> · {t.deliverable}
                                  {t.is_gate ? ' (check)' : ''}
                                </span>
                                {pill(t.status)}
                              </div>
                              {t.error && t.status !== 'completed' && <p className="nt-text">{t.error}</p>}
                              <div className="nt-actions">
                                {t.output_artifact && (
                                  <button className="btn btn-small" disabled={busy === t.output_artifact} onClick={() => view(t)}>
                                    View
                                  </button>
                                )}
                                {ap && (
                                  <>
                                    <button className="btn btn-small btn-primary" disabled={busy === ap.id} onClick={() => act(ap.id, () => api(`/api/approvals/${ap.id}`, { method: 'POST', body: JSON.stringify({ decision: 'approved' }) }))}>
                                      Approve
                                    </button>
                                    <button className="btn btn-small" disabled={busy === ap.id} onClick={() => act(ap.id, () => api(`/api/approvals/${ap.id}`, { method: 'POST', body: JSON.stringify({ decision: 'rejected' }) }))}>
                                      Reject
                                    </button>
                                  </>
                                )}
                                {t.status === 'waiting_for_external_action' && (
                                  <button className="btn btn-small btn-primary" disabled={busy === t.id} onClick={() => act(t.id, () => api(`/api/tasks/${t.id}/complete-external`, { method: 'POST', body: '{}' }))}>
                                    Mark done
                                  </button>
                                )}
                                {t.status === 'failed' && (
                                  <button className="btn btn-small" disabled={busy === t.id} onClick={() => act(t.id, () => api(`/api/tasks/${t.id}/retry`, { method: 'POST', body: '{}' }))}>
                                    Retry
                                  </button>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                      <div className="nt-actions">
                        {['queued', 'running', 'waiting_for_approval', 'waiting_for_external_action'].includes(w.status) && (
                          <button className="btn btn-small" onClick={() => act(`p${w.id}`, () => api(`/api/workflows/${w.id}/pause`, { method: 'POST', body: '{}' }))}>
                            Pause
                          </button>
                        )}
                        {w.status === 'paused' && (
                          <button className="btn btn-small" onClick={() => act(`r${w.id}`, () => api(`/api/workflows/${w.id}/resume`, { method: 'POST', body: '{}' }))}>
                            Resume
                          </button>
                        )}
                        {!['completed', 'cancelled'].includes(w.status) && (
                          <button className="btn btn-small" onClick={() => act(`c${w.id}`, () => api(`/api/workflows/${w.id}/cancel`, { method: 'POST', body: '{}' }))}>
                            Cancel goal
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
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
    </Card>
  );
}
