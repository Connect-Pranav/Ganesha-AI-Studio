// Live goals on the studio backend: every step is inspectable (agent, attempts, engine,
// timings, errors, review fixes, output versions) plus the execution log. All in the panel.
import { useCallback, useEffect, useState } from 'react';
import { Icon } from './Icon';
import { Card, EmptyState, LiveBadge, formatWhen } from './ui';
import { Unlock } from './NotificationCenter';
import { openNewGoal, GOAL_TYPES } from './GoalModal';
import { agentById, agentName } from '../data/agentsMeta';
import { ApiError, api, getToken } from '../services/adminService';
import { loadArtifact } from '../services/studioService';
import { OPEN_STATUSES, WF_STATUS } from '../services/StudioContext';

interface WfRow { id: string; template: string; brand: string; title: string; status: string; created_at: string; updated_at: string }
interface Task {
  id: string;
  step_key: string;
  agent_id: string;
  deliverable: string;
  status: string;
  attempts: number;
  max_attempts: number;
  output_artifact: string | null;
  error: string | null;
  feedback: string | null;
  provider: string | null;
  model: string | null;
  is_gate: number;
  needs_approval: number;
  qa: string | null;
  started_at: string | null;
  finished_at: string | null;
  depends_on: string[] | string;
}
interface EventRow { id: number; task_id: string | null; kind: string; message: string; data_json: string | null; created_at: string }
interface Detail { workflow: WfRow & { goal: string }; tasks: Task[]; approvals: { id: string; task_id: string; status: string; decided_at: string | null; note: string | null }[]; events: EventRow[] }

const pill = (s: string) => <span className={`pill ${WF_STATUS[s]?.cls ?? 'pill-idle'}`}>{WF_STATUS[s]?.label ?? s}</span>;
const dur = (a: string | null, b: string | null) => {
  if (!a || !b) return null;
  const s = Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
};
const EVENT_LABEL: Record<string, string> = {
  workflow_created: 'Goal created',
  workflow_status: 'Goal status',
  task_completed: 'Completed',
  task_retry: 'Retry scheduled',
  task_retry_manual: 'You retried',
  task_failed: 'Failed',
  lease_expired: 'Worker timed out — requeued',
  gate_failed: 'Review sent back for fixes',
  gate_failed_final: 'Review failed — needs you',
  approval_requested: 'Approval requested',
  approved: 'You approved',
  rejected: 'You rejected',
  external_action_done: 'You confirmed a manual step',
};

/** What a finished step really produced. Agents write documents; they never render media or publish. */
function outputNote(t: Task): string {
  const limits = agentById(t.agent_id)?.limits;
  if (t.is_gate) return 'Written review (pass/fail with fixes).';
  if (t.needs_approval) return 'Written package for your approval. Nothing is published, spent or deployed by the agent.';
  return limits ? `Written deliverable. ${limits}` : 'Written deliverable (text). No audio, video, image or website file is produced by this step.';
}

export function StudioWorkflows({ brand, title = 'Studio goals', compact = false }: { brand?: string; title?: string; compact?: boolean }) {
  const [locked, setLocked] = useState(!getToken());
  const [rows, setRows] = useState<WfRow[] | null>(null);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [preview, setPreview] = useState<{ title: string; text: string; meta: string } | null>(null);
  const [versions, setVersions] = useState<Record<string, { id: string; kind: string; version: number; created_at: string }[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<'open' | 'all' | 'completed' | 'failed'>('all');

  const load = useCallback(async () => {
    if (!getToken()) return setLocked(true);
    try {
      const r = await api<{ workflows: WfRow[] }>('/api/workflows');
      setRows(brand ? r.workflows.filter((w) => w.brand === brand) : r.workflows);
      setError('');
      setLocked(false);
      if (openId) setDetail(await api<Detail>(`/api/workflows/${openId}`));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setLocked(true);
      else setError(e instanceof Error ? e.message : 'Could not load');
    }
  }, [openId, brand]);

  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 20_000);
    const onChange = () => load();
    window.addEventListener('ganesha:goal-created', onChange);
    window.addEventListener('ganesha:auth', onChange);
    return () => (clearInterval(t), window.removeEventListener('ganesha:goal-created', onChange), window.removeEventListener('ganesha:auth', onChange));
  }, [load]);

  const toggle = async (id: string) => {
    if (openId === id) return (setOpenId(null), setDetail(null));
    setOpenId(id);
    setDetail(null);
    setShowLog(false);
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

  const view = (t: Task, artifactId = t.output_artifact!) =>
    act(artifactId, async () => {
      const a = await loadArtifact(artifactId);
      setPreview({ title: `${agentName(t.agent_id)} · ${t.deliverable}`, text: a.text, meta: `Version ${a.version} · ${a.kind === 'review' ? 'review' : a.kind === 'rejected_output' ? 'rejected attempt' : 'deliverable'} · ${formatWhen(a.created_at)} · ${outputNote(t)}` });
    });

  const loadVersions = (t: Task) =>
    act(`v${t.id}`, async () => {
      const r = await api<{ artifacts: { id: string; kind: string; version: number; created_at: string }[] }>(`/api/tasks/${t.id}`);
      setVersions((v) => ({ ...v, [t.id]: r.artifacts }));
    });

  if (locked) {
    return (
      <Card title={title}>
        <Unlock onUnlocked={() => (setLocked(false), load())} />
      </Card>
    );
  }

  const shown = (rows ?? []).filter((w) =>
    filter === 'all' ? true : filter === 'open' ? OPEN_STATUSES.includes(w.status) : filter === 'failed' ? w.status === 'failed' : w.status === 'completed',
  );
  const countOf = (f: typeof filter) => (rows ?? []).filter((w) => (f === 'all' ? true : f === 'open' ? OPEN_STATUSES.includes(w.status) : w.status === f)).length;
  const goalTypes = brand ? GOAL_TYPES.filter((g) => g.template.startsWith(brand) || g.template === 'research_brief') : GOAL_TYPES.slice(0, 4);

  return (
    <Card title={title} action={rows?.length ? <LiveBadge /> : undefined}>
      <div className="goal-row goal-row-top">
        <span className="goal-label">New goal</span>
        <div className="goal-btns">
          {goalTypes.map((g) => (
            <button key={g.template} className="btn btn-small" onClick={() => openNewGoal(g.template)}>
              <Icon name="plus" size={14} /> {g.label}
            </button>
          ))}
        </div>
      </div>
      {!compact && rows && rows.length > 0 && (
        <div className="tabs" role="tablist" aria-label="Filter goals">
          {(['all', 'open', 'completed', 'failed'] as const).map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} className={`tab ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f === 'open' ? 'In progress' : f === 'completed' ? 'Done' : 'Failed'}
              <span className="tab-count">{countOf(f)}</span>
            </button>
          ))}
        </div>
      )}
      {error && <p className="drawer-notice error">{error}</p>}
      {rows === null ? (
        <p className="ai-note">Loading…</p>
      ) : shown.length === 0 ? (
        <EmptyState
          title={rows.length ? 'Nothing with this status' : 'No goals yet'}
          hint={rows.length ? undefined : 'Start one above. GANESHA assigns the team and the agents start within a few minutes.'}
        />
      ) : (
        <ul className="wf-list">
          {(compact ? shown.slice(0, 5) : shown).map((w) => (
            <li key={w.id} className="wf-item">
              <button className="wf-row" onClick={() => toggle(w.id)} aria-expanded={openId === w.id}>
                <span className="wf-row-main">
                  <span className="wf-name">{w.title}</span>
                  <span className="wf-meta">
                    {GOAL_TYPES.find((g) => g.template === w.template)?.label ?? w.template} · started {formatWhen(w.created_at)} · updated {formatWhen(w.updated_at)}
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
                      {w.status === 'completed' && (
                        <p className="truth-note">
                          <Icon name="check" size={14} /> Done means every step produced its written deliverable and you confirmed any manual step.
                          Agents do not render audio or video, build files, or publish anything themselves.
                        </p>
                      )}
                      <ol className="wf-steps">
                        {detail.tasks.map((t) => {
                          const ap = detail.approvals.find((a) => a.task_id === t.id && a.status === 'pending');
                          const decided = detail.approvals.find((a) => a.task_id === t.id && a.status !== 'pending');
                          const d = dur(t.started_at, t.finished_at);
                          return (
                            <li key={t.id} className={`wf-step wf-${t.status}`}>
                              <div className="wf-step-head">
                                <span>
                                  <strong>{agentName(t.agent_id)}</strong> · {t.deliverable}
                                  {t.is_gate ? ' (check)' : ''}
                                </span>
                                {pill(t.status)}
                              </div>
                              <p className="step-meta">
                                Attempt {t.attempts}/{t.max_attempts}
                                {t.provider && ` · ${t.provider}${t.model ? ` ${t.model}` : ''}`}
                                {d && ` · took ${d}`}
                                {t.finished_at && ` · finished ${formatWhen(t.finished_at)}`}
                                {t.qa && ` · review ${t.qa}`}
                                {decided && ` · you ${decided.status}${decided.decided_at ? ` ${formatWhen(decided.decided_at)}` : ''}`}
                              </p>
                              {t.status === 'completed' && <p className="step-out">{outputNote(t)}</p>}
                              {t.status === 'waiting_for_external_action' && (
                                <p className="step-out warn">Approved. This step happens outside the studio (for example an upload). Press “Mark done” after you have done it.</p>
                              )}
                              {t.error && t.status !== 'completed' && <p className="nt-text meta-error">{t.error}</p>}
                              {t.feedback && t.status !== 'completed' && <p className="step-out">Fix requested: {t.feedback}</p>}
                              <div className="nt-actions">
                                {t.output_artifact && (
                                  <button className="btn btn-small" disabled={busy === t.output_artifact} onClick={() => view(t)}>
                                    View output
                                  </button>
                                )}
                                {t.output_artifact && (
                                  <button className="btn btn-small" disabled={busy === `v${t.id}`} onClick={() => loadVersions(t)}>
                                    Versions
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
                              {versions[t.id] && (
                                <ul className="versions">
                                  {versions[t.id].map((v) => (
                                    <li key={v.id}>
                                      <button className="linkish" onClick={() => view(t, v.id)}>
                                        v{v.version} · {v.kind === 'rejected_output' ? 'rejected attempt' : v.kind}
                                      </button>{' '}
                                      <span className="stat-hint">{formatWhen(v.created_at)}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
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
                        <button className="btn btn-small" onClick={() => setShowLog((x) => !x)} aria-expanded={showLog}>
                          {showLog ? 'Hide' : 'Show'} execution log ({detail.events.length})
                        </button>
                      </div>
                      {showLog && (
                        <ol className="ev-log">
                          {detail.events.length === 0 && <li className="stat-hint">No events recorded.</li>}
                          {detail.events.map((e) => {
                            const t = detail.tasks.find((x) => x.id === e.task_id);
                            return (
                              <li key={e.id} className={`ev ev-${e.kind}`}>
                                <span className="ev-time">{new Date(e.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                                <span className="ev-kind">{EVENT_LABEL[e.kind] ?? e.kind}</span>
                                <span className="ev-msg">
                                  {t ? <strong>{agentName(t.agent_id)}: </strong> : null}
                                  {e.message}
                                </span>
                              </li>
                            );
                          })}
                        </ol>
                      )}
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
            <p className="ai-note preview-meta">{preview.meta}</p>
            <pre className="preview-text">{preview.text}</pre>
          </div>
        </div>
      )}
    </Card>
  );
}
