// CBO Autopilot: the CBO picks the studio's next goals from real records and starts them itself
// within your limits — or lines them up for one tap.
import { useState } from 'react';
import { Card, EmptyState, productNames } from '../ui';
import { autopilot, dateShort, money, useLoad } from '../../services/cboService';
import { Pill, useAction } from './common';

const STATUS: Record<string, { label: string; cls: string }> = {
  started: { label: 'Started by SAARTHI', cls: 'pill-running' },
  proposed: { label: 'Waiting for your tap', cls: 'pill-warn' },
  rejected: { label: 'Skipped', cls: 'pill-idle' },
  expired: { label: 'Expired', cls: 'pill-idle' },
};

export function AutopilotCard({ onChanged }: { onChanged: () => void }) {
  const l = useLoad(() => autopilot.get());
  const act = useAction();
  const [msg, setMsg] = useState<string | null>(null);
  const [cap, setCap] = useState<string | null>(null);
  if (!l.data) return null;
  const d = l.data;
  const reload = () => (l.reload(), onChanged());
  const waiting = d.proposals.filter((p) => p.status === 'proposed');
  return (
    <Card
      title="SAARTHI Autopilot"
      className="cc-cbo-card"
      action={
        <button className="btn btn-small btn-primary" disabled={act.busy === 'run' || d.mode === 'off'} onClick={() => act.run('run', async () => { const r = await autopilot.run(); setMsg(r.actions.length ? `${r.actions.length} goal(s): ${r.actions.map((a) => `${a.title} → ${a.status}`).join('; ')}` : r.note ?? 'Nothing new to do right now — every brand already has work in progress or is within its cadence.'); }, reload)}>
          {act.busy === 'run' ? 'Thinking…' : 'Plan next work now'}
        </button>
      }
    >
      <p className="cx-sub">
        Every morning (9:00 IST) GANESHA picks the next goals from real records — SOMA’s YouTube data, each brand’s last goal and open work — and assigns them to the agents. Publishing and spending steps still stop for you.
      </p>
      <div className="form form-row cx-wrap cx-top cx-autopilot-controls">
        <label className="cx-inline">
          <span>Mode</span>
          <select value={d.mode} onChange={(e) => act.run('mode', () => autopilot.save({ autopilotMode: e.target.value }), reload)}>
            <option value="auto">Auto — start within my limit</option>
            <option value="suggest">Suggest — I tap to start</option>
            <option value="off">Off</option>
          </select>
        </label>
        <label className="cx-inline">
          <span>Daily limit ₹</span>
          <input type="number" min={0} step="1" style={{ width: 90 }} value={cap ?? String(d.dailyInr)} onChange={(e) => setCap(e.target.value)} onBlur={() => cap !== null && Number(cap) !== d.dailyInr && act.run('cap', () => autopilot.save({ autopilotDailyInr: Number(cap) }), () => (setCap(null), reload()))} />
        </label>
        <label className="cx-inline">
          <span>Goals / day</span>
          <select value={d.maxGoals} onChange={(e) => act.run('max', () => autopilot.save({ autopilotMaxGoals: Number(e.target.value) }), reload)}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>
      {d.mode === 'auto' && d.dailyInr === 0 && (
        <p className="cx-warn-text">Limit ₹0: only work that is provably free starts by itself (mark Gemini as “free tier” in CFO → Settings if your key is free). Anything that may cost money waits for one tap below.</p>
      )}
      {act.error && <p className="form-error">{act.error}</p>}
      {msg && <p className="cx-ok">{msg}</p>}
      {d.proposals.length === 0 ? (
        <EmptyState title="No autopilot goals yet." hint="Press “Plan next work now”, or wait for the 9:00 IST run." />
      ) : (
        <ul className="cx-list cx-top">
          {d.proposals.slice(0, 8).map((p) => (
            <li key={p.id}>
              <div className="cx-li-main">
                <p>
                  <Pill cls={STATUS[p.status].cls}>{STATUS[p.status].label}</Pill> <strong>{p.title}</strong> <span className="cx-sub">· {productNames[p.brand as keyof typeof productNames] ?? p.brand}</span>
                </p>
                <p className="cx-sub">Why: {p.reason}</p>
                {p.evidence.length > 0 && <p className="cx-sub">Evidence: {p.evidence.join(' · ')}</p>}
                <p className="cx-sub">
                  Estimated up to {money(p.est_inr, p.est_usd)} · {dateShort(p.created_at)}
                </p>
              </div>
              {p.status === 'proposed' && (
                <div className="cx-actions">
                  <button className="btn btn-small btn-primary" disabled={!!act.busy} onClick={() => act.run(p.id, () => autopilot.decide(p.id, 'approve'), reload)}>
                    Start
                  </button>
                  <button className="btn btn-small" disabled={!!act.busy} onClick={() => act.run(p.id, () => autopilot.decide(p.id, 'reject'), reload)}>
                    Skip
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {waiting.length > 1 && (
        <button className="btn btn-small btn-primary cx-top" disabled={!!act.busy} onClick={() => act.run('all', async () => { for (const p of waiting) await autopilot.decide(p.id, 'approve'); }, reload)}>
          Start all {waiting.length}
        </button>
      )}
    </Card>
  );
}
