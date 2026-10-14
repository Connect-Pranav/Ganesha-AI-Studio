// Task manager: every orchestrator task with its CBO lifecycle state, priority, deadline,
// estimate vs actual, reassignment and retry. Plus a DRAFT planner that writes nothing.
import { useMemo, useState, type FormEvent } from 'react';
import { Card, EmptyState, productNames } from '../ui';
import { AGENTS, agentName } from '../../data/agentsMeta';
import { cbo, dateShort, dur, LIFECYCLE, LIFECYCLE_LABEL, money, tokens, useLoad, type Lifecycle, type Plan, type TaskRow } from '../../services/cboService';
import { Gate, Honest, Pill, TEMPLATE_OPTIONS, useAction } from './common';
import { PlanTable } from './CboView';

const GATES = new Set(['ops_dharma_safety', 'chitragupta_quality_audit']);

export function TaskManager() {
  const r = useLoad(() => cbo.tasks());
  const [filter, setFilter] = useState<Lifecycle | 'ALL' | 'OPEN'>('OPEN');
  const [open, setOpen] = useState<string | null>(null);
  const tasks = r.data?.tasks ?? [];
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of tasks) c[t.state] = (c[t.state] ?? 0) + 1;
    return c;
  }, [tasks]);
  const shown = tasks.filter((t) => (filter === 'ALL' ? true : filter === 'OPEN' ? !['COMPLETED', 'CANCELLED'].includes(t.state) : t.state === filter));
  return (
    <>
      <Planner />
      <Gate title="Tasks" locked={r.locked} ready={Boolean(r.data)} error={r.error} onRetry={r.reload}>
        <Card title="Tasks" action={<button className="btn btn-small" onClick={r.reload}>{r.loading ? 'Loading…' : 'Refresh'}</button>}>
          <div className="tabs" role="tablist" aria-label="Filter by state">
            {(['OPEN', 'ALL', ...LIFECYCLE] as const).map((s) => (
              <button key={s} role="tab" aria-selected={filter === s} className={`tab ${filter === s ? 'active' : ''}`} onClick={() => setFilter(s)}>
                {s === 'OPEN' ? 'Open' : s === 'ALL' ? 'All' : LIFECYCLE_LABEL[s].label}{' '}
                <span className="tab-count">{s === 'OPEN' ? tasks.filter((t) => !['COMPLETED', 'CANCELLED'].includes(t.state)).length : s === 'ALL' ? tasks.length : counts[s] ?? 0}</span>
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <EmptyState title="No tasks in this view." hint="Tasks appear when a goal is started (Pipelines → New goal, or Confirm a plan)." />
          ) : (
            <div className="an-table-wrap">
              <table className="an-table cx-tasks">
                <thead>
                  <tr>
                    <th>Goal · step</th>
                    <th>Agent</th>
                    <th>State</th>
                    <th>Priority</th>
                    <th>Deadline</th>
                    <th className="num">Estimate</th>
                    <th className="num">Actual</th>
                    <th className="num">Tries</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((t) => (
                    <TaskRowView key={t.id} t={t} open={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)} reload={r.reload} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Honest>States: Ready = can start now · Assigned = waiting for upstream steps · Blocked = paused, failed upstream, global pause, or waiting for you to do an approved action. Estimates are made right before a task starts, from the real prompt.</Honest>
        </Card>
      </Gate>
    </>
  );
}

function TaskRowView({ t, open, onToggle, reload }: { t: TaskRow; open: boolean; onToggle: () => void; reload: () => void }) {
  const lc = LIFECYCLE_LABEL[t.state];
  return (
    <>
      <tr className={t.overdue ? 'cx-overdue' : ''}>
        <td>
          <strong>{t.workflowTitle}</strong>
          <div className="cx-sub">
            {productNames[t.brand as keyof typeof productNames] ?? t.brand} · {t.stepKey}
            {t.gate ? ' · review gate' : ''}
            {t.approvalStep ? ' · needs approval' : ''}
          </div>
        </td>
        <td>
          {agentName(t.agentId)}
          {t.reassignedFrom && <div className="cx-sub">from {agentName(t.reassignedFrom)}</div>}
        </td>
        <td>
          <Pill cls={lc.cls} title={t.stateReason ?? undefined}>
            {lc.label}
          </Pill>
          {t.stateReason && <div className="cx-sub">{t.stateReason}</div>}
        </td>
        <td>{t.priority}</td>
        <td>
          {t.deadline ? dateShort(t.deadline) : '—'}
          {t.overdue && <div className="cx-err">Overdue</div>}
        </td>
        <td className="num">{t.estimate ? money(t.estimate.direct_inr, t.estimate.direct_usd) : '—'}</td>
        <td className="num">{t.actual ? money(t.actual.unknown ? null : t.actual.inr, t.actual.usd) : '—'}</td>
        <td className="num">
          {t.attempts}/{t.maxAttempts}
        </td>
        <td>
          <button className="btn btn-small" aria-expanded={open} onClick={onToggle}>
            {open ? 'Close' : 'Manage'}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="cx-detail-row">
          <td colSpan={9}>
            <TaskDetail t={t} reload={reload} />
          </td>
        </tr>
      )}
    </>
  );
}

function TaskDetail({ t, reload }: { t: TaskRow; reload: () => void }) {
  const act = useAction();
  const est = useLoad(() => cbo.estimates(t.id), [t.id]);
  const [priority, setPriority] = useState(t.priority);
  const [deadline, setDeadline] = useState(t.deadline ? t.deadline.slice(0, 16) : '');
  const [agent, setAgent] = useState('');
  const candidates = AGENTS.filter((a) => a.id !== t.agentId && a.id !== 'ganesha_orchestrator' && GATES.has(a.id) === t.gate && (!t.approvalStep || a.approvalRequired.length > 0));
  const canReassign = ['READY', 'ASSIGNED', 'BLOCKED', 'FAILED'].includes(t.state) && ['queued', 'failed'].includes(t.status);
  const latest = est.data?.estimates[0];
  return (
    <div className="cx-detail">
      {act.error && <p className="form-error">{act.error}</p>}
      {t.error && <p className="cx-err">Last error: {t.error}</p>}
      <div className="cx-detail-grid">
        <form
          className="form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            act.run('meta', () => cbo.taskMeta(t.id, { priority, deadline: deadline ? new Date(deadline).toISOString() : null }), reload);
          }}
        >
          <div className="form-row">
            <label>
              Priority
              <select value={priority} onChange={(e) => setPriority(e.target.value as TaskRow['priority'])}>
                {['urgent', 'high', 'normal', 'low'].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <label>
              Deadline
              <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </label>
          </div>
          <button className="btn btn-small btn-primary" disabled={act.busy === 'meta'}>
            Save
          </button>
        </form>
        <div className="form">
          <label>
            Reassign to
            <select value={agent} onChange={(e) => setAgent(e.target.value)} disabled={!canReassign}>
              <option value="">{canReassign ? 'Choose an agent…' : 'Only queued or failed tasks'}</option>
              {candidates.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} — {a.role}
                </option>
              ))}
            </select>
          </label>
          <div className="cx-actions">
            <button className="btn btn-small" disabled={!agent || act.busy === 're'} onClick={() => act.run('re', () => cbo.reassign(t.id, agent), reload)}>
              Reassign
            </button>
            {t.state === 'FAILED' && (
              <button className="btn btn-small btn-primary" disabled={act.busy === 'retry'} onClick={() => act.run('retry', () => cbo.retry(t.id), reload)}>
                Retry (fresh attempts)
              </button>
            )}
          </div>
        </div>
      </div>
      <h3 className="cx-h3">Cost preflight</h3>
      {!latest ? (
        <p className="cx-sub">{est.loading ? 'Loading…' : 'Not estimated yet — estimates are made when the task is about to start.'}</p>
      ) : (
        <>
          <dl className="kv-row">
            <div>
              <dt>Engine</dt>
              <dd>
                {latest.provider}/{latest.model}
              </dd>
            </div>
            <div>
              <dt>Tokens in / out</dt>
              <dd>
                {tokens(latest.est_input_tokens)} / {tokens(latest.est_output_tokens)}
              </dd>
            </div>
            <div>
              <dt>Calls</dt>
              <dd>{latest.est_calls}</dd>
            </div>
            <div>
              <dt>Direct</dt>
              <dd>{money(latest.direct_inr, latest.direct_usd)}</dd>
            </div>
            <div>
              <dt>Conservative</dt>
              <dd>{money(latest.conservative_inr, latest.conservative_usd)}</dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>{dur(latest.duration_sec)}</dd>
            </div>
            <div>
              <dt>Confidence</dt>
              <dd>{latest.confidence}</dd>
            </div>
            <div>
              <dt>Decision</dt>
              <dd>{latest.decision.replace(/_/g, ' ')}</dd>
            </div>
          </dl>
          {latest.pricing && (
            <p className="cx-sub">
              Price source:{' '}
              <a href={latest.pricing.source} target="_blank" rel="noreferrer">
                {new URL(latest.pricing.source).hostname}
              </a>{' '}
              · verified {latest.pricing.verifiedAt}
            </p>
          )}
          <ul className="cx-assume">
            {latest.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </>
      )}
      {t.actual && (
        <p className="cx-sub">
          Actual so far: {t.actual.calls} call(s), {tokens(t.actual.input)} in / {tokens(t.actual.output)} out tokens, {money(t.actual.unknown ? null : t.actual.inr, t.actual.usd)}
          {t.actual.unknown ? ' (some cost rows unknown)' : ''}.
        </p>
      )}
    </div>
  );
}

function Planner() {
  const [template, setTemplate] = useState('littleloop_episode');
  const [title, setTitle] = useState('');
  const [count, setCount] = useState(1);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [started, setStarted] = useState<string | null>(null);
  const act = useAction();
  return (
    <Card title="Plan & estimate (nothing runs until you start it)">
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          setStarted(null);
          act.run('plan', async () => setPlan(await cbo.plan(template, title, count)));
        }}
      >
        <div className="form-row cx-wrap">
          <label>
            Workflow
            <select value={template} onChange={(e) => setTemplate(e.target.value)}>
              {TEMPLATE_OPTIONS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="e.g. Monsoon puddle jump" />
          </label>
          <label className="cx-narrow">
            How many
            <input type="number" min={1} max={10} value={count} onChange={(e) => setCount(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} />
          </label>
        </div>
        <div className="cx-actions">
          <button className="btn btn-primary btn-small" disabled={act.busy === 'plan'}>
            {act.busy === 'plan' ? 'Estimating…' : 'Estimate'}
          </button>
          {plan && title.trim() && (
            <button
              type="button"
              className="btn btn-small"
              disabled={act.busy === 'start'}
              onClick={() =>
                act.run('start', async () => {
                  for (let i = 0; i < plan.count; i++) await cbo.startWorkflow(plan.template, plan.count > 1 ? `${title.trim().slice(0, 110)} #${i + 1}` : title.trim(), '', `plan-${Date.now()}-${i}`);
                  setStarted(`Started ${plan.count} goal(s). Each step is estimated again with real inputs before it runs.`);
                  window.dispatchEvent(new Event('ganesha:goal-created'));
                })
              }
            >
              Start {plan.count > 1 ? `${plan.count} goals` : 'goal'}
            </button>
          )}
        </div>
      </form>
      {act.error && <p className="form-error">{act.error}</p>}
      {started && <p className="cx-ok">{started}</p>}
      {plan && <PlanTable plan={plan} />}
    </Card>
  );
}
