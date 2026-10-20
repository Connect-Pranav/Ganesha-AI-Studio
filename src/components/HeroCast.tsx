// Home hero: the three channels on a glowing horizon, each with its own live numbers from
// SOMA (/api/analytics/:brand). Tapping a channel opens its workspace on "Progress & analytics".
// A channel without a connected source says so — no number is invented.
import { useEffect, useState } from 'react';
import { loadAnalytics, type AnalyticsReport } from '../services/analyticsService';
import { BrandMark } from './BrandMark';

type Brand = 'littleloop' | 'sunverse' | 'foliocraft';
const CHANNELS: { id: Brand; name: string; where: string }[] = [
  { id: 'littleloop', name: 'LittleLoop', where: 'Instagram' },
  { id: 'sunverse', name: 'Surverse', where: 'YouTube' },
  { id: 'foliocraft', name: 'Foliocraft', where: 'Website' },
];

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; r: AnalyticsReport };
const fmt = (v: number | null | undefined) => {
  if (v === null || v === undefined) return '—';
  const a = Math.abs(v);
  const s = a >= 1e7 ? `${(a / 1e7).toFixed(1)}Cr` : a >= 1e5 ? `${(a / 1e5).toFixed(1)}L` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : String(a);
  return v < 0 ? `-${s}` : s;
};

function ChannelCard({ c, i, onOpen }: { c: (typeof CHANNELS)[number]; i: number; onOpen: (v: Brand) => void }) {
  const [st, setSt] = useState<State>({ status: 'loading' });
  useEffect(() => {
    let alive = true;
    loadAnalytics(c.id)
      .then((r) => alive && setSt({ status: 'ready', r }))
      .catch(() => alive && setSt({ status: 'error' }));
    return () => {
      alive = false;
    };
  }, [c.id]);

  const r = st.status === 'ready' ? st.r : null;
  const ch = r?.connected ? r.channel : undefined;
  const ig = r?.platform === 'instagram';
  const growth = r?.summary?.growth?.subscribers;
  return (
    <button className="hc-ch" style={{ ['--i' as string]: i - 1 }} onClick={() => onOpen(c.id)} aria-label={`Open ${c.name} progress`}>
      <BrandMark id={c.id} size={150} className="hc-ch-logo" />
      <span className="hc-ch-name">{c.name}</span>
      <span className="hc-ch-where">{r?.platform === 'youtube' ? 'YouTube' : ig ? 'Instagram' : c.where}</span>
      <span className="hc-ch-stats">
        {st.status === 'loading' ? (
          <span className="hc-ch-note">Loading…</span>
        ) : ch ? (
          <>
            <span>
              <b>{ch.subscribersHidden ? 'Hidden' : fmt(ch.subscribers)}</b>
              <i>{ig ? 'followers' : 'subscribers'}</i>
            </span>
            <span>
              <b>{fmt(ch.totalViews)}</b>
              <i>views</i>
            </span>
            <span>
              <b>{fmt(r?.summary?.last30Days.views)}</b>
              <i>last 30 days</i>
            </span>
          </>
        ) : (
          <span className="hc-ch-note">{st.status === 'error' ? 'Numbers unavailable right now' : 'Not connected yet'}</span>
        )}
      </span>
      {ch && typeof growth === 'number' && (
        <span className={`hc-ch-delta ${growth < 0 ? 'down' : ''}`}>
          {growth >= 0 ? '+' : ''}
          {fmt(growth)} {ig ? 'followers' : 'subs'}
        </span>
      )}
    </button>
  );
}

export function HeroCast({ onOpen }: { onOpen: (v: Brand) => void }) {
  return (
    <div className="hc hc-tall">
      <div className="hc-row hc-channels">
        {CHANNELS.map((c, i) => (
          <ChannelCard key={c.id} c={c} i={i} onOpen={onOpen} />
        ))}
      </div>
      <div className="hc-horizon" aria-hidden="true" />
    </div>
  );
}
