// Sunverse monetization tracker (owner-only): the progress history the Worker records once a day
// from YouTube Analytics, plus the core YPP requirements YouTube has no API for, which the owner
// ticks after checking YouTube Studio. Nothing here is estimated or pre-ticked.
import { useCallback, useEffect, useState } from 'react';
import { api, AUTH_EVENT, getToken } from '../services/adminService';
import { Card, EmptyState, formatWhen } from './ui';

export interface CoreCheck { id: string; label: string; done: boolean; updatedAt: string | null }
export interface Snapshot { day: string; totalHours365: number; longFormHours365: number | null; shortsViews90: number | null }
export interface TrackerData { checklist: CoreCheck[]; history: Snapshot[]; ypp?: { tiers?: { label: string; hours: number }[] } }
interface Bars { hours: number; label: string }

const fmt = (v: number, d = 0) => v.toLocaleString('en-IN', { maximumFractionDigits: d });
export const TRACKER_EVENT = 'ganesha:ypp-tracker';

function HistoryChart({ history, bars }: { history: Snapshot[]; bars: Bars[] }) {
  const W = 1100;
  const H = 240;
  const pts = history.map((h) => ({ day: h.day, v: h.longFormHours365 ?? h.totalHours365, total: h.longFormHours365 === null }));
  const top = Math.max(...bars.map((b) => b.hours), ...pts.map((p) => p.v)) * 1.05;
  const x = (i: number) => (pts.length === 1 ? W / 2 : 8 + (i * (W - 16)) / (pts.length - 1));
  const y = (v: number) => H - 18 - (v / top) * (H - 30);
  return (
    <svg className="ypp-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Watch hours over ${pts.length} tracked days`}>
      {bars.map((b) => (
        <g key={b.label}>
          <line x1={0} x2={W} y1={y(b.hours)} y2={y(b.hours)} className="ypp-goal" />
          <text x={W - 4} y={y(b.hours) - 4} textAnchor="end" className="ypp-goal-label">
            {b.label} · {fmt(b.hours)} hrs
          </text>
        </g>
      ))}
      {pts.length > 1 && <polyline key={pts.length} className="chart-draw ypp-line" pathLength={1} points={pts.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')} />}
      {pts.map((p, i) => (
        <circle key={p.day} cx={x(i)} cy={y(p.v)} r={pts.length > 60 ? 1.5 : 3} className={`ypp-dot ${p.total ? 'total' : ''}`}>
          <title>{`${p.day}: ${fmt(p.v, 1)} hrs${p.total ? ' (total incl. Shorts)' : ' long-form'}`}</title>
        </circle>
      ))}
    </svg>
  );
}

export function YppTracker() {
  const [data, setData] = useState<TrackerData | null>(null);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState('');
  const load = useCallback(() => {
    if (!getToken()) return setData(null);
    api<TrackerData>('/api/youtube/ypp')
      .then((d) => (setData(d), setErr('')))
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : 'Could not load the tracker'));
  }, []);
  useEffect(() => {
    load();
    window.addEventListener(AUTH_EVENT, load);
    return () => window.removeEventListener(AUTH_EVENT, load);
  }, [load]);

  const toggle = async (c: CoreCheck) => {
    setSaving(c.id);
    try {
      const d = await api<TrackerData>('/api/youtube/ypp/checklist', { method: 'PUT', body: JSON.stringify({ id: c.id, done: !c.done }) });
      setData(d);
      setErr('');
      window.dispatchEvent(new Event(TRACKER_EVENT));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving('');
    }
  };

  if (!getToken())
    return (
      <Card title="Monetization tracker">
        <EmptyState title="Unlock the studio to track monetization" hint="Progress history and the requirement checklist are private (bell → Unlock)." />
      </Card>
    );
  if (!data) return <Card title="Monetization tracker">{err ? <p className="form-error">{err}</p> : <p className="ai-note">Loading…</p>}</Card>;

  const bars: Bars[] = (data.ypp?.tiers ?? []).map((t) => ({ label: t.label, hours: t.hours }));
  const h = data.history;
  const first = h[0];
  const last = h[h.length - 1];
  const val = (s: Snapshot) => s.longFormHours365 ?? s.totalHours365;
  const ticked = data.checklist.filter((c) => c.done).length;
  return (
    <Card title="Monetization tracker">
      {err && <p className="form-error">{err}</p>}
      <h4 className="ypp-sub">Progress history</h4>
      {h.length === 0 ? (
        <EmptyState title="No snapshots yet" hint="Once YouTube Analytics is connected, the studio saves one snapshot a day automatically. Opening the Watch time card also saves today's." />
      ) : (
        <>
          <HistoryChart history={h} bars={bars} />
          <p className="ai-note">
            {h.length} day{h.length === 1 ? '' : 's'} tracked since {first.day} · latest {last.day}: {fmt(val(last), 1)} hrs
            {last.longFormHours365 === null ? ' (total incl. Shorts)' : ' long-form'}
            {last.shortsViews90 !== null && ` · ${fmt(last.shortsViews90)} Shorts views (90 days)`}
            {h.length > 1 && ` · ${val(last) - val(first) >= 0 ? '+' : ''}${fmt(val(last) - val(first), 1)} hrs since ${first.day}`}
          </p>
        </>
      )}

      <h4 className="ypp-sub">
        Core requirements <span className="ypp-count">{ticked} / {data.checklist.length} confirmed</span>
      </h4>
      <p className="ai-note">YouTube has no API for these. Check them in YouTube Studio → Earn, then tick here.</p>
      <ul className="ypp-checks">
        {data.checklist.map((c) => (
          <li key={c.id}>
            <label className={c.done ? 'done' : ''}>
              <input type="checkbox" checked={c.done} disabled={saving === c.id} onChange={() => toggle(c)} />
              <span>{c.label}</span>
              {c.updatedAt && <small>{formatWhen(c.updatedAt)}</small>}
            </label>
          </li>
        ))}
      </ul>
    </Card>
  );
}
