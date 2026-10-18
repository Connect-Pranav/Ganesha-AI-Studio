// Brand workspace: live goals, the deliverables library, integrations and production handoffs.
import { useCallback, useEffect, useState } from 'react';
import { ReelFactory } from './ReelFactory';
import { Icon } from './Icon';
import { Card, EmptyState, LiveBadge, formatWhen } from './ui';
import { StudioWorkflows } from './StudioWorkflows';
import { ResearchPanel } from './AgentWidgets';
import { ActivityFeed, StatCard, TaskBoard } from './Widgets';
import { Integ } from './Connection';
import { openNewGoal } from './GoalModal';
import { agentName } from '../data/agentsMeta';
import { useStudio, OPEN_STATUSES } from '../services/StudioContext';
import { loadArtifact, loadBrandArtifacts, type ArtifactRow } from '../services/studioService';
import { loadAnalytics, type AnalyticsReport } from '../services/analyticsService';
import type { DashboardData, ProductId, View } from '../types';

const TEMPLATE: Record<ProductId, string> = { sunverse: 'sunverse_song_release', littleloop: 'littleloop_episode', foliocraft: 'foliocraft_feature' };

/** How work leaves the studio for each brand. Facts about the setup, not live state. */
const HANDOFF: Record<ProductId, { title: string; steps: string[] }> = {
  sunverse: {
    title: 'From brief to release',
    steps: [
      'Agents write the composition brief, original lyrics, vocal and mix notes, artwork prompts and a timed video plan.',
      'You generate the audio in your music tool and the visuals in your image/video tools using those prompts.',
      'SURYA prepares the YouTube title, description, chapters and checklist and stops for your approval.',
      'After approving, you upload on YouTube, then press “Mark done” on that step. Nothing is uploaded automatically.',
    ],
  },
  littleloop: {
    title: 'From story to posted short',
    steps: [
      'Agents write the concept, timed script, character sheet, shot plan, per-shot video prompts, sound sheet and edit plan.',
      'Google Flow has no public API: copy MAYA’s prompts into Flow and generate the clips there.',
      'DHARMA checks child safety and CHITRAGUPTA checks quality before LAKSHMI prepares the posting package.',
      'Reels from the Reel Factory post to Instagram automatically only after you tap Approve & post.',
    ],
  },
  foliocraft: {
    title: 'From idea to shipped feature',
    steps: [
      'BRAHMA writes the spec, NIRNAYA decides build-now vs later, SUTRADHARA the UX spec, KUBERA the pricing view.',
      'CHITRAGUPTA reviews the plan, then the build step stops for your approval.',
      'Approved coding work is done by KARMA (CODE-SHAKTI) as a pull request in the weekly coding run. Merging and deploying stay with you.',
    ],
  },
};

function Deliverables({ brand }: { brand: ProductId }) {
  const { locked } = useStudio();
  const [rows, setRows] = useState<ArtifactRow[] | null>(null);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<{ title: string; text: string; meta: string } | null>(null);
  const [kind, setKind] = useState<'deliverable' | 'review'>('deliverable');

  const load = useCallback(() => {
    if (locked) return;
    loadBrandArtifacts(brand)
      .then((r) => (setRows(r.artifacts), setError('')))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load deliverables'));
  }, [brand, locked]);
  useEffect(() => {
    setRows(null);
    load();
  }, [load]);

  if (locked) return null;
  const uniq = (k: string) => new Set((rows ?? []).filter((r) => r.kind === k).map((r) => `${r.workflow_id}:${r.step_key}`)).size;
  const shown = (rows ?? []).filter((r) => r.kind === kind);
  // Latest version per step only, grouped by goal.
  const latest = new Map<string, ArtifactRow>();
  for (const r of shown) if (!latest.has(`${r.workflow_id}:${r.step_key}`)) latest.set(`${r.workflow_id}:${r.step_key}`, r);
  const groups = new Map<string, ArtifactRow[]>();
  for (const r of latest.values()) groups.set(r.workflow_id, [...(groups.get(r.workflow_id) ?? []), r]);

  const open = async (r: ArtifactRow) => {
    try {
      const a = await loadArtifact(r.id);
      setPreview({ title: `${agentName(r.agent_id)} · ${r.deliverable}`, text: a.text, meta: `${r.workflow_title} · version ${r.version} · ${formatWhen(r.created_at)} · written document` });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open');
    }
  };

  return (
    <Card title="Deliverables" action={rows?.length ? <LiveBadge /> : undefined}>
      <div className="tabs" role="tablist" aria-label="Deliverable type">
        <button role="tab" aria-selected={kind === 'deliverable'} className={`tab ${kind === 'deliverable' ? 'active' : ''}`} onClick={() => setKind('deliverable')}>
          Work <span className="tab-count">{uniq('deliverable')}</span>
        </button>
        <button role="tab" aria-selected={kind === 'review'} className={`tab ${kind === 'review' ? 'active' : ''}`} onClick={() => setKind('review')}>
          Reviews <span className="tab-count">{uniq('review')}</span>
        </button>
      </div>
      {error && <p className="drawer-notice error">{error}</p>}
      {rows === null && !error ? (
        <p className="ai-note">Loading…</p>
      ) : groups.size === 0 ? (
        <EmptyState title="Nothing delivered yet" hint="Every brief, script, prompt and plan the agents write for this brand appears here." />
      ) : (
        <div className="dl-groups">
          {[...groups.entries()].map(([wid, items]) => (
            <section key={wid} className="dl-group">
              <p className="dl-goal">{items[0].workflow_title}</p>
              <ul className="dl-list">
                {items.map((r) => (
                  <li key={r.id}>
                    <button className="dl-item" onClick={() => open(r)}>
                      <span className="dl-agent">{agentName(r.agent_id)}</span>
                      <span className="dl-name">{r.deliverable}</span>
                      <span className="dl-meta">
                        v{r.version} · {formatWhen(r.created_at)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <p className="ai-note">These are written documents (briefs, scripts, prompts, plans). Audio, video and site files are made by you in your tools.</p>
      {preview && (
        <div className="drawer-scrim preview-scrim" onClick={() => setPreview(null)}>
          <div className="modal preview" role="dialog" aria-modal="true" aria-label={preview.title} onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2>{preview.title}</h2>
              <button className="icon-btn" onClick={() => setPreview(null)} aria-label="Close">
                <Icon name="close" />
              </button>
            </header>
            <p className="ai-note preview-meta">{preview.meta}</p>
            <pre className="preview-text">{preview.text}</pre>
          </div>
        </div>
      )}
    </Card>
  );
}

function SunverseChannel({ onNavigate }: { onNavigate: (v: View) => void }) {
  const [r, setR] = useState<AnalyticsReport | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    loadAnalytics('sunverse').then(setR).catch((e: unknown) => setErr(e instanceof Error ? e.message : 'Could not load'));
  }, []);
  return (
    <Card title="YouTube channel" action={r?.connected ? <LiveBadge label="Real data" /> : undefined}>
      {err ? (
        <EmptyState title="Channel data couldn’t load" hint={err} />
      ) : !r ? (
        <p className="ai-note">Loading…</p>
      ) : !r.connected || !r.channel ? (
        <EmptyState title="Not connected" hint={r.reason} />
      ) : (
        <>
          <dl className="kv-row">
            <div>
              <dt>Subscribers</dt>
              <dd>{r.channel.subscribersHidden ? 'Hidden' : r.channel.subscribers?.toLocaleString('en-IN')}</dd>
            </div>
            <div>
              <dt>Videos</dt>
              <dd>{r.channel.videoCount}</dd>
            </div>
            <div>
              <dt>Views (all videos)</dt>
              <dd>{r.summary?.totalViewsOfVideos?.toLocaleString('en-IN') ?? '—'}</dd>
            </div>
            <div>
              <dt>Latest upload</dt>
              <dd>{r.summary?.latestUpload ? formatWhen(r.summary.latestUpload) : '—'}</dd>
            </div>
          </dl>
          <p className="ai-note">
            {r.channel.handle} · public statistics · fetched {r.fetchedAt ? formatWhen(r.fetchedAt) : '—'}
          </p>
          <button className="btn btn-small" onClick={() => onNavigate('analytics')}>
            Full analytics <Icon name="arrow" size={14} />
          </button>
        </>
      )}
    </Card>
  );
}

function Integrations({ brand }: { brand: ProductId }) {
  const { summary, health } = useStudio();
  const yt = summary?.integrations.youtubeStats.configured ?? health?.youtubeKeySet ?? false;
  return (
    <Card title="Integrations">
      <ul className="integ">
        {brand === 'sunverse' && (
          <>
            <Integ name="YouTube stats" ok={yt} okText="@SURVERSE_09 · public statistics" offText="YOUTUBE_API_KEY not set on the Worker." />
            <Integ name="YouTube upload" ok={false} offText="Needs channel sign-in (Google OAuth). You upload after approval." />
            <Integ name="Music generation" ok={false} pending="Manual" offText="Agents write the brief and prompt; you generate audio in your tool." />
            <Integ name="Spotify" ok={false} offText="Not started." />
          </>
        )}
        {brand === 'littleloop' && (
          <>
            <Integ name="Google Flow" ok={false} pending="Manual handoff" offText="No public API. Prompts are copied into Flow by you." />
            <Integ name="Instagram" ok={false} pending="On hold" offText="Paused by you." />
            <Integ name="YouTube (LittleLoop)" ok={false} offText="No channel connected. Share a handle to track it." />
          </>
        )}
        {brand === 'foliocraft' && (
          <>
            <Integ name="Code (pull requests)" ok={false} pending="Weekly run" offText="CODE-SHAKTI’s weekly coding run opens pull requests for queued coding tasks. Merging and deploying stay with you." />
            <Integ name="Theme previews / deploy" ok={false} offText="No Foliocraft site or preview deploy is connected yet." />
            <Integ name="Site analytics & sales" ok={false} offText="No tracking or payments source connected." />
          </>
        )}
      </ul>
    </Card>
  );
}

export function BrandWorkspace({ data, productId, onNavigate }: { data: DashboardData; productId: ProductId; onNavigate: (v: View) => void }) {
  const { summary, locked } = useStudio();
  const product = data.products.find((x) => x.id === productId)!;
  const live = !locked && summary;
  const c = summary?.counts.workflowsByBrand[productId] ?? {};
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  const open = Object.entries(c).filter(([k]) => OPEN_STATUSES.includes(k)).reduce((a, [, v]) => a + v, 0);
  const waiting = (c.waiting_for_approval ?? 0) + (c.waiting_for_external_action ?? 0);
  const brandEvents = (summary?.events ?? []).filter((e) => e.brand === productId).slice(0, 8);
  const handoff = HANDOFF[productId];

  return (
    <div className="workspace" style={{ ['--accent' as string]: product.accent }}>
      <section className="ws-hero">
        <div className="product-icon lg" aria-hidden="true">
          <Icon name={product.id} size={26} />
        </div>
        <div className="ws-hero-text">
          <p className="eyebrow">Brand workspace</p>
          <h2 className="ws-title">{product.name}</h2>
          <p className="ws-desc">{product.description}</p>
        </div>
        <button className="btn btn-primary" onClick={() => openNewGoal(TEMPLATE[productId])}>
          <Icon name="plus" size={16} /> New goal
        </button>
      </section>

      <section className="grid-4" aria-label={`${product.name} status`}>
        {live ? (
          <>
            <StatCard metric={{ label: 'Goals', value: String(total), hint: 'Started on the studio backend' }} />
            <StatCard metric={{ label: 'In progress', value: String(open), hint: `${c.running ?? 0} working now` }} />
            <StatCard metric={{ label: 'Waiting for you', value: String(waiting), hint: 'Approvals and manual steps' }} />
            <StatCard metric={{ label: 'Done', value: String(c.completed ?? 0), hint: `${c.failed ?? 0} failed` }} />
          </>
        ) : (
          product.metrics.map((m) => <StatCard key={m.label} metric={m} />)
        )}
      </section>

      <div className="grid-main">
        <div className="col">
          {productId === 'littleloop' && <ReelFactory />}
          <StudioWorkflows brand={productId} title={`${product.name} goals`} />
          <Deliverables brand={productId} />
          <ResearchPanel findings={data.research} brand={product.id} title={`NARADA research · ${product.name}`} />
          <TaskBoard tasks={data.tasks.filter((t) => t.product === productId)} live={data.live.tasks} />
        </div>
        <div className="col">
          {productId === 'sunverse' && <SunverseChannel onNavigate={onNavigate} />}
          <Integrations brand={productId} />
          <Card title={handoff.title}>
            <ol className="flow">
              {handoff.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </Card>
          {live && (
            <Card title="Live activity" action={brandEvents.length ? <LiveBadge /> : undefined}>
              {brandEvents.length ? (
                <ul className="activity">
                  {brandEvents.map((e) => (
                    <li key={e.id}>
                      <div className="act-body">
                        <p className="act-text">{e.message}</p>
                        <p className="act-meta">
                          {e.workflow_title} · {formatWhen(e.created_at)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="No recent backend activity for this brand" />
              )}
            </Card>
          )}
          <ActivityFeed items={data.activity.filter((a) => a.product === productId)} live={data.live.activity} />
        </div>
      </div>
    </div>
  );
}
