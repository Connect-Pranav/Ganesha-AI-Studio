import { useState } from 'react';
import { BrandMark, hasLogo } from './BrandMark';
import { Icon, type IconName } from './Icon';
import { Card, EmptyState, LiveBadge, SourceBadge, agentNames, engineNames, formatWhen, productNames, timeAgo } from './ui';
import { openNewGoal } from './GoalModal';
import type { Activity, Agent, Metric, Product, ProductId, Task, TaskStatus, Workflow } from '../types';

/* ---------- Stat card ---------- */
export function StatCard({ metric, onClick }: { metric: Metric; onClick?: () => void }) {
  const body = (
    <>
      <p className="stat-label">{metric.label}</p>
      <p className="stat-value">{metric.value}</p>
      <div className="stat-foot">
        {metric.delta && <span className={`delta delta-${metric.trend ?? 'flat'}`}>{metric.delta}</span>}
        {metric.hint && <span className="stat-hint">{metric.hint}</span>}
      </div>
    </>
  );
  if (!onClick) return <div className="stat">{body}</div>;
  return (
    <button type="button" className="stat stat-link" onClick={onClick} aria-label={`${metric.label}: ${metric.value}. Open details`}>
      {body}
      <span className="stat-go" aria-hidden="true">›</span>
    </button>
  );
}

/** Scroll a section into view once it has rendered (e.g. right after switching tabs). */
export function scrollToSection(id: string) {
  let tries = 0;
  const go = () => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else if (tries++ < 20) requestAnimationFrame(go);
  };
  requestAnimationFrame(go);
}

/* ---------- Product card ---------- */
export function ProductCard({ product, onOpen }: { product: Product; onOpen: (id: ProductId) => void }) {
  return (
    <article className="product" style={{ ['--accent' as string]: product.accent }}>
      <div className="product-top">
        <div className={`product-icon ${hasLogo(product.id) ? 'has-logo' : ''}`} aria-hidden="true">
          <BrandMark id={product.id} size={64} iconSize={20} />
        </div>
        <LiveBadge label="Counts" />
      </div>
      <h3 className="product-name">{product.name}</h3>
      <p className="product-tag">{product.tagline}</p>
      <dl className="product-metrics">
        {product.metrics.map((m) => (
          <div key={m.label}>
            <dt>{m.label}</dt>
            <dd>{m.value}</dd>
          </div>
        ))}
      </dl>
      <button className="btn btn-ghost product-open" onClick={() => onOpen(product.id)}>
        Open workspace <Icon name="arrow" size={16} />
      </button>
    </article>
  );
}

/* ---------- Agents ---------- */
const stateLabel: Record<Agent['state'], string> = {
  running: 'Running',
  idle: 'Ready',
  paused: 'Paused',
  error: 'Last run failed',
  never_run: 'Not run yet',
};
const statePill: Record<Agent['state'], string> = {
  running: 'pill-running',
  idle: 'pill-running',
  paused: 'pill-paused',
  error: 'pill-error',
  never_run: 'pill-idle',
};

export function AgentPanel({ agents, live, detailed = false }: { agents: Agent[]; live: boolean; detailed?: boolean }) {
  return (
    <Card title="Agent workspace" action={<SourceBadge live={live} />}>
      <ul className={`agents ${detailed ? 'agents-detailed' : ''}`}>
        {agents.map((a) => (
          <li key={a.id} className="agent">
            <div className="agent-avatar" aria-hidden="true">{a.name[0]}</div>
            <div className="agent-body">
              <div className="agent-row">
                <span className="agent-name">{a.name}</span>
                <span className={`pill ${statePill[a.state]}`}>{stateLabel[a.state]}</span>
              </div>
              <p className="agent-role">{a.role}</p>
              {detailed && <p className="agent-desc">{a.description}</p>}
              <p className="agent-task">{a.currentTask ?? (live ? 'No open task' : 'Waiting for a task')}</p>
              {a.lastRun && (
                <p className={`agent-meta ${a.lastRun.status === 'failed' ? 'meta-error' : ''}`}>
                  Last run {formatWhen(a.lastRun.finishedAt)} via {engineNames[a.lastRun.engine]} · {a.lastRun.summary}
                </p>
              )}
            </div>
            {a.id !== 'code-shakti' && (
              <button className="btn btn-small" onClick={() => openNewGoal(a.id === 'narada' ? 'research_brief' : undefined)}>
                Give a goal
              </button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ---------- Activity ---------- */
const kindIcon: Record<Activity['kind'], IconName> = {
  task: 'check',
  research: 'research',
  code: 'code',
  publish: 'content',
  system: 'connection',
};

export function ActivityFeed({ items, live }: { items: Activity[]; live: boolean }) {
  return (
    <Card title="Recent activity" action={<SourceBadge live={live} />}>
      {items.length === 0 ? (
        <EmptyState title="No activity yet" hint="Agent actions and releases will appear here." />
      ) : (
        <ul className="activity">
          {items.map((a) => (
            <li key={a.id}>
              <span className={`act-icon act-${a.kind}`} aria-hidden="true">
                <Icon name={kindIcon[a.kind]} size={15} />
              </span>
              <div className="act-body">
                <p className="act-text">{a.text}</p>
                <p className="act-meta">
                  {productNames[a.product]}
                  {a.agent && ` · ${agentNames[a.agent]}`}
                  {a.engine && ` · ${engineNames[a.engine]}`} · {timeAgo(a.minutesAgo)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ---------- Tasks ---------- */
const statusLabel: Record<TaskStatus, string> = {
  queued: 'Queued',
  in_progress: 'In progress',
  review: 'Review',
  done: 'Done',
};
export function TaskBoard({ tasks, live }: { tasks: Task[]; live: boolean }) {
  const [filter, setFilter] = useState<TaskStatus | 'all'>('all');
  const shown = filter === 'all' ? tasks : tasks.filter((t) => t.status === filter);
  const count = (s: TaskStatus) => tasks.filter((t) => t.status === s).length;

  return (
    <Card title="Task status" action={<SourceBadge live={live} />}>
      <div className="tabs" role="tablist" aria-label="Filter tasks">
        {(['all', 'queued', 'in_progress', 'review', 'done'] as const).map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={filter === s}
            className={`tab ${filter === s ? 'active' : ''}`}
            onClick={() => setFilter(s)}
          >
            {s === 'all' ? 'All' : statusLabel[s]}
            <span className="tab-count">{s === 'all' ? tasks.length : count(s)}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <EmptyState
          title={tasks.length === 0 ? 'No tasks yet' : 'Nothing in this column'}
          hint={tasks.length === 0 ? 'GANESHA plans tasks from NARADA research on each agent run.' : undefined}
        />
      ) : (
        <ul className="tasks">
          {shown.map((t) => (
            <li key={t.id} className="task">
              <span className={`prio prio-${t.priority}`} title={`${t.priority} priority`} />
              <div className="task-body">
                <p className="task-title">{t.title}</p>
                <p className="task-meta">
                  {productNames[t.product]} · {agentNames[t.agent]}
                  {t.requiresApproval && <span className="approval">Needs approval</span>}
                  {t.prUrl && (
                    <a className="pr-link" href={t.prUrl} target="_blank" rel="noreferrer">
                      Review PR
                    </a>
                  )}
                </p>
                {t.reason && <p className="task-reason">{t.reason}</p>}
              </div>
              <span className={`status status-${t.status}`}>{statusLabel[t.status]}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ---------- Workflows ---------- */
export function WorkflowMonitor({ workflows }: { workflows: Workflow[] }) {
  return (
    <Card title="Workflow monitoring" action={<SourceBadge live={workflows.length > 0} />}>
      {workflows.length === 0 ? (
        <EmptyState title="No pipelines yet" hint="File a goal and GANESHA turns it into a pipeline on the next run." />
      ) : (
        <ul className="workflows">
          {workflows.map((w) => {
            const done = w.steps.filter((s) => s.state === 'done').length;
            const failed = w.steps.some((s) => s.state === 'failed');
            return (
              <li key={w.id} className="workflow">
                <div className="wf-head">
                  <div>
                    <p className="wf-name">{w.name}</p>
                    <p className="wf-meta">{productNames[w.product]}</p>
                  </div>
                  <span className={`pill ${failed ? 'pill-error' : 'pill-running'}`}>
                    {failed ? 'Needs attention' : `${done}/${w.steps.length} steps`}
                  </span>
                </div>
                <ol className="steps">
                  {w.steps.map((s) => (
                    <li key={s.name} className={`step step-${s.state}`}>
                      <span className="step-dot" aria-hidden="true" />
                      <span className="step-name">{s.name}</span>
                      <span className="sr-only"> — {s.state}</span>
                    </li>
                  ))}
                </ol>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ---------- Quick actions ---------- */
export type QuickActionKind = 'content' | 'research' | 'code' | 'analytics';

const actions: { kind: QuickActionKind; label: string; desc: string; icon: IconName }[] = [
  { kind: 'content', label: 'Create content', desc: 'Script, track or theme', icon: 'content' },
  { kind: 'research', label: 'Research', desc: 'Ask NARADA', icon: 'research' },
  { kind: 'code', label: 'Coding task', desc: 'Send to CODE-SHAKTI', icon: 'code' },
  { kind: 'analytics', label: 'Analytics', desc: 'Real channel report (SOMA)', icon: 'analytics' },
];

export function QuickActions({ onAction }: { onAction: (k: QuickActionKind) => void }) {
  return (
    <Card title="Quick actions">
      <div className="quick">
        {actions.map((a) => (
          <button key={a.kind} className="quick-btn" onClick={() => onAction(a.kind)}>
            <span className="quick-icon" aria-hidden="true">
              <Icon name={a.icon} />
            </span>
            <span className="quick-label">{a.label}</span>
            <span className="quick-desc">{a.desc}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}
