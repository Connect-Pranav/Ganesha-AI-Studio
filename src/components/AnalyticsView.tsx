import { useCallback, useEffect, useState } from 'react';
import { Card, EmptyState, LiveBadge, formatWhen } from './ui';
import { Icon } from './Icon';
import { loadAnalytics, type AnalyticsReport, type Video } from '../services/analyticsService';
import type { ProductId } from '../types';
import { BrandWorkCounts, StudioOps } from './StudioOps';

type Tab = ProductId | 'studio';
// SOMA's YouTube analysis (Sunverse) comes first: it is the tab with real channel data.
const BRANDS: { id: Tab; label: string }[] = [
  { id: 'sunverse', label: 'Sunverse · YouTube (SOMA)' },
  { id: 'studio', label: 'Studio operations' },
  { id: 'littleloop', label: 'LittleLoop' },
  { id: 'foliocraft', label: 'Foliocraft' },
];

const n = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString('en-IN'));
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`);
const signed = (v: number | null | undefined) => (v === null || v === undefined ? null : `${v >= 0 ? '+' : ''}${v.toLocaleString('en-IN')}`);
const len = (s: number | null) => (s === null ? '—' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

function Stat({ label, value, hint, delta }: { label: string; value: string; hint?: string; delta?: string | null }) {
  return (
    <div className="stat">
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      <div className="stat-foot">
        {delta && <span className={`delta delta-${delta.startsWith('-') ? 'down' : delta === '+0' ? 'flat' : 'up'}`}>{delta}</span>}
        {hint && <span className="stat-hint">{hint}</span>}
      </div>
    </div>
  );
}

function VideoTable({ videos }: { videos: Video[] }) {
  return (
    <div className="an-table-wrap">
      <table className="an-table">
        <thead>
          <tr>
            <th>Video</th>
            <th>Published</th>
            <th className="num">Length</th>
            <th className="num">Views</th>
            <th className="num">Likes</th>
            <th className="num">Comments</th>
            <th className="num">Like rate</th>
          </tr>
        </thead>
        <tbody>
          {videos.map((v) => (
            <tr key={v.id}>
              <td className="an-title">
                <a href={v.url} target="_blank" rel="noreferrer">{v.title}</a>
              </td>
              <td>{day(v.publishedAt)}</td>
              <td className="num">{len(v.durationSec)}</td>
              <td className="num">{n(v.views)}</td>
              <td className="num">{v.likes === null ? <span title="Hidden by the channel">hidden</span> : n(v.likes)}</td>
              <td className="num">{v.comments === null ? 'off' : n(v.comments)}</td>
              <td className="num">{v.likes !== null && v.views ? pct(v.likes / v.views) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AnalyticsView({ initialBrand = 'sunverse' }: { initialBrand?: Tab }) {
  const [brand, setBrand] = useState<Tab>(initialBrand);
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; report: AnalyticsReport }>({ status: 'loading' });

  const load = useCallback((b: Tab) => {
    if (b === 'studio') return;
    setState({ status: 'loading' });
    loadAnalytics(b)
      .then((report) => setState({ status: 'ready', report }))
      .catch((e: unknown) => setState({ status: 'error', message: e instanceof Error ? e.message : 'Could not load analytics' }));
  }, []);
  useEffect(() => load(brand), [brand, load]);

  const tabs = (
    <div className="tabs" role="tablist" aria-label="Brand">
      {BRANDS.map((b) => (
        <button key={b.id} role="tab" aria-selected={brand === b.id} className={`tab ${brand === b.id ? 'active' : ''}`} onClick={() => setBrand(b.id)}>
          {b.label}
        </button>
      ))}
    </div>
  );

  if (brand === 'studio') {
    return (
      <div className="an">
        {tabs}
        <StudioOps />
      </div>
    );
  }
  if (state.status === 'loading') {
    return (
      <div className="an">
        {tabs}
        <Card title="SOMA analytics">
          <p className="ai-note">Fetching the latest numbers…</p>
        </Card>
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="an">
        {tabs}
        <Card title="SOMA analytics">
          <EmptyState title="Analytics couldn’t load" hint={state.message} />
          <button className="btn" onClick={() => load(brand)}>Try again</button>
        </Card>
      </div>
    );
  }

  const r = state.report;
  if (!r.connected || !r.channel || !r.summary || !r.videos) {
    return (
      <div className="an">
        {tabs}
        <Card title="SOMA analytics">
          <EmptyState title={r.platform === 'instagram' ? 'Instagram not connected yet' : 'No audience data source connected'} hint={r.reason ?? 'This brand has no analytics source yet.'} />
        </Card>
        {r.studio && <StudioReels s={r.studio} />}
        <BrandWorkCounts brand={brand} />
      </div>
    );
  }

  const s = r.summary;
  const g = s.growth;
  const growthHint = g ? `since ${formatWhen(g.since)}` : undefined;
  const ig = r.platform === 'instagram';
  const top = s.topVideos.map((id) => r.videos!.find((v) => v.id === id)).filter((v): v is Video => Boolean(v));

  return (
    <div className="an">
      {tabs}

      <section className="an-head">
        <div>
          <p className="eyebrow">{ig ? 'Instagram account' : 'YouTube channel'}</p>
          <h2 className="ws-title">
            <a href={r.channel.url} target="_blank" rel="noreferrer">{r.channel.title}</a>
          </h2>
          <p className="ws-desc">
            {r.channel.handle} · {r.source} · fetched {formatWhen(r.fetchedAt!)}
            {r.stale && ` · latest fetch failed (${r.fetchError}); showing the previous fetch`}
          </p>
        </div>
        <LiveBadge label="Real data" />
      </section>

      <section className="grid-4" aria-label="Channel totals">
        <Stat label={ig ? 'Followers' : 'Subscribers'} value={r.channel.subscribersHidden ? 'Hidden' : n(r.channel.subscribers)} delta={signed(g?.subscribers)} hint={growthHint} />
        <Stat label={ig ? 'Views (latest posts)' : 'Total channel views'} value={n(r.channel.totalViews)} delta={ig ? undefined : signed(g?.totalViews)} hint={ig ? 'sum of per-post views' : growthHint} />
        <Stat label={ig ? 'Posts' : 'Videos'} value={n(r.channel.videoCount)} hint={s.latestUpload ? `Latest ${day(s.latestUpload)}` : undefined} />
        <Stat label={ig ? 'Average views / post' : 'Average views / video'} value={n(s.avgViewsPerVideo)} hint={`Median ${n(s.medianViewsPerVideo)}`} />
      </section>

      <section className="grid-4" aria-label="Engagement">
        <Stat label="Last 30 days" value={`${n(s.last30Days.views)} views`} hint={`${s.last30Days.uploads} upload(s) in 30 days`} />
        <Stat label="Like rate" value={pct(s.likeRate)} hint={`${n(s.totalLikes)} likes`} />
        <Stat label="Comment rate" value={pct(s.commentRate)} hint={`${n(s.totalComments)} comments`} />
        {ig ? (
          <Stat label="Saves · shares" value={`${n(sumOf(r.videos, 'saves'))} · ${n(sumOf(r.videos, 'shares'))}`} hint="latest posts (owner view)" />
        ) : (
          <Stat label="Up to 3 min vs longer" value={`${n(s.upTo3Min.avgViews)} / ${n(s.over3Min.avgViews)}`} hint={`avg views · ${s.upTo3Min.count} vs ${s.over3Min.count} videos`} />
        )}
      </section>

      <div className="grid-main">
        <div className="col">
          {r.studio && <StudioReels s={r.studio} />}
          <Card title={ig ? 'Top posts by views' : 'Top videos by views'}>
            {top.length ? <VideoTable videos={top} /> : <EmptyState title="No videos yet" />}
          </Card>
          <Card title={ig ? `Latest posts (${r.videos.length})` : `All videos (${r.videos.length})`}>
            {r.videos.length ? <VideoTable videos={r.videos} /> : <EmptyState title="No uploads yet" />}
          </Card>
        </div>
        <div className="col">
          <Card title="SOMA’s analysis" action={r.insights ? <LiveBadge label={r.insights.provider ?? 'AI'} /> : undefined}>
            {r.insights ? (
              <div className="an-insights">
                <p className="an-headline">{r.insights.headline}</p>
                <h3>Working</h3>
                <ul className="bullets">{r.insights.working.map((x) => <li key={x}>{x}</li>)}</ul>
                <h3>Not working</h3>
                <ul className="bullets">{r.insights.notWorking.map((x) => <li key={x}>{x}</li>)}</ul>
                <h3>Next 3 actions</h3>
                <ol className="flow">
                  {r.insights.nextActions.map((a) => (
                    <li key={a.action}>
                      <strong>{a.action}</strong> — {a.why} <span className="stat-hint">Measure: {a.measureWith}</span>
                    </li>
                  ))}
                </ol>
                {r.insights.at && <p className="ai-note">Written {formatWhen(r.insights.at)} from the fetch of {formatWhen(r.insights.basedOn ?? r.insights.at)}.</p>}
                {r.insights.basedOn && r.fetchedAt && r.insights.basedOn < r.fetchedAt && (
                  <p className="cx-warn-text">This analysis was written from an older fetch, so its figures can differ slightly from the live numbers above. The numbers above are the current ones; SOMA writes a fresh analysis automatically on its next scheduled run.</p>
                )}
              </div>
            ) : (
              <EmptyState
                title="No written analysis yet"
                hint={r.insightsError ?? 'SOMA writes one each day once the Worker has an AI key (GEMINI_API_KEY). The numbers on this page are already real.'}
              />
            )}
          </Card>
          <Card title="What this report can’t see yet">
            <ul className="bullets">{(r.dataGaps ?? []).map((x) => <li key={x}>{x}</li>)}</ul>
          </Card>
          <Card title="Refresh">
            <p className="ai-note">Numbers update automatically every 6 hours and on page load at most once an hour.</p>
            <button className="btn" onClick={() => load(brand)}>
              <Icon name="refresh" size={16} /> Reload
            </button>
          </Card>
        </div>
      </div>
    </div>
  );
}

function sumOf(v: Video[] | undefined, k: 'saves' | 'shares'): number | null {
  const xs = (v ?? []).map((x) => x[k]).filter((x): x is number => typeof x === 'number');
  return xs.length ? xs.reduce((a, b) => a + b, 0) : null;
}

function StudioReels({ s }: { s: NonNullable<AnalyticsReport['studio']> }) {
  return (
    <Card title="LittleLoop studio · reels">
      <section className="grid-4">
        <Stat label="Posted to Instagram" value={String(s.published)} hint="by the Reel Factory" />
        <Stat label="Waiting for you" value={String(s.waitingApproval)} hint="approve in LittleLoop / Agents" />
        <Stat label="Waiting for Flow clips" value={String(s.waitingFlow)} hint={s.mode === 'flow' ? 'Google Flow mode' : 'API mode'} />
        <Stat label="Character sheets" value={String(s.sheets)} hint={s.factoryOn ? 'factory ON' : 'factory OFF'} />
      </section>
      {s.recent.length > 0 && (
        <ul className="rf-list">
          {s.recent.map((r) => (
            <li key={`${r.day}-${r.slot}`}>
              <span className="pill pill-idle">{r.status}</span>
              <span className="rf-li-title">{r.title ?? 'Reel'}</span>
              <span className="cx-sub">{r.day} #{r.slot}</span>
              {r.igPermalink && <a href={r.igPermalink} target="_blank" rel="noreferrer">Instagram</a>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
