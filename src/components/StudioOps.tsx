// Studio operations analytics, counted from execution records in D1 (via /api/summary).
// "—" / "Not available" = no source or not enough data; "0" = counted and none happened.
import { Card, EmptyState, LiveBadge, engineNames, formatWhen, productNames } from './ui';
import { Unlock } from './NotificationCenter';
import { agentName } from '../data/agentsMeta';
import { useStudio, WF_STATUS } from '../services/StudioContext';
import type { Summary } from '../services/studioService';

const n = (v: number | null | undefined) => (v === null || v === undefined ? '—' : Math.round(v).toLocaleString('en-IN'));
const pct = (num: number, den: number) => (den > 0 ? `${Math.round((num / den) * 100)}%` : '—');
const secs = (s: number | null | undefined) => (s === null || s === undefined ? '—' : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`);
const pl = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const sum = (o: Record<string, number> | undefined) => Object.values(o ?? {}).reduce((a, b) => a + b, 0);

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat">
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      {hint && (
        <div className="stat-foot">
          <span className="stat-hint">{hint}</span>
        </div>
      )}
    </div>
  );
}

const ORDER = ['completed', 'running', 'queued', 'waiting_for_approval', 'waiting_for_external_action', 'paused', 'failed', 'cancelled'];

/** Status distribution: labelled segments (never color alone) + hover title on each. */
function StatusBar({ counts }: { counts: Record<string, number> }) {
  const total = sum(counts);
  if (!total) return null;
  const parts = ORDER.filter((k) => counts[k]);
  return (
    <div className="sbar-wrap">
      <div className="sbar" role="img" aria-label={parts.map((k) => `${WF_STATUS[k]?.label ?? k}: ${counts[k]}`).join(', ')}>
        {parts.map((k) => (
          <span key={k} className={`sbar-seg seg-${k}`} style={{ flexGrow: counts[k] }} title={`${WF_STATUS[k]?.label ?? k}: ${counts[k]} (${pct(counts[k], total)})`} />
        ))}
      </div>
      <ul className="sbar-legend">
        {parts.map((k) => (
          <li key={k}>
            <i className={`sbar-key seg-${k}`} aria-hidden="true" />
            {WF_STATUS[k]?.label ?? k} <strong>{counts[k]}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function StudioOps() {
  const { summary, locked, summaryError, refresh } = useStudio();
  if (locked)
    return (
      <Card title="Studio operations">
        <Unlock onUnlocked={() => refresh()} />
      </Card>
    );
  if (!summary)
    return (
      <Card title="Studio operations">
        <EmptyState title={summaryError ? 'Studio data couldn’t load' : 'Loading…'} hint={summaryError ?? undefined} />
      </Card>
    );
  return <StudioOpsBody s={summary} />;
}

function StudioOpsBody({ s }: { s: Summary }) {
  const wf = s.counts.workflowsByStatus;
  const totalGoals = sum(wf);
  const finished = (wf.completed ?? 0) + (wf.failed ?? 0) + (wf.cancelled ?? 0);
  const open = totalGoals - finished;
  const tasks = s.counts.tasksByStatus;
  const ap = s.counts.approvalsByStatus;
  const gate = (id: string) => s.agents.find((a) => a.id === id)?.gate ?? null;
  const qa = gate('chitragupta_quality_audit');
  const safety = gate('ops_dharma_safety');
  const busiest = [...s.agents].filter((a) => a.total > 0).sort((a, b) => b.total - a.total).slice(0, 8);
  const brands = ['sunverse', 'littleloop', 'foliocraft', 'studio'] as const;

  return (
    <>
      <section className="an-head">
        <div>
          <p className="eyebrow">Studio operations</p>
          <h2 className="ws-title">Agent work, counted</h2>
          <p className="ws-desc">
            From the studio’s execution records · updated {formatWhen(s.generatedAt)} · {s.windowNote}
          </p>
        </div>
        <LiveBadge label="Real data" />
      </section>

      <section className="grid-4" aria-label="Goals">
        <Tile label="Goals started" value={n(totalGoals)} hint={`${n(open)} open`} />
        <Tile label="Goals done" value={n(wf.completed ?? 0)} hint={`Success rate ${pct(wf.completed ?? 0, finished)} of finished`} />
        <Tile label="Waiting for you" value={n((wf.waiting_for_approval ?? 0) + (wf.waiting_for_external_action ?? 0))} hint={`${pl(ap.pending ?? 0, 'approval')} pending`} />
        <Tile label="Failed steps · 7 days" value={n(s.counts.failedTasks7d)} hint={`${n(tasks.failed ?? 0)} failed in total`} />
      </section>

      <section className="grid-4" aria-label="Quality and speed">
        <Tile label="Quality reviews (CHITRAGUPTA)" value={qa ? `${qa.pass} pass · ${qa.fail} fail` : '—'} hint={qa ? `Pass rate ${pct(qa.pass, qa.pass + qa.fail)}` : 'No reviews yet'} />
        <Tile label="Safety reviews (DHARMA)" value={safety ? `${safety.pass} pass · ${safety.fail} fail` : '—'} hint={safety ? `Pass rate ${pct(safety.pass, safety.pass + safety.fail)}` : 'No reviews yet'} />
        <Tile label="Step time (median)" value={secs(s.taskDurationSec?.median)} hint={s.taskDurationSec ? `90% under ${secs(s.taskDurationSec.p90)} · ${s.taskDurationSec.samples} steps` : 'Not enough completed steps'} />
        <Tile label="Your decisions" value={`${n(ap.approved ?? 0)} approved`} hint={`${n(ap.rejected ?? 0)} rejected`} />
      </section>

      <div className="grid-main">
        <div className="col">
          <Card title="Goals by status">{totalGoals ? <StatusBar counts={wf} /> : <EmptyState title="No goals yet" hint="Counts appear after the first goal runs." />}</Card>
          <Card title="Goals by brand">
            <div className="an-table-wrap">
              <table className="an-table">
                <thead>
                  <tr>
                    <th>Brand</th>
                    <th className="num">Total</th>
                    <th className="num">Done</th>
                    <th className="num">Open</th>
                    <th className="num">Failed</th>
                  </tr>
                </thead>
                <tbody>
                  {brands.map((b) => {
                    const c = s.counts.workflowsByBrand[b] ?? {};
                    const t = sum(c);
                    return (
                      <tr key={b}>
                        <td>{productNames[b]}</td>
                        <td className="num">{t}</td>
                        <td className="num">{c.completed ?? 0}</td>
                        <td className="num">{t - (c.completed ?? 0) - (c.failed ?? 0) - (c.cancelled ?? 0)}</td>
                        <td className="num">{c.failed ?? 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="Most active agents">
            {busiest.length ? (
              <div className="an-table-wrap">
                <table className="an-table">
                  <thead>
                    <tr>
                      <th>Agent</th>
                      <th className="num">Steps</th>
                      <th className="num">Done</th>
                      <th className="num">Failed</th>
                      <th>Last active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {busiest.map((a) => (
                      <tr key={a.id}>
                        <td>{agentName(a.id)}</td>
                        <td className="num">{a.total}</td>
                        <td className="num">{a.completed}</td>
                        <td className="num">{a.failed}</td>
                        <td>{a.last_activity ? formatWhen(a.last_activity) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No agent work recorded yet" />
            )}
          </Card>
        </div>
        <div className="col">
          <Card title="AI usage · last 30 days">
            {s.providers.map((p) => {
              const u = s.usage30d.find((x) => x.provider === p.provider);
              return (
                <div key={p.provider} className="usage">
                  <p className="usage-head">
                    <strong>{engineNames[p.provider] ?? p.provider}</strong> <span className="stat-hint">{p.model}</span>
                  </p>
                  {p.state === 'not_configured' && !u ? (
                    <p className="ai-note">Not configured — no key on the Worker.</p>
                  ) : (
                    <dl className="kv-row">
                      <div>
                        <dt>Calls</dt>
                        <dd>{n(u?.calls ?? 0)}</dd>
                      </div>
                      <div>
                        <dt>Error rate</dt>
                        <dd>{u ? pct(u.errors, u.calls) : '—'}</dd>
                      </div>
                      <div>
                        <dt>Tokens in / out</dt>
                        <dd>{u ? `${n(u.input_tokens)} / ${n(u.output_tokens)}` : '0 / 0'}</dd>
                      </div>
                      <div>
                        <dt>Avg latency</dt>
                        <dd>{u?.avg_latency_ms ? `${(u.avg_latency_ms / 1000).toFixed(1)}s` : '—'}</dd>
                      </div>
                      <div>
                        <dt>Cost</dt>
                        <dd>{p.costTracking === 'configured' ? (u?.cost_usd != null ? `$${u.cost_usd.toFixed(4)}` : '$0') : 'Not tracked'}</dd>
                      </div>
                    </dl>
                  )}
                </div>
              );
            })}
            <p className="ai-note">Cost shows “Not tracked” unless a per-token price is configured; it is never estimated.</p>
          </Card>
          <Card title="Steps by status">
            {sum(tasks) ? (
              <ul className="kv-list compact">
                {Object.entries(tasks)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, v]) => (
                    <li key={k}>
                      <span>{WF_STATUS[k]?.label ?? k}</span>
                      <strong>{v}</strong>
                    </li>
                  ))}
              </ul>
            ) : (
              <EmptyState title="No steps yet" />
            )}
          </Card>
          <Card title="Not available yet">
            <ul className="bullets">
              <li>Revenue, views and conversions per goal — no sales or platform source is linked to goals.</li>
              <li>Cost in money — needs a per-token price set on the Worker.</li>
              <li>LittleLoop and Foliocraft audience numbers — no channel or site analytics connected.</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

/** Small per-brand block for brand tabs without an audience source. */
export function BrandWorkCounts({ brand }: { brand: string }) {
  const { summary, locked } = useStudio();
  if (locked || !summary) return null;
  const c = summary.counts.workflowsByBrand[brand] ?? {};
  const t = sum(c);
  return (
    <Card title="Studio work for this brand">
      {t ? <StatusBar counts={c} /> : <EmptyState title="No goals for this brand yet" />}
    </Card>
  );
}
