import { Card, EmptyState, LiveBadge, formatWhen, productNames } from './ui';
import { Icon } from './Icon';
import { ActivityFeed, AgentPanel, ProductCard, QuickActions, StatCard, TaskBoard, type QuickActionKind } from './Widgets';
import { describeProvider } from './Connection';
import { agentName } from '../data/agentsMeta';
import { useStudio, OPEN_STATUSES, WF_STATUS } from '../services/StudioContext';
import type { Summary } from '../services/studioService';
import { ResearchPanel, RunHistory } from './AgentWidgets';
import { AgentDirectory, PipelineBoard } from './PipelineWidgets';
import { StudioWorkflows } from './StudioWorkflows';
import type { AiStatus, DashboardData, ProductId, View } from '../types';

export interface ViewHandlers {
  onOpenProduct: (id: ProductId) => void;
  onQuickAction: (k: QuickActionKind) => void;
  onRecheckAi: () => void;
  onConnectAi: () => void;
}

interface Common extends ViewHandlers {
  data: DashboardData;
  ai: AiStatus | null;
  aiChecking: boolean;
}

/* ---------- Overview ---------- */
const pl = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const BRAND_IDS: ProductId[] = ['sunverse', 'littleloop', 'foliocraft'];

/** Live per-brand counts from the backend replace the scheduled-runner counts when unlocked. */
function liveProducts(data: DashboardData, s: Summary | null) {
  if (!s) return data.products;
  return data.products.map((prod) => {
    const c = s.counts.workflowsByBrand[prod.id] ?? {};
    const open = Object.entries(c).filter(([k]) => OPEN_STATUSES.includes(k)).reduce((x, [, v]) => x + v, 0);
    return {
      ...prod,
      metrics: [
        { label: 'Goals in progress', value: String(open) },
        { label: 'Waiting for you', value: String((c.waiting_for_approval ?? 0) + (c.waiting_for_external_action ?? 0)) },
        { label: 'Done', value: String(c.completed ?? 0) },
      ],
    };
  });
}

function NeedsYou({ s, onOpen }: { s: Summary; onOpen: () => void }) {
  const waiting = s.workflows.filter((w) => w.status === 'waiting_for_approval' || w.status === 'waiting_for_external_action');
  const failed = s.workflows.filter((w) => w.status === 'failed').slice(0, 3);
  return (
    <Card title="Needs you" action={waiting.length + failed.length ? <span className="pill pill-warn">{waiting.length + failed.length}</span> : undefined}>
      {waiting.length + failed.length === 0 ? (
        <EmptyState title="Nothing waiting" hint="Approvals, manual steps and failures show up here and in the 🔔 bell." />
      ) : (
        <ul className="needs">
          {[...waiting, ...failed].map((w) => (
            <li key={w.id}>
              <span className={`pill ${WF_STATUS[w.status]?.cls ?? 'pill-idle'}`}>{WF_STATUS[w.status]?.label ?? w.status}</span>
              <span className="needs-title">{w.title}</span>
              <span className="stat-hint">
                {productNames[w.brand as keyof typeof productNames] ?? w.brand} · {formatWhen(w.updated_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <button className="btn btn-small" onClick={onOpen}>
        Open pipelines <Icon name="arrow" size={14} />
      </button>
    </Card>
  );
}

function AgentHealth({ s }: { s: Summary }) {
  const working = s.agents.filter((a) => a.running > 0).length;
  const queued = s.agents.reduce((x, a) => x + a.queued, 0);
  const everFailed = s.agents.filter((a) => a.failed > 0);
  const used = s.agents.filter((a) => a.total > 0).length;
  const prov = s.providers.map((p) => describeProvider(p, p.state !== 'not_configured'));
  return (
    <Card title="Agent health">
      <dl className="kv-row">
        <div>
          <dt>Working now</dt>
          <dd>{working}</dd>
        </div>
        <div>
          <dt>Steps queued</dt>
          <dd>{queued}</dd>
        </div>
        <div>
          <dt>Agents with work assigned</dt>
          <dd>
            {used} / {s.agents.length}
          </dd>
        </div>
        <div>
          <dt>Failed steps · 7 d</dt>
          <dd>{s.counts.failedTasks7d}</dd>
        </div>
      </dl>
      <ul className="integ">
        {s.providers.map((p, i) => (
          <li key={p.provider}>
            <span className="integ-name">{p.provider === 'gemini' ? 'Gemini' : 'Claude'}</span>
            <span className={`ai-pill tone-${prov[i].tone}`}>{prov[i].label}</span>
            <span className="integ-detail">{prov[i].detail}</span>
          </li>
        ))}
      </ul>
      {everFailed.length > 0 && (
        <p className="ai-note">Agents with failed steps: {everFailed.map((a) => agentName(a.id)).join(', ')}. Open the goal in Pipelines to see the error and retry.</p>
      )}
    </Card>
  );
}

function LiveEvents({ s }: { s: Summary }) {
  return (
    <Card title="Live activity" action={s.events.length ? <LiveBadge /> : undefined}>
      {s.events.length ? (
        <ul className="activity">
          {s.events.slice(0, 10).map((e) => (
            <li key={e.id}>
              <div className="act-body">
                <p className="act-text">{e.message}</p>
                <p className="act-meta">
                  {e.workflow_title ?? 'Studio'} · {formatWhen(e.created_at)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No backend activity yet" />
      )}
    </Card>
  );
}

export function OverviewView(p: Common & { onNavigate: (v: View) => void }) {
  const { data } = p;
  const { summary, locked } = useStudio();
  const s = !locked ? summary : null;
  const wf = s?.counts.workflowsByStatus ?? {};
  const open = Object.entries(wf).filter(([k]) => OPEN_STATUSES.includes(k)).reduce((x, [, v]) => x + v, 0);
  const kpis = s
    ? [
        { label: 'Goals in progress', value: String(open), hint: `${wf.completed ?? 0} done so far` },
        { label: 'Waiting for you', value: String((wf.waiting_for_approval ?? 0) + (wf.waiting_for_external_action ?? 0)), hint: `${pl(s.counts.approvalsByStatus.pending ?? 0, 'approval')} pending` },
        { label: 'Agents working now', value: String(s.agents.filter((a) => a.running > 0).length), hint: `${pl(s.agents.reduce((x, a) => x + a.queued, 0), 'step')} queued` },
        { label: 'Failed steps · 7 days', value: String(s.counts.failedTasks7d), hint: s.counts.failedTasks7d ? 'Retry from Pipelines' : 'No failures', trend: s.counts.failedTasks7d ? ('down' as const) : ('flat' as const) },
      ]
    : data.overview;

  return (
    <>
      {locked && <p className="notice">Showing scheduled-runner data only. Unlock (🔔 bell or AI Connection) to see live goals, approvals and agent health.</p>}
      <section className="grid-4" aria-label="Key metrics">
        {kpis.map((m) => (
          <StatCard key={m.label} metric={m} />
        ))}
      </section>

      <section aria-label="Brands">
        <div className="section-head">
          <h2 className="section-title">Brands</h2>
          <p className="section-sub">Three separate workspaces — data never mixes.</p>
        </div>
        <div className="grid-3">
          {liveProducts(data, s)
            .filter((x) => BRAND_IDS.includes(x.id))
            .map((prod) => (
              <ProductCard key={prod.id} product={prod} onOpen={p.onOpenProduct} />
            ))}
        </div>
      </section>

      <div className="grid-main">
        <div className="col">
          <StudioWorkflows title="Latest goals" compact />
          {s ? <AgentHealth s={s} /> : <AgentPanel agents={data.agents} live={data.live.agents} />}
          <ResearchPanel findings={data.research} limit={3} title="Latest NARADA research" />
          <TaskBoard tasks={data.tasks.filter((t) => t.status !== 'done').slice(0, 8)} live={data.live.tasks} />
        </div>
        <div className="col">
          {s && <NeedsYou s={s} onOpen={() => p.onNavigate('pipelines')} />}
          <QuickActions onAction={p.onQuickAction} />
          {s && <LiveEvents s={s} />}
          <ActivityFeed items={data.activity.slice(0, 10)} live={data.live.activity} />
        </div>
      </div>
    </>
  );
}

/* ---------- Agents ---------- */
export function AgentsView(p: Common) {
  return (
    <div className="grid-main">
      <div className="col">
        <AgentDirectory pipelines={p.data.pipelines} liveAgents={p.data.agents} />
      </div>
      <div className="col">
        <RunHistory runs={p.data.runs} />
        <Card title="How the agents work">
          <ul className="bullets">
            <li>
              <strong>31 agents</strong> in 5 teams. You post a goal; GANESHA routes it to a pipeline and the specialists
              work step by step.
            </li>
            <li>
              <strong>CHITRAGUPTA</strong> (quality) and <strong>DHARMA</strong> (safety) gate every pipeline — failures
              go back for one fix.
            </li>
            <li>
              <strong>NARADA</strong> researches each brand daily and must cite real sources — no source, no finding.
            </li>
            <li>
              <strong>GANESHA</strong> turns findings into at most 3 tasks per brand and routes them to the right agent.
            </li>
            <li>
              <strong>CODE-SHAKTI</strong> picks one coding task, opens a pull request and waits — you approve by
              merging.
            </li>
            <li>Anything that publishes, spends money or deploys is marked “Needs approval”.</li>
            <li>Every output is schema-validated before it reaches this page.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

/* ---------- Pipelines ---------- */
export function PipelinesView(p: Common) {
  return (
    <div className="grid-main">
      <div className="col">
        <StudioWorkflows />
        <PipelineBoard pipelines={p.data.pipelines} />
      </div>
      <div className="col">
        <Card title="How a goal flows">
          <ol className="flow">
            <li><strong>You</strong> start a goal with <strong>New goal</strong> on this page.</li>
            <li><strong>GANESHA</strong> builds the pipeline and the agents start within about 5 minutes.</li>
            <li><strong>Specialists</strong> produce each deliverable. Open any step and click <strong>View</strong> to read it.</li>
            <li><strong>DHARMA + CHITRAGUPTA</strong> check safety and quality; failures get one fix.</li>
            <li><strong>Approval</strong>: publishing, pricing or code merges stop here and appear in the 🔔 bell with Approve / Reject.</li>
            <li><strong>SAMVADA</strong> writes the handoff and the goal is done.</li>
          </ol>
          <p className="ai-note">Deliverables are private: they are only shown after you unlock with your admin token.</p>
        </Card>
        <ResearchPanel findings={p.data.research} limit={3} title="Latest NARADA research" />
      </div>
    </div>
  );
}
