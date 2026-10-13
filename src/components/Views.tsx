import { Icon } from './Icon';
import { Card, DemoBadge } from './ui';
import {
  ActivityFeed,
  AgentPanel,
  ProductCard,
  QuickActions,
  StatCard,
  TaskBoard,
  WorkflowMonitor,
  type QuickActionKind,
} from './Widgets';
import { ResearchPanel, RunHistory } from './AgentWidgets';
import { AgentDirectory, PipelineBoard } from './PipelineWidgets';
import { AiStatusCard } from './AiConnection';
import type { AgentId, AiStatus, DashboardData, Product, ProductId, TaskStatus } from '../types';

export interface ViewHandlers {
  onOpenProduct: (id: ProductId) => void;
  onAdvanceTask: (id: string, s: TaskStatus) => void;
  onToggleAgent: (id: AgentId) => void;
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
export function OverviewView(p: Common) {
  const { data } = p;
  return (
    <>
      <section className="grid-4" aria-label="Key metrics">
        {data.overview.map((m) => (
          <StatCard key={m.label} metric={m} />
        ))}
      </section>

      <section aria-label="Brands">
        <div className="section-head">
          <h2 className="section-title">Brands</h2>
          <p className="section-sub">Three separate workspaces — data never mixes.</p>
        </div>
        <div className="grid-3">
          {data.products.map((prod) => (
            <ProductCard key={prod.id} product={prod} onOpen={p.onOpenProduct} />
          ))}
        </div>
      </section>

      <div className="grid-main">
        <div className="col">
          <PipelineBoard pipelines={data.pipelines} limit={3} />
          <AgentPanel agents={data.agents} onToggle={p.onToggleAgent} live={data.live.agents} />
          <ResearchPanel findings={data.research} limit={4} title="Latest NARADA research" />
          <TaskBoard tasks={data.tasks} onAdvance={p.onAdvanceTask} live={data.live.tasks} />
          <WorkflowMonitor workflows={data.workflows} />
        </div>
        <div className="col">
          <QuickActions onAction={p.onQuickAction} />
          <AiStatusCard status={p.ai} checking={p.aiChecking} onRecheck={p.onRecheckAi} onConnect={p.onConnectAi} />
          <ActivityFeed items={data.activity} live={data.live.activity} />
        </div>
      </div>
    </>
  );
}

/* ---------- Product workspace ---------- */
function Pipeline({ product }: { product: Product }) {
  const max = Math.max(...product.pipeline.map((s) => s.count), 1);
  return (
    <Card title={product.id === 'foliocraft' ? 'Conversion funnel' : 'Production pipeline'} action={<DemoBadge />}>
      <ul className="pipeline">
        {product.pipeline.map((s) => (
          <li key={s.name}>
            <span className="pl-name">{s.name}</span>
            <span className="pl-track">
              <span className="pl-bar" style={{ width: `${Math.max((s.count / max) * 100, 3)}%` }} />
            </span>
            <span className="pl-count">{s.count.toLocaleString('en-IN')}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function ProductView(p: Common & { productId: ProductId }) {
  const product = p.data.products.find((x) => x.id === p.productId);
  if (!product) return null;
  const tasks = p.data.tasks.filter((t) => t.product === product.id);
  const activity = p.data.activity.filter((a) => a.product === product.id);
  const workflows = p.data.workflows.filter((w) => w.product === product.id);

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
        <button className="btn btn-primary" onClick={() => p.onQuickAction('content')}>
          <Icon name="plus" size={16} /> New task
        </button>
      </section>

      <section className="grid-3" aria-label={`${product.name} metrics`}>
        {product.metrics.map((m) => (
          <StatCard key={m.label} metric={{ ...m, hint: 'Demo' }} />
        ))}
      </section>

      <div className="grid-main">
        <div className="col">
          <ResearchPanel findings={p.data.research} brand={product.id} title={`NARADA research · ${product.name}`} />
          <TaskBoard tasks={tasks} onAdvance={p.onAdvanceTask} live={p.data.live.tasks} />
          <Pipeline product={product} />
          <WorkflowMonitor workflows={workflows} />
        </div>
        <div className="col">
          <QuickActions onAction={p.onQuickAction} />
          <ActivityFeed items={activity} live={p.data.live.activity} />
        </div>
      </div>
    </div>
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
        <PipelineBoard pipelines={p.data.pipelines} />
      </div>
      <div className="col">
        <Card title="How a goal flows">
          <ol className="flow">
            <li><strong>You</strong> post a goal (buttons below the board) — it opens a private issue in the vault.</li>
            <li><strong>GANESHA</strong> picks it up on the next run (every 3 hours, 8 AM–11 PM) and builds the pipeline.</li>
            <li><strong>Specialists</strong> produce each deliverable into the private vault.</li>
            <li><strong>DHARMA + CHITRAGUPTA</strong> check safety and quality; failures get one fix.</li>
            <li><strong>Approval</strong> — publishing, pricing or code merges stop here. Reply <code>approve</code> or <code>reject</code> on the issue.</li>
            <li><strong>SAMVADA</strong> writes the handoff and closes the goal.</li>
          </ol>
          <p className="ai-note">This public page shows status only. Lyrics, scripts and plans stay in the private vault.</p>
        </Card>
        <ResearchPanel findings={p.data.research} limit={3} title="Latest NARADA research" />
      </div>
    </div>
  );
}

/* ---------- Connection ---------- */
export function ConnectionView(p: Common) {
  return (
    <div className="narrow">
      <AiStatusCard status={p.ai} checking={p.aiChecking} onRecheck={p.onRecheckAi} onConnect={p.onConnectAi} full />
      <Card title="Where keys live">
        <table className="env-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Where</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>GEMINI_API_KEY</code></td>
              <td>GitHub repo secret</td>
              <td>Free Gemini key for the Actions engine. Never in the browser or Git.</td>
            </tr>
            <tr>
              <td><code>GEMINI_MODEL</code></td>
              <td>GitHub repo variable (optional)</td>
              <td>Model ID. Default <code>gemini-3.8-flash</code>.</td>
            </tr>
            <tr>
              <td>Claude</td>
              <td>Claude scheduled tasks</td>
              <td>Uses your Claude plan. No key stored anywhere.</td>
            </tr>
          </tbody>
        </table>
      </Card>
      <RunHistory runs={p.data.runs} />
    </div>
  );
}
