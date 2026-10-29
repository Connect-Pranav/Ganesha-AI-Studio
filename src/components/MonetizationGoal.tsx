// Sunverse monetization goal: achieved vs required for both YouTube Partner Program tiers
// (Fan funding and Ad revenue). Watch hours / Shorts views come from the owner-only YouTube
// Analytics endpoint; subscribers and recent public uploads from public stats. Bars come from the
// Worker (yppTarget), never hard-coded here. Nothing is estimated.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, AUTH_EVENT, getToken } from '../services/adminService';
import { loadAnalytics } from '../services/analyticsService';
import { TRACKER_EVENT, type TrackerData } from './YppTracker';

interface Tier { id: 'fan' | 'ads'; label: string; subscribers: number; hours: number; shortsViews90: number; uploads90: number | null }
interface WatchReport {
  connected: boolean;
  problem?: string | null;
  last365?: { watchHours: number };
  split?: { longFormWatchHours365?: number; shortsViews90?: number; error?: string } | null;
  ypp: { hours: number; subscribers: number; note: string; tiers?: Tier[] };
}
type Watch = { s: 'locked' } | { s: 'loading' } | { s: 'error'; m: string } | { s: 'ready'; r: WatchReport };
type Pub = { s: 'loading' } | { s: 'error'; m: string } | { s: 'ready'; subs: number | null; uploads90: number | null };

// Fallback bars only until the Worker answers (same values the Worker returns before 1 Feb 2027).
const FALLBACK: Tier[] = [
  { id: 'fan', label: 'Fan funding', subscribers: 500, hours: 3000, shortsViews90: 3_000_000, uploads90: 3 },
  { id: 'ads', label: 'Ad revenue', subscribers: 1000, hours: 4000, shortsViews90: 10_000_000, uploads90: null },
];
const DAY = 86_400_000;
const fmt = (v: number, digits = 0) => v.toLocaleString('en-IN', { maximumFractionDigits: digits });
const short = (v: number) => (v >= 1e6 ? `${fmt(v / 1e6, 1)}M` : v >= 1e3 ? `${fmt(v / 1e3, 1)}K` : fmt(v));
const pct = (have: number, need: number) => (need > 0 ? Math.min(100, Math.round((have / need) * 1000) / 10) : 0);

function Bars({ have, tiers, pick, show }: { have: number | null; tiers: Tier[]; pick: (t: Tier) => number; show: (v: number) => string }) {
  return (
    <ul className="mz-bars">
      {tiers.map((t) => {
        const need = pick(t);
        const p = have === null ? 0 : pct(have, need);
        return (
          <li key={t.id} className={have !== null && have >= need ? 'met' : ''}>
            <span className="mz-bar-label">
              <span>{t.label}</span>
              <span className="mz-ach">
                <b>{have === null ? '—' : show(have)}</b> / {show(need)}
              </span>
            </span>
            <span className="wt-bar mz-bar" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100} aria-label={`${t.label}: ${have === null ? 'unknown' : show(have)} of ${show(need)}`}>
              <span style={{ width: `${p}%` }} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Tile({ label, value, children, hint, onClick }: { label: string; value: string; children?: ReactNode; hint: string; onClick: () => void }) {
  return (
    <button type="button" className="stat stat-link mz-tile" onClick={onClick} aria-label={`${label}: ${value}. ${hint}. Open watch time details`}>
      <p className="stat-label">{label}</p>
      <p className="stat-value mz-value">{value}</p>
      {children}
      <div className="stat-foot">
        <span className="stat-hint">{hint}</span>
      </div>
      <span className="stat-go" aria-hidden="true">›</span>
    </button>
  );
}

export function MonetizationGoal({ onOpen }: { onOpen: () => void }) {
  const [watch, setWatch] = useState<Watch>({ s: getToken() ? 'loading' : 'locked' });
  const [pub, setPub] = useState<Pub>({ s: 'loading' });
  const [core, setCore] = useState<{ done: number; total: number } | null>(null);

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
  // Owner-confirmed core requirements (2-Step Verification, strikes, AdSense …) from the tracker.
  useEffect(() => {
    const loadCore = () => {
      if (!getToken()) return setCore(null);
      api<TrackerData>('/api/youtube/ypp')
        .then((d) => setCore({ done: d.checklist.filter((c) => c.done).length, total: d.checklist.length }))
        .catch(() => setCore(null));
    };
    loadCore();
    window.addEventListener(AUTH_EVENT, loadCore);
    window.addEventListener(TRACKER_EVENT, loadCore);
    return () => (window.removeEventListener(AUTH_EVENT, loadCore), window.removeEventListener(TRACKER_EVENT, loadCore));
  }, []);
  useEffect(() => {
    loadAnalytics('sunverse')
      .then((r) => {
        const subs = r.connected && r.channel && !r.channel.subscribersHidden ? r.channel.subscribers : null;
        const since = Date.now() - 90 * DAY;
        const uploads90 = r.connected && r.videos ? r.videos.filter((v) => v.publishedAt && Date.parse(v.publishedAt) >= since).length : null;
        setPub({ s: 'ready', subs, uploads90 });
      })
      .catch((e: unknown) => setPub({ s: 'error', m: e instanceof Error ? e.message : 'Could not load' }));
  }, []);

  const tiers = (watch.s === 'ready' && watch.r.ypp.tiers?.length ? watch.r.ypp.tiers : FALLBACK) as Tier[];
  const connected = watch.s === 'ready' && watch.r.connected;
  const split = connected && watch.s === 'ready' && watch.r.split && !watch.r.split.error ? watch.r.split : null;
  // Prefer long-form hours (what YPP counts). Older cached reports have only the total, labelled as such.
  const hours = !connected ? null : split?.longFormWatchHours365 ?? (watch.s === 'ready' ? watch.r.last365?.watchHours ?? null : null);
  const hoursIsTotal = connected && !split;
  const shorts = split?.shortsViews90 ?? null;
  const subs = pub.s === 'ready' ? pub.subs : null;
  const uploads = pub.s === 'ready' ? pub.uploads90 : null;

  const watchMissing =
    watch.s === 'locked' ? 'Private data · unlock the studio (bell → Unlock)'
    : watch.s === 'loading' ? 'Loading…'
    : watch.s === 'error' ? watch.m
    : !watch.r.connected ? watch.r.problem || 'Not connected · tap to connect YouTube Analytics →'
    : watch.r.split?.error ? `Shorts split unavailable: ${watch.r.split.error}`
    : 'Refresh watch time to load the Shorts split';

  /** true = met, false = not met, null = can't tell yet. Either watch hours or Shorts views can qualify. */
  const verdict = (t: Tier): boolean | null => {
    const subOk = subs === null ? null : subs >= t.subscribers;
    const upOk = t.uploads90 === null ? true : uploads === null ? null : uploads >= t.uploads90;
    const hOk = hours === null || hoursIsTotal ? null : hours >= t.hours;
    const sOk = shorts === null ? null : shorts >= t.shortsViews90;
    const viewOk = hOk === true || sOk === true ? true : hOk === null || sOk === null ? null : false;
    if (subOk === false || upOk === false || viewOk === false) return false;
    if (subOk === null || upOk === null || viewOk === null) return null;
    return true;
  };
  const upNeed = tiers.find((t) => t.uploads90 !== null)?.uploads90 ?? 3;
  // Ready to apply for ad revenue only when the numbers AND every core requirement are met.
  const adsV = verdict(tiers[tiers.length - 1]);
  const coreV = core === null ? null : core.done === core.total;
  const overall = adsV === false || coreV === false ? false : adsV === null || coreV === null ? null : true;
  const label = (v: boolean | null) => (v === true ? 'Ready' : v === false ? 'Not yet' : '—');

  return (
    <>
      <Tile
        label="Subscribers"
        value={subs === null ? '—' : fmt(subs)}
        hint={pub.s === 'loading' ? 'Loading…' : pub.s === 'error' ? pub.m : subs === null ? 'Hidden or not connected' : `${fmt(Math.max(0, tiers[tiers.length - 1].subscribers - subs))} to the ad revenue bar`}
        onClick={onOpen}
      >
        <Bars have={subs} tiers={tiers} pick={(t) => t.subscribers} show={fmt} />
      </Tile>
      <Tile
        label={hoursIsTotal ? 'Watch hours · 12 months (total)' : 'Long-form watch hours · 12 months'}
        value={hours === null ? '—' : fmt(hours, 1)}
        hint={hours === null ? watchMissing : hoursIsTotal ? 'Includes Shorts until refreshed · Studio → Earn is final' : `${fmt(Math.max(0, Math.ceil(tiers[tiers.length - 1].hours - hours)))} hrs to the ad revenue bar`}
        onClick={onOpen}
      >
        <Bars have={hours} tiers={tiers} pick={(t) => t.hours} show={fmt} />
      </Tile>
      <Tile
        label="Shorts views · 90 days"
        value={shorts === null ? '—' : short(shorts)}
        hint={shorts === null ? watchMissing : 'Or-path: Shorts views can replace watch hours'}
        onClick={onOpen}
      >
        <Bars have={shorts} tiers={tiers} pick={(t) => t.shortsViews90} show={short} />
      </Tile>
      <Tile label="Monetization status" value={label(overall)} hint={core ? 'Numbers + core requirements · Studio → Earn is final' : 'Core requirements: unlock to see · Studio → Earn is final'} onClick={onOpen}>
        <ul className="mz-status">
          {tiers.map((t) => {
            const v = verdict(t);
            return (
              <li key={t.id} className={v === true ? 'met' : v === false ? 'not' : ''}>
                <span>{t.label}</span>
                <b>{label(v)}</b>
              </li>
            );
          })}
          <li className={uploads === null ? '' : uploads >= upNeed ? 'met' : 'not'}>
            <span>Public uploads · 90 days</span>
            <b>{uploads === null ? '—' : `${uploads} / ${upNeed}`}</b>
          </li>
          <li className={core === null ? '' : core.done === core.total ? 'met' : 'not'}>
            <span>Core requirements</span>
            <b>{core === null ? '—' : `${core.done} / ${core.total}`}</b>
          </li>
        </ul>
      </Tile>
    </>
  );
}
