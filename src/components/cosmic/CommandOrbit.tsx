// Cosmic Command Center: GANESHA CBO at the centre, the 31 agents on team orbits, live links from the
// CBO to agents that are working right now, and instrument chips for money, approvals, providers,
// subscriptions and deadlines. Every value is from the CBO report / studio summary (real records).
import { useMemo } from 'react';
import { AGENTS, TEAMS } from '../../data/agentsMeta';
import { useStudio } from '../../services/StudioContext';
import { inr, type Report } from '../../services/cboService';

const ORBITS: { team: string; r: number }[] = [
  { team: 'master', r: 0.2 },
  { team: 'ops', r: 0.31 },
  { team: 'sunverse', r: 0.42 },
  { team: 'littleloop', r: 0.42 },
  { team: 'foliocraft', r: 0.42 },
];
// The three brand teams share the outer orbit, each in its own arc.
const ARC: Record<string, [number, number]> = { sunverse: [-80, 40], littleloop: [50, 170], foliocraft: [180, 280] };

type NodeState = 'working' | 'waiting' | 'failed' | 'idle';

export function CommandOrbit({ rep }: { rep: Report }) {
  const { summary } = useStudio();
  const stat = useMemo(() => new Map((summary?.agents ?? []).map((a) => [a.id, a])), [summary]);
  const working = new Set(rep.agents.workingIds);
  const blockedAgents = new Set(rep.blockers.map((b) => b.agentId));
  const W = 640;
  const H = 520;
  const cx = W / 2;
  const cy = H / 2;
  const S = Math.min(W, H);

  const nodes = AGENTS.filter((a) => a.id !== 'ganesha_orchestrator').map((a) => {
    const o = ORBITS.find((x) => x.team === a.team)!;
    const peers = AGENTS.filter((x) => x.team === a.team && x.id !== 'ganesha_orchestrator');
    const i = peers.findIndex((x) => x.id === a.id);
    const [a0, a1] = ARC[a.team] ?? [0, 360];
    const span = a1 - a0;
    const deg = a0 + (span * (i + 0.5)) / peers.length;
    const rad = (deg * Math.PI) / 180;
    const s = stat.get(a.id);
    const state: NodeState = working.has(a.id) ? 'working' : s?.recent_failed || blockedAgents.has(a.id) ? 'failed' : s?.waiting ? 'waiting' : 'idle';
    return { id: a.id, name: a.name, role: a.role, team: a.team, x: cx + Math.cos(rad) * o.r * S, y: cy + Math.sin(rad) * o.r * S, state };
  });
  const m = rep.money;
  const monthly = m.budgets.find((b) => b.scope === 'monthly_total');
  const subs = rep.subscriptions && !('error' in rep.subscriptions) ? rep.subscriptions : null;
  const renewSoon = subs?.services.filter((s) => s.daysUntilRenewal !== null && s.daysUntilRenewal <= 7) ?? [];
  const provOk = rep.health.providers.filter((p) => p.state === 'last_request_ok').length;
  const counts = { working: nodes.filter((n) => n.state === 'working').length, waiting: nodes.filter((n) => n.state === 'waiting').length, failed: nodes.filter((n) => n.state === 'failed').length };

  return (
    <section className="cc-wrap" aria-label="Cosmic command center">
      <div className="cc-stage">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`GANESHA CBO with ${nodes.length + 1} agents: ${counts.working} working, ${counts.waiting} waiting for you, ${counts.failed} with recent failures.`}>
          <defs>
            <radialGradient id="ccCore">
              <stop offset="0%" stopColor="#a78bfa" />
              <stop offset="35%" stopColor="#7c5cff" />
              <stop offset="75%" stopColor="#6d4dff" />
              <stop offset="100%" stopColor="#312e81" />
            </radialGradient>
            <filter id="ccGlow" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="4" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <g className="cc-spin">
            {[0.2, 0.31, 0.42].map((r) => (
              <circle key={r} className="cc-ring" cx={cx} cy={cy} r={r * S} />
            ))}
          </g>
          {nodes
            .filter((n) => n.state === 'working')
            .map((n) => (
              <line key={`l-${n.id}`} className="cc-link" x1={cx} y1={cy} x2={n.x} y2={n.y} />
            ))}
          {Object.entries(ARC).map(([team, [a0, a1]]) => {
            const mid = (((a0 + a1) / 2) * Math.PI) / 180;
            return (
              <text key={team} className="cc-team-label" x={cx + Math.cos(mid) * 0.49 * S} y={cy + Math.sin(mid) * 0.49 * S} textAnchor="middle">
                {TEAMS[team]?.name.split('—')[0].trim() ?? team}
              </text>
            );
          })}
          {nodes.map((n) => (
            <circle key={n.id} className={`cc-node ${n.state}`} cx={n.x} cy={n.y} r={n.state === 'idle' ? 6 : 8}>
              <title>{`${n.name} — ${n.role} (${n.state})`}</title>
            </circle>
          ))}
          <circle className="cc-core" cx={cx} cy={cy} r={44} />
          <text className="cc-core-label" x={cx} y={cy - 2}>
            GANESHA
          </text>
          <text className="cc-core-sub" x={cx} y={cy + 14}>
            CBO · {rep.health.dispatchPaused ? 'dispatch paused' : `${rep.tasks.byState.RUNNING} running`}
          </text>
        </svg>
        <div className="cc-legend" aria-hidden="true">
          <span>
            <i style={{ background: 'var(--cyan)' }} />
            working {counts.working}
          </span>
          <span>
            <i style={{ background: 'var(--amber)' }} />
            waiting for you {counts.waiting}
          </span>
          <span>
            <i style={{ background: 'var(--err)' }} />
            recent failure {counts.failed}
          </span>
          <span>
            <i style={{ background: '#4b5584' }} />
            idle
          </span>
        </div>
      </div>
      <div className="cc-side">
        <Chip label="Active tasks" value={`${rep.tasks.byState.RUNNING + rep.tasks.byState.READY}`} sub={`${rep.tasks.byState.ASSIGNED} waiting upstream`} />
        <Chip label="Approvals" value={`${rep.approvals.length}`} sub="content + budget" hot={rep.approvals.length > 0} />
        <Chip label="Budget used" value={monthly ? `${Math.round((monthly.usedInr / Math.max(1e-9, monthly.limitInr)) * 100)}%` : '—'} sub={monthly ? `${inr(monthly.usedInr)} of ${inr(monthly.limitInr)}` : 'no monthly budget set'} hot={Boolean(monthly?.warning)} />
        <Chip label="Spend (month)" value={m.fxSet ? inr(m.actualMonthInr) : '—'} sub={m.fxSet ? 'GANESHA API, reconciled' : 'set USD→INR rate'} />
        <Chip label="Providers OK" value={`${provOk}/${rep.health.providers.length}`} sub="last request succeeded" hot={provOk < rep.health.providers.length} />
        <Chip label="Deadlines" value={`${rep.deadlines.overdue.length}`} sub={`overdue · ${rep.deadlines.upcoming7d.length} due in 7 d`} hot={rep.deadlines.overdue.length > 0} />
        <Chip label="Subscriptions" value={subs ? `${subs.services.filter((s) => s.plan).length}/4` : '—'} sub={renewSoon.length ? `${renewSoon.map((s) => s.name).join(', ')} renew soon` : 'plans imported'} hot={renewSoon.length > 0} />
        <Chip label="Alerts" value={`${(subs?.alerts.length ?? 0) + rep.blockers.length}`} sub="subscription + task" hot={(subs?.alerts.length ?? 0) + rep.blockers.length > 0} />
      </div>
    </section>
  );
}

function Chip({ label, value, sub, hot }: { label: string; value: string; sub: string; hot?: boolean }) {
  return (
    <div className={`cc-chip ${hot ? 'hot' : ''}`}>
      <p>{label}</p>
      <p>{value}</p>
      <p className="cx-sub">{sub}</p>
    </div>
  );
}
