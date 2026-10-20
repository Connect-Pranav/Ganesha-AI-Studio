// MUSHAK 4-hour reports: each autopilot cycle with what went in (inputs), what was planned and why
// (plan), and what came out (outputs). Owner can switch autopilot, change the interval, or run now.
import { useCallback, useEffect, useState } from 'react';
import { api, AUTH_EVENT, getToken } from '../services/adminService';
import { BrandMark } from './BrandMark';
import { formatWhen } from './ui';

interface Step { id: string; kind: string; agent: string; brand: string; campaign: string; lead?: string; count?: number; why: string; status: string; startedAt?: string; finishedAt?: string; result?: { text: string; leads?: { name: string; website: string | null; category: string | null; sources: string[] }[]; summary?: string; sources?: string[]; score?: number; missing?: string[]; subject?: string; preview?: string; draftId?: string } }
interface CampState { id: string; brand: string; name: string; objective: string; leads: number; maxLeads: number; unresearched: number; unscored: number; readyToDraft: number; waitingApproval: number; jobsToday: number; dailyJobLimit: number; threshold: number }
interface Cycle {
  id: string;
  trigger: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  inputs: { campaigns?: CampState[]; openedCampaigns?: { brand: string; campaign: string; objective: string }[]; waitingForApproval?: number; rules?: string[]; problem?: string };
  plan: Step[];
  outputs: { stepsPlanned: number; stepsDone: number; stepsFailed: number; stepsSkipped: number; leadsFound: number; researched: number; scored: number; draftsForApproval: { lead: string; subject: string }[]; costUsd: number; tokens: number } | null;
  summary: string | null;
  error: string | null;
}
interface Data { settings: { autopilot: boolean; everyHours: number; maxSteps: number }; nextRunAt: string | null; cycles: Cycle[] }

const KIND: Record<string, string> = { discover: 'Find new leads', research: 'Research', qualify: 'Score', draft: 'Write outreach draft' };
const BRAND: Record<string, string> = { littleloop: 'LittleLoop', sunverse: 'Sunverse', foliocraft: 'Foliocraft' };
const ist = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const pill = (s: string) => (s === 'done' ? 'pill-running' : s === 'running' || s === 'pending' ? 'pill-idle' : 'pill-warn');

function CycleCard({ c, open, onToggle }: { c: Cycle; open: boolean; onToggle: () => void }) {
  const o = c.outputs;
  return (
    <li className={`mc-cycle st-${c.status}`}>
      <button className="mc-head" onClick={onToggle} aria-expanded={open}>
        <span className="mc-when">
          {ist(c.startedAt)}
          {c.finishedAt ? ` → ${new Date(c.finishedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}` : ''}
        </span>
        <span className={`pill ${pill(c.status)}`}>{c.status === 'running' ? `running ${c.plan.filter((p) => p.status !== 'pending').length}/${c.plan.length}` : c.status}</span>
        <span className="mc-sum">{c.summary ?? (c.status === 'running' ? 'Working…' : '')}</span>
        <span className="cx-sub">{c.trigger === 'schedule' ? 'auto' : 'manual'} {open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mc-body">
          <section>
            <h4 className="ag-h">1 · Inputs: what Mushak saw</h4>
            {c.inputs.problem && <p className="form-error">{c.inputs.problem}</p>}
            {(c.inputs.openedCampaigns?.length ?? 0) > 0 && (
              <p className="cx-sub">Opened starter campaign(s): {c.inputs.openedCampaigns!.map((x) => `${BRAND[x.brand]} · ${x.campaign}`).join('; ')} (edit or pause them in Campaigns).</p>
            )}
            {(c.inputs.campaigns?.length ?? 0) > 0 ? (
              <div className="gr-table-wrap">
                <table className="gs-table mc-table">
                  <thead>
                    <tr><th>Campaign</th><th>Leads</th><th>To research</th><th>To score</th><th>To draft</th><th>Waiting you</th><th>Jobs today</th></tr>
                  </thead>
                  <tbody>
                    {c.inputs.campaigns!.map((k) => (
                      <tr key={k.id}>
                        <td><span className="gs-brand"><BrandMark id={k.brand} size={20} iconSize={12} />{k.name}</span></td>
                        <td>{k.leads}/{k.maxLeads}</td><td>{k.unresearched}</td><td>{k.unscored}</td><td>{k.readyToDraft}</td><td>{k.waitingApproval}</td><td>{k.jobsToday}/{k.dailyJobLimit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              !c.inputs.problem && <p className="ai-note">No active campaign.</p>
            )}
            {c.inputs.rules && <ul className="bullets mc-rules">{c.inputs.rules.map((r) => <li key={r}>{r}</li>)}</ul>}
          </section>

          <section>
            <h4 className="ag-h">2 · Plan: what it decided and why ({c.plan.length} step{c.plan.length === 1 ? '' : 's'})</h4>
            {c.plan.length === 0 ? <p className="ai-note">Nothing needed doing.</p> : (
              <ol className="mc-plan">
                {c.plan.map((s) => (
                  <li key={s.id}>
                    <span className={`pill ${pill(s.status)}`}>{s.status}</span>{' '}
                    <strong>{s.agent}</strong> · {KIND[s.kind] ?? s.kind}{s.lead ? ` · ${s.lead}` : s.count ? ` · ${s.count} leads` : ''} <span className="cx-sub">· {BRAND[s.brand]}</span>
                    <p className="cx-sub">Why: {s.why}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section>
            <h4 className="ag-h">3 · Output: what came out</h4>
            {o && (
              <div className="gs-kpis mc-kpis">
                {[
                  ['Leads found', o.leadsFound],
                  ['Researched', o.researched],
                  ['Scored', o.scored],
                  ['Drafts for you', o.draftsForApproval.length],
                  ['Steps done', `${o.stepsDone}/${o.stepsPlanned}`],
                  ['Failed / skipped', `${o.stepsFailed} / ${o.stepsSkipped}`],
                  ['Tokens', o.tokens.toLocaleString('en-IN')],
                  ['AI cost', `$${o.costUsd.toFixed(4)}`],
                ].map(([k, v]) => (
                  <div key={k as string} className="gs-kpi"><b>{v}</b><span>{k}</span></div>
                ))}
              </div>
            )}
            <ol className="mc-out">
              {c.plan.filter((s) => s.result).map((s) => (
                <li key={s.id} className={`st-${s.status}`}>
                  <p><strong>{s.agent}</strong> · {s.finishedAt ? new Date(s.finishedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : ''} · {s.result!.text}</p>
                  {s.result!.leads && s.result!.leads.length > 0 && (
                    <ul className="mc-leads">
                      {s.result!.leads.map((l) => (
                        <li key={l.name}>
                          {l.name}{l.category ? ` · ${l.category}` : ''}{' '}
                          {l.sources[0] && <a href={l.sources[0]} target="_blank" rel="noreferrer">source</a>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {s.result!.summary && <p className="cx-sub">{s.result!.summary}</p>}
                  {s.result!.missing && s.result!.missing.length > 0 && <p className="cx-sub">Missing evidence: {s.result!.missing.join(', ')}</p>}
                  {s.result!.preview && <pre className="fp-prompt mc-preview">{s.result!.preview}…</pre>}
                </li>
              ))}
            </ol>
            {o && o.draftsForApproval.length > 0 && <p className="cx-warn-text">{o.draftsForApproval.length} draft(s) are waiting for your approval in Growth → Approvals. Nothing is sent until you approve.</p>}
            {c.error && <p className="form-error">{c.error}</p>}
          </section>
        </div>
      )}
    </li>
  );
}

export function MushakCycles() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [locked, setLocked] = useState(!getToken());

  const load = useCallback(() => {
    const has = Boolean(getToken());
    setLocked(!has);
    if (!has) return;
    api<Data>('/api/growth/cycles')
      .then((d) => {
        setData(d);
        setErr(null);
        setOpenId((x) => x ?? d.cycles[0]?.id ?? null);
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : 'Could not load reports'));
  }, []);
  useEffect(() => {
    load();
    window.addEventListener(AUTH_EVENT, load);
    return () => window.removeEventListener(AUTH_EVENT, load);
  }, [load]);
  const running = data?.cycles.some((c) => c.status === 'running');
  useEffect(() => {
    if (!running) return;
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [running, load]);

  const save = async (patch: Record<string, unknown>) => {
    try {
      await api('/api/growth/autopilot', { method: 'PUT', body: JSON.stringify(patch) });
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save');
    }
  };
  const runNow = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ cycle: Cycle }>('/api/growth/cycles/run', { method: 'POST', body: '{}' });
      setOpenId(r.cycle.id);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not start');
    } finally {
      setBusy(false);
    }
  };

  if (locked) return <p className="ai-note">Unlock the studio to see Mushak’s 4-hour reports.</p>;
  if (!data) return err ? <p className="form-error">{err}</p> : <p className="ai-note">Loading…</p>;
  const s = data.settings;
  return (
    <div className="mc">
      <div className="mc-bar">
        <label className="st-check">
          <input type="checkbox" checked={s.autopilot} onChange={(e) => save({ autopilot: e.target.checked })} /> <strong>Autopilot {s.autopilot ? 'ON' : 'OFF'}</strong>
        </label>
        <label className="mc-every">
          every
          <select value={s.everyHours} onChange={(e) => save({ everyHours: Number(e.target.value) })}>
            {[1, 2, 3, 4, 6, 8, 12, 24].map((h) => <option key={h} value={h}>{h} h</option>)}
          </select>
        </label>
        <span className="cx-sub">{s.autopilot && data.nextRunAt ? `next run ${new Date(data.nextRunAt) <= new Date() ? 'within 5 min' : ist(data.nextRunAt)}` : 'paused'} · up to {s.maxSteps} steps per run</span>
        <button className="btn btn-small btn-primary" onClick={runNow} disabled={busy || running}>{running ? 'Running…' : busy ? 'Starting…' : 'Run now'}</button>
      </div>
      {err && <p className="form-error">{err}</p>}
      {data.cycles.length === 0 ? (
        <p className="ai-note">No runs yet. The first automatic run starts within 5 minutes, or press Run now.</p>
      ) : (
        <ul className="mc-list">
          {data.cycles.map((c) => (
            <CycleCard key={c.id} c={c} open={openId === c.id} onToggle={() => setOpenId(openId === c.id ? null : c.id)} />
          ))}
        </ul>
      )}
      <p className="ai-note">Each run: score → draft → research → find new leads, inside your campaign limits. Mushak never approves or sends; drafts wait for you. Times are IST.</p>
    </div>
  );
}

/** One line for the Home banner: autopilot state, last run, next run. */
export function useMushakStatus() {
  const [line, setLine] = useState<string | null>(null);
  useEffect(() => {
    const load = () => {
      if (!getToken()) return setLine(null);
      api<Data>('/api/growth/cycles')
        .then((d) => {
          const last = d.cycles[0];
          const next = d.settings.autopilot && d.nextRunAt ? (new Date(d.nextRunAt) <= new Date() ? 'next run within 5 min' : `next run ${ist(d.nextRunAt)}`) : 'autopilot paused';
          setLine(last ? `${last.status === 'running' ? 'Working now' : `Last run ${formatWhen(last.startedAt)}`}: ${last.summary ?? '…'} · ${next}` : `Autopilot ${d.settings.autopilot ? `on, every ${d.settings.everyHours} h` : 'off'} · ${next}`);
        })
        .catch(() => setLine(null));
    };
    load();
    window.addEventListener(AUTH_EVENT, load);
    const t = setInterval(load, 60_000);
    return () => {
      window.removeEventListener(AUTH_EVENT, load);
      clearInterval(t);
    };
  }, []);
  return line;
}
