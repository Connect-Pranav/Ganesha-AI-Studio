import { useEffect, useMemo, useRef, useState } from 'react';
import { UniverseScene, webglAvailable, type SceneInput, type SceneNode } from './scene';
import { AGENTS, TEAMS, TEMPLATES, agentById, agentName } from '../../data/agentsMeta';
import { NewGoalButtons } from '../PipelineWidgets';
import { Icon } from '../Icon';
import { formatWhen, productNames } from '../ui';
import type { AiStatus, DashboardData, ProductId, Run, View } from '../../types';
import { useStudio, OPEN_STATUSES, WF_STATUS } from '../../services/StudioContext';
import type { Summary } from '../../services/studioService';
import { describeProvider, EnginePill } from '../Connection';

/** Backend workflow status → arc style. */
const ARC: Record<string, SceneInput['links'][number]['status']> = {
  running: 'running',
  queued: 'pending',
  paused: 'pending',
  waiting_for_approval: 'approval_required',
  waiting_for_external_action: 'approval_required',
  failed: 'failed',
  completed: 'completed',
};

const TEAM_COLOR: Record<string, string> = { master: '#a78bfa', ops: '#94a3b8' };
const LEGACY: Record<string, string> = { ganesha: 'ganesha_orchestrator', narada: 'narada_market_intelligence', 'code-shakti': 'code_shakti' };
const STATUS_TEXT = { idle: 'Available', working: 'Working now', approval: 'Waiting for you', error: 'A step failed recently' } as const;

interface Props {
  data: DashboardData;
  ai: AiStatus | null;
  onNavigate: (v: View) => void;
}

export default function Universe3D({ data, ai, onNavigate }: Props) {
  const { summary, locked, health, healthError } = useStudio();
  const live: Summary | null = !locked ? summary : null;
  const hostRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<UniverseScene | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [supported] = useState(webglAvailable);

  /* ---------- derive the graph from live data ---------- */
  const { input, statusOf, lastRunOf } = useMemo(() => {
    const status = new Map<string, SceneNode['status']>();
    // Live backend first: working > waiting for you > failed in the last 48 h.
    if (live)
      for (const a of live.agents) {
        if (a.running) status.set(a.id, 'working');
        else if (a.waiting) status.set(a.id, 'approval');
        else if (a.recent_failed) status.set(a.id, 'error');
      }
    for (const p of live ? [] : data.pipelines)
      for (const s of p.steps) {
        if (s.status === 'running') status.set(s.agent, 'working');
        else if (s.status === 'approval_required' && status.get(s.agent) !== 'working') status.set(s.agent, 'approval');
        else if (s.status === 'failed' && !status.has(s.agent)) status.set(s.agent, 'error');
      }
    const lastRun = new Map<string, Run>();
    for (const r of data.runs) {
      const id = LEGACY[r.agent];
      if (id && !lastRun.has(id)) lastRun.set(id, r);
    }
    for (const [id, r] of lastRun) if (r.status === 'failed' && !status.has(id)) status.set(id, 'error');

    const accent = Object.fromEntries(data.products.map((p) => [p.id, p.accent]));
    const nodes: SceneNode[] = [{ id: 'core', kind: 'core', label: 'GANESHA', color: '#7c5cff' }];
    for (const p of data.products) nodes.push({ id: p.id, kind: 'brand', label: p.name, sub: p.tagline, color: p.accent });
    for (const a of AGENTS) {
      if (a.id === 'ganesha_orchestrator') continue; // the core itself
      nodes.push({
        id: a.id,
        kind: 'agent',
        label: a.name,
        team: a.team,
        color: TEAM_COLOR[a.team] ?? accent[a.team] ?? '#a78bfa',
        status: status.get(a.id) ?? 'idle',
      });
    }
    const recentDone = data.pipelines.filter((p) => p.status === 'completed').slice(0, 3);
    if (live) {
      const open = live.workflows.filter((w) => OPEN_STATUSES.includes(w.status) || w.status === 'failed').slice(0, 12);
      const done = live.workflows.filter((w) => w.status === 'completed').slice(0, 3);
      const links: SceneInput['links'] = [...open, ...done].map((w) => ({
        id: w.id,
        from: 'core',
        to: w.brand === 'studio' ? 'narada_market_intelligence' : w.brand,
        status: ARC[w.status] ?? 'pending',
      }));
      return { input: { nodes, links }, statusOf: status, lastRunOf: lastRun };
    }
    const links: SceneInput['links'] = [...data.pipelines.filter((p) => p.status !== 'completed'), ...recentDone].map((p) => {
      const active = p.steps.find((s) => s.status === 'running' || s.status === 'approval_required');
      const to = p.brand === 'studio' ? (active?.agent ?? 'narada_market_intelligence') : p.brand;
      return { id: p.id, from: 'core', to, status: p.status };
    });
    return { input: { nodes, links }, statusOf: status, lastRunOf: lastRun };
  }, [data, live]);

  /* ---------- mount / update scene ---------- */
  useEffect(() => {
    if (!supported || !hostRef.current || !labelsRef.current) return;
    const s = new UniverseScene(hostRef.current, labelsRef.current, { onSelect: setSelected, onHover: setHovered });
    sceneRef.current = s;
    const ro = new ResizeObserver(() => s.resize());
    ro.observe(hostRef.current);
    return () => {
      ro.disconnect();
      s.dispose();
      sceneRef.current = null;
    };
  }, [supported]);

  useEffect(() => {
    sceneRef.current?.setData(input);
  }, [input]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && sceneRef.current?.select(null);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  /* ---------- HUD numbers (real only) ---------- */
  const wf = live?.counts.workflowsByStatus;
  const running = wf ? Object.entries(wf).filter(([k]) => ['running', 'queued'].includes(k)).reduce((x, [, v]) => x + v, 0) : data.pipelines.filter((p) => p.status === 'running').length;
  const approvals = wf ? (wf.waiting_for_approval ?? 0) + (wf.waiting_for_external_action ?? 0) : data.pipelines.filter((p) => p.status === 'approval_required').length;
  const working = [...statusOf.values()].filter((s) => s === 'working').length;
  const failed7 = live ? live.counts.failedTasks7d : null;

  if (!supported) {
    return (
      <div className="u-fallback">
        <p className="empty-title">3D needs WebGL, which this browser or device has turned off.</p>
        <button className="btn btn-primary" onClick={() => onNavigate('overview')}>
          Open classic dashboard
        </button>
      </div>
    );
  }

  const focus = selected ?? null;

  return (
    <div className="universe">
      <div className="u-canvas" ref={hostRef} />
      <div className="u-labels" ref={labelsRef} aria-hidden="true" />

      {/* HUD */}
      <div className="u-hud">
        <div className="u-stats">
          <Stat value={AGENTS.length} label="agents" />
          <Stat value={running} label={live ? 'goals in progress' : 'pipelines running'} tone={running ? 'blue' : undefined} />
          <Stat value={approvals} label="waiting for you" tone={approvals ? 'amber' : undefined} />
          <Stat value={working} label="agents working" />
          {failed7 !== null ? <Stat value={failed7} label="failed steps · 7d" tone={failed7 ? 'red' : undefined} /> : <Stat value={data.research.length} label="sourced findings" />}
        </div>
        <div className="u-actions">
          <span className={`u-health ${health ? 'ok' : healthError ? 'bad' : ''}`} title={health ? `Backend v${health.version}` : healthError ?? ''}>
            {health ? `Backend online${live ? '' : ' · locked'}` : healthError ? 'Backend offline' : 'Checking…'}
          </span>
          <EnginePill />
          <button className="btn btn-small" onClick={() => sceneRef.current?.resetView()}>
            <Icon name="refresh" size={14} /> Reset view
          </button>
          <button className="btn btn-small" onClick={() => onNavigate('overview')}>
            Classic view
          </button>
        </div>
      </div>

      <div className="u-legend" aria-hidden="true">
        <span><i className="lg lg-working" /> working</span>
        <span><i className="lg lg-approval" /> needs approval</span>
        <span><i className="lg lg-error" /> failed</span>
        <span className="u-hint">{hovered ? `Inspect ${nodeLabel(hovered)}` : 'Drag to orbit · scroll or pinch to zoom · tap anything'}</span>
      </div>

      {/* Accessible list of everything in the scene (keyboard / screen readers) */}
      <nav className="sr-only" aria-label="Universe objects">
        <button onClick={() => sceneRef.current?.select('core')}>GANESHA core</button>
        {data.products.map((p) => (
          <button key={p.id} onClick={() => sceneRef.current?.select(p.id)}>{p.name}</button>
        ))}
        {AGENTS.filter((a) => a.id !== 'ganesha_orchestrator').map((a) => (
          <button key={a.id} onClick={() => sceneRef.current?.select(a.id)}>{a.name}</button>
        ))}
      </nav>

      {focus && (
        <aside className="u-panel" aria-label="Details">
          <button className="icon-btn u-close" onClick={() => sceneRef.current?.select(null)} aria-label="Close details">
            <Icon name="close" />
          </button>
          {focus === 'core' ? (
            <CorePanel data={data} ai={ai} live={live} onNavigate={onNavigate} />
          ) : data.products.some((p) => p.id === focus) ? (
            <BrandPanel id={focus as ProductId} data={data} live={live} onNavigate={onNavigate} onPick={(id) => sceneRef.current?.select(id)} />
          ) : (
            <AgentPanel id={focus} data={data} live={live} status={statusOf.get(focus) ?? 'idle'} lastRun={lastRunOf.get(focus)} />
          )}
        </aside>
      )}
    </div>
  );
}

function nodeLabel(id: string) {
  if (id === 'core') return 'GANESHA';
  return productNames[id as ProductId] ?? agentName(id);
}

function Stat({ value, label, tone }: { value: number; label: string; tone?: 'blue' | 'amber' | 'red' }) {
  return (
    <div className={`u-stat ${tone ? `u-stat-${tone}` : ''}`}>
      <span className="u-stat-v">{value}</span>
      <span className="u-stat-l">{label}</span>
    </div>
  );
}

/* ---------- panels ---------- */
function CorePanel({ data, ai, live, onNavigate }: { data: DashboardData; ai: AiStatus | null; live: Summary | null; onNavigate: (v: View) => void }) {
  const w = live?.counts.workflowsByStatus;
  const LEG: Record<string, string> = { running: 'running', approval_required: 'approval_required', completed: 'completed', failed: 'failed' };
  const by = (s: string) =>
    w
      ? s === 'running'
        ? (w.running ?? 0) + (w.queued ?? 0)
        : s === 'approval_required'
          ? (w.waiting_for_approval ?? 0) + (w.waiting_for_external_action ?? 0)
          : (w[s] ?? 0)
      : data.pipelines.filter((p) => p.status === LEG[s]).length;
  return (
    <div className="u-p">
      <p className="eyebrow">Master control</p>
      <h2 className="u-p-title">GANESHA</h2>
      <p className="u-p-sub">Chief Orchestrator — turns each goal into a pipeline and routes it to 30 specialists.</p>
      <dl className="u-kv">
        <div><dt>Running</dt><dd>{by('running')}</dd></div>
        <div><dt>Need approval</dt><dd>{by('approval_required')}</dd></div>
        <div><dt>Completed</dt><dd>{by('completed')}</dd></div>
        <div><dt>Failed</dt><dd>{by('failed')}</dd></div>
      </dl>
      {live ? (
        <ul className="u-engines">
          {live.providers.map((p) => {
            const v = describeProvider(p, p.state !== 'not_configured');
            return (
              <li key={p.provider}>
                <strong>{p.provider === 'gemini' ? 'Gemini' : 'Claude'}</strong> — {v.label}. {v.detail}
              </li>
            );
          })}
        </ul>
      ) : ai && (
        <ul className="u-engines">
          {ai.engines.map((e) => (
            <li key={e.engine}>
              <strong>{e.label}</strong> — {e.state.replace('_', ' ')}
              {e.lastRun ? `, last run ${formatWhen(e.lastRun.finishedAt)}` : ''}
            </li>
          ))}
        </ul>
      )}
      <p className="u-p-h">Give the team a goal</p>
      <NewGoalButtons />
      <button className="btn btn-ghost u-p-btn" onClick={() => onNavigate('pipelines')}>
        Open pipeline board <Icon name="arrow" size={14} />
      </button>
    </div>
  );
}

function BrandPanel({ id, data, live, onNavigate, onPick }: { id: ProductId; data: DashboardData; live: Summary | null; onNavigate: (v: View) => void; onPick: (id: string) => void }) {
  const p = data.products.find((x) => x.id === id)!;
  const goals = live?.workflows.filter((w) => w.brand === id).slice(0, 5) ?? null;
  const team = AGENTS.filter((a) => a.team === id);
  const pipes = data.pipelines.filter((x) => x.brand === id).slice(0, 4);
  const findings = data.research.filter((f) => f.brand === id).slice(0, 2);
  return (
    <div className="u-p" style={{ ['--accent' as string]: p.accent }}>
      <p className="eyebrow">{TEAMS[id]?.name.split(' — ')[1] ?? 'Brand'}</p>
      <h2 className="u-p-title">{p.name}</h2>
      <p className="u-p-sub">{p.description}</p>
      <p className="u-p-h">Team · {team.length} agents</p>
      <div className="u-chips">
        {team.map((a) => (
          <button key={a.id} className="u-chip" onClick={() => onPick(a.id)}>{a.name}</button>
        ))}
      </div>
      <p className="u-p-h">{goals ? 'Goals' : 'Pipelines'}</p>
      {goals ? (
        goals.length ? (
          <ul className="u-list">
            {goals.map((g) => (
              <li key={g.id}>
                <span className={`pill ${WF_STATUS[g.status]?.cls ?? 'pill-idle'}`}>{WF_STATUS[g.status]?.label ?? g.status}</span> {g.title}
                <span className="u-muted">
                  {' '}
                  · {g.done}/{g.steps} steps · {formatWhen(g.updated_at)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="u-muted">No goals yet for {p.name}.</p>
        )
      ) : pipes.length ? (
        <ul className="u-list">
          {pipes.map((x) => (
            <li key={x.id}>
              <span className={`pstat pstat-${x.status}`}>{x.status.replace('_', ' ')}</span> {x.title}
              <span className="u-muted"> · {TEMPLATES[x.template]?.name}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="u-muted">No pipelines yet for {p.name}.</p>
      )}
      <p className="u-p-h">Latest research</p>
      {findings.length ? (
        <ul className="u-list">
          {findings.map((f) => (
            <li key={f.id}>
              {f.title}
              <br />
              <a href={f.evidence[0].url} target="_blank" rel="noreferrer">{f.evidence[0].source}</a>
              <span className="u-muted"> · {formatWhen(f.createdAt)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="u-muted">NARADA hasn’t reported on {p.name} yet.</p>
      )}
      <button className="btn btn-primary u-p-btn" onClick={() => onNavigate(id)}>
        Open {p.name} workspace <Icon name="arrow" size={14} />
      </button>
    </div>
  );
}

function AgentPanel({ id, data, live, status, lastRun }: { id: string; data: DashboardData; live: Summary | null; status: NonNullable<SceneNode['status']>; lastRun?: Run }) {
  const a = agentById(id);
  if (!a) return null;
  const st = live?.agents.find((x) => x.id === id);
  const step = data.pipelines
    .flatMap((p) => p.steps.filter((s) => s.agent === id && s.status !== 'pending').map((s) => ({ p, s })))
    .sort((x, y) => Date.parse(y.p.updatedAt) - Date.parse(x.p.updatedAt))[0];
  return (
    <div className="u-p">
      <p className="eyebrow">{TEAMS[a.team]?.name.split(' — ')[0]}</p>
      <h2 className="u-p-title">{a.name}</h2>
      <p className="u-p-sub">{a.role}</p>
      <p className={`u-status u-status-${status}`}>{STATUS_TEXT[status]}</p>
      <p className="u-p-text">{a.mission}</p>
      {st && (
        <p className="u-p-text">
          <strong>Studio work:</strong>{' '}
          {st.total
            ? `${st.completed} done · ${st.failed} failed · ${st.running} working · ${st.queued} queued${st.last_activity ? ` · active ${formatWhen(st.last_activity)}` : ''}`
            : 'No steps run yet on the studio backend.'}
        </p>
      )}
      {!live && step && (
        <p className="u-p-text">
          <strong>Latest work:</strong> {step.s.deliverable} for “{step.p.title}” — {step.s.status.replace('_', ' ')}
          {step.s.qa ? ` (QA ${step.s.qa})` : ''}
        </p>
      )}
      {lastRun && (
        <p className="u-p-text">
          <strong>Last run:</strong> {formatWhen(lastRun.finishedAt)} — {lastRun.summary}
        </p>
      )}
      <p className="u-p-h">Delivers</p>
      <p className="u-p-text">{a.outputs.join('; ')}</p>
      <p className="u-p-h">Quality bar</p>
      <ul className="u-list u-ticks">
        {a.acceptance.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      {a.approvalRequired.length > 0 && <p className="approval">Needs your approval for: {a.approvalRequired.join(', ').replace(/_/g, ' ')}</p>}
      {a.limits && <p className="dir-limit">{a.limits}</p>}
      <p className="u-muted u-id"><code>{a.id}</code></p>
    </div>
  );
}
