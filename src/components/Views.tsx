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
          <AgentPanel agents={data.agents} onToggle={p.onToggleAgent} />
          <WorkflowMonitor workflows={data.workflows} />
          <TaskBoard tasks={data.tasks} onAdvance={p.onAdvanceTask} />
        </div>
        <div className="col">
          <QuickActions onAction={p.onQuickAction} />
          <AiStatusCard status={p.ai} checking={p.aiChecking} onRecheck={p.onRecheckAi} onConnect={p.onConnectAi} />
          <ActivityFeed items={data.activity} />
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
          <Pipeline product={product} />
          <WorkflowMonitor workflows={workflows} />
          <TaskBoard tasks={tasks} onAdvance={p.onAdvanceTask} />
        </div>
        <div className="col">
          <QuickActions onAction={p.onQuickAction} />
          <ActivityFeed items={activity} />
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
        <AgentPanel agents={p.data.agents} onToggle={p.onToggleAgent} detailed />
      </div>
      <div className="col">
        <Card title="How agents work in Demo Mode">
          <ul className="bullets">
            <li>GANESHA routes each task to the right agent and keeps brands separate.</li>
            <li>NARADA research must cite sources; unverified claims get flagged.</li>
            <li>CODE-SHAKTI reports only real build and test results.</li>
            <li>Right now agents are simulated — pausing or resuming only changes this screen.</li>
          </ul>
        </Card>
        <TaskBoard tasks={p.data.tasks} onAdvance={p.onAdvanceTask} />
      </div>
    </div>
  );
}

/* ---------- Connection ---------- */
export function ConnectionView(p: Common) {
  return (
    <div className="narrow">
      <AiStatusCard status={p.ai} checking={p.aiChecking} onRecheck={p.onRecheckAi} onConnect={p.onConnectAi} full />
      <Card title="Environment variables">
        <table className="env-table">
          <thead>
            <tr>
              <th>Variable</th>
              <th>Where</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>VITE_AI_STATUS_ENDPOINT</code></td>
              <td>Frontend (.env.local)</td>
              <td>Your backend's status URL. Optional; empty = Demo Mode.</td>
            </tr>
            <tr>
              <td><code>AI_PROVIDER</code></td>
              <td>Backend only</td>
              <td>Provider name, read by the server adapter.</td>
            </tr>
            <tr>
              <td><code>AI_API_KEY</code></td>
              <td>Backend only</td>
              <td>Secret key. Never in the browser or in Git.</td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}
