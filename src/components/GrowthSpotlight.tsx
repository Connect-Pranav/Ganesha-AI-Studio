// GANESHA GROWTH AI spotlight on Home: a banner for the newest agent and a performance popup
// (opens by itself once a day when the studio is unlocked). Every number is the Worker's own count
// from /api/growth/overview — demo leads excluded, nothing estimated.
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, AUTH_EVENT, getToken } from '../services/adminService';
import { AgentAvatar } from './AgentAvatar';
import { BrandMark } from './BrandMark';
import { Icon } from './Icon';
import { formatWhen } from './ui';
import type { View } from '../types';

type Metrics = { name: string; leads: number; qualified: number; pendingApprovals: number; sent: number; repliedLeads: number; replyRate: number | null; meetingsConfirmed: number; won: number; costUsd: number; costInr: number | null; jobs: number; failedJobs: number };
interface Overview {
  brands: Record<string, Metrics>;
  total: Record<string, number | null>;
  recent: { id: string; kind: string; note: string | null; lead_name: string | null; created_at: string }[];
  attention: { id: string; name: string; why: string[] }[];
}

const GROWTH_AGENT = { id: 'ganesha_growth_ai', name: 'GROWTH AI', team: 'master', role: 'Growth — lead generation and outreach' };
const BRANDS = ['littleloop', 'sunverse', 'foliocraft'] as const;
const today = () => new Date().toISOString().slice(0, 10);
const label = (s: string) => s.replace(/_/g, ' ');
const money = (o: { costInr?: number | null; costUsd?: number | null }) => (o.costInr !== null && o.costInr !== undefined ? `₹${Number(o.costInr).toFixed(2)}` : `$${Number(o.costUsd ?? 0).toFixed(4)}`);

export function GrowthSpotlight({ onNavigate }: { onNavigate: (v: View) => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [locked, setLocked] = useState(!getToken());

  const load = useCallback(() => {
    const has = Boolean(getToken());
    setLocked(!has);
    if (!has) return;
    api<Overview>('/api/growth/overview')
      .then((d) => {
        setData(d);
        setErr(null);
        try {
          if (localStorage.getItem('gas.growthPopup.day') !== today()) {
            localStorage.setItem('gas.growthPopup.day', today());
            setOpen(true);
          }
        } catch {
          /* storage unavailable: no auto-open */
        }
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : 'Could not load Growth AI'));
  }, []);
  useEffect(() => {
    load();
    window.addEventListener(AUTH_EVENT, load);
    return () => window.removeEventListener(AUTH_EVENT, load);
  }, [load]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open]);

  const t = data?.total;
  const started = Boolean(t && ((t.leads ?? 0) > 0 || (t.jobs ?? 0) > 0));
  return (
    <>
      <section className="gs-banner" aria-label="GANESHA GROWTH AI">
        <AgentAvatar agent={GROWTH_AGENT} size={84} />
        <div className="gs-text">
          <p className="eyebrow">New agent</p>
          <h2>GANESHA GROWTH AI</h2>
          <p>
            {locked
              ? 'Unlock the studio to see how your marketing agent is doing.'
              : err
                ? err
                : !data
                  ? 'Loading performance…'
                  : started
                    ? `${t!.leads} leads · ${t!.sent} sent · ${t!.meetingsConfirmed} meetings · ${t!.won} won`
                    : 'Live and ready. No campaign has run yet.'}
          </p>
        </div>
        <div className="gs-actions">
          <button className="btn btn-primary" onClick={() => setOpen(true)} disabled={locked || !data}>
            <Icon name="analytics" size={16} /> Performance
          </button>
          <button className="btn btn-ghost" onClick={() => onNavigate('growth')}>
            Open Growth
          </button>
        </div>
      </section>

      {open &&
        data &&
        createPortal(
          <div className="ag-modal-scrim" onClick={() => setOpen(false)}>
            <div className="ag-modal gs-modal" role="dialog" aria-modal="true" aria-label="Growth AI performance" onClick={(e) => e.stopPropagation()}>
              <button className="icon-btn ag-close" onClick={() => setOpen(false)} aria-label="Close">
                <Icon name="close" />
              </button>
              <div className="ag-modal-head">
                <AgentAvatar agent={GROWTH_AGENT} size={100} />
                <div>
                  <p className="eyebrow">Performance · all three brands</p>
                  <h2 className="ag-modal-name">GROWTH AI</h2>
                  <p className="ag-modal-role">Finds partners and customers, drafts outreach, and sends only what you approve.</p>
                </div>
              </div>

              <div className="gs-kpis">
                {[
                  ['Leads found', t!.leads],
                  ['Qualified', t!.qualified],
                  ['Waiting for you', t!.pendingApprovals],
                  ['Sent', t!.sent],
                  ['Replies', t!.repliedLeads],
                  ['Meetings', t!.meetingsConfirmed],
                  ['Won', t!.won],
                  ['AI cost', money(t as { costInr?: number | null; costUsd?: number | null })],
                ].map(([k, v]) => (
                  <div key={k as string} className="gs-kpi">
                    <b>{v ?? '—'}</b>
                    <span>{k}</span>
                  </div>
                ))}
              </div>

              {!started && <p className="ai-note">Nothing has run yet. Create a campaign in Growth → Campaigns, activate it, and tap “Find leads”. Every message still waits for your approval.</p>}

              <table className="gs-table">
                <thead>
                  <tr>
                    <th>Brand</th>
                    <th>Leads</th>
                    <th>Qualified</th>
                    <th>Sent</th>
                    <th>Reply rate</th>
                    <th>Meetings</th>
                    <th>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {BRANDS.filter((b) => data.brands[b]).map((b) => {
                    const m = data.brands[b];
                    return (
                      <tr key={b}>
                        <td>
                          <span className="gs-brand">
                            <BrandMark id={b} size={24} iconSize={14} />
                            {m.name}
                          </span>
                        </td>
                        <td>{m.leads}</td>
                        <td>{m.qualified}</td>
                        <td>{m.sent}</td>
                        <td>{m.replyRate === null ? '—' : `${m.replyRate}%`}</td>
                        <td>{m.meetingsConfirmed}</td>
                        <td>{money(m)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {data.attention.length > 0 && (
                <>
                  <h3 className="ag-h">Needs attention</h3>
                  <ul className="bullets">{data.attention.map((a) => <li key={a.id}><strong>{a.name}</strong>: {a.why.join(' · ')}</li>)}</ul>
                </>
              )}
              {data.recent.length > 0 && (
                <>
                  <h3 className="ag-h">Latest activity</h3>
                  <ul className="gs-recent">
                    {data.recent.slice(0, 5).map((r) => (
                      <li key={r.id}>
                        <span className="stat-hint">{formatWhen(r.created_at)}</span> {label(r.kind)}
                        {r.lead_name ? ` · ${r.lead_name}` : ''}
                        {r.note ? ` · ${r.note}` : ''}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <div className="nt-actions">
                <button className="btn btn-primary" onClick={() => { setOpen(false); onNavigate('growth'); }}>Open Growth</button>
                <button className="btn btn-ghost" onClick={() => setOpen(false)}>Close</button>
              </div>
              <p className="ai-note">Counted from saved records; demo leads are excluded. This popup opens by itself once a day.</p>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
