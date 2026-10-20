// MUSHAK daily report: everything the Growth agent did on one IST day — every agent job (with tokens,
// cost, result or error) and every pipeline event — from the Worker's saved records.
import { useCallback, useEffect, useState } from 'react';
import { api, AUTH_EVENT, getToken } from '../services/adminService';
import { BrandMark } from './BrandMark';

interface Job { id: string; at: string; brand: string; agent: string; kind: string; what: string; campaign: string | null; lead: string | null; status: string; attempts: number; model: string | null; tokens: { input: number | null; output: number | null } | null; costUsd: number | null; result: string | null; error: string | null }
interface Ev { id: string; at: string; brand: string; kind: string; lead: string | null; campaign: string | null; from: string | null; to: string | null; note: string | null; actor: string }
interface Report {
  day: string;
  headline: string;
  counts: Record<string, number>;
  cost: { usd: number; inr: number | null; unknownCostJobs: number };
  tokens: { input: number; output: number };
  byBrand: Record<string, { jobs: number; leadsFound: number; drafts: number; sent: number; replies: number; costUsd: number }>;
  waitingForYouNow: number;
  jobs: Job[];
  timeline: Ev[];
  note: string;
}

const BRAND_NAME: Record<string, string> = { littleloop: 'LittleLoop', sunverse: 'Sunverse', foliocraft: 'Foliocraft' };
const EV_LABEL: Record<string, string> = {
  lead_created: 'Lead added', researched: 'Research done', qualified: 'Lead scored', draft_created: 'Draft written', draft_approved: 'You approved a draft',
  draft_rejected: 'You rejected a draft', approval_invalidated: 'Edited after approval', message_sent: 'Message sent', send_failed: 'Send failed', reply_received: 'Reply received',
  meeting_confirmed: 'Meeting confirmed', meeting_proposed: 'Meeting proposed', suppressed: 'Do-not-contact', discovery_run: 'Lead search finished', campaign_created: 'Campaign created',
  campaign_activate: 'Campaign activated', campaign_pause: 'Campaign paused', campaign_resume: 'Campaign resumed', campaign_cancel: 'Campaign cancelled', campaign_complete: 'Campaign completed',
  stage_changed: 'Stage changed', lead_edited: 'Lead edited', task_added: 'Task added',
};
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const dayLabel = (d: string) => new Date(`${d}T00:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
const money = (usd: number, inr: number | null) => (inr !== null ? `₹${inr.toFixed(2)}` : `$${usd.toFixed(4)}`);

export function MushakDaily() {
  const [days, setDays] = useState<{ day: string; events: number }[]>([]);
  const [day, setDay] = useState<string | null>(null);
  const [rep, setRep] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [locked, setLocked] = useState(!getToken());

  const loadDays = useCallback(() => {
    const has = Boolean(getToken());
    setLocked(!has);
    if (!has) return;
    api<{ days: { day: string; events: number }[] }>('/api/growth/days')
      .then((r) => {
        setDays(r.days);
        setDay((d) => d ?? r.days[0]?.day ?? null);
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : 'Could not load days'));
  }, []);
  useEffect(() => {
    loadDays();
    window.addEventListener(AUTH_EVENT, loadDays);
    return () => window.removeEventListener(AUTH_EVENT, loadDays);
  }, [loadDays]);
  useEffect(() => {
    if (!day) return;
    setRep(null);
    api<Report>(`/api/growth/daily?date=${day}`)
      .then(setRep)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : 'Could not load the report'));
  }, [day]);

  if (locked) return <p className="ai-note">Unlock the studio to see Mushak’s daily reports.</p>;
  if (err) return <p className="form-error">{err}</p>;
  const c = rep?.counts;
  return (
    <div className="mk">
      <div className="mk-days" role="tablist" aria-label="Report day">
        {days.map((d) => (
          <button key={d.day} role="tab" aria-selected={day === d.day} className={`gx-chip ${day === d.day ? 'active' : ''}`} onClick={() => setDay(d.day)}>
            {dayLabel(d.day)}
            {d.events > 0 && <span className="tab-count">{d.events}</span>}
          </button>
        ))}
      </div>
      {!rep || !c ? (
        <p className="ai-note">Loading report…</p>
      ) : (
        <>
          <p className="mk-headline">{rep.headline}</p>
          <div className="gs-kpis mk-kpis">
            {[
              ['Agent jobs', `${c.jobs}`, c.jobsFailed || c.jobsBlocked ? `${c.jobsFailed} failed · ${c.jobsBlocked} stopped by limits` : 'all ok'],
              ['Leads found', `${c.leadsFound}`, `${c.searches} search(es)`],
              ['Researched / scored', `${c.researched} / ${c.scored}`, `${c.qualified} qualified`],
              ['Drafts written', `${c.drafts}`, `${c.approved} approved · ${c.rejected} rejected`],
              ['Sent', `${c.sent}`, 'only after your approval'],
              ['Replies', `${c.replies}`, `${c.meetings} meeting(s) · ${c.optOuts} opt-out(s)`],
              ['Won / lost', `${c.won} / ${c.lost}`, ''],
              ['AI cost', money(rep.cost.usd, rep.cost.inr), `${(rep.tokens.input + rep.tokens.output).toLocaleString('en-IN')} tokens${rep.cost.unknownCostJobs ? ` · ${rep.cost.unknownCostJobs} unpriced` : ''}`],
            ].map(([k, v, h]) => (
              <div key={k} className="gs-kpi">
                <b>{v}</b>
                <span>{k}</span>
                {h && <i className="mk-hint">{h}</i>}
              </div>
            ))}
          </div>
          {rep.waitingForYouNow > 0 && <p className="cx-warn-text">{rep.waitingForYouNow} draft(s) are waiting for your approval right now (Growth → Approvals).</p>}

          <h3 className="ag-h">By brand</h3>
          <table className="gs-table">
            <thead>
              <tr><th>Brand</th><th>Jobs</th><th>Leads</th><th>Drafts</th><th>Sent</th><th>Replies</th><th>Cost</th></tr>
            </thead>
            <tbody>
              {Object.entries(rep.byBrand).map(([b, m]) => (
                <tr key={b}>
                  <td><span className="gs-brand"><BrandMark id={b} size={22} iconSize={14} />{BRAND_NAME[b] ?? b}</span></td>
                  <td>{m.jobs}</td><td>{m.leadsFound}</td><td>{m.drafts}</td><td>{m.sent}</td><td>{m.replies}</td><td>${m.costUsd.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 className="ag-h">Agent work, step by step ({rep.jobs.length})</h3>
          {rep.jobs.length === 0 ? (
            <p className="ai-note">No agent jobs ran on this day.</p>
          ) : (
            <ol className="mk-list">
              {rep.jobs.map((j) => (
                <li key={j.id} className={`mk-job st-${j.status}`}>
                  <span className="mk-time">{time(j.at)}</span>
                  <div>
                    <p>
                      <strong>{j.agent}</strong> · {j.what}
                      {j.lead ? ` · ${j.lead}` : ''}
                      {j.campaign ? ` · campaign “${j.campaign}”` : ''} · <span className="mk-brand">{BRAND_NAME[j.brand] ?? j.brand}</span>
                    </p>
                    <p className="cx-sub">
                      <span className={`pill ${j.status === 'succeeded' ? 'pill-running' : j.status === 'running' ? 'pill-idle' : 'pill-warn'}`}>{j.status}</span>{' '}
                      {j.error ?? j.result ?? ''}
                      {j.tokens ? ` · ${j.tokens.input ?? '—'} in / ${j.tokens.output ?? '—'} out tokens` : ''}
                      {j.costUsd !== null ? ` · $${j.costUsd.toFixed(5)}` : j.status === 'succeeded' ? ' · cost unknown' : ''}
                      {j.model ? ` · ${j.model}` : ''}
                      {j.attempts > 1 ? ` · ${j.attempts} attempts` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}

          <h3 className="ag-h">Everything that happened ({rep.timeline.length})</h3>
          {rep.timeline.length === 0 ? (
            <p className="ai-note">No pipeline events on this day.</p>
          ) : (
            <ol className="mk-list">
              {rep.timeline.map((e) => (
                <li key={e.id}>
                  <span className="mk-time">{time(e.at)}</span>
                  <p>
                    <strong>{EV_LABEL[e.kind] ?? e.kind.replace(/_/g, ' ')}</strong>
                    {e.lead ? ` · ${e.lead}` : e.campaign ? ` · ${e.campaign}` : ''}
                    {e.from || e.to ? ` (${(e.from ?? '—').replace(/_/g, ' ')} → ${(e.to ?? '—').replace(/_/g, ' ')})` : ''}
                    {e.note ? ` — ${e.note}` : ''} <span className="cx-sub">· {BRAND_NAME[e.brand] ?? e.brand} · by {e.actor}</span>
                  </p>
                </li>
              ))}
            </ol>
          )}
          <p className="ai-note">{rep.note}</p>
        </>
      )}
    </div>
  );
}
