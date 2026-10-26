import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { AgentAvatar } from './AgentAvatar';
import { AgentChat } from './AgentChat';
import { MushakDaily } from './MushakDaily';
import { Card, EmptyState, LiveBadge, formatWhen, productNames } from './ui';
import { AGENTS, TEAMS, TEMPLATES, agentName, type AgentMeta } from '../data/agentsMeta';
import { openNewGoal } from './GoalModal';
import type { Agent, Pipeline, PipelineStatus, StepStatus } from '../types';
import { useStudio } from '../services/StudioContext';
import { api } from '../services/adminService';
import type { AgentStat } from '../services/studioService';

const pStatusLabel: Record<PipelineStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  approval_required: 'Needs approval',
};
const stepLabel: Record<StepStatus, string> = {
  pending: 'pending',
  running: 'running',
  completed: 'done',
  failed: 'failed',
  approval_required: 'needs approval',
  skipped: 'skipped',
};

/* ---------- New goal buttons ---------- */
export function NewGoalButtons() {
  const goals = [
    { template: 'sunverse_song_release', text: 'Song' },
    { template: 'littleloop_episode', text: 'Episode' },
    { template: 'foliocraft_feature', text: 'Feature' },
    { template: 'research_brief', text: 'Research' },
  ];
  return (
    <div className="goal-btns">
      {goals.map((g) => (
        <button key={g.template} className="btn btn-small" onClick={() => openNewGoal(g.template)}>
          <Icon name="plus" size={14} /> {g.text}
        </button>
      ))}
    </div>
  );
}

/* ---------- Single pipeline ---------- */
function PipelineCard({ p }: { p: Pipeline }) {
  const done = p.steps.filter((s) => s.status === 'completed' || s.status === 'skipped').length;
  const pct = Math.round((done / p.steps.length) * 100);
  return (
    <li className={`pipe pipe-${p.status}`}>
      <div className="pipe-head">
        <div className="pipe-title-wrap">
          <p className="pipe-title">{p.title}</p>
          <p className="pipe-meta">
            {TEMPLATES[p.template]?.name ?? p.template} · {productNames[p.brand]} · updated {formatWhen(p.updatedAt)}
            {p.goalRef && (
              <>
                {' · '}
                {p.goalRef}
              </>
            )}
          </p>
        </div>
        <span className={`pstat pstat-${p.status}`}>{pStatusLabel[p.status]}</span>
      </div>
      <div className="pipe-bar" aria-label={`${pct}% complete`}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <ol className="pipe-steps">
        {p.steps.map((s) => (
          <li key={s.key} className={`chip chip-${s.status}`} title={`${s.deliverable} — ${stepLabel[s.status]}${s.attempts > 1 ? ` (attempt ${s.attempts})` : ''}`}>
            <span className="chip-name">{agentName(s.agent)}</span>
            <span className="chip-status">
              {s.gate && '◆ '}
              {stepLabel[s.status]}
            </span>
          </li>
        ))}
      </ol>
    </li>
  );
}

/* ---------- Board ---------- */
export function PipelineBoard({ pipelines, limit }: { pipelines: Pipeline[]; limit?: number }) {
  const [filter, setFilter] = useState<PipelineStatus | 'all'>('all');
  const order: (PipelineStatus | 'all')[] = ['all', 'approval_required', 'running', 'pending', 'failed', 'completed'];
  const count = (s: PipelineStatus) => pipelines.filter((p) => p.status === s).length;
  const shown = (filter === 'all' ? pipelines : pipelines.filter((p) => p.status === filter)).slice(0, limit ?? 100);

  return (
    <Card title="Earlier pipelines" action={pipelines.length ? <LiveBadge /> : undefined}>
      {pipelines.length > 0 && (
        <div className="tabs" role="tablist" aria-label="Filter pipelines">
          {order.map((s) => (
            <button key={s} role="tab" aria-selected={filter === s} className={`tab ${filter === s ? 'active' : ''}`} onClick={() => setFilter(s)}>
              {s === 'all' ? 'All' : pStatusLabel[s]}
              <span className="tab-count">{s === 'all' ? pipelines.length : count(s)}</span>
            </button>
          ))}
        </div>
      )}
      {shown.length === 0 ? (
        <EmptyState
          title={pipelines.length ? 'Nothing with this status' : 'No pipelines yet'}
          hint={pipelines.length ? undefined : 'Start a goal below and GANESHA assigns the team.'}
        />
      ) : (
        <ul className="pipes">
          {shown.map((p) => (
            <PipelineCard key={p.id} p={p} />
          ))}
        </ul>
      )}
      <p className="ai-note">Pipelines run earlier by the scheduled goal runner. New goals now run on the studio backend (Studio goals above).</p>
    </Card>
  );
}

/* ---------- Agent directory ---------- */
const ENGINE_OPTIONS: { value: string; label: string }[] = [
  { value: 'gemini', label: 'Gemini only' },
  { value: 'gemini,groq', label: 'Gemini, then Groq (both free)' },
  { value: 'groq,gemini', label: 'Groq, then Gemini (both free)' },
  { value: 'gemini,claude', label: 'Gemini, then Claude' },
  { value: 'claude', label: 'Claude only' },
  { value: 'claude,gemini', label: 'Claude, then Gemini' },
  { value: 'openai', label: 'ChatGPT (OpenAI) only — paid' },
  { value: 'openai,gemini', label: 'ChatGPT, then Gemini' },
  { value: 'gemini,openai', label: 'Gemini, then ChatGPT' },
];

interface LiveAgentInfo {
  stats: AgentStat | undefined;
  engines: string[] | undefined;
  usable: boolean | undefined; // at least one of its engines has a key on the Worker
}

function liveStatus(i: LiveAgentInfo): { label: string; cls: string } {
  const st = i.stats;
  if (st?.running) return { label: `Working (${st.running})`, cls: 'pill-running' };
  if (st?.waiting) return { label: 'Waiting for you', cls: 'pill-warn' };
  if (st?.queued) return { label: `Queued (${st.queued})`, cls: 'pill-idle' };
  if (i.usable === false) return { label: 'No AI engine', cls: 'pill-error' };
  return { label: 'Ready', cls: 'pill-idle' };
}

/** MUSHAK — the Growth agent (lead generation + approval-gated outreach). Not a pipeline agent. */
const MUSHAK_META: AgentMeta = {
  id: 'mushak_growth',
  name: 'MUSHAK',
  team: 'master',
  role: 'Growth — leads & outreach',
  mission: 'Finds real partners and customers for LittleLoop, Sunverse and Foliocraft, researches and scores them with evidence, and drafts honest outreach that goes out only after you approve.',
  outputs: ['Lead lists with sources', 'Scores with evidence', 'Outreach drafts', 'Reply summaries', 'Daily report'],
  acceptance: ['Only verified, sourced facts', 'Nothing sent without your approval', 'Opt-outs always respected'],
  approvalRequired: ['send_message'],
  engines: ['gemini'],
};

export function AgentDirectory({ pipelines, liveAgents }: { pipelines: Pipeline[]; liveAgents: Agent[] }) {
  const { summary, health, locked } = useStudio();
  const [team, setTeam] = useState<string>('all');
  const [engines, setEngines] = useState<Record<string, string[]> | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (locked) return setEngines(null);
    api<{ agents: { id: string; engines: string[] }[] }>('/api/agents')
      .then((r) => setEngines(Object.fromEntries(r.agents.map((a) => [a.id, a.engines]))))
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : 'Could not load engines'));
  }, [locked]);

  const keyOk = (e: string) => {
    const p = summary?.providers.find((x) => x.provider === e);
    if (p) return p.state !== 'not_configured';
    return e === 'gemini' ? Boolean(health?.geminiKeySet) : e === 'groq' ? Boolean(health?.groqKeySet) : e === 'claude' ? Boolean(health?.claudeKeySet) : false;
  };
  const setEngine = async (id: string, value: string) => {
    setSaving(id);
    setErr('');
    try {
      const r = await api<{ engines: string[] }>(`/api/agents/${id}/engines`, { method: 'PUT', body: JSON.stringify({ engines: value.split(',') }) });
      setEngines((m) => ({ ...(m ?? {}), [id]: r.engines }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(null);
    }
  };

  // Scheduled-runner signals (older JSON pipelines + run log), used when the backend is locked.
  const active = new Map<string, string>();
  for (const p of pipelines) for (const s of p.steps) if (s.status === 'running' || s.status === 'approval_required') active.set(s.agent, s.status);
  const lastRun = new Map(liveAgents.filter((a) => a.lastRun).map((a) => [a.lastRun!.agent, a.lastRun!]));
  const techId: Record<string, string> = { ganesha: 'ganesha_orchestrator', narada: 'narada_market_intelligence', 'code-shakti': 'code_shakti' };
  const runFor = (id: string) => [...lastRun.entries()].find(([k]) => techId[k] === id)?.[1];
  // MUSHAK has its own banner above the grid, so the grid lists the 31 pipeline agents only.
  const ALL = AGENTS;
  const shown = team === 'all' ? ALL : ALL.filter((a) => a.team === team);
  const live = !locked && Boolean(summary);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = openId ? ALL.find((a) => a.id === openId) ?? null : null;
  const [ptab, setPtab] = useState<'talk' | 'about' | 'report'>('talk');
  const openAgent = (id: string) => {
    setPtab('talk');
    setOpenId(id);
  };
  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpenId(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openId]);
  const statusFor = (id: string, info: LiveAgentInfo) => {
    if (live) return liveStatus(info);
    const s = active.get(id);
    return s === 'running' ? { label: 'Working', cls: 'pill-running' } : s ? { label: 'Awaiting approval', cls: 'pill-paused' } : { label: 'Idle', cls: 'pill-idle' };
  };

  return (
    <Card title={`Your agent team · ${ALL.length} agents`} action={live ? <LiveBadge /> : undefined}>
      <div className="tabs" role="tablist" aria-label="Filter by team">
        {['all', ...Object.keys(TEAMS)].map((t) => (
          <button key={t} role="tab" aria-selected={team === t} className={`tab ${team === t ? 'active' : ''}`} onClick={() => setTeam(t)}>
            {t === 'all' ? 'All' : TEAMS[t].name.split(' — ')[0]}
            <span className="tab-count">{t === 'all' ? ALL.length : ALL.filter((a) => a.team === t).length}</span>
          </button>
        ))}
      </div>
      {locked && <p className="ai-note">Unlock (🔔 or AI Connection) to see each agent’s live work and choose its AI engine.</p>}
      {err && <p className="drawer-notice error">{err}</p>}
      <ul className="ag-grid">
        {shown.map((a) => {
          const eng = engines?.[a.id];
          const info: LiveAgentInfo = { stats: summary?.agents.find((x) => x.id === a.id), engines: eng, usable: eng ? eng.some(keyOk) : undefined };
          const st = statusFor(a.id, info);
          return (
            <li key={a.id}>
              <button className={`ag-tile team-${a.team}`} onClick={() => openAgent(a.id)} aria-haspopup="dialog">
                <AgentAvatar agent={a} size={88} />
                <span className="ag-name">{a.name}</span>
                <span className="ag-role">{a.role}</span>
                <span className={`pill ${st.cls}`}>{st.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {open && createPortal((() => {
        const a = open;
        const run = runFor(a.id);
        const eng = engines?.[a.id];
        const info: LiveAgentInfo = { stats: summary?.agents.find((x) => x.id === a.id), engines: eng, usable: eng ? eng.some(keyOk) : undefined };
        const st = statusFor(a.id, info);
        const stats = info.stats;
        return (
          <div className="ag-modal-scrim" onClick={() => setOpenId(null)}>
            <div className={`ag-modal team-${a.team}`} role="dialog" aria-modal="true" aria-label={a.name} onClick={(e) => e.stopPropagation()}>
              <button className="icon-btn ag-close" onClick={() => setOpenId(null)} aria-label="Close">
                <Icon name="close" />
              </button>
              <div className="ag-modal-head">
                <AgentAvatar agent={a} size={120} />
                <div>
                  <p className="eyebrow">{TEAMS[a.team]?.name ?? a.team}</p>
                  <h2 className="ag-modal-name">{a.name}</h2>
                  <p className="ag-modal-role">{a.role}</p>
                  <span className={`pill ${st.cls}`}>{st.label}</span>
                </div>
              </div>
              <div className="ws-tabs" role="tablist" aria-label={`${a.name} panel`}>
                <button role="tab" aria-selected={ptab === 'talk'} className={`ws-tab ${ptab === 'talk' ? 'active' : ''}`} onClick={() => setPtab('talk')}>🙏 Talk</button>
                {a.id === MUSHAK_META.id && <button role="tab" aria-selected={ptab === 'report'} className={`ws-tab ${ptab === 'report' ? 'active' : ''}`} onClick={() => setPtab('report')}>Daily report</button>}
                <button role="tab" aria-selected={ptab === 'about'} className={`ws-tab ${ptab === 'about' ? 'active' : ''}`} onClick={() => setPtab('about')}>About</button>
              </div>
              {ptab === 'talk' && <AgentChat key={a.id} agentId={a.id} name={a.name} />}
              {ptab === 'report' && <MushakDaily />}
              {ptab === 'about' && (<>
              <p className="ag-mission">{a.mission}</p>
              {live && (
                <p className="dir-stats">
                  {stats?.total ? (
                    <>
                      {stats.completed} done · {stats.failed} failed{stats.gate ? ` · reviews ${stats.gate.pass} pass / ${stats.gate.fail} fail` : ''}
                      {stats.last_activity ? ` · active ${formatWhen(stats.last_activity)}` : ''}
                    </>
                  ) : a.id === 'ganesha_orchestrator' ? (
                    'Orchestrates every goal; runs no steps of its own'
                  ) : (
                    'No steps run yet'
                  )}
                </p>
              )}
              {a.outputs?.length > 0 && (
                <>
                  <h3 className="ag-h">Delivers</h3>
                  <ul className="bullets">{a.outputs.map((o) => <li key={o}>{o}</li>)}</ul>
                </>
              )}
              {a.acceptance?.length > 0 && (
                <>
                  <h3 className="ag-h">Checked against</h3>
                  <ul className="bullets">{a.acceptance.map((o) => <li key={o}>{o}</li>)}</ul>
                </>
              )}
              {a.approvalRequired.length > 0 && <p className="approval">Needs your approval for: {a.approvalRequired.join(', ').replace(/_/g, ' ')}</p>}
              {a.limits && <p className="dir-limit">{a.limits}</p>}
              {run && <p className="dir-run">Scheduled run {formatWhen(run.finishedAt)} · {run.summary}</p>}
              {eng ? (
                <label className="dir-engine">
                  <span>AI engine</span>
                  <select value={eng.join(',')} disabled={saving === a.id} onChange={(e) => setEngine(a.id, e.target.value)}>
                    {!ENGINE_OPTIONS.some((o) => o.value === eng.join(',')) && <option value={eng.join(',')}>{eng.join(', then ')}</option>}
                    {ENGINE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                        {o.value.split(',').every((x) => !keyOk(x)) ? ' (no key)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              ) : locked ? (
                <p className="ai-note">Unlock to see live work and choose this agent’s AI engine.</p>
              ) : null}
              <p className="dir-meta"><code>{a.id}</code></p>
              </>)}
            </div>
          </div>
        );
      })(), document.body)}
    </Card>
  );
}
