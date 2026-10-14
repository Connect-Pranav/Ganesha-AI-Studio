// Subscription Intelligence: what your four AI subscriptions and their API accounts actually expose.
// Every value carries a status (Live / Imported / Calculated / Estimated / Unavailable / …).
// Unknown is shown as "—" with its reason, never as 0.
import { useMemo, useState, type ReactNode } from 'react';
import { Card, EmptyState } from '../ui';
import { agentName } from '../../data/agentsMeta';
import { dateShort, inr, money, STATUS_PILL, subintel, tokens, usd, useLoad, type DataStatus, type ServiceView, type SubOverview } from '../../services/cboService';
import { Gate, Honest, Pill, Tile, useAction } from './common';

const TABS = ['Subscriptions', 'Usage & Allowances', 'Billing History', 'Daily Consumption', 'Model Usage', 'API Accounts', 'Forecasts', 'Resource Allocation', 'Data Sources & Permissions'] as const;
type Tab = (typeof TABS)[number];
const ACCENT: Record<string, string> = { google_ai_pro: 'cyan', chatgpt: 'violet', claude: 'amber', canva: 'magenta' };

export function S({ s }: { s: DataStatus }) {
  const p = STATUS_PILL[s];
  return (
    <span className={`pill ${p.cls}`} title={p.hint}>
      {p.label}
    </span>
  );
}

export function SubscriptionIntel() {
  const o = useLoad(() => subintel.overview());
  const [tab, setTab] = useState<Tab>('Subscriptions');
  return (
    <Gate title="Subscription Intelligence" locked={o.locked} ready={Boolean(o.data)} error={o.error} onRetry={o.reload}>
      {o.data && (
        <>
          <Totals o={o.data} reload={o.reload} />
          <div className="tabs cx-tabs-scroll" role="tablist" aria-label="Subscription Intelligence sections">
            {TABS.map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
                {t}
              </button>
            ))}
          </div>
          {tab === 'Subscriptions' && <Subscriptions o={o.data} reload={o.reload} />}
          {tab === 'Usage & Allowances' && <UsageTab o={o.data} />}
          {tab === 'Billing History' && <BillingTab o={o.data} reload={o.reload} />}
          {tab === 'Daily Consumption' && <DailyTab />}
          {tab === 'Model Usage' && <ModelTab />}
          {tab === 'API Accounts' && <ApiTab o={o.data} reload={o.reload} />}
          {tab === 'Forecasts' && <ForecastTab o={o.data} />}
          {tab === 'Resource Allocation' && <AllocationTab o={o.data} />}
          {tab === 'Data Sources & Permissions' && <SourcesTab o={o.data} reload={o.reload} />}
          <Honest>
            Usage shown here is either provider-reported (Live/Recent), from files you imported, or GANESHA’s own calls. GANESHA’s calls are never presented as your whole Claude, ChatGPT or Google account usage. Claude Pro/Max, ChatGPT, Google AI Pro and Canva plans expose no official API for plan, billing or usage windows — import receipts to fill them.
          </Honest>
        </>
      )}
    </Gate>
  );
}

function Totals({ o, reload }: { o: SubOverview; reload: () => void }) {
  const t = o.totals;
  const act = useAction();
  const v = (x: { inr: number | null; partial: boolean }) => (
    <>
      {inr(x.inr)}
      {x.partial && x.inr !== null && <span className="cx-partial" title="Some services have no verified data and are excluded"> partial</span>}
    </>
  );
  return (
    <>
      {o.alerts.length > 0 && (
        <div className="cx-alerts" role="status">
          {o.alerts.map((a, i) => (
            <p key={i} className={a.level === 'error' ? 'cx-err' : 'cx-warn-text'}>
              ⚠ {a.message}
            </p>
          ))}
        </div>
      )}
      <section className="grid-4 cx-tiles" aria-label="AI spending this month">
        <Tile label="Subscriptions / month" value={v(t.subscriptionsMonthly)} hint="from imported plan amounts" />
        <Tile label="API spend (verified)" value={v(t.apiVerifiedMonth)} hint="provider-reported or imported" />
        <Tile label="GANESHA calls only" value={v(t.ganeshaApiMonth)} hint="this studio’s own usage — separate" />
        <Tile label="Total AI spend" value={v(t.aiTotalMonth)} hint="subscriptions + verified API" tone="ok" />
      </section>
      <div className="cx-actions">
        <button className="btn btn-small" onClick={() => act.run('sync', () => subintel.sync(), reload)} disabled={act.busy === 'sync'}>
          {act.busy === 'sync' ? 'Syncing…' : 'Sync provider Admin APIs now'}
        </button>
        <span className="cx-sub">Generated {dateShort(o.generatedAt)}</span>
        {act.error && <span className="form-error">{act.error}</span>}
      </div>
    </>
  );
}

function Ring({ used, limit, label }: { used: number | null; limit: number | null; label: string }) {
  const known = used !== null && limit !== null && limit > 0;
  const pct = known ? Math.min(100, (used! / limit!) * 100) : 0;
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div className="cx-ring" role="img" aria-label={known ? `${label}: ${Math.round(pct)}% used` : `${label}: unknown`}>
      <svg viewBox="0 0 84 84" width="84" height="84" aria-hidden="true">
        <circle cx="42" cy="42" r={r} className="cx-ring-track" />
        {known && <circle cx="42" cy="42" r={r} className={`cx-ring-val ${pct >= 80 ? 'warn' : ''}`} strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90 42 42)" />}
      </svg>
      <span>{known ? `${Math.round(pct)}%` : '—'}</span>
    </div>
  );
}

function Timeline({ v }: { v: ServiceView }) {
  const p = v.period;
  if (!p.periodDays || p.daysRemaining === undefined) return <p className="cx-sub">Renewal timeline: import the next renewal date and billing period.</p>;
  const pct = Math.max(0, Math.min(100, p.periodElapsedPct ?? 0));
  return (
    <div className="cx-timeline" aria-label={`Billing period ${p.periodStart} to ${p.nextRenewal}, ${pct}% elapsed`}>
      <div className="cx-timeline-bar">
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="cx-row-between cx-sub">
        <span>{p.periodStart}</span>
        <span>
          {p.daysRemaining} of {p.periodDays} days left
        </span>
        <span>{p.nextRenewal}</span>
      </div>
    </div>
  );
}

function Row({ k, children, status }: { k: string; children: ReactNode; status?: DataStatus }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>
        {children} {status && <S s={status} />}
      </dd>
    </>
  );
}

const fv = (v: ServiceView, f: string) => v.profile[f];
const show = (v: ServiceView, f: string, fmt: (x: unknown) => ReactNode = (x) => String(x)) => {
  const x = fv(v, f);
  return x && x.value !== null ? <>{fmt(x.value)}</> : <span className="cx-unknown">—</span>;
};

function ServiceCard({ v, reload }: { v: ServiceView; reload: () => void }) {
  const [edit, setEdit] = useState(false);
  const u = v.usage;
  const cur = (x: unknown) => `${fv(v, 'currency')?.value === 'USD' ? '$' : '₹'}${Number(x).toLocaleString('en-IN')}`;
  return (
    <article className={`cx-sub-card accent-${ACCENT[v.service]}`}>
      <header className="cx-row-between">
        <div>
          <p className="cx-eyebrow">{v.vendor}</p>
          <h3>{v.name}</h3>
        </div>
        <Ring used={u.consumedThisPeriod?.value ?? u.latest?.consumed ?? null} limit={u.limit} label={`${v.name} allowance`} />
      </header>
      <dl className="cx-voice-dl">
        <Row k="Plan" status={fv(v, 'plan')?.status}>
          {show(v, 'plan')}
        </Row>
        <Row k="Status" status={fv(v, 'status')?.status}>
          {show(v, 'status')}
        </Row>
        <Row k={fv(v, 'start_date') ? 'Started' : 'First observed'}>
          {fv(v, 'start_date') ? show(v, 'start_date') : show(v, 'first_observed')}
          {v.period.age && <span className="cx-sub"> · {v.period.age.days} days ({v.period.age.basis})</span>}
        </Row>
        <Row k="Next renewal" status={fv(v, 'next_renewal')?.status}>
          {v.period.nextRenewal ?? <span className="cx-unknown">—</span>}
          {v.period.daysUntilRenewal !== undefined && <span className="cx-sub"> · in {v.period.daysUntilRenewal} d</span>}
        </Row>
        <Row k="Billing" status={fv(v, 'amount')?.status}>
          {show(v, 'amount', cur)} {fv(v, 'billing_period') ? `/ ${fv(v, 'billing_period').value}` : ''}
          {v.period.effectiveMonthly !== undefined && fv(v, 'billing_period')?.value === 'yearly' && <span className="cx-sub"> · {cur(v.period.effectiveMonthly)}/mo</span>}
        </Row>
        <Row k="Current usage" status={u.latest?.status ?? 'UNAVAILABLE'}>
          {u.latest ? `${tokens(u.latest.consumed)} ${u.latest.unit}` : <span className="cx-unknown">—</span>}
        </Row>
        <Row k="Remaining" status={u.latest?.remaining !== null && u.latest?.remaining !== undefined ? u.latest.status : 'UNAVAILABLE'}>
          {u.latest?.remaining !== null && u.latest?.remaining !== undefined ? `${tokens(u.latest.remaining)} ${u.latest.unit}` : <span className="cx-unknown">—</span>}
        </Row>
        <Row k="Reset">{u.latest?.reset_at ? dateShort(u.latest.reset_at) : <span className="cx-unknown">—</span>}</Row>
        <Row k="Usage unit">{v.usageUnits}</Row>
        <Row k="Freshness">{v.lastSync ? `synced ${dateShort(v.lastSync)}` : Object.values(v.profile)[0] ? `imported ${dateShort(Object.values(v.profile).map((f) => f.retrievedAt).sort().pop())}` : 'no data yet'}</Row>
      </dl>
      <Timeline v={v} />
      <p className="cx-sub">
        Missing: {v.missing.length} field(s) · <span title={v.missing.join(', ')}>hover for list</span>
      </p>
      {v.actions.length > 0 && (
        <ul className="cx-assume">
          {v.actions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
      <button className="btn btn-small" onClick={() => setEdit(!edit)}>
        {edit ? 'Close' : 'Import plan details'}
      </button>
      {edit && <ProfileForm v={v} onDone={() => (setEdit(false), reload())} />}
    </article>
  );
}

function ProfileForm({ v, onDone }: { v: ServiceView; onDone: () => void }) {
  const act = useAction();
  const init = (f: string) => (v.profile[f]?.value === null || v.profile[f]?.value === undefined ? '' : String(v.profile[f].value));
  const [f, setF] = useState({
    plan: init('plan'),
    status: init('status') || 'active',
    start_date: init('start_date'),
    first_observed: init('first_observed'),
    next_renewal: init('next_renewal'),
    billing_period: init('billing_period') || 'monthly',
    amount: init('amount'),
    currency: init('currency') || 'INR',
    payment_method: init('payment_method'),
    usage_unit: init('usage_unit'),
    usage_window: init('usage_window'),
    usage_limit: init('usage_limit'),
    timezone: init('timezone'),
  });
  const [source, setSource] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <form
      className="form cx-top"
      onSubmit={(e) => {
        e.preventDefault();
        const fields: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(f)) if (val !== '') fields[k] = ['amount', 'usage_limit'].includes(k) ? Number(val) : val;
        act.run('save', () => subintel.saveProfile(v.service, source, fields), onDone);
      }}
    >
      <p className="cx-sub">Copy these from your receipt, invoice or the provider’s billing page. They are stored as Imported with the source you give.</p>
      <div className="form-row cx-wrap">
        <label>
          Plan
          <input value={f.plan} onChange={set('plan')} placeholder="e.g. Pro" />
        </label>
        <label className="cx-narrow">
          Status
          <select value={f.status} onChange={set('status')}>
            {['active', 'trial', 'past_due', 'cancelled', 'expired', 'paused'].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label className="cx-narrow">
          Amount
          <input type="number" min={0} step="0.01" value={f.amount} onChange={set('amount')} />
        </label>
        <label className="cx-narrow">
          Currency
          <select value={f.currency} onChange={set('currency')}>
            <option>INR</option>
            <option>USD</option>
          </select>
        </label>
        <label className="cx-narrow">
          Period
          <select value={f.billing_period} onChange={set('billing_period')}>
            <option value="monthly">monthly</option>
            <option value="yearly">yearly</option>
          </select>
        </label>
      </div>
      <div className="form-row cx-wrap">
        <label>
          Start date (verified)
          <input type="date" value={f.start_date} onChange={set('start_date')} />
        </label>
        <label>
          First observed (if start unknown)
          <input type="date" value={f.first_observed} onChange={set('first_observed')} />
        </label>
        <label>
          Next renewal
          <input type="date" value={f.next_renewal} onChange={set('next_renewal')} />
        </label>
        <label>
          Billing timezone
          <input value={f.timezone} onChange={set('timezone')} placeholder="e.g. America/Los_Angeles" />
        </label>
      </div>
      <div className="form-row cx-wrap">
        <label>
          Payment method (type + last 4 only)
          <input value={f.payment_method} onChange={set('payment_method')} placeholder="card •••• 4242 / upi / google play" />
        </label>
        <label>
          Usage unit
          <input value={f.usage_unit} onChange={set('usage_unit')} placeholder="messages / prompts / credits" />
        </label>
        <label>
          Usage window
          <input value={f.usage_window} onChange={set('usage_window')} placeholder="e.g. 5-hour rolling, daily" />
        </label>
        <label className="cx-narrow">
          Allowance
          <input type="number" min={0} value={f.usage_limit} onChange={set('usage_limit')} />
        </label>
      </div>
      <label>
        Source (required)
        <input value={source} onChange={(e) => setSource(e.target.value)} required placeholder="e.g. Google Play receipt, 2 Oct 2026" />
      </label>
      <button className="btn btn-small btn-primary" disabled={act.busy === 'save'}>
        Save as Imported
      </button>
      {act.error && <p className="form-error">{act.error}</p>}
    </form>
  );
}

function Subscriptions({ o, reload }: { o: SubOverview; reload: () => void }) {
  return (
    <div className="cx-sub-grid">
      {o.services.map((v) => (
        <ServiceCard key={v.service} v={v} reload={reload} />
      ))}
    </div>
  );
}

function UsageTab({ o }: { o: SubOverview }) {
  return (
    <Card title="Usage & allowances (per provider unit — never converted to invented tokens)">
      <div className="an-table-wrap">
        <table className="an-table">
          <thead>
            <tr>
              <th>Service</th>
              <th>Unit</th>
              <th className="num">Used</th>
              <th className="num">Remaining</th>
              <th className="num">Allowance</th>
              <th>Window / reset</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {o.services.map((v) => {
              const l = v.usage.latest;
              return (
                <tr key={v.service}>
                  <td>
                    <strong>{v.name}</strong>
                    <div className="cx-sub">{v.usageUnits}</div>
                  </td>
                  <td>{l?.unit ?? (v.profile.usage_unit?.value as string) ?? '—'}</td>
                  <td className="num">{l ? tokens(l.consumed) : '—'}</td>
                  <td className="num">{l?.remaining !== null && l?.remaining !== undefined ? tokens(l.remaining) : '—'}</td>
                  <td className="num">{v.usage.limit !== null ? tokens(v.usage.limit) : '—'}</td>
                  <td>
                    {l ? [l.window_start ?? l.day, l.window_end].filter(Boolean).join(' → ') : (v.profile.usage_window?.value as string) ?? '—'}
                    {l?.reset_at && <div className="cx-sub">resets {dateShort(l.reset_at)}</div>}
                  </td>
                  <td>
                    <S s={l?.status ?? 'UNAVAILABLE'} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Honest>No official API exposes Claude app, ChatGPT or Gemini app usage windows. Record what the app shows with Data Sources → Import usage; it is labelled Imported.</Honest>
    </Card>
  );
}

function BillingTab({ o }: { o: SubOverview; reload: () => void }) {
  const rows = o.services.flatMap((v) => v.billing.map((b) => ({ ...b, name: v.name })));
  rows.sort((a, b) => (b.paid_on ?? '').localeCompare(a.paid_on ?? ''));
  return (
    <Card title="Billing history">
      {rows.length === 0 ? (
        <EmptyState title="No billing records yet." hint="Import receipts/invoices (Data Sources tab) or connect an Admin API for API costs." />
      ) : (
        <div className="an-table-wrap">
          <table className="an-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Service</th>
                <th>Kind</th>
                <th>Description</th>
                <th className="num">Amount</th>
                <th className="num">INR</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 200).map((b) => (
                <tr key={b.id} className={b.superseded ? 'cx-muted-row' : ''}>
                  <td>{b.paid_on ?? '—'}</td>
                  <td>{b.name}</td>
                  <td>{b.record === 'api_billing' ? 'API' : 'Subscription'}</td>
                  <td>
                    {b.description ?? '—'}
                    {b.superseded && <div className="cx-sub">superseded by live cost data (not counted)</div>}
                  </td>
                  <td className="num">
                    {b.currency === 'INR' ? inr(b.amount) : b.currency === 'USD' ? usd(b.amount) : `${b.amount} ${b.currency}`}
                    {b.tax !== null && <div className="cx-sub">tax {b.tax}</div>}
                  </td>
                  <td className="num">{inr(b.amount_inr)}</td>
                  <td>
                    <S s={b.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function DailyTab() {
  const d = useLoad(() => subintel.daily(31));
  if (!d.data) return <Card title="Daily consumption"><EmptyState title={d.error ?? 'Loading…'} /></Card>;
  return (
    <>
      <Card title="Provider-reported & imported usage">
        {d.data.provider.length === 0 ? (
          <EmptyState title="No provider usage rows." hint="Appears after an Admin API sync or an import. Nothing is back-filled." />
        ) : (
          <div className="an-table-wrap">
            <table className="an-table">
              <thead>
                <tr>
                  <th>Date / window</th>
                  <th>Service</th>
                  <th>Model / feature</th>
                  <th>Unit</th>
                  <th className="num">Consumed</th>
                  <th className="num">Remaining</th>
                  <th>Reset</th>
                  <th>Source</th>
                  <th>Synced</th>
                </tr>
              </thead>
              <tbody>
                {d.data.provider.map((r, i) => (
                  <tr key={i}>
                    <td>{r.day || [r.window_start, r.window_end].filter(Boolean).join(' → ')}</td>
                    <td>{r.service}</td>
                    <td>{[r.model, r.feature].filter(Boolean).join(' · ') || '—'}</td>
                    <td>{r.unit}</td>
                    <td className="num">{tokens(r.consumed)}</td>
                    <td className="num">{r.remaining === null ? '—' : tokens(r.remaining)}</td>
                    <td>{r.reset_at ? dateShort(r.reset_at) : '—'}</td>
                    <td>
                      <S s={r.status} />
                      <div className="cx-sub">{r.source}</div>
                    </td>
                    <td className="cx-sub">{dateShort(r.synced_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="GANESHA’s own API calls (local ledger — partial by definition)">
        {d.data.ganesha.length === 0 ? (
          <EmptyState title="No GANESHA calls in this window." />
        ) : (
          <div className="an-table-wrap">
            <table className="an-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Provider / model</th>
                  <th>Purpose</th>
                  <th className="num">Calls</th>
                  <th className="num">In tokens</th>
                  <th className="num">Out tokens</th>
                </tr>
              </thead>
              <tbody>
                {d.data.ganesha.map((r, i) => (
                  <tr key={i}>
                    <td>{r.day}</td>
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
          </div>
        )}
        <Honest>{d.data.note}</Honest>
      </Card>
    </>
  );
}

function ModelTab() {
  const d = useLoad(() => subintel.daily(31));
  const rows = useMemo(() => {
    const m = new Map<string, { key: string; source: string; unit: string; value: number }>();
    for (const r of d.data?.provider ?? []) {
      if (!r.model) continue;
      const key = `${r.service}|${r.model}|${r.unit}|account`;
      const cur = m.get(key) ?? { key: `${r.service} · ${r.model}`, source: 'Account (provider-reported/imported)', unit: r.unit, value: 0 };
      cur.value += r.consumed ?? 0;
      m.set(key, cur);
    }
    for (const r of d.data?.ganesha ?? []) {
      for (const [unit, v] of [['input_tokens', r.input_tokens], ['output_tokens', r.output_tokens]] as const) {
        const key = `${r.provider}|${r.model}|${unit}|ganesha`;
        const cur = m.get(key) ?? { key: `${r.provider} · ${r.model}`, source: 'GANESHA only', unit, value: 0 };
        cur.value += v ?? 0;
        m.set(key, cur);
      }
    }
    return [...m.values()].sort((a, b) => b.value - a.value);
  }, [d.data]);
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Card title="Model usage · last 31 days">
      {rows.length === 0 ? (
        <EmptyState title="No model-level usage recorded." />
      ) : (
        <ul className="cx-bars">
          {rows.slice(0, 30).map((r) => (
            <li key={`${r.key}${r.unit}${r.source}`}>
              <span className="cx-bar-label">
                {r.key} <span className="cx-sub">· {r.unit} · {r.source}</span>
              </span>
              <span className={`cx-bar ${r.source === 'GANESHA only' ? 'ganesha' : ''}`} style={{ width: `${(r.value / max) * 100}%` }} />
              <span className="cx-bar-val">{tokens(r.value)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ApiTab({ o, reload }: { o: SubOverview; reload: () => void }) {
  const act = useAction();
  return (
    <Card title="Developer API accounts (separate from consumer subscriptions)">
      <div className="an-table-wrap">
        <table className="an-table">
          <thead>
            <tr>
              <th>API</th>
              <th>Credentials</th>
              <th className="num">Account spend (month)</th>
              <th className="num">GANESHA spend (month)</th>
              <th>Outside GANESHA</th>
              <th>Last sync</th>
            </tr>
          </thead>
          <tbody>
            {o.services.map((v) => {
              const cred = v.availability.find((a) => a.record === 'api_account');
              const mtd = v.availability.find((a) => a.record === 'api_billing');
              return (
                <tr key={v.service}>
                  <td>
                    <strong>{v.apiName}</strong>
                  </td>
                  <td>
                    <S s={cred?.status ?? 'UNAVAILABLE'} />
                    <div className="cx-sub">{cred?.source}</div>
                  </td>
                  <td className="num">
                    {mtd?.value === null || mtd?.value === undefined ? '—' : inr(mtd.value as number)} <S s={mtd?.status ?? 'UNAVAILABLE'} />
                    <div className="cx-sub">{mtd?.source}</div>
                  </td>
                  <td className="num">{v.spend.ganeshaMonth ? money(v.spend.ganeshaMonth.inr, v.spend.ganeshaMonth.usd) : '—'}</td>
                  <td>
                    <S s={v.external.status} /> {v.external.inputTokens !== undefined && `${tokens(v.external.inputTokens)} input tokens`}
                    <div className="cx-sub">{v.external.formula ?? v.external.note}</div>
                  </td>
                  <td className="cx-sub">
                    {v.lastSync ? dateShort(v.lastSync) : '—'}
                    {v.syncRuns[0] && v.syncRuns[0].status !== 'ok' && <div>{v.syncRuns[0].status.replace('_', ' ')}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="cx-actions cx-top">
        <button className="btn btn-small btn-primary" disabled={act.busy === 's'} onClick={() => act.run('s', () => subintel.sync(), reload)}>
          Sync Admin APIs
        </button>
        {act.error && <span className="form-error">{act.error}</span>}
      </div>
      <Honest>Anthropic’s Usage & Cost Admin API needs an organization account and an Admin key (ANTHROPIC_ADMIN_KEY). OpenAI’s Usage/Costs API needs an organization Admin key (OPENAI_ADMIN_KEY). The Gemini API exposes no usage or billing for a key.</Honest>
    </Card>
  );
}

function ForecastTab({ o }: { o: SubOverview }) {
  return (
    <Card title="Forecasts to renewal">
      <div className="an-table-wrap">
        <table className="an-table">
          <thead>
            <tr>
              <th>Service</th>
              <th>Renewal</th>
              <th className="num">Used this period</th>
              <th className="num">Projected at renewal</th>
              <th className="num">Allowance</th>
              <th>Over allowance?</th>
              <th className="num">Unused allowance value</th>
            </tr>
          </thead>
          <tbody>
            {o.services.map((v) => (
              <tr key={v.service}>
                <td>{v.name}</td>
                <td>{v.period.nextRenewal ? `${v.period.nextRenewal} (${v.period.daysUntilRenewal} d)` : '—'}</td>
                <td className="num">{v.usage.consumedThisPeriod ? `${tokens(v.usage.consumedThisPeriod.value)} ${v.usage.consumedThisPeriod.unit ?? ''}` : '—'}</td>
                <td className="num">
                  {v.usage.forecast ? (
                    <>
                      {tokens(Math.round(v.usage.forecast.projectedTotal))} <S s="ESTIMATED" />
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="num">{v.usage.limit ?? '—'}</td>
                <td>{v.usage.forecast?.exceedsLimit === null || !v.usage.forecast ? '—' : v.usage.forecast.exceedsLimit ? 'Likely' : 'No'}</td>
                <td className="num">{v.usage.unusedValue ? `${v.usage.unusedValue.currency === 'USD' ? '$' : '₹'}${v.usage.unusedValue.value}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Honest>Forecasts need at least 3 observed days in the current period and a known renewal date. Formula: consumed ÷ days elapsed × period length. Unused allowance value = (1 − projected ÷ allowance) × monthly cost. No ROI is calculated: there is no verified revenue input.</Honest>
    </Card>
  );
}

function AllocationTab({ o }: { o: SubOverview }) {
  const d = useLoad(() => subintel.decisions());
  return (
    <>
      <Card title="How the CBO allocates work">
        <ol className="cx-ol">
          <li>Candidates are only the engines this agent may use (your override → studio primary → registry), so the required quality is kept.</li>
          <li>Consumer subscriptions (Claude Pro, ChatGPT, Google AI Pro, Canva) are never called by GANESHA — they have no programmatic interface for this. Media work goes to them through manual handoffs.</li>
          <li>Engines without a key, or with a key rejected in the last 24 h, are excluded.</li>
          <li>Among the rest: lowest conservative cost wins (free tier counts as ₹0 only if you marked it free). Ties go to the agent’s preferred order.</li>
          <li>Urgent / high-priority / due-within-6-hours tasks avoid engines that were rate-limited in the last hour, even if free.</li>
          <li>Then budgets, thresholds and approvals apply, and money is reserved before the call.</li>
        </ol>
      </Card>
      <Card title="Recent decisions">
        {!d.data || d.data.decisions.length === 0 ? (
          <EmptyState title={d.error ?? 'No dispatch decisions yet.'} />
        ) : (
          <ul className="cx-list">
            {d.data.decisions.map((x) => (
              <li key={x.id}>
                <div className="cx-li-main">
                  <p>
                    <strong>{x.workflow_title ?? x.task_id}</strong> · {x.step_key} · {x.agent_id ? agentName(x.agent_id) : ''} → <Pill cls="pill-running">{x.chosen_provider}</Pill>
                  </p>
                  <p className="cx-sub">{x.reason}</p>
                  <p className="cx-sub">
                    {x.candidates.map((c) => `${c.provider}${c.eligible ? ` ${money(c.conservativeInr, c.conservativeUsd)}` : ` ✕ ${c.why.join(', ')}`}`).join(' · ')}
                  </p>
                </div>
                <span className="cx-sub">{dateShort(x.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Spend by project">
        {o.byProject.length === 0 ? (
          <EmptyState title="No reconciled project spend yet." />
        ) : (
          <ul className="cx-list compact">
            {o.byProject.map((p) => (
              <li key={p.workflow_id}>
                <span>
                  {p.title ?? p.workflow_id} <span className="cx-sub">{p.brand} · {p.calls} calls</span>
                </span>
                <strong>{p.unknown ? `${inr(p.inr)} + unknown` : inr(p.inr)}</strong>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function SourcesTab({ o, reload }: { o: SubOverview; reload: () => void }) {
  const [svc, setSvc] = useState(o.services[0].service);
  const v = o.services.find((x) => x.service === svc)!;
  return (
    <>
      <div className="tabs" role="tablist" aria-label="Service">
        {o.services.map((x) => (
          <button key={x.service} role="tab" aria-selected={svc === x.service} className={`tab ${svc === x.service ? 'active' : ''}`} onClick={() => setSvc(x.service)}>
            {x.name}
          </button>
        ))}
      </div>
      <Card title={`${v.name}: every field, its status and source`}>
        <div className="an-table-wrap">
          <table className="an-table">
            <thead>
              <tr>
                <th>Record</th>
                <th>Field</th>
                <th>Value</th>
                <th>Status</th>
                <th>Source / reason</th>
              </tr>
            </thead>
            <tbody>
              {v.availability.map((a) => (
                <tr key={`${a.record}.${a.field}`}>
                  <td className="cx-sub">{a.record.replace(/_/g, ' ')}</td>
                  <td>{a.field.replace(/_/g, ' ')}</td>
                  <td>{a.value === null || a.value === undefined ? <span className="cx-unknown">—</span> : String(a.value)}</td>
                  <td>
                    <S s={a.status} />
                  </td>
                  <td className="cx-sub">
                    {a.source}
                    {a.retrievedAt && ` · ${dateShort(a.retrievedAt)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <ImportCard service={v.service} name={v.name} onDone={reload} />
      <Card title="Sync runs">
        {v.syncRuns.length === 0 ? (
          <EmptyState title="No sync runs." hint={v.service === 'claude' || v.service === 'chatgpt' ? 'Set the Admin key and press Sync.' : 'No live adapter exists for this service.'} />
        ) : (
          <ul className="cx-list compact">
            {v.syncRuns.map((r) => (
              <li key={r.id}>
                <span>
                  {r.adapter} · {r.rows} rows {r.error && <span className="cx-sub">· {r.error}</span>}
                </span>
                <span>
                  <Pill cls={r.status === 'ok' ? 'pill-running' : r.status === 'error' ? 'pill-error' : 'pill-paused'}>{r.status.replace('_', ' ')}</Pill> <span className="cx-sub">{dateShort(r.started_at)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function ImportCard({ service, name, onDone }: { service: string; name: string; onDone: () => void }) {
  const act = useAction();
  const [kind, setKind] = useState<'billing' | 'usage'>('billing');
  const [record, setRecord] = useState('consumer_subscription');
  const [csv, setCsv] = useState('');
  const [source, setSource] = useState('');
  const [res, setRes] = useState<string | null>(null);
  const example = kind === 'billing' ? 'date,amount,currency,description,invoice\n2026-10-02,1950,INR,Pro plan,INV-123' : 'day,unit,consumed,remaining,limit,reset_at,model,feature\n2026-10-14,messages,40,,160,2026-10-14T18:00:00Z,,';
  return (
    <Card title={`Import ${name} records (receipts, invoices, usage exports)`}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          setRes(null);
          act.run('i', async () => {
            const r = await subintel.importRecords(service, { kind, record, csv, source });
            setRes(`${r.inserted} new · ${r.updated} updated · ${r.skipped} duplicates skipped${r.rejected.length ? ` · ${r.rejected.length} rejected (${r.rejected.slice(0, 3).map((x) => `row ${x.row}: ${x.error}`).join('; ')})` : ''}`);
          }, onDone);
        }}
      >
        <div className="form-row cx-wrap">
          <label className="cx-narrow">
            Kind
            <select value={kind} onChange={(e) => (setKind(e.target.value as 'billing' | 'usage'), setRecord(e.target.value === 'billing' ? 'consumer_subscription' : 'subscription_usage'))}>
              <option value="billing">Billing</option>
              <option value="usage">Usage</option>
            </select>
          </label>
          <label>
            Record
            <select value={record} onChange={(e) => setRecord(e.target.value)}>
              {kind === 'billing' ? (
                <>
                  <option value="consumer_subscription">Subscription receipt</option>
                  <option value="api_billing">API invoice</option>
                </>
              ) : (
                <>
                  <option value="subscription_usage">Subscription usage (app)</option>
                  <option value="api_usage">API usage export</option>
                </>
              )}
            </select>
          </label>
          <label>
            Source (file / where from)
            <input value={source} onChange={(e) => setSource(e.target.value)} required />
          </label>
        </div>
        <label>
          CSV
          <textarea rows={5} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={example} required />
        </label>
        <label className="cx-inline">
          <span className="cx-sub">Or choose a file:</span>
          <input type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setCsv(await f.text()); if (!source) setSource(f.name); } }} />
        </label>
        <button className="btn btn-small btn-primary" disabled={act.busy === 'i'}>
          Import
        </button>
        {res && <p className="cx-ok">{res}</p>}
        {act.error && <p className="form-error">{act.error}</p>}
      </form>
      <Honest>Duplicates are detected by invoice number (or date + amount + description) and by day/model/unit for usage. Provider-reported (Live) rows always win over imported ones. Never include full card or account numbers.</Honest>
    </Card>
  );
}
