// GANESHA GROWTH AI — owner dashboard: overview, campaigns, leads/CRM, approval queue, replies,
// tasks & meetings, agent activity & costs, settings. Every number comes from the Worker's records.
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, AUTH_EVENT, getToken } from '../../services/adminService';
import { Card, EmptyState, formatWhen } from '../ui';
import { Markdown } from '../Markdown';
import { MushakDaily } from '../MushakDaily';
import { MushakCycles } from '../MushakCycles';

type Brand = 'littleloop' | 'sunverse' | 'foliocraft';
const BRANDS: { id: Brand; name: string }[] = [
  { id: 'littleloop', name: 'LittleLoop' },
  { id: 'sunverse', name: 'Sunverse' },
  { id: 'foliocraft', name: 'Foliocraft' },
];
const TABS = ['Overview', '4-hour reports', 'Daily report', 'Campaigns', 'Leads', 'Approvals', 'Replies', 'Tasks', 'Agents & Costs', 'Settings'] as const;
type Tab = (typeof TABS)[number];
const STAGES = ['new', 'researching', 'qualified', 'outreach_drafted', 'pending_approval', 'approved', 'sent', 'replied', 'meeting_scheduled', 'proposal', 'negotiation', 'won', 'lost', 'suppressed'];
const MANUAL = ['new', 'researching', 'qualified', 'replied', 'meeting_scheduled', 'proposal', 'negotiation', 'won', 'lost'];
const OBJECTIVES: Record<Brand, string[]> = {
  littleloop: ['sponsorship', 'licensing', 'distribution', 'partnership', 'creator_collaboration'],
  sunverse: ['creator_collaboration', 'licensing', 'distribution', 'partnership'],
  foliocraft: ['customer_acquisition', 'partnership', 'distribution'],
};
const label = (s: string) => s.replace(/_/g, ' ');

interface Campaign { id: string; brand: Brand; name: string; objective: string; segment: string; audience: string; geography: string; criteria: string; threshold: number; dailyJobLimit: number; maxLeads: number; budgetInr: number; researchDepth: string; channel: string; status: string; updatedAt: string }
interface Lead { id: string; brand: Brand; campaignId: string | null; name: string; orgType: string; website: string | null; contactRole: string | null; contactEmail: string | null; category: string | null; geography: string | null; sources: { url: string; title: string | null; verified: boolean }[]; evidence: string; researchedAt: string | null; stale: boolean; score: number | null; scoreDetail: { components: Record<string, { label: string; max: number; score: number; evidence: string | null }>; missing: string[]; nextAction: string | null } | null; confidence: string | null; stage: string; lostReason: string | null; nextAction: string | null; followUpAt: string | null; contactPermission: string; origin: string; updatedAt: string }
interface Draft { id: string; leadId: string; leadName?: string; leadScore?: number | null; kind: string; channel: string; recipient: string; subject: string; body: string; personalization: string; status: string; approvalValid: boolean; approvedAt: string | null; sentAt: string | null; warnings?: string[]; updatedAt: string }

function useGrowth<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!path) return;
    if (!getToken()) return setError('locked');
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => {
    load();
    window.addEventListener(AUTH_EVENT, load);
    return () => window.removeEventListener(AUTH_EVENT, load);
  }, [load]);
  return { data, error, load, setData };
}
const post = <T,>(path: string, body: unknown = {}, method = 'POST') => api<T>(path, { method, body: JSON.stringify(body) });

function Notice({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <p className={/^(✅|Saved|Done)/.test(msg) ? 'cx-ok' : 'form-error'} role="status">{msg}</p>;
}
function Stat({ k, v, hint }: { k: string; v: ReactNode; hint?: string }) {
  return (
    <div className="gr-stat" title={hint}>
      <span className="gr-stat-v">{v}</span>
      <span className="gr-stat-k">{k}</span>
    </div>
  );
}
const n = (v: number | null | undefined, suffix = '') => (v === null || v === undefined ? '—' : `${v}${suffix}`);

export function GrowthView() {
  const [brand, setBrand] = useState<Brand>(() => (localStorage.getItem('gas.growth.brand') as Brand) || 'littleloop');
  const [tab, setTab] = useState<Tab>('Overview');
  const [locked, setLocked] = useState(!getToken());
  useEffect(() => {
    const f = () => setLocked(!getToken());
    window.addEventListener(AUTH_EVENT, f);
    return () => window.removeEventListener(AUTH_EVENT, f);
  }, []);
  const pickBrand = (b: Brand) => {
    setBrand(b);
    try {
      localStorage.setItem('gas.growth.brand', b);
    } catch {
      /* ignore */
    }
  };
  if (locked) return <Card title="MUSHAK · Growth"><EmptyState title="Unlock the studio to use Mushak" hint="Bell → Unlock with your admin token." /></Card>;
  return (
    <div className="gr">
      <div className="gr-bar">
        <div className="tabs" role="tablist" aria-label="Brand">
          {BRANDS.map((b) => (
            <button key={b.id} role="tab" aria-selected={brand === b.id} className={`tab ${brand === b.id ? 'active' : ''}`} onClick={() => pickBrand(b.id)}>{b.name}</button>
          ))}
        </div>
        <div className="tabs gr-tabs" role="tablist" aria-label="Growth section">
          {TABS.map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</button>
          ))}
        </div>
      </div>
      {tab === 'Overview' && <Overview brand={brand} onGo={setTab} />}
      {tab === '4-hour reports' && <Card title="Mushak · every run (inputs → plan → output)"><MushakCycles /></Card>}
      {tab === 'Daily report' && <Card title="Mushak · daily report (all brands)"><MushakDaily /></Card>}
      {tab === 'Campaigns' && <Campaigns key={brand} brand={brand} />}
      {tab === 'Leads' && <Leads key={brand} brand={brand} />}
      {tab === 'Approvals' && <Approvals key={brand} brand={brand} />}
      {tab === 'Replies' && <Replies key={brand} brand={brand} />}
      {tab === 'Tasks' && <Tasks key={brand} brand={brand} />}
      {tab === 'Agents & Costs' && <Jobs key={brand} brand={brand} />}
      {tab === 'Settings' && <GrowthSettings key={brand} brand={brand} />}
    </div>
  );
}

/* ---------------- Overview ---------------- */
interface OverviewData { brands: Record<string, Record<string, number | null> & { name: string }>; total: Record<string, number | null>; recent: { id: string; kind: string; note: string | null; lead_name: string | null; actor: string; created_at: string; to_stage: string | null }[]; attention: { id: string; name: string; why: string[] }[]; foliocraftSegments: Record<string, { leads: number; sent: number; won: number; conversionRate: number | null }> | null; note: string }
function Overview({ brand, onGo }: { brand: Brand; onGo: (t: Tab) => void }) {
  const { data, error } = useGrowth<OverviewData>(`/api/growth/overview?brand=${brand}`, [brand]);
  if (error) return <Card title="Growth overview"><p className="form-error">{error}</p></Card>;
  if (!data) return <Card title="Growth overview"><p className="cx-sub">Loading…</p></Card>;
  const m = data.brands[brand];
  return (
    <>
      <Card title={`Growth overview · ${m.name}`}>
        <div className="gr-stats">
          <Stat k="Leads" v={n(m.leads)} />
          <Stat k="Qualified" v={n(m.qualified)} hint={`${n(m.qualificationRate, '%')} of leads`} />
          <Stat k="Waiting approval" v={<button className="gr-link" onClick={() => onGo('Approvals')}>{n(m.pendingApprovals)}</button>} />
          <Stat k="Approved (not sent)" v={n(m.approved)} />
          <Stat k="Sent" v={n(m.sent)} />
          <Stat k="Reply rate" v={n(m.replyRate, '%')} hint="Leads that replied ÷ leads contacted" />
          <Stat k="Meetings confirmed" v={n(m.meetingsConfirmed)} />
          <Stat k="Active opportunities" v={n(m.activeOpportunities)} />
          <Stat k="Won" v={n(m.won)} />
          <Stat k="AI cost" v={m.costInr !== null && m.costInr !== undefined ? `₹${Number(m.costInr).toFixed(2)}` : `$${Number(m.costUsd ?? 0).toFixed(4)}`} hint={`${m.jobs} agent jobs${m.jobsWithUnknownCost ? `, ${m.jobsWithUnknownCost} with unknown cost` : ''}`} />
        </div>
        <p className="cx-sub">{data.note}{m.demoLeads ? ` ${m.demoLeads} demo lead(s) not counted.` : ''}</p>
      </Card>
      {data.foliocraftSegments && brand === 'foliocraft' && (
        <Card title="Foliocraft · individuals vs business (kept separate)">
          <div className="gr-stats">
            {Object.entries(data.foliocraftSegments).map(([seg, s]) => (
              <Stat key={seg} k={`${seg}: leads / sent / won`} v={`${s.leads} / ${s.sent} / ${s.won}`} hint={`Conversion ${n(s.conversionRate, '%')}`} />
            ))}
          </div>
        </Card>
      )}
      <Card title="Needs attention">
        {data.attention.filter((a) => a).length === 0 ? <p className="cx-sub">Nothing waiting.</p> : (
          <ul className="gr-list">{data.attention.map((a) => <li key={a.id}><strong>{a.name}</strong> — {a.why.join(' · ')}</li>)}</ul>
        )}
      </Card>
      <Card title="Recent agent & pipeline activity">
        {data.recent.length === 0 ? <EmptyState title="No activity yet" hint="Create a campaign, then let NARADA discover leads." /> : (
          <ul className="gr-list">{data.recent.map((a) => <li key={a.id}><span className="cx-sub">{formatWhen(a.created_at)}</span> · <strong>{label(a.kind)}</strong>{a.lead_name ? ` · ${a.lead_name}` : ''}{a.note ? ` — ${a.note}` : ''} <span className="cx-sub">({a.actor})</span></li>)}</ul>
        )}
      </Card>
    </>
  );
}

/* ---------------- Campaigns ---------------- */
function Campaigns({ brand }: { brand: Brand }) {
  const { data, load } = useGrowth<{ campaigns: Campaign[] }>(`/api/growth/campaigns?brand=${brand}`, [brand]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [f, setF] = useState({ name: '', objective: OBJECTIVES[brand][0], segment: brand === 'foliocraft' ? 'individual' : 'business', audience: '', geography: '', criteria: '', threshold: 60, dailyJobLimit: 20, maxLeads: 50, budgetInr: 0, researchDepth: 'standard', channel: 'manual' });
  const set = (k: string, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const create = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await post('/api/growth/campaigns', { ...f, brand });
      setMsg('✅ Campaign created as draft. Activate it to let agents work.');
      setF((x) => ({ ...x, name: '' }));
      load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'failed');
    }
  };
  const act = async (c: Campaign, action: string) => {
    if (action === 'cancel' && !window.confirm(`Cancel "${c.name}"? Unsent drafts will be cancelled.`)) return;
    setBusy(c.id + action);
    setMsg(null);
    try {
      if (action === 'discover') {
        const r = await post<{ created: Lead[]; skipped: { name: string; reason: string }[] }>(`/api/growth/campaigns/${c.id}/discover`, { count: 5 });
        setMsg(`✅ NARADA found ${r.created.length} new lead(s)${r.skipped.length ? `, skipped ${r.skipped.length} (${r.skipped.map((s) => `${s.name}: ${s.reason}`).join('; ')})` : ''}.`);
      } else await post(`/api/growth/campaigns/${c.id}/${action}`);
      load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'failed');
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <Card title="Campaigns">
        <Notice msg={msg} />
        {!data ? <p className="cx-sub">Loading…</p> : data.campaigns.length === 0 ? <EmptyState title="No campaigns yet" hint="Create one below." /> : (
          <ul className="gr-rows">
            {data.campaigns.map((c) => (
              <li key={c.id} className="gr-row">
                <div>
                  <strong>{c.name}</strong> <span className={`pill ${c.status === 'active' ? 'pill-running' : 'pill-idle'}`}>{c.status}</span>
                  <p className="cx-sub">{label(c.objective)} · {c.segment} · threshold {c.threshold} · {c.dailyJobLimit} jobs/day · max {c.maxLeads} leads · {c.budgetInr ? `₹${c.budgetInr} budget` : 'free-tier only'} · {c.channel}</p>
                </div>
                <div className="nt-actions">
                  {c.status === 'active' && <button className="btn btn-small btn-primary" disabled={busy !== null} onClick={() => act(c, 'discover')}>{busy === c.id + 'discover' ? 'NARADA searching…' : '🔎 Find leads'}</button>}
                  {['draft', 'paused'].includes(c.status) && <button className="btn btn-small" disabled={busy !== null} onClick={() => act(c, c.status === 'draft' ? 'activate' : 'resume')}>{c.status === 'draft' ? 'Activate' : 'Resume'}</button>}
                  {c.status === 'active' && <button className="btn btn-small" disabled={busy !== null} onClick={() => act(c, 'pause')}>Pause</button>}
                  {!['cancelled', 'completed'].includes(c.status) && <button className="btn btn-small" disabled={busy !== null} onClick={() => act(c, 'cancel')}>Cancel</button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="New campaign">
        <form className="form" onSubmit={create}>
          <div className="form-row">
            <label>Name<input value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={120} required placeholder="e.g. Kids publishers — India" /></label>
            <label>Objective<select value={f.objective} onChange={(e) => set('objective', e.target.value)}>{OBJECTIVES[brand].map((o) => <option key={o} value={o}>{label(o)}</option>)}</select></label>
            <label>Segment<select value={f.segment} onChange={(e) => set('segment', e.target.value)}><option value="business">Business / partners</option>{brand === 'foliocraft' && <option value="individual">Individual users</option>}</select></label>
          </div>
          <div className="form-row">
            <label>Audience<input value={f.audience} onChange={(e) => set('audience', e.target.value)} maxLength={1000} placeholder="Who exactly?" /></label>
            <label>Geography<input value={f.geography} onChange={(e) => set('geography', e.target.value)} maxLength={200} placeholder="e.g. India" /></label>
          </div>
          <label>Prospect criteria<textarea rows={2} value={f.criteria} onChange={(e) => set('criteria', e.target.value)} maxLength={2000} placeholder="Must-haves, exclusions…" /></label>
          <div className="form-row">
            <label>Qualify at score ≥<input type="number" min={0} max={100} value={f.threshold} onChange={(e) => set('threshold', Number(e.target.value))} /></label>
            <label>Agent jobs / day<input type="number" min={1} max={500} value={f.dailyJobLimit} onChange={(e) => set('dailyJobLimit', Number(e.target.value))} /></label>
            <label>Max leads<input type="number" min={1} max={5000} value={f.maxLeads} onChange={(e) => set('maxLeads', Number(e.target.value))} /></label>
            <label>Budget ₹ (0 = free tier only)<input type="number" min={0} value={f.budgetInr} onChange={(e) => set('budgetInr', Number(e.target.value))} /></label>
          </div>
          <div className="form-row">
            <label>Research depth<select value={f.researchDepth} onChange={(e) => set('researchDepth', e.target.value)}><option value="light">Light</option><option value="standard">Standard</option><option value="deep">Deep</option></select></label>
            <label>Channel<select value={f.channel} onChange={(e) => set('channel', e.target.value)}><option value="manual">Manual (you send, then confirm)</option><option value="email">Email (needs an integration)</option></select></label>
          </div>
          <p className="cx-sub">Estimated resources: up to {f.dailyJobLimit} Gemini jobs/day (free tier; Google Search grounding has a free monthly quota). Every message still needs your approval.</p>
          <div className="modal-actions"><button className="btn btn-primary">Create campaign</button></div>
        </form>
      </Card>
    </>
  );
}

/* ---------------- Leads / CRM ---------------- */
function Leads({ brand }: { brand: Brand }) {
  const [stage, setStage] = useState('');
  const [q, setQ] = useState('');
  const [minScore, setMinScore] = useState('');
  const qs = new URLSearchParams({ brand, ...(stage ? { stage } : {}), ...(q ? { q } : {}), ...(minScore ? { minScore } : {}) }).toString();
  const { data, load } = useGrowth<{ leads: Lead[] }>(`/api/growth/leads?${qs}`, [qs]);
  const camps = useGrowth<{ campaigns: Campaign[] }>(`/api/growth/campaigns?brand=${brand}`, [brand]);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [nf, setNf] = useState({ name: '', website: '', contactEmail: '', category: '', campaignId: '' });
  const add = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await post('/api/growth/leads', { brand, name: nf.name, website: nf.website || undefined, contactEmail: nf.contactEmail || undefined, category: nf.category || undefined, campaignId: nf.campaignId || undefined });
      setNf({ name: '', website: '', contactEmail: '', category: '', campaignId: nf.campaignId });
      setMsg('✅ Lead added.');
      load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'failed');
    }
  };
  const byStage = STAGES.map((s) => ({ s, c: data?.leads.filter((l) => l.stage === s).length ?? 0 })).filter((x) => x.c);
  return (
    <>
      <Card title="CRM pipeline">
        <div className="gr-pipe">{byStage.length ? byStage.map((x) => <button key={x.s} className={`cx-chip ${stage === x.s ? 'on' : ''}`} onClick={() => setStage(stage === x.s ? '' : x.s)}>{label(x.s)} · {x.c}</button>) : <span className="cx-sub">No leads yet.</span>}</div>
        <div className="form"><div className="form-row gr-filters">
          <label>Search<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="name, site, category" /></label>
          <label>Stage<select value={stage} onChange={(e) => setStage(e.target.value)}><option value="">All</option>{STAGES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></label>
          <label>Min score<input type="number" min={0} max={100} value={minScore} onChange={(e) => setMinScore(e.target.value)} /></label>
        </div></div>
        <Notice msg={msg} />
        {!data ? <p className="cx-sub">Loading…</p> : data.leads.length === 0 ? <EmptyState title="No leads match" hint="Activate a campaign and tap Find leads, or add one below." /> : (
          <ul className="gr-rows">
            {data.leads.map((l) => (
              <li key={l.id} className="gr-row gr-lead">
                <button className="gr-lead-head" onClick={() => setOpen(open === l.id ? null : l.id)} aria-expanded={open === l.id}>
                  <span className="gr-score" data-band={l.score === null ? 'none' : l.score >= 70 ? 'hi' : l.score >= 40 ? 'mid' : 'lo'}>{l.score ?? '—'}</span>
                  <span><strong>{l.name}</strong>{l.origin === 'demo' && <span className="pill pill-warn"> DEMO</span>}<br /><span className="cx-sub">{label(l.stage)} · {l.category ?? l.orgType}{l.website ? ` · ${l.website.replace(/^https?:\/\//, '')}` : ''}{l.stale ? ' · ⚠️ research is stale' : ''}</span></span>
                </button>
                {open === l.id && <LeadPanel id={l.id} campaigns={camps.data?.campaigns ?? []} onChange={load} />}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Add a lead manually">
        <form className="form" onSubmit={add}>
          <div className="form-row">
            <label>Name<input required value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} maxLength={160} /></label>
            <label>Website<input value={nf.website} onChange={(e) => setNf({ ...nf, website: e.target.value })} placeholder="https://…" /></label>
            <label>Public business email (optional)<input value={nf.contactEmail} onChange={(e) => setNf({ ...nf, contactEmail: e.target.value })} placeholder="partnerships@…" /></label>
          </div>
          <div className="form-row">
            <label>Category<input value={nf.category} onChange={(e) => setNf({ ...nf, category: e.target.value })} /></label>
            <label>Campaign<select value={nf.campaignId} onChange={(e) => setNf({ ...nf, campaignId: e.target.value })}><option value="">None</option>{(camps.data?.campaigns ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          </div>
          <p className="cx-sub">Duplicates (same website, or same name) are detected per brand. A public email is not permission to contact — keep it business-only.</p>
          <div className="modal-actions"><button className="btn btn-primary">Add lead</button></div>
        </form>
      </Card>
    </>
  );
}

interface LeadDetail { lead: Lead; activities: { id: string; kind: string; from_stage: string | null; to_stage: string | null; note: string | null; actor: string; created_at: string }[]; drafts: { id: string; status: string; subject: string; created_at: string }[]; replies: { id: string; classification: string; summary: string; received_at: string }[] }
function LeadPanel({ id, campaigns, onChange }: { id: string; campaigns: Campaign[]; onChange: () => void }) {
  const { data, load } = useGrowth<LeadDetail>(`/api/growth/leads/${id}`, [id]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const run = async (what: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(what);
    setMsg(null);
    try {
      await fn();
      setMsg(`✅ ${ok}`);
      load();
      onChange();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(null);
    }
  };
  if (!data) return <p className="cx-sub">Loading…</p>;
  const l = data.lead;
  const move = (stage: string) => {
    let reason: string | null | undefined;
    if (stage === 'lost') reason = window.prompt('Why was it lost?');
    if (stage === 'lost' && !reason) return;
    const confirm = stage === 'meeting_scheduled' ? window.confirm('Is the meeting confirmed by the prospect?') : false;
    if (stage === 'meeting_scheduled' && !confirm) return;
    run('stage', () => post(`/api/growth/leads/${id}/stage`, { stage, reason, confirm }), `Moved to ${label(stage)}`);
  };
  return (
    <div className="gr-panel">
      <Notice msg={msg} />
      <div className="nt-actions">
        <button className="btn btn-small btn-primary" disabled={busy !== null || l.stage === 'suppressed'} onClick={() => run('research', () => post(`/api/growth/leads/${id}/research`), 'Researched')}>{busy === 'research' ? 'NARADA researching…' : '🔎 Research'}</button>
        <button className="btn btn-small btn-primary" disabled={busy !== null || !l.researchedAt} onClick={() => run('qualify', () => post(`/api/growth/leads/${id}/qualify`), 'Scored')}>{busy === 'qualify' ? 'SOMA scoring…' : '📊 Qualify'}</button>
        <button className="btn btn-small btn-primary" disabled={busy !== null || !l.researchedAt || l.stage === 'suppressed'} onClick={() => run('draft', () => post(`/api/growth/leads/${id}/draft`, {}), 'Draft ready — see Approvals')}>{busy === 'draft' ? 'SAMVADA writing…' : '✉️ Draft outreach'}</button>
        <select aria-label="Move stage" value="" onChange={(e) => e.target.value && move(e.target.value)} disabled={busy !== null}>
          <option value="">Move stage…</option>
          {MANUAL.filter((s) => s !== l.stage).map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </select>
        <select aria-label="Campaign" value={l.campaignId ?? ''} onChange={(e) => run('camp', () => post(`/api/growth/leads/${id}`, { campaignId: e.target.value || null }, 'PUT'), 'Campaign updated')}>
          <option value="">No campaign</option>
          {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {l.stage !== 'suppressed' && (l.contactEmail || l.website) && (
          <button className="btn btn-small" disabled={busy !== null} onClick={() => window.confirm('Add to the do-not-contact list for every brand?') && run('sup', () => post('/api/growth/suppressions', { brand: '*', kind: l.contactEmail ? 'email' : 'domain', value: l.contactEmail ?? l.website, reason: 'Owner marked do-not-contact' }), 'Suppressed')}>🚫 Do not contact</button>
        )}
      </div>
      <p className="cx-sub">Contact: {l.contactRole ?? 'role unknown'}{l.contactEmail ? ` · ${l.contactEmail}` : ''} · permission: {label(l.contactPermission)}{l.nextAction ? ` · next: ${l.nextAction}` : ''}</p>
      {l.scoreDetail && (
        <div className="gr-score-box">
          <p><strong>Score {l.score}/100</strong> · {l.confidence ?? 'low'} confidence</p>
          <ul className="gr-list">{Object.entries(l.scoreDetail.components).map(([k, c]) => <li key={k}>{c.label}: <strong>{c.score}/{c.max}</strong>{c.evidence ? ` — ${c.evidence}` : ' — no evidence'}</li>)}</ul>
          {l.scoreDetail.missing.length > 0 && <p className="cx-sub">Missing: {l.scoreDetail.missing.join(', ')}</p>}
        </div>
      )}
      {l.evidence && <div className="gr-evidence"><Markdown text={l.evidence} /></div>}
      {l.sources.length > 0 && (
        <div className="sd-sources">{l.sources.map((s, i) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer" title={s.url}>[{i + 1}] {s.verified ? '✓ ' : '? '}{s.title ?? s.url.replace(/^https?:\/\//, '').slice(0, 50)}</a>)}</div>
      )}
      <details>
        <summary className="cx-sub">Activity timeline ({data.activities.length})</summary>
        <ul className="gr-list">{data.activities.map((a) => <li key={a.id}><span className="cx-sub">{formatWhen(a.created_at)}</span> · {label(a.kind)}{a.from_stage || a.to_stage ? ` (${a.from_stage ?? '—'} → ${a.to_stage ?? '—'})` : ''}{a.note ? ` — ${a.note}` : ''} <span className="cx-sub">· {a.actor}</span></li>)}</ul>
      </details>
    </div>
  );
}

/* ---------------- Approval queue ---------------- */
function Approvals({ brand }: { brand: Brand }) {
  const [status, setStatus] = useState('pending_approval');
  const { data, load } = useGrowth<{ drafts: Draft[] }>(`/api/growth/drafts?brand=${brand}&status=${status}`, [brand, status]);
  const [edit, setEdit] = useState<Record<string, { subject: string; body: string; recipient: string }>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (id: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(id);
    setMsg(null);
    try {
      await fn();
      setMsg(`✅ ${ok}`);
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(null);
    }
  };
  const copy = (d: Draft) => navigator.clipboard?.writeText(`${d.subject ? `Subject: ${d.subject}\n\n` : ''}${d.body}`).then(() => setMsg('✅ Copied — send it, then tap “I sent it”.'), () => setMsg('Copy failed — select the text.'));
  return (
    <Card title="Approval queue — nothing is sent without you">
      <div className="tabs" role="tablist">
        {['pending_approval', 'approved', 'sent', 'rejected', 'cancelled'].map((s) => <button key={s} role="tab" aria-selected={status === s} className={`tab ${status === s ? 'active' : ''}`} onClick={() => setStatus(s)}>{label(s)}</button>)}
      </div>
      <Notice msg={msg} />
      {!data ? <p className="cx-sub">Loading…</p> : data.drafts.length === 0 ? <EmptyState title="Nothing here" /> : (
        <ul className="gr-rows">
          {data.drafts.map((d) => {
            const e = edit[d.id];
            return (
              <li key={d.id} className="gr-row gr-draft">
                <p><strong>{d.leadName}</strong> <span className="cx-sub">· {label(d.kind)} · {d.channel} → {d.recipient}{d.leadScore !== null && d.leadScore !== undefined ? ` · score ${d.leadScore}` : ''}</span></p>
                {d.warnings && d.warnings.length > 0 && <p className="form-error">⚠️ {d.warnings.join(' · ')}</p>}
                {e ? (
                  <div className="form">
                    <label>Recipient<input value={e.recipient} onChange={(x) => setEdit({ ...edit, [d.id]: { ...e, recipient: x.target.value } })} /></label>
                    <label>Subject<input value={e.subject} onChange={(x) => setEdit({ ...edit, [d.id]: { ...e, subject: x.target.value } })} /></label>
                    <label>Message<textarea rows={7} value={e.body} onChange={(x) => setEdit({ ...edit, [d.id]: { ...e, body: x.target.value } })} /></label>
                    <div className="nt-actions">
                      <button className="btn btn-small btn-primary" disabled={busy === d.id} onClick={() => run(d.id, () => post(`/api/growth/drafts/${d.id}`, e, 'PUT'), 'Saved — needs approval again').then(() => setEdit((x) => { const y = { ...x }; delete y[d.id]; return y; }))}>Save changes</button>
                      <button className="btn btn-small" onClick={() => setEdit((x) => { const y = { ...x }; delete y[d.id]; return y; })}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    {d.subject && <p><strong>Subject:</strong> {d.subject}</p>}
                    <pre className="fp-prompt gr-body">{d.body}</pre>
                    {d.personalization && <p className="cx-sub">Personalisation used: {d.personalization}</p>}
                  </>
                )}
                {!e && (
                  <div className="nt-actions">
                    {['pending_approval', 'approved', 'rejected'].includes(d.status) && <button className="btn btn-small" onClick={() => setEdit({ ...edit, [d.id]: { subject: d.subject, body: d.body, recipient: d.recipient } })}>✏️ Edit</button>}
                    {d.status === 'pending_approval' && <button className="btn btn-small btn-primary" disabled={busy === d.id || Boolean(d.warnings?.length)} onClick={() => run(d.id, () => post(`/api/growth/drafts/${d.id}/approve`), 'Approved. Now send it.')}>✅ Approve</button>}
                    {['pending_approval', 'approved'].includes(d.status) && <button className="btn btn-small" disabled={busy === d.id} onClick={() => { const r = window.prompt('Reason (optional)') ; if (r !== null) run(d.id, () => post(`/api/growth/drafts/${d.id}/reject`, { reason: r }), 'Rejected'); }}>✕ Reject</button>}
                    {d.status === 'approved' && d.approvalValid && d.channel === 'manual' && (
                      <>
                        <button className="btn btn-small" onClick={() => copy(d)}>📋 Copy message</button>
                        <button className="btn btn-small btn-primary" disabled={busy === d.id} onClick={() => window.confirm(`Did you send this to ${d.recipient}? It will be recorded as sent.`) && run(d.id, () => post(`/api/growth/drafts/${d.id}/send`, { confirmSent: true }), 'Recorded as sent')}>📤 I sent it</button>
                      </>
                    )}
                    {d.status === 'approved' && d.channel === 'email' && <button className="btn btn-small" disabled={busy === d.id} onClick={() => run(d.id, () => post(`/api/growth/drafts/${d.id}/send`), 'Sent')}>📤 Send email</button>}
                    {d.sentAt && <span className="cx-sub">sent {formatWhen(d.sentAt)}</span>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="cx-sub">Approval is tied to the exact text: if you edit an approved message, it needs approval again. A message counts as sent only when you confirm you sent it (no email integration is connected yet).</p>
    </Card>
  );
}

/* ---------------- Replies ---------------- */
function Replies({ brand }: { brand: Brand }) {
  const { data, load } = useGrowth<{ replies: { id: string; lead_name: string; classification: string; summary: string; next_action: string; needs_review: number; received_at: string; body: string }[] }>(`/api/growth/replies?brand=${brand}`, [brand]);
  const leads = useGrowth<{ leads: Lead[] }>(`/api/growth/leads?brand=${brand}`, [brand]);
  const [leadId, setLeadId] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await post<{ reply: { classification: string; next_action: string } }>(`/api/growth/leads/${leadId}/reply`, { body });
      setMsg(`✅ Classified as "${label(r.reply.classification)}". Next: ${r.reply.next_action || '—'}`);
      setBody('');
      load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'failed');
    } finally {
      setBusy(false);
    }
  };
  const contacted = (leads.data?.leads ?? []).filter((l) => ['sent', 'replied', 'meeting_scheduled', 'proposal', 'negotiation', 'approved'].includes(l.stage));
  return (
    <>
      <Card title="Paste a reply — SAMVADA classifies it">
        <form className="form" onSubmit={submit}>
          <label>Lead<select required value={leadId} onChange={(e) => setLeadId(e.target.value)}><option value="">Choose…</option>{(contacted.length ? contacted : leads.data?.leads ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          <label>Their reply<textarea required rows={5} value={body} onChange={(e) => setBody(e.target.value)} maxLength={20000} /></label>
          <div className="modal-actions"><button className="btn btn-primary" disabled={busy || !leadId}>{busy ? 'Reading…' : 'Classify reply'}</button></div>
        </form>
        <Notice msg={msg} />
        <p className="cx-sub">No mailbox is connected, so replies are pasted here. “Unsubscribe / no thanks” always adds the contact to the do-not-contact list. Ganesha never answers by itself.</p>
      </Card>
      <Card title="Replies">
        {!data ? <p className="cx-sub">Loading…</p> : data.replies.length === 0 ? <EmptyState title="No replies yet" /> : (
          <ul className="gr-rows">{data.replies.map((r) => <li key={r.id} className="gr-row"><p><strong>{r.lead_name}</strong> · <span className="pill pill-idle">{label(r.classification)}</span>{r.needs_review ? <span className="pill pill-warn"> needs review</span> : null} <span className="cx-sub">{formatWhen(r.received_at)}</span></p><p className="cx-sub">{r.summary}{r.next_action ? ` → ${r.next_action}` : ''}</p></li>)}</ul>
        )}
      </Card>
    </>
  );
}

/* ---------------- Tasks & meetings ---------------- */
function Tasks({ brand }: { brand: Brand }) {
  const { data, load } = useGrowth<{ tasks: { id: string; kind: string; title: string; due_at: string | null; confirmed: number; done: number; lead_name: string | null }[] }>(`/api/growth/tasks?brand=${brand}`, [brand]);
  const leads = useGrowth<{ leads: Lead[] }>(`/api/growth/leads?brand=${brand}`, [brand]);
  const [f, setF] = useState({ kind: 'task', title: '', dueAt: '', leadId: '', confirmed: false });
  const [msg, setMsg] = useState<string | null>(null);
  const add = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await post('/api/growth/tasks', { brand, kind: f.kind, title: f.title, dueAt: f.dueAt ? new Date(f.dueAt).toISOString() : undefined, leadId: f.leadId || undefined, confirmed: f.kind === 'meeting' && f.confirmed });
      setF({ ...f, title: '', dueAt: '', confirmed: false });
      load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'failed');
    }
  };
  const upd = async (id: string, b: Record<string, boolean>) => {
    await post(`/api/growth/tasks/${id}`, b, 'PUT').catch((e) => setMsg(e.message));
    load();
  };
  return (
    <Card title="Tasks & meetings">
      <Notice msg={msg} />
      {!data ? <p className="cx-sub">Loading…</p> : data.tasks.length === 0 ? <EmptyState title="Nothing scheduled" /> : (
        <ul className="gr-rows">{data.tasks.map((t) => (
          <li key={t.id} className={`gr-row ${t.done ? 'gr-done' : ''}`}>
            <label className="st-check"><input type="checkbox" checked={Boolean(t.done)} onChange={(e) => upd(t.id, { done: e.target.checked })} /> {t.kind === 'meeting' ? '📅' : '☑️'} {t.title}{t.lead_name ? ` · ${t.lead_name}` : ''}{t.due_at ? ` · ${formatWhen(t.due_at)}` : ''}</label>
            {t.kind === 'meeting' && (t.confirmed ? <span className="pill pill-running">confirmed</span> : <button className="btn btn-small" onClick={() => window.confirm('Has the prospect confirmed this meeting?') && upd(t.id, { confirmed: true })}>Mark confirmed</button>)}
          </li>
        ))}</ul>
      )}
      <form className="form" onSubmit={add}>
        <div className="form-row">
          <label>Type<select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="task">Task / follow-up</option><option value="meeting">Meeting</option></select></label>
          <label>Title<input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={200} /></label>
          <label>Due<input type="datetime-local" value={f.dueAt} onChange={(e) => setF({ ...f, dueAt: e.target.value })} /></label>
          <label>Lead<select value={f.leadId} onChange={(e) => setF({ ...f, leadId: e.target.value })}><option value="">—</option>{(leads.data?.leads ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        </div>
        {f.kind === 'meeting' && <label className="st-check"><input type="checkbox" checked={f.confirmed} onChange={(e) => setF({ ...f, confirmed: e.target.checked })} /> The prospect has confirmed this meeting</label>}
        <div className="modal-actions"><button className="btn btn-primary">Add</button></div>
      </form>
      <p className="cx-sub">No calendar is connected: meetings are tracked here and count as “booked” only when you confirm them.</p>
    </Card>
  );
}

/* ---------------- Agents & costs ---------------- */
function Jobs({ brand }: { brand: Brand }) {
  const { data } = useGrowth<{ jobs: { id: string; kind: string; agent_id: string; status: string; model: string | null; input_tokens: number | null; output_tokens: number | null; cost_usd: number | null; error: string | null; summary: string | null; created_at: string }[] }>(`/api/growth/jobs?brand=${brand}`, [brand]);
  const AG: Record<string, string> = { narada_market_intelligence: 'NARADA', ops_soma_analytics: 'SOMA', samvada_handoffs: 'SAMVADA' };
  return (
    <Card title="Agent activity & costs">
      <p className="cx-sub">Growth uses existing agents: NARADA (lead hunting & research, Google Search), SOMA (scoring), SAMVADA (drafts & replies). Limits per campaign: jobs/day, max leads, ₹ budget; plus a monthly job cap per brand.</p>
      {!data ? <p className="cx-sub">Loading…</p> : data.jobs.length === 0 ? <EmptyState title="No agent jobs yet" /> : (
        <div className="gr-table-wrap">
          <table className="gr-table">
            <thead><tr><th>When</th><th>Agent</th><th>Job</th><th>Status</th><th>Tokens in/out</th><th>Cost</th><th>Result</th></tr></thead>
            <tbody>{data.jobs.map((j) => (
              <tr key={j.id}><td>{formatWhen(j.created_at)}</td><td>{AG[j.agent_id] ?? j.agent_id}</td><td>{label(j.kind)}</td><td><span className={`pill ${j.status === 'succeeded' ? 'pill-running' : j.status === 'running' ? 'pill-idle' : 'pill-warn'}`}>{j.status}</span></td><td>{j.input_tokens ?? '—'} / {j.output_tokens ?? '—'}</td><td>{j.cost_usd === null ? 'unknown' : `$${j.cost_usd.toFixed(5)}`}</td><td className="cx-sub">{j.error ?? j.summary ?? ''}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <p className="cx-sub">Cost uses CFO pricing and your billing tier (Settings → CFO). “unknown” = no verified price for that model — never guessed.</p>
    </Card>
  );
}

/* ---------------- Settings ---------------- */
interface BrandCfg { id: Brand; name: string; description: string; valueProposition: string; idealProfile: string; prospectCategories: string[]; geography: string; goals: string[]; metrics: string[]; messaging: { tone: string; must: string[]; mustNot: string[] }; safety: string; weights: Record<string, number> }
function GrowthSettings({ brand }: { brand: Brand }) {
  const { data, load } = useGrowth<{ brands: BrandCfg[]; channels: Record<string, { connected: boolean; note: string }> }>('/api/growth/brands');
  const sups = useGrowth<{ suppressions: { id: string; brand: string; kind: string; value: string; reason: string; created_at: string }[] }>(`/api/growth/suppressions?brand=${brand}`, [brand]);
  const [msg, setMsg] = useState<string | null>(null);
  const [geo, setGeo] = useState<string | null>(null);
  const [sup, setSup] = useState({ kind: 'email', value: '', reason: '' });
  const cfg = data?.brands.find((b) => b.id === brand);
  const save = async (patch: Record<string, unknown>) => {
    try {
      await post(`/api/growth/brands/${brand}`, patch, 'PUT');
      setMsg('✅ Saved');
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'failed');
    }
  };
  const addSup = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await post('/api/growth/suppressions', { brand: '*', ...sup });
      setSup({ ...sup, value: '', reason: '' });
      setMsg('✅ Added to do-not-contact list (all brands).');
      sups.load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'failed');
    }
  };
  const demo = async (on: boolean) => {
    try {
      const r = await post<{ created?: number; removed?: number }>('/api/growth/demo', {}, on ? 'POST' : 'DELETE');
      setMsg(`✅ ${on ? `${r.created} demo lead(s) added (labelled DEMO, never contacted)` : `${r.removed} demo lead(s) removed`}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'failed');
    }
  };
  return (
    <>
      <Notice msg={msg} />
      {cfg && (
        <Card title={`Brand profile · ${cfg.name}`}>
          <dl className="gr-dl">
            <div><dt>Description</dt><dd>{cfg.description}</dd></div>
            <div><dt>Value proposition</dt><dd>{cfg.valueProposition}</dd></div>
            <div><dt>Ideal customer / partner</dt><dd>{cfg.idealProfile}</dd></div>
            <div><dt>Categories</dt><dd>{cfg.prospectCategories.join(', ')}</dd></div>
            <div><dt>Geography</dt><dd>{geo === null ? <>{cfg.geography} <button className="btn btn-small" onClick={() => setGeo(cfg.geography)}>Edit</button></> : <span className="bu-rename"><input value={geo} onChange={(e) => setGeo(e.target.value)} /><button className="btn btn-small btn-primary" onClick={() => save({ geography: geo }).then(() => setGeo(null))}>Save</button></span>}</dd></div>
            <div><dt>Tone</dt><dd>{cfg.messaging.tone}</dd></div>
            <div><dt>Always</dt><dd>{cfg.messaging.must.join(' · ')}</dd></div>
            <div><dt>Never</dt><dd>{cfg.messaging.mustNot.join(' · ')}</dd></div>
            <div><dt>Safety</dt><dd>{cfg.safety}</dd></div>
            <div><dt>Score weights</dt><dd>{Object.entries(cfg.weights).map(([k, v]) => `${k} ${v}`).join(' · ')}</dd></div>
          </dl>
        </Card>
      )}
      <Card title="Integrations">
        <ul className="gr-list">
          <li>AI: Gemini (free tier) + Google Search grounding — set in ⚙️ Settings → API keys.</li>
          {data && Object.entries(data.channels).map(([k, c]) => <li key={k}>{k}: <span className={`pill ${c.connected ? 'pill-running' : 'pill-warn'}`}>{c.connected ? 'ready' : 'not connected'}</span> — {c.note}</li>)}
          <li>Calendar: not connected — meetings are tracked manually.</li>
        </ul>
      </Card>
      <Card title="Do-not-contact list">
        <form className="form" onSubmit={addSup}>
          <div className="form-row">
            <label>Type<select value={sup.kind} onChange={(e) => setSup({ ...sup, kind: e.target.value })}><option value="email">Email</option><option value="domain">Website / domain</option></select></label>
            <label>Value<input required value={sup.value} onChange={(e) => setSup({ ...sup, value: e.target.value })} /></label>
            <label>Reason<input required value={sup.reason} onChange={(e) => setSup({ ...sup, reason: e.target.value })} /></label>
          </div>
          <div className="modal-actions"><button className="btn btn-primary">Add</button></div>
        </form>
        {(sups.data?.suppressions ?? []).length > 0 && (
          <ul className="gr-list">{sups.data!.suppressions.map((s) => <li key={s.id}>{s.kind}: <code>{s.value}</code> — {s.reason} <span className="cx-sub">({s.brand === '*' ? 'all brands' : s.brand}, {formatWhen(s.created_at)})</span> <button className="btn btn-small" onClick={() => window.confirm('Remove from the list? Leads stay suppressed until you reactivate each one.') && post(`/api/growth/suppressions/${s.id}`, {}, 'DELETE').then(() => sups.load(), (e) => setMsg(e.message))}>Remove</button></li>)}</ul>
        )}
      </Card>
      <Card title="Demo mode">
        <p className="cx-sub">Adds a few fictional leads labelled DEMO to try the screens. They are excluded from every metric and can never be contacted.</p>
        <div className="nt-actions"><button className="btn btn-small" onClick={() => demo(true)}>Add demo leads</button><button className="btn btn-small" onClick={() => demo(false)}>Remove demo leads</button></div>
      </Card>
    </>
  );
}
