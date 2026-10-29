// Sunverse monetization goal tiles: achieved vs required for the YouTube Partner Program.
// Watch hours come from the owner-only YouTube Analytics endpoint; subscribers from public stats.
// Targets come from the Worker (yppTarget), never hard-coded here. Nothing is estimated except the
// clearly labelled hours-per-day pace, which is last-28-day hours divided by 28.
import { useCallback, useEffect, useState } from 'react';
import { api, AUTH_EVENT, getToken } from '../services/adminService';
import { loadAnalytics } from '../services/analyticsService';

interface Totals { views: number; watchHours: number; avgViewSeconds: number | null }
interface WatchReport {
  connected: boolean;
  problem?: string | null;
  last365?: Totals;
  last28?: Totals;
  ypp: { hours: number; subscribers: number; note: string };
}
type Watch = { s: 'locked' } | { s: 'loading' } | { s: 'error'; m: string } | { s: 'ready'; r: WatchReport };
type Subs = { s: 'loading' } | { s: 'error'; m: string } | { s: 'ready'; n: number | null };

const fmt = (v: number, digits = 0) => v.toLocaleString('en-IN', { maximumFractionDigits: digits });
const pct = (have: number, need: number) => (need > 0 ? Math.min(100, Math.round((have / need) * 1000) / 10) : 0);

function Tile({ label, value, hint, progress, onClick }: { label: string; value: string; hint: string; progress?: number; onClick: () => void }) {
  return (
    <button type="button" className="stat stat-link mz-tile" onClick={onClick} aria-label={`${label}: ${value}. ${hint}. Open watch time details`}>
      <p className="stat-label">{label}</p>
      <p className="stat-value mz-value">{value}</p>
      {progress !== undefined && (
        <div className="wt-bar mz-bar" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label={`${label} progress`}>
          <span style={{ width: `${progress}%` }} />
        </div>
      )}
      <div className="stat-foot">
        <span className="stat-hint">{hint}</span>
      </div>
      <span className="stat-go" aria-hidden="true">›</span>
    </button>
  );
}

export function MonetizationGoal({ onOpen }: { onOpen: () => void }) {
  const [watch, setWatch] = useState<Watch>({ s: getToken() ? 'loading' : 'locked' });
  const [subs, setSubs] = useState<Subs>({ s: 'loading' });

  const loadWatch = useCallback(() => {
    if (!getToken()) return setWatch({ s: 'locked' });
    api<WatchReport>('/api/youtube/watchtime')
      .then((r) => setWatch({ s: 'ready', r }))
      .catch((e: unknown) => setWatch({ s: 'error', m: e instanceof Error ? e.message : 'Could not load watch time' }));
  }, []);
  useEffect(() => {
    loadWatch();
    window.addEventListener(AUTH_EVENT, loadWatch);
    return () => window.removeEventListener(AUTH_EVENT, loadWatch);
  }, [loadWatch]);
  useEffect(() => {
    loadAnalytics('sunverse')
      .then((r) => setSubs({ s: 'ready', n: r.connected && r.channel && !r.channel.subscribersHidden ? r.channel.subscribers : null }))
      .catch((e: unknown) => setSubs({ s: 'error', m: e instanceof Error ? e.message : 'Could not load' }));
  }, []);

  const target = watch.s === 'ready' ? watch.r.ypp : null;
  const needHours = target?.hours ?? 4000;
  const needSubs = target?.subscribers ?? 1000;
  const hours = watch.s === 'ready' && watch.r.connected ? (watch.r.last365?.watchHours ?? 0) : null;
  const h28 = watch.s === 'ready' && watch.r.connected ? (watch.r.last28?.watchHours ?? 0) : null;
  const subN = subs.s === 'ready' ? subs.n : null;

  const watchMissing =
    watch.s === 'locked' ? 'Unlock the studio to see (private data)'
    : watch.s === 'loading' ? 'Loading…'
    : watch.s === 'error' ? watch.m
    : !watch.r.connected ? (watch.r.problem || 'Connect YouTube Analytics once')
    : '';

  const hoursLeft = hours === null ? null : Math.max(0, needHours - hours);
  const subsLeft = subN === null ? null : Math.max(0, needSubs - subN);
  const perDay = h28 === null ? null : h28 / 28;

  let status = '—';
  let statusHint = 'Needs watch hours and subscribers';
  if (hoursLeft !== null && subsLeft !== null) {
    if (hoursLeft === 0 && subsLeft === 0) {
      status = 'Ready to apply';
      statusHint = 'Both bars met · confirm in YouTube Studio → Earn';
    } else {
      status = 'Not yet';
      statusHint = [hoursLeft > 0 && `${fmt(Math.ceil(hoursLeft))} hrs`, subsLeft > 0 && `${fmt(subsLeft)} subs`].filter(Boolean).join(' + ') + ' to go';
    }
  } else if (hoursLeft !== null || subsLeft !== null) {
    statusHint = hoursLeft === null ? 'Watch hours unavailable' : 'Subscriber count unavailable';
  }

  return (
    <>
      <Tile
        label="Watch hours · 365 days"
        value={hours === null ? `— / ${fmt(needHours)}` : `${fmt(hours, 1)} / ${fmt(needHours)}`}
        progress={hours === null ? undefined : pct(hours, needHours)}
        hint={hours === null ? watchMissing : `${pct(hours, needHours)}% · ${fmt(Math.ceil(hoursLeft!))} hrs to go`}
        onClick={onOpen}
      />
      <Tile
        label="Subscribers"
        value={subN === null ? `— / ${fmt(needSubs)}` : `${fmt(subN)} / ${fmt(needSubs)}`}
        progress={subN === null ? undefined : pct(subN, needSubs)}
        hint={subs.s === 'loading' ? 'Loading…' : subs.s === 'error' ? subs.m : subN === null ? 'Hidden or not connected' : `${pct(subN, needSubs)}% · ${fmt(subsLeft!)} to go`}
        onClick={onOpen}
      />
      <Tile
        label="Watch hours · last 28 days"
        value={h28 === null ? '—' : fmt(h28, 1)}
        hint={perDay === null ? watchMissing : `≈ ${fmt(perDay, 1)} hrs/day recent pace`}
        onClick={onOpen}
      />
      <Tile label="Monetization (YPP)" value={status} hint={statusHint} onClick={onOpen} />
    </>
  );
}
