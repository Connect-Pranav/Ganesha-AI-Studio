import { useState } from 'react';
import { Card, EmptyState, LiveBadge, agentNames, engineNames, formatWhen, productNames } from './ui';
import { openNewGoal } from './GoalModal';
import type { BrandId, Finding, Run } from '../types';

/* ---------- NARADA research ---------- */
export function ResearchPanel({
  findings,
  brand,
  limit,
  title = 'NARADA research',
}: {
  findings: Finding[];
  brand?: BrandId;
  limit?: number;
  title?: string;
}) {
  const [filter, setFilter] = useState<BrandId | 'all'>(brand ?? 'all');
  const scoped = brand ? findings.filter((f) => f.brand === brand) : findings;
  const shown = (filter === 'all' ? scoped : scoped.filter((f) => f.brand === filter)).slice(0, limit ?? 50);

  return (
    <Card title={title} action={findings.length ? <LiveBadge /> : undefined}>
      {!brand && findings.length > 0 && (
        <div className="tabs" role="tablist" aria-label="Filter research by brand">
          {(['all', 'littleloop', 'sunverse', 'foliocraft'] as const).map((b) => (
            <button
              key={b}
              role="tab"
              aria-selected={filter === b}
              className={`tab ${filter === b ? 'active' : ''}`}
              onClick={() => setFilter(b)}
            >
              {b === 'all' ? 'All' : productNames[b]}
            </button>
          ))}
        </div>
      )}
      {shown.length === 0 ? (
        <EmptyState
          title={findings.length === 0 ? 'NARADA has not run yet' : 'No findings for this brand yet'}
          hint={
            findings.length === 0
              ? 'Real research appears here after the first agent run — every finding with its sources.'
              : undefined
          }
        />
      ) : (
        <ul className="findings">
          {shown.map((f) => (
            <li key={f.id} className="finding">
              <div className="finding-head">
                <span className={`conf conf-${f.confidence}`}>{f.confidence} confidence</span>
                <span className="finding-meta">
                  {productNames[f.brand]} · {engineNames[f.engine]} · {formatWhen(f.createdAt)}
                </span>
              </div>
              <p className="finding-title">{f.title}</p>
              <p className="finding-insight">{f.insight}</p>
              <ul className="sources" aria-label="Sources">
                {f.evidence.map((e) => (
                  <li key={e.url}>
                    <a href={e.url} target="_blank" rel="noreferrer">
                      {e.title}
                    </a>
                    <span>
                      {' '}
                      — {e.source}, retrieved {new Date(e.retrievedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ---------- Run history (audit log) ---------- */
export function RunHistory({ runs }: { runs: Run[] }) {
  return (
    <Card
      title="Run history"
      action={
        <button className="btn btn-small" onClick={() => openNewGoal('research_brief')}>
          New research goal
        </button>
      }
    >
      {runs.length === 0 ? (
        <EmptyState title="No agent runs yet" hint="Each real run is logged here: agent, engine, result and errors." />
      ) : (
        <ul className="runs">
          {runs.slice(0, 20).map((r) => (
            <li key={r.id} className="run">
              <span className={`run-dot run-${r.status}`} aria-hidden="true" />
              <div className="run-body">
                <p className="run-title">
                  {agentNames[r.agent]} <span className="run-engine">via {engineNames[r.engine]}</span>
                </p>
                <p className="run-summary">{r.summary}</p>
                {r.error && <p className="run-error">{r.error}</p>}
              </div>
              <div className="run-right">
                <span className={`status run-status-${r.status}`}>{r.status}</span>
                <span className="run-when">{formatWhen(r.finishedAt)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
