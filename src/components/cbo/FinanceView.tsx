// CFO & Cost Intelligence. INR first; source currency and FX timestamp kept. Unknown stays unknown.
import { useState, type FormEvent } from 'react';
import { Card, EmptyState, productNames } from '../ui';
import { agentName } from '../../data/agentsMeta';
import { dateShort, fin, inr, money, tokens, usd, useLoad, type Finance, type Settings } from '../../services/cboService';
import { Gate, Honest, Pill, Tile, useAction } from './common';
import { Meter } from './CboView';

export function FinanceView() {
  const f = useLoad(() => fin.summary());
  const s = useLoad(() => fin.settings());
  const reload = () => (f.reload(), s.reload());
  return (
    <Gate title="CFO & Cost Intelligence" locked={f.locked} ready={Boolean(f.data && s.data)} error={f.error ?? s.error} onRetry={reload}>
      {f.data && s.data && <Body f={f.data} s={s.data} reload={reload} />}
    </Gate>
  );
}

function Body({ f, s, reload }: { f: Finance; s: Settings; reload: () => void }) {
  return (
    <>
      {!f.fx && <div className="notice">No USD→INR rate is set, so costs show in USD and INR budgets can’t be checked. Set it below (Settings).</div>}
      <section className="grid-4 cx-tiles" aria-label="This month">
        <Tile label={`API spend · ${f.month}`} value={f.fx ? inr(f.actual.inr) : '—'} hint={f.actual.unknownRows ? `${f.actual.unknownRows} row(s) with unknown cost` : 'actual, reconciled'} tone={f.actual.unknownRows ? 'warn' : undefined} />
        <Tile label="Subscriptions / month" value={inr(f.subscriptions.monthlyInr)} hint={`${f.subscriptions.count} entered${f.subscriptions.unconverted ? ` · ${f.subscriptions.unconverted} not converted` : ''}`} />
        <Tile label="Reserved now" value={inr(f.reserved.inr)} hint={`${f.reserved.active} active reservation(s)`} />
        <Tile label="Queued work (est.)" value={inr(f.queuedEstimate.inr)} hint={`${f.queuedEstimate.tasks} task(s)${f.queuedEstimate.tasksWithUnknownCost ? ` · ${f.queuedEstimate.tasksWithUnknownCost} unknown` : ''}`} />
      </section>
      <div className="grid-main">
        <div className="cx-col">
          <Budgets f={f} reload={reload} />
          <Card title="Provider usage this month">
            {f.actual.byProvider.length === 0 && f.tokensByModel.length === 0 ? (
              <EmptyState title="No usage recorded this month." />
            ) : (
              <div className="an-table-wrap">
                <table className="an-table">
                  <thead>
                    <tr>
                      <th>Provider / model</th>
                      <th>Purpose</th>
                      <th className="num">Calls</th>
                      <th className="num">Input tok.</th>
                      <th className="num">Output tok.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {f.tokensByModel.map((r) => (
                      <tr key={`${r.provider}${r.model}${r.purpose}`}>
                        <td>
                          {r.provider}/{r.model}
                        </td>
                        <td>{r.purpose}</td>
                        <td className="num">{r.calls}</td>
                        <td className="num">{tokens(r.input_tokens)}</td>
                        <td className="num">{tokens(r.output_tokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <table className="an-table">
                  <thead>
                    <tr>
                      <th>Provider (ledger)</th>
                      <th className="num">Calls</th>
                      <th className="num">USD</th>
                      <th className="num">INR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {f.actual.byProvider.map((r) => (
                      <tr key={r.provider}>
                        <td>{r.provider}</td>
                        <td className="num">{r.calls}</td>
                        <td className="num">{usd(r.usd)}</td>
                        <td className="num">{r.unknown_rows ? `${inr(r.inr)} + unknown` : inr(r.inr)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Card title="Estimated vs actual (latest tasks)">
            {f.estimateVsActual.length === 0 ? (
              <EmptyState title="No reconciled tasks yet." />
            ) : (
              <div className="an-table-wrap">
                <table className="an-table">
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th className="num">Estimated</th>
                      <th className="num">Actual</th>
                      <th className="num">Diff</th>
                    </tr>
                  </thead>
                  <tbody>
                    {f.estimateVsActual.map((r) => {
                      const d = r.est_usd !== null && r.act_usd !== null && r.est_usd > 0 ? Math.round(((r.act_usd - r.est_usd) / r.est_usd) * 100) : null;
                      return (
                        <tr key={r.task_id}>
                          <td>
                            {r.workflow_title} · {r.step_key}
                            <div className="cx-sub">{agentName(r.agent_id)}</div>
                          </td>
                          <td className="num">{money(r.est_inr, r.est_usd)}</td>
                          <td className="num">{money(r.act_inr, r.act_usd)}</td>
                          <td className="num">{d === null ? '—' : `${d > 0 ? '+' : ''}${d}%`}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Card title="Cost per completed deliverable">
            {f.perDeliverable.length === 0 ? (
              <EmptyState title="No completed goals yet." />
            ) : (
              <ul className="cx-list compact">
                {f.perDeliverable.map((r) => (
                  <li key={`${r.template}${r.brand}`}>
                    <span>
                      {productNames[r.brand as keyof typeof productNames] ?? r.brand} · {r.template.replace(/_/g, ' ')} <span className="cx-sub">({r.completed} done)</span>
                    </span>
                    <strong>{r.perDeliverableInr === null ? 'Unknown' : inr(r.perDeliverableInr)}</strong>
                  </li>
                ))}
              </ul>
            )}
            <Honest>These are written deliverables (briefs, scripts, prompts). Video/audio generated in Flow or Canva is covered by those subscriptions and is not in this figure. Cost per Reel / YouTube video appears once those goals complete.</Honest>
          </Card>
        </div>
        <div className="cx-col">
          <SettingsCard s={s} reload={reload} />
          <Card title="Forecast & quota">
            <p>
              <strong>{f.forecastMonthInr === null ? 'No forecast' : inr(f.forecastMonthInr)}</strong> <span className="cx-sub">{f.forecastNote}</span>
            </p>
            <ul className="cx-list compact">
              {f.quota.map((q) => (
                <li key={q.provider}>
                  <span>
                    <strong>{q.provider}</strong> <span className="cx-sub">{q.note}</span>
                  </span>
                  <Pill cls="pill-idle">Unknown</Pill>
                </li>
              ))}
            </ul>
            <Honest>{f.limitation}</Honest>
          </Card>
          <Subscriptions reload={reload} />
          <Pricing />
        </div>
      </div>
    </>
  );
}

function Budgets({ f, reload }: { f: Finance; reload: () => void }) {
  const act = useAction();
  const [scope, setScope] = useState('monthly_total');
  const [ref, setRef] = useState('');
  const [limit, setLimit] = useState('');
  const [warn, setWarn] = useState('80');
  return (
    <Card title="Budgets (INR)">
      {f.budgets.length === 0 ? (
        <EmptyState title="No budget set." hint="Until you set one, nothing is blocked for cost — only your approval thresholds apply." />
      ) : (
        <ul className="cx-list">
          {f.budgets.map((b) => (
            <li key={b.id}>
              <div className="cx-li-main">
                <p>
                  <strong>{b.scope.replace('_', ' ')}</strong> {b.scopeRef && b.scopeRef !== '*' ? `· ${b.scopeRef}` : ''} {b.warning && <Pill cls="pill-warn">≥ {b.warnPct}%</Pill>}
                </p>
                {b.scope !== 'task' && <Meter used={b.usedInr} limit={b.limitInr} warn={b.warning} />}
                <p className="cx-sub">{b.scope === 'task' ? `Max ${inr(b.limitInr)} per task (conservative estimate)` : `${inr(b.usedInr)} used (spent + reserved${b.scope === 'monthly_total' ? ' + subscriptions' : ''}) of ${inr(b.limitInr)}`}</p>
              </div>
              <button className="btn btn-small" onClick={() => act.run(b.id, () => fin.deleteBudget(b.id), reload)} disabled={act.busy === b.id}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="form cx-top"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          act.run('add', () => fin.addBudget({ scope, scopeRef: ref.trim() || undefined, limitInr: Number(limit), warnPct: Number(warn) }), () => (setLimit(''), reload()));
        }}
      >
        <div className="form-row cx-wrap">
          <label>
            Scope
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="monthly_total">Monthly total</option>
              <option value="provider">Per provider (monthly)</option>
              <option value="project">Per goal / project</option>
              <option value="task">Per task (max)</option>
            </select>
          </label>
          {(scope === 'provider' || scope === 'project') && (
            <label>
              {scope === 'provider' ? 'Provider id' : 'Goal id (wf_…)'}
              <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder={scope === 'provider' ? 'claude / gemini / gemini_tts' : 'wf_…'} />
            </label>
          )}
          <label className="cx-narrow">
            Limit ₹
            <input type="number" min={0} step="0.01" required value={limit} onChange={(e) => setLimit(e.target.value)} />
          </label>
          <label className="cx-narrow">
            Warn at %
            <input type="number" min={1} max={100} value={warn} onChange={(e) => setWarn(e.target.value)} />
          </label>
        </div>
        <button className="btn btn-small btn-primary" disabled={!limit || act.busy === 'add'}>
          Save budget
        </button>
        {act.error && <p className="form-error">{act.error}</p>}
      </form>
    </Card>
  );
}

function SettingsCard({ s, reload }: { s: Settings; reload: () => void }) {
  const act = useAction();
  const [rate, setRate] = useState(s.fx_usd_inr ? String(s.fx_usd_inr.rate) : '');
  const [src, setSrc] = useState(s.fx_usd_inr?.source ?? '');
  const [threshold, setThreshold] = useState(s.task_approval_inr === null ? '' : String(s.task_approval_inr));
  const [policy, setPolicy] = useState(s.unknown_cost_policy);
  const [billing, setBilling] = useState(s.provider_billing);
  const [conc, setConc] = useState(s.max_concurrent_paid_tasks === null ? '' : String(s.max_concurrent_paid_tasks));
  return (
    <Card title="Settings & controls">
      <div className={`cx-pause ${s.dispatch_paused ? 'on' : ''}`}>
        <div>
          <strong>Global dispatch pause: {s.dispatch_paused ? 'ON' : 'off'}</strong>
          <p className="cx-sub">Stops new chargeable tasks from starting. It cannot recall requests already sent to a provider.</p>
        </div>
        <button className={`btn btn-small ${s.dispatch_paused ? 'btn-primary' : ''}`} disabled={act.busy === 'pause'} onClick={() => act.run('pause', () => fin.saveSettings({ dispatchPaused: !s.dispatch_paused }), reload)}>
          {s.dispatch_paused ? 'Resume dispatch' : 'Pause new charges'}
        </button>
      </div>
      <form
        className="form cx-top"
        onSubmit={(e) => {
          e.preventDefault();
          const body: Record<string, unknown> = {
            taskApprovalInr: threshold === '' ? null : Number(threshold),
            unknownCostPolicy: policy,
            providerBilling: billing,
            maxConcurrentPaidTasks: conc === '' ? null : Number(conc),
          };
          if (rate) body.fxUsdInr = { rate: Number(rate), source: src };
          act.run('save', () => fin.saveSettings(body), reload);
        }}
      >
        <div className="form-row cx-wrap">
          <label className="cx-narrow">
            ₹ per 1 USD
            <input type="number" step="0.0001" min={1} value={rate} onChange={(e) => setRate(e.target.value)} placeholder="not set" />
          </label>
          <label>
            Rate source (required)
            <input value={src} onChange={(e) => setSrc(e.target.value)} placeholder="e.g. RBI reference rate 14 Oct" required={Boolean(rate)} />
          </label>
        </div>
        {s.fx_usd_inr && <p className="cx-sub">Current: ₹{s.fx_usd_inr.rate} · {s.fx_usd_inr.source} · set {dateShort(s.fx_usd_inr.at)}</p>}
        <div className="form-row cx-wrap">
          <label>
            Approval above ₹ (per task)
            <input type="number" min={0} step="0.01" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="off" />
          </label>
          <label>
            Max paid tasks at once
            <input type="number" min={1} max={6} value={conc} onChange={(e) => setConc(e.target.value)} placeholder="no extra limit" />
          </label>
        </div>
        <label>
          When cost is unknown and a budget exists
          <select value={policy} onChange={(e) => setPolicy(e.target.value as Settings['unknown_cost_policy'])}>
            <option value="require_approval">Ask me first (recommended)</option>
            <option value="allow">Allow</option>
          </select>
        </label>
        <fieldset className="cx-fieldset">
          <legend>API billing tier (you know this; the API doesn’t say)</legend>
          {Object.entries(billing).map(([p, v]) => (
            <label key={p} className="cx-inline">
              <span>{p}</span>
              <select value={v} onChange={(e) => setBilling({ ...billing, [p]: e.target.value as 'free' | 'paid' | 'unknown' })} disabled={p === 'claude'}>
                <option value="free">free tier</option>
                <option value="paid">paid</option>
                <option value="unknown">unknown</option>
              </select>
            </label>
          ))}
        </fieldset>
        <button className="btn btn-small btn-primary" disabled={act.busy === 'save'}>
          Save settings
        </button>
        {act.error && <p className="form-error">{act.error}</p>}
      </form>
    </Card>
  );
}

function Subscriptions({ reload }: { reload: () => void }) {
  const l = useLoad(() => fin.subscriptions());
  const act = useAction();
  const [form, setForm] = useState({ name: '', provider: 'google', amount: '', currency: 'INR', billingCycle: 'monthly' });
  const after = () => (l.reload(), reload());
  return (
    <Card title="Subscriptions you pay for">
      {(l.data?.subscriptions ?? []).length === 0 ? (
        <EmptyState title="None entered." hint="Add Google AI Pro, ChatGPT, Claude and Canva with the amounts you actually pay — nothing is assumed." />
      ) : (
        <ul className="cx-list compact">
          {l.data!.subscriptions.map((x) => (
            <li key={x.id}>
              <span>
                <strong>{x.name}</strong> <span className="cx-sub">{x.provider} · {x.billing_cycle} · {x.includes_api ? 'includes API' : 'no API access'}</span>
              </span>
              <span className="cx-actions">
                {x.currency === 'INR' ? inr(x.amount) : `${usd(x.amount)}${x.amount_inr === null ? ' (not converted)' : ` ≈ ${inr(x.amount_inr)}`}`}
                <button className="btn btn-small" onClick={() => act.run(x.id, () => fin.deleteSubscription(x.id), after)}>
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form
        className="form cx-top"
        onSubmit={(e) => {
          e.preventDefault();
          act.run('add', () => fin.addSubscription({ ...form, amount: Number(form.amount), includesApi: false }), () => (setForm({ ...form, name: '', amount: '' }), after()));
        }}
      >
        <div className="form-row cx-wrap">
          <label>
            Name
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Google AI Pro" required />
          </label>
          <label className="cx-narrow">
            Provider
            <select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
              {['google', 'openai', 'anthropic', 'canva', 'other'].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label className="cx-narrow">
            Amount
            <input type="number" min={0} step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          </label>
          <label className="cx-narrow">
            Currency
            <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
              <option>INR</option>
              <option>USD</option>
            </select>
          </label>
          <label className="cx-narrow">
            Cycle
            <select value={form.billingCycle} onChange={(e) => setForm({ ...form, billingCycle: e.target.value })}>
              <option value="monthly">monthly</option>
              <option value="yearly">yearly</option>
            </select>
          </label>
        </div>
        <button className="btn btn-small btn-primary" disabled={act.busy === 'add'}>
          Add subscription
        </button>
        {act.error && <p className="form-error">{act.error}</p>}
      </form>
    </Card>
  );
}

function Pricing() {
  const l = useLoad(() => fin.pricing());
  const act = useAction();
  const [form, setForm] = useState({ provider: '', model: '', inputPerMtok: '', outputPerMtok: '', sourceUrl: '', effectiveFrom: '' });
  return (
    <Card title="Pricing registry (USD per 1M tokens)">
      {!l.data ? (
        <EmptyState title="Loading…" />
      ) : (
        <div className="an-table-wrap">
          <table className="an-table">
            <thead>
              <tr>
                <th>Model</th>
                <th className="num">In</th>
                <th className="num">Out</th>
                <th>Valid</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {l.data.owner.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.provider}/{p.model} <Pill cls="pill-warn">yours</Pill>
                  </td>
                  <td className="num">{p.input_per_mtok}</td>
                  <td className="num">{p.output_per_mtok}</td>
                  <td>
                    {p.effective_from}
                    {p.effective_to ? ` → ${p.effective_to}` : ''}
                  </td>
                  <td>
                    <a href={p.source_url} target="_blank" rel="noreferrer">
                      link
                    </a>{' '}
                    · {p.verified_at}
                  </td>
                </tr>
              ))}
              {l.data.seeded.map((p, i) => (
                <tr key={i}>
                  <td>
                    {p.provider}/{p.model}
                    {p.freeTier && <div className="cx-sub">free tier exists</div>}
                  </td>
                  <td className="num">{p.input}</td>
                  <td className="num">{p.output}</td>
                  <td>
                    {p.from === '1970-01-01' ? 'now' : p.from}
                    {p.to ? ` → ${p.to}` : ''}
                  </td>
                  <td>
                    <a href={p.source} target="_blank" rel="noreferrer">
                      {new URL(p.source).hostname}
                    </a>{' '}
                    · {p.verifiedAt}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Honest>{l.data.note}</Honest>
        </div>
      )}
      <details className="cx-details">
        <summary>Add or correct a price</summary>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            act.run('add', () => fin.addPricing({ ...form, inputPerMtok: Number(form.inputPerMtok), outputPerMtok: Number(form.outputPerMtok), effectiveFrom: form.effectiveFrom || undefined }), l.reload);
          }}
        >
          <div className="form-row cx-wrap">
            <label>
              Provider
              <input value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} placeholder="openai" required />
            </label>
            <label>
              Model
              <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} required />
            </label>
            <label className="cx-narrow">
              In $/M
              <input type="number" step="0.0001" min={0} value={form.inputPerMtok} onChange={(e) => setForm({ ...form, inputPerMtok: e.target.value })} required />
            </label>
            <label className="cx-narrow">
              Out $/M
              <input type="number" step="0.0001" min={0} value={form.outputPerMtok} onChange={(e) => setForm({ ...form, outputPerMtok: e.target.value })} required />
            </label>
          </div>
          <div className="form-row cx-wrap">
            <label>
              Official pricing page (https)
              <input type="url" value={form.sourceUrl} onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })} required />
            </label>
            <label className="cx-narrow">
              Effective from
              <input type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} />
            </label>
          </div>
          <button className="btn btn-small btn-primary" disabled={act.busy === 'add'}>
            Save price
          </button>
          {act.error && <p className="form-error">{act.error}</p>}
        </form>
      </details>
    </Card>
  );
}
