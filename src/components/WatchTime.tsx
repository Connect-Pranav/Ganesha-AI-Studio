// Sunverse watch time (owner-only): YouTube Analytics API after a one-time Google sign-in.
// Shows lifetime / 365-day / 28-day watch hours, average view duration, a 28-day daily chart and
// progress to the YouTube Partner Program watch-hour bar. Nothing here is estimated by Ganesha.
import { useCallback, useEffect, useState } from 'react';
import { api, AUTH_EVENT, getToken } from '../services/adminService';
import { Card, EmptyState, LiveBadge, formatWhen } from './ui';
import { Icon } from './Icon';

interface Totals { views: number; watchHours: number; avgViewSeconds: number | null }
interface Report {
  connected: boolean;
  problem?: string | null;
  appConfigured?: boolean;
  missing?: string[];
  redirectUri?: string;
  channelTitle?: string | null;
  fetchedAt?: string;
  lifetime?: Totals;
  last365?: Totals;
  last28?: Totals;
  daily?: { day: string; views: number; watchHours: number }[];
  ypp: { hours: number; subscribers: number; note: string };
  notes?: string[];
}

const hrs = (v: number | undefined) => (v === undefined ? '—' : v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v.toLocaleString('en-IN', { maximumFractionDigits: 1 }));
const dur = (s: number | null | undefined) => (s === null || s === undefined ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);

type WatchState = { s: 'locked' } | { s: 'loading' } | { s: 'error'; m: string } | { s: 'ready'; r: Report };

/** Loads the owner-only watch time report; reloads when the studio is unlocked. */
function useWatchTime() {
  const [state, setState] = useState<WatchState>({ s: getToken() ? 'loading' : 'locked' });
  const load = useCallback((refresh = false) => {
    if (!getToken()) return setState({ s: 'locked' });
    setState((x) => (x.s === 'ready' ? x : { s: 'loading' }));
    api<Report>(`/api/youtube/watchtime${refresh ? '?refresh=1' : ''}`)
      .then((r) => setState({ s: 'ready', r }))
      .catch((e: unknown) => setState({ s: 'error', m: e instanceof Error ? e.message : 'Could not load watch time' }));
  }, []);
  useEffect(() => {
    load();
    const on = () => load();
    window.addEventListener(AUTH_EVENT, on);
    return () => window.removeEventListener(AUTH_EVENT, on);
  }, [load]);
  return { state, setState, load };
}

/** Compact channel watch time card for the Sunverse workspace. Same data as the full panel in Progress. */
export function WatchTimeCard({ onOpen }: { onOpen: () => void }) {
  const { state } = useWatchTime();
  const title = 'Channel watch time';
  const open = (
    <button className="btn btn-small" onClick={onOpen}>
      Watch time details <Icon name="arrow" size={14} />
    </button>
  );
  if (state.s === 'locked')
    return <Card title={title}><EmptyState title="Unlock the studio to see watch time" hint="Watch time is private channel data, so it is shown only to you (bell → Unlock)." /></Card>;
  if (state.s === 'loading') return <Card title={title}><p className="ai-note">Loading watch time…</p></Card>;
  if (state.s === 'error') return <Card title={title}><p className="form-error">{state.m}</p>{open}</Card>;
  const r = state.r;
  if (!r.connected || !r.last365)
    return (
      <Card title={title}>
        <EmptyState title="YouTube Analytics not connected" hint={r.problem ?? 'Connect once from the watch time panel in Progress.'} />
        {open}
      </Card>
    );
  const pctDone = Math.min(100, Math.round((r.last365.watchHours / r.ypp.hours) * 1000) / 10);
  return (
    <Card title={title} action={<LiveBadge label="YouTube Analytics" />}>
      <dl className="kv-row" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <div><dt>Last 28 days</dt><dd>{hrs(r.last28?.watchHours)} hrs</dd></div>
        <div><dt>Last 365 days</dt><dd>{hrs(r.last365.watchHours)} hrs</dd></div>
        <div><dt>Lifetime</dt><dd>{hrs(r.lifetime?.watchHours)} hrs</dd></div>
        <div><dt>Avg view (28 d)</dt><dd>{dur(r.last28?.avgViewSeconds)}</dd></div>
      </dl>
      <div className="wt-bar" role="progressbar" aria-valuenow={pctDone} aria-valuemin={0} aria-valuemax={100} aria-label="Watch hours toward the Partner Program bar" style={{ marginTop: 12 }}>
        <span style={{ width: `${pctDone}%` }} />
      </div>
      <p className="ai-note">
        {pctDone}% of {r.ypp.hours.toLocaleString('en-IN')} Partner Program hours · fetched {r.fetchedAt ? formatWhen(r.fetchedAt) : '—'}
      </p>
      {open}
    </Card>
  );
}

export function WatchTime({ subscribers }: { subscribers: number | null }) {
  const { state, setState, load } = useWatchTime();
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    setBusy(true);
    try {
      const { url } = await api<{ url: string }>('/api/youtube/connect', { method: 'POST', body: '{}' });
      window.location.href = url;
    } catch (e) {
      setState({ s: 'error', m: e instanceof Error ? e.message : 'Could not start the Google sign-in' });
      setBusy(false);
    }
  };

  if (state.s === 'locked')
    return (
      <Card title="Watch time">
        <EmptyState title="Unlock the studio to see watch time" hint="Watch time is private channel data, so it is shown only to you (bell → Unlock)." />
      </Card>
    );
  if (state.s === 'loading') return <Card title="Watch time"><p className="ai-note">Loading watch time…</p></Card>;
  if (state.s === 'error')
    return (
      <Card title="Watch time">
        <p className="form-error">{state.m}</p>
        <div className="nt-actions">
          <button className="btn btn-small" onClick={() => load(true)}>Try again</button>
          <button className="btn btn-small btn-primary" onClick={connect} disabled={busy}>Connect YouTube Analytics</button>
        </div>
      </Card>
    );

  const r = state.r;
  if (!r.connected)
    return (
      <Card title="Watch time · connect once">
        {r.problem && <p className="form-error">{r.problem}</p>}
        <p className="ws-desc">YouTube keeps watch time private, so the public stats above can’t show it. Sign in once with the Google account that owns the channel. It’s free, and Ganesha only gets read access to analytics.</p>
        {r.appConfigured ? (
          <div className="nt-actions" style={{ marginTop: 12 }}>
            <button className="btn btn-primary" onClick={connect} disabled={busy}>
              <Icon name="analytics" size={16} /> {busy ? 'Opening Google…' : 'Connect YouTube Analytics'}
            </button>
          </div>
        ) : (
          <>
            <p className="ai-note" style={{ marginTop: 10 }}>One-time setup (about 5 minutes), then the button appears here:</p>
            <ol className="flow">
              <li>Open <strong>console.cloud.google.com</strong> → create a project → <em>APIs &amp; Services → Library</em> → enable <strong>YouTube Analytics API</strong> and <strong>YouTube Data API v3</strong>.</li>
              <li><em>OAuth consent screen</em>: External, app name “Ganesha”, your email. Add your Gmail as a test user, then press <strong>Publish app</strong> (In production) so the sign-in doesn’t expire every 7 days.</li>
              <li><em>Credentials → Create credentials → OAuth client ID → Web application</em>. Under “Authorized redirect URIs” paste: <code>{r.redirectUri}</code></li>
              <li>Copy the Client ID and Client secret → Ganesha <strong>⚙️ Settings → API keys → Platforms</strong> → <code>YT_CLIENT_ID</code> and <code>YT_CLIENT_SECRET</code> → Save.</li>
              <li>Come back here and tap <strong>Connect YouTube Analytics</strong>. Pick the SURVERSE channel and allow. Google may say the app is unverified; it’s your own app, so choose Advanced → Continue.</li>
            </ol>
            {r.missing && r.missing.length > 0 && <p className="cx-warn-text">Missing now: {r.missing.join(', ')}</p>}
          </>
        )}
      </Card>
    );

  const y = r.last365!;
  const goal = r.ypp.hours;
  const pctDone = Math.min(100, Math.round((y.watchHours / goal) * 1000) / 10);
  const daily = r.daily ?? [];
  const peak = Math.max(0.01, ...daily.map((d) => d.watchHours));
  return (
    <Card title="Watch time" action={<LiveBadge label="YouTube Analytics" />}>
      <section className="grid-4 wt-grid" aria-label="Watch time">
        <div className="stat"><p className="stat-label">Watch hours · lifetime</p><p className="stat-value">{hrs(r.lifetime?.watchHours)}</p><div className="stat-foot"><span className="stat-hint">{(r.lifetime?.views ?? 0).toLocaleString('en-IN')} views</span></div></div>
        <div className="stat"><p className="stat-label">Watch hours · last 365 days</p><p className="stat-value">{hrs(y.watchHours)}</p><div className="stat-foot"><span className="stat-hint">{y.views.toLocaleString('en-IN')} views</span></div></div>
        <div className="stat"><p className="stat-label">Watch hours · last 28 days</p><p className="stat-value">{hrs(r.last28?.watchHours)}</p><div className="stat-foot"><span className="stat-hint">{(r.last28?.views ?? 0).toLocaleString('en-IN')} views</span></div></div>
        <div className="stat"><p className="stat-label">Average view duration</p><p className="stat-value">{dur(r.last28?.avgViewSeconds)}</p><div className="stat-foot"><span className="stat-hint">last 28 days · lifetime {dur(r.lifetime?.avgViewSeconds)}</span></div></div>
      </section>

      <div className="wt-ypp">
        <div className="wt-ypp-head">
          <strong>Monetization progress (YouTube Partner Program)</strong>
          <span>{hrs(y.watchHours)} / {goal.toLocaleString('en-IN')} hrs · {subscribers === null ? '— ' : subscribers.toLocaleString('en-IN')} / {r.ypp.subscribers.toLocaleString('en-IN')} subs</span>
        </div>
        <div className="wt-bar" role="progressbar" aria-valuenow={pctDone} aria-valuemin={0} aria-valuemax={100} aria-label="Watch hours toward the Partner Program bar">
          <span style={{ width: `${pctDone}%` }} />
        </div>
        <p className="stat-hint">{pctDone}% of the watch-hour bar · {r.ypp.note}</p>
      </div>

      {daily.length > 0 && (
        <div className="wt-chart" aria-label="Daily watch hours, last 28 days">
          {daily.map((d) => (
            <span key={d.day} title={`${d.day}: ${d.watchHours} hrs · ${d.views} views`} style={{ height: `${Math.max(2, (d.watchHours / peak) * 100)}%` }} />
          ))}
        </div>
      )}
      <p className="ai-note">
        {r.channelTitle} · fetched {r.fetchedAt ? formatWhen(r.fetchedAt) : '—'} · {(r.notes ?? []).join(' ')}{' '}
        <button className="gr-link" onClick={() => load(true)}>Refresh</button>
      </p>
    </Card>
  );
}
