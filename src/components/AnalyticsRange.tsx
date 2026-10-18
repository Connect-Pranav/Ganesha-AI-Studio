// Range dropdown (hourly → all time) with a growth chart built from stored hourly fetches.
import { useEffect, useState } from 'react';
import { Card } from './ui';
import { loadHistory, type History, type Range } from '../services/analyticsService';
import type { ProductId } from '../types';

const RANGES: { id: Range; label: string }[] = [
  { id: '24h', label: 'Last 24 hours (hourly)' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 90 days' },
  { id: 'all', label: 'All time' },
];
const fmt = (n: number | null) => (n === null ? '—' : `${n > 0 ? '+' : ''}${n.toLocaleString('en-IN')}`);

function Line({ points, k, color }: { points: History['points']; k: 'views' | 'followers'; color: string }) {
  const vals = points.map((p) => p[k]).filter((v): v is number => typeof v === 'number');
  if (vals.length < 2) return null;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const t0 = Date.parse(points[0].at);
  const t1 = Date.parse(points[points.length - 1].at) || t0 + 1;
  const xy = points
    .filter((p) => typeof p[k] === 'number')
    .map((p) => `${(((Date.parse(p.at) - t0) / (t1 - t0 || 1)) * 600).toFixed(1)},${(150 - ((p[k]! - min) / (max - min || 1)) * 130 - 10).toFixed(1)}`);
  return <polyline points={xy.join(' ')} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />;
}

export function AnalyticsRange({ brand, labels }: { brand: ProductId; labels: { followers: string; views: string; posts: string } }) {
  const [range, setRange] = useState<Range>(() => {
    try {
      return (localStorage.getItem('gas.analytics.range') as Range) || '7d';
    } catch {
      return '7d';
    }
  });
  const [h, setH] = useState<History | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setErr(null);
    loadHistory(brand, range)
      .then((x) => alive && setH(x))
      .catch((e) => alive && setErr(e instanceof Error ? e.message : 'Failed'));
    try {
      localStorage.setItem('gas.analytics.range', range);
    } catch {
      /* ignore */
    }
    return () => {
      alive = false;
    };
  }, [brand, range]);

  return (
    <Card
      title="Growth over time"
      action={
        <select className="an-range" value={range} onChange={(e) => setRange(e.target.value as Range)} aria-label="Time range">
          {RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      }
    >
      {err && <p className="form-error">{err}</p>}
      {h && (
        <>
          <div className="an-range-stats">
            <span><strong>{fmt(h.change.views)}</strong> {labels.views}</span>
            <span><strong>{fmt(h.change.followers)}</strong> {labels.followers}</span>
            <span><strong>{fmt(h.change.posts)}</strong> {labels.posts}</span>
          </div>
          {h.points.length >= 2 ? (
            <svg className="an-chart" viewBox="0 0 600 160" preserveAspectRatio="none" role="img" aria-label={`${labels.views} and ${labels.followers} over the selected range`}>
              <Line points={h.points} k="views" color="#a78bfa" />
              <Line points={h.points} k="followers" color="#34d399" />
            </svg>
          ) : (
            <p className="cx-sub">Not enough history yet — Ganesha now saves a reading every hour, so this chart fills in automatically.</p>
          )}
          <p className="cx-sub">
            <span className="an-dot" style={{ background: '#a78bfa' }} /> {labels.views} · <span className="an-dot" style={{ background: '#34d399' }} /> {labels.followers} · {h.fetches} readings
            {h.from ? ` · ${new Date(h.from).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} → ${new Date(h.to!).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
          </p>
        </>
      )}
    </Card>
  );
}
