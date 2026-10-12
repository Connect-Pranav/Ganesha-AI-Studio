import { useState } from 'react';
import { Icon } from './Icon';
import { Card, EmptyState, LiveBadge, formatWhen, productNames } from './ui';
import { AGENTS, TEAMS, TEMPLATES, agentName, newGoalUrl, VAULT_URL } from '../data/agentsMeta';
import type { Agent, Pipeline, PipelineStatus, StepStatus } from '../types';

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
    { label: 'sunverse', text: 'Song', title: 'New Sunverse song: ' },
    { label: 'littleloop', text: 'Episode', title: 'New LittleLoop episode: ' },
    { label: 'foliocraft', text: 'Feature', title: 'Foliocraft feature: ' },
    { label: 'research', text: 'Research', title: 'Research: ' },
  ];
  return (
    <div className="goal-btns">
      {goals.map((g) => (
        <a key={g.label} className="btn btn-small" href={newGoalUrl(g.label, g.title)} target="_blank" rel="noreferrer">
          <Icon name="plus" size={14} /> {g.text}
        </a>
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
                <a href={`${VAULT_URL}/issues/${p.goalRef.split('#')[1]}`} target="_blank" rel="noreferrer">
                  {p.goalRef}
                </a>
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
    <Card title="Pipelines" action={pipelines.length ? <LiveBadge /> : undefined}>
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
          hint={pipelines.length ? undefined : 'Create a goal below — GANESHA picks it up on the next run and assigns the team.'}
        />
      ) : (
        <ul className="pipes">
          {shown.map((p) => (
            <PipelineCard key={p.id} p={p} />
          ))}
        </ul>
      )}
      <div className="goal-row">
        <span className="goal-label">New goal</span>
        <NewGoalButtons />
      </div>
    </Card>
  );
}

/* ---------- Agent directory ---------- */
export function AgentDirectory({ pipelines, liveAgents }: { pipelines: Pipeline[]; liveAgents: Agent[] }) {
  const [team, setTeam] = useState<string>('all');
  const active = new Map<string, string>();
  for (const p of pipelines) for (const s of p.steps) if (s.status === 'running' || s.status === 'approval_required') active.set(s.agent, s.status);
  const lastRun = new Map(liveAgents.filter((a) => a.lastRun).map((a) => [a.lastRun!.agent, a.lastRun!]));
  const techId: Record<string, string> = { ganesha: 'ganesha_orchestrator', narada: 'narada_market_intelligence', 'code-shakti': 'code_shakti' };
  const runFor = (id: string) => [...lastRun.entries()].find(([k]) => techId[k] === id)?.[1];
  const shown = team === 'all' ? AGENTS : AGENTS.filter((a) => a.team === team);

  return (
    <Card title={`Agent directory · ${AGENTS.length} agents`}>
      <div className="tabs" role="tablist" aria-label="Filter by team">
        {['all', ...Object.keys(TEAMS)].map((t) => (
          <button key={t} role="tab" aria-selected={team === t} className={`tab ${team === t ? 'active' : ''}`} onClick={() => setTeam(t)}>
            {t === 'all' ? 'All' : TEAMS[t].name.split(' — ')[0]}
            <span className="tab-count">{t === 'all' ? AGENTS.length : AGENTS.filter((a) => a.team === t).length}</span>
          </button>
        ))}
      </div>
      <ul className="dir">
        {shown.map((a) => {
          const st = active.get(a.id);
          const run = runFor(a.id);
          return (
            <li key={a.id} className="dir-item">
              <div className="dir-top">
                <span className="dir-avatar" aria-hidden="true">{a.name[0]}</span>
                <div className="dir-head">
                  <p className="dir-name">{a.name}</p>
                  <p className="dir-role">{a.role}</p>
                </div>
                <span className={`pill ${st === 'running' ? 'pill-running' : st ? 'pill-paused' : 'pill-idle'}`}>
                  {st === 'running' ? 'Working' : st ? 'Awaiting approval' : 'Available'}
                </span>
              </div>
              <p className="dir-mission">{a.mission}</p>
              <p className="dir-meta">
                <code>{a.id}</code>
                {a.approvalRequired.length > 0 && <span className="approval">Approval: {a.approvalRequired.join(', ').replace(/_/g, ' ')}</span>}
              </p>
              {a.limits && <p className="dir-limit">{a.limits}</p>}
              {run && <p className="dir-run">Last run {formatWhen(run.finishedAt)} · {run.summary}</p>}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

