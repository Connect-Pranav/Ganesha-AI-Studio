// GANESHA CBO — executive dashboard + command bar. Every value comes from /api/cbo/report.
import { useState, type FormEvent } from 'react';
import { Card, EmptyState, productNames } from '../ui';
import { agentName } from '../../data/agentsMeta';
import { cbo, dateShort, dur, inr, LIFECYCLE_LABEL, money, useLoad, type CommandResult, type Lifecycle, type Plan, type Report } from '../../services/cboService';
import { Gate, Honest, Pill, Tile, useAction } from './common';

const SUGGESTIONS = [
  'Give me today’s complete studio status.',
  'Which agents are working and what is each one doing?',
  'Plan five Instagram Reels and estimate the cost before assigning any tasks.',
  'Show me remaining credits and tell me which balances are unknown.',
  'Which tasks are at risk of missing their deadlines?',
  'Pause tasks that could incur new API charges.',
  'Which provider requires authorization?',
  'Show me the tasks waiting for my approval.',
];

export function CboView({ onNavigate }: { onNavigate: (v: 'tasks' | 'finance' | 'connection' | 'pipelines') => void }) {
  const r = useLoad(() => cbo.report());
  return (
    <>
      <CommandBar onDone={r.reload} />
      <Gate title="Executive dashboard" locked={r.locked} ready={Boolean(r.data)} error={r.error} onRetry={r.reload}>
        {r.data && <Body rep={r.data} reload={r.reload} onNavigate={onNavigate} />}
      </Gate>
    </>
  );
}

function Body({ rep, reload, onNavigate }: { rep: Report; reload: () => void; onNavigate: (v: 'tasks' | 'finance' | 'connection' | 'pipelines') => void }) {
  const act = useAction();
  const s = rep.tasks.byState;
  const m = rep.money;
  const providersOk = rep.health.providers.filter((p) => p.state === 'last_request_ok').length;
  return (
    <>
      {rep.health.dispatchPaused && (
        <div className="notice" role="status">
          Global dispatch pause is <strong>ON</strong>: no new chargeable tasks start. Requests already sent to a provider finish normally.
        </div>
      )}
      <section className="grid-4 cx-tiles" aria-label="Studio health">
        <Tile label="Active tasks" value={s.RUNNING + s.READY + s.ASSIGNED} hint={`${s.RUNNING} running · ${s.READY} ready · ${s.ASSIGNED} assigned`} />
        <Tile label="Blocked / failed" value={`${s.BLOCKED} / ${s.FAILED}`} tone={s.FAILED ? 'err' : s.BLOCKED ? 'warn' : undefined} hint={`${s.COMPLETED} completed all-time`} />
        <Tile label="Waiting for you" value={rep.approvals.length} tone={rep.approvals.length ? 'warn' : undefined} hint="approvals (content + budget)" />
        <Tile label="Agents" value={`${rep.agents.available} free`} hint={`${rep.agents.working} working of ${rep.agents.total}`} />
        <Tile label="Spend this month" value={m.fxSet ? inr(m.actualMonthInr) : '—'} hint={m.fxSet ? (m.unknownCostRows ? `${m.unknownCostRows} cost row(s) unknown` : 'API usage (actual)') : 'Set a USD→INR rate in CFO'} />
        <Tile label="Reserved" value={inr(m.reservedInr)} hint="held for running tasks" />
        <Tile label="Queued work (est.)" value={inr(m.queuedEstimateInr)} hint="history-based estimate, not reserved" />
        <Tile label="Providers" value={`${providersOk}/${rep.health.providers.length}`} tone={providersOk < rep.health.providers.length ? 'warn' : 'ok'} hint="last request OK" />
      </section>

      <div className="grid-main">
        <div className="cx-col">
          <Card title="Pending decisions" action={<button className="btn btn-small" onClick={reload}>Refresh</button>}>
            {act.error && <p className="form-error">{act.error}</p>}
            {rep.approvals.length === 0 ? (
              <EmptyState title="Nothing waits for you." />
            ) : (
              <ul className="cx-list">
                {rep.approvals.map((a) => (
                  <li key={a.id}>
                    <div className="cx-li-main">
                      <p>
                        <Pill cls={a.action.startsWith('budget:') ? 'pill-warn' : 'pill-idle'}>{a.action.startsWith('budget:') ? 'Budget' : 'Approval'}</Pill> <strong>{a.workflow_title}</strong> · {a.action.replace(/^budget:/, '')}
                      </p>
                      <p className="cx-sub">{a.summary}</p>
                    </div>
                    <div className="cx-actions">
                      <button className="btn btn-small btn-primary" disabled={!!act.busy} onClick={() => act.run(a.id, () => cbo.decide(a.id, 'approved'), reload)}>
                        Approve
                      </button>
                      <button className="btn btn-small" disabled={!!act.busy} onClick={() => act.run(a.id, () => cbo.decide(a.id, 'rejected'), reload)}>
                        Reject
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Blockers & failures" action={<button className="btn btn-small" onClick={() => onNavigate('tasks')}>Task manager</button>}>
            {rep.blockers.length === 0 ? (
              <EmptyState title="No blocked or failed tasks." />
            ) : (
              <ul className="cx-list">
                {rep.blockers.map((t) => (
                  <li key={t.id}>
                    <div className="cx-li-main">
                      <p>
                        <Pill cls={LIFECYCLE_LABEL[t.state].cls}>{LIFECYCLE_LABEL[t.state].label}</Pill> <strong>{t.workflowTitle}</strong> · {t.stepKey} · {agentName(t.agentId)}
                      </p>
                      <p className="cx-sub">{t.error ?? t.reason ?? ''}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Deadlines">
            {rep.deadlines.overdue.length + rep.deadlines.upcoming7d.length + rep.deadlines.delayedGoals.length === 0 ? (
              <EmptyState title="No deadlines set or due." hint="Set deadlines in the Task manager." />
            ) : (
              <ul className="cx-list">
                {rep.deadlines.delayedGoals.map((g) => (
                  <li key={g.id}>
                    <Pill cls="pill-error">Delayed goal</Pill> <strong>{g.title}</strong> · due {dateShort(g.deadline)}
                  </li>
                ))}
                {rep.deadlines.overdue.map((t) => (
                  <li key={t.id}>
                    <Pill cls="pill-error">Overdue</Pill> {t.workflowTitle} · {t.stepKey} · due {dateShort(t.deadline)}
                  </li>
                ))}
                {rep.deadlines.upcoming7d.map((t) => (
                  <li key={t.id}>
                    <Pill cls="pill-idle">Due soon</Pill> {t.workflowTitle} · {t.stepKey} · {dateShort(t.deadline)}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="cx-col">
          <Card title="Recommended next actions">
            {rep.recommendedActions.length === 0 ? (
              <EmptyState title="Nothing needs attention." />
            ) : (
              <ol className="cx-ol">
                {rep.recommendedActions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ol>
            )}
          </Card>
          <Card title="Budgets" action={<button className="btn btn-small" onClick={() => onNavigate('finance')}>CFO</button>}>
            {m.budgets.length === 0 ? (
              <EmptyState title="No budget set." hint="Nothing is blocked by budget until you set one." />
            ) : (
              <ul className="cx-list">
                {m.budgets.map((b) => (
                  <li key={b.id}>
                    <div className="cx-li-main">
                      <p>
                        <strong>{b.scope.replace('_', ' ')}</strong> {b.scopeRef && b.scopeRef !== '*' ? `· ${b.scopeRef}` : ''}
                      </p>
                      {b.scope !== 'task' && <Meter used={b.usedInr} limit={b.limitInr} warn={b.warning} />}
                      <p className="cx-sub">{b.scope === 'task' ? `Max ${inr(b.limitInr)} per task` : `${inr(b.usedInr)} of ${inr(b.limitInr)} · ${inr(b.remainingInr)} left`}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="cx-sub">Forecast this month: {m.forecastMonthInr === null ? 'not enough priced data' : inr(m.forecastMonthInr)} · Subscriptions {inr(m.subscriptionsMonthlyInr)}/mo</p>
          </Card>
          <Card title="Provider health" action={<button className="btn btn-small" onClick={() => onNavigate('connection')}>Connections</button>}>
            <ul className="cx-list compact">
              {rep.health.providers.map((p) => (
                <li key={p.provider}>
                  <span>
                    <strong>{p.provider}</strong> <span className="cx-sub">{p.model}</span>
                  </span>
                  <Pill cls={p.state === 'last_request_ok' ? 'pill-running' : p.state === 'not_configured' ? 'pill-idle' : 'pill-warn'}>{p.state.replace(/_/g, ' ')}</Pill>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
      <Honest>Generated {dateShort(rep.generatedAt)} by GANESHA_CBO from studio records. Estimates are marked as estimates; “—” means unknown, not zero.</Honest>
    </>
  );
}

export function Meter({ used, limit, warn }: { used: number; limit: number; warn: boolean }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
  return (
    <div className="cx-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${pct}% used`}>
      <span className={warn || pct >= 100 ? 'cx-meter-fill warn' : 'cx-meter-fill'} style={{ width: `${pct}%` }} />
    </div>
  );
}

function CommandBar({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState('');
  const [res, setRes] = useState<CommandResult | null>(null);
  const act = useAction();
  const [applied, setApplied] = useState<string | null>(null);
  const submit = async (e?: FormEvent, t = text) => {
    e?.preventDefault();
    if (!t.trim()) return;
    setApplied(null);
    await act.run('cmd', async () => setRes(await cbo.command(t)));
  };
  const apply = async () => {
    const a = res?.proposedAction;
    if (!a) return;
    const n = a.repeat ?? 1;
    const ok = await act.run('apply', async () => {
      for (let i = 0; i < n; i++) {
        if (a.path === '/api/workflows') {
          const body = a.body as { template: string; title: string; goal: string };
          await cbo.startWorkflow(body.template, n > 1 ? `${body.title.slice(0, 110)} #${i + 1}` : body.title, body.goal, `cmd-${res!.intent}-${Date.now()}-${i}`);
        } else await cbo.raw(a.method, a.path, a.body);
      }
    });
    if (ok) {
      setApplied(`${a.label}: done.`);
      window.dispatchEvent(new Event('ganesha:goal-created'));
      onDone();
    }
  };
  const plan = res?.intent === 'plan' ? (res.data as Plan) : null;
  return (
    <Card title="Ask GANESHA CBO">
      <form className="cx-cmd" onSubmit={submit}>
        <label className="sr-only" htmlFor="cbo-cmd">
          Command
        </label>
        <input id="cbo-cmd" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Plan five Instagram Reels and estimate the cost" maxLength={500} />
        <button className="btn btn-primary" disabled={act.busy === 'cmd' || !text.trim()}>
          {act.busy === 'cmd' ? 'Thinking…' : 'Ask'}
        </button>
      </form>
      <div className="cx-chips">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" className="cx-chip" onClick={() => (setText(s), submit(undefined, s))}>
            {s}
          </button>
        ))}
      </div>
      {act.error && <p className="form-error">{act.error}</p>}
      {res && (
        <div className="cx-answer" role="status">
          <p>{res.answer}</p>
          {plan && <PlanTable plan={plan} />}
          {res.proposedAction && !applied && (
            <div className="cx-actions">
              <button className="btn btn-small btn-primary" onClick={apply} disabled={act.busy === 'apply'}>
                {act.busy === 'apply' ? 'Working…' : `Confirm: ${res.proposedAction.label}`}
              </button>
              <span className="cx-sub">Nothing changes until you confirm.</span>
            </div>
          )}
          {applied && <p className="cx-ok">{applied}</p>}
          <p className="cx-sub">Intent: {res.intent} · Source: {res.source}</p>
        </div>
      )}
    </Card>
  );
}

export function PlanTable({ plan }: { plan: Plan }) {
  return (
    <div className="an-table-wrap">
      <table className="an-table">
        <thead>
          <tr>
            <th>Step</th>
            <th>Agent</th>
            <th>Engine</th>
            <th className="num">Tokens in/out</th>
            <th className="num">Direct</th>
            <th className="num">Conservative</th>
            <th>Conf.</th>
            <th>Approval</th>
          </tr>
        </thead>
        <tbody>
          {plan.steps.map((s) => (
            <tr key={s.key}>
              <td>
                <strong>{s.key}</strong>
                <div className="cx-sub">{s.deliverable}</div>
              </td>
              <td>{s.agentName}</td>
              <td>
                {s.estimate.provider}/{s.estimate.model}
                {!s.estimate.engineConfigured && <div className="cx-sub">not configured</div>}
              </td>
              <td className="num">
                {s.estimate.estInputTokens.toLocaleString('en-IN')} / {s.estimate.estOutputTokens.toLocaleString('en-IN')}
              </td>
              <td className="num">{money(s.estimate.directInr, s.estimate.directUsd)}</td>
              <td className="num">{money(s.estimate.conservativeInr, s.estimate.conservativeUsd)}</td>
              <td>{s.estimate.confidence}</td>
              <td>{s.approval ? 'You approve' : s.gate ? 'Review gate' : '—'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4}>
              <strong>
                Total × {plan.count} · ~{dur(plan.totals.durationSec)} per goal
              </strong>
            </td>
            <td className="num">
              <strong>{money(plan.totals.directInr, plan.totals.directUsd)}</strong>
            </td>
            <td className="num">
              <strong>{money(plan.totals.conservativeInr, plan.totals.conservativeUsd)}</strong>
            </td>
            <td colSpan={2}>{plan.confidence}</td>
          </tr>
        </tfoot>
      </table>
      <p className="cx-sub">
        {plan.note} {plan.budgetCheck.ok === null ? plan.budgetCheck.note : plan.budgetCheck.ok ? 'Within budget.' : 'Would exceed a budget — dispatch will stop for your approval.'} Brand: {productNames[plan.brand as keyof typeof productNames] ?? plan.brand}.
      </p>
      {plan.notes?.map((n) => (
        <p key={n} className="cx-sub">
          {n}
        </p>
      ))}
      <details className="cx-details">
        <summary>Assumptions</summary>
        <ul>
          {[...new Set(plan.steps.flatMap((s) => s.estimate.assumptions))].map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

export type { Lifecycle };
