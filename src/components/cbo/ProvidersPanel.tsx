// Provider & Subscription Manager (appended to the AI Connection page).
import { Card, EmptyState } from '../ui';
import { conn, dateShort, inr, usd, useLoad } from '../../services/cboService';
import { Gate, Honest, Pill, useAction } from './common';

const STATE: Record<string, { label: string; cls: string }> = {
  connected: { label: 'Connected (verified)', cls: 'pill-running' },
  credentials_set_untested: { label: 'Key set · untested', cls: 'pill-warn' },
  credentials_set_oauth_not_implemented: { label: 'Credentials set · OAuth not built', cls: 'pill-warn' },
  error: { label: 'Error', cls: 'pill-error' },
  not_configured: { label: 'Not configured', cls: 'pill-idle' },
  manual_handoff: { label: 'Manual handoff', cls: 'pill-idle' },
};

export function ProvidersPanel() {
  const l = useLoad(() => conn.list());
  const act = useAction();
  return (
    <Gate title="Providers & subscriptions" locked={l.locked} ready={Boolean(l.data)} error={l.error} onRetry={l.reload}>
      <Card title="Providers & subscriptions" action={<button className="btn btn-small" onClick={l.reload}>Refresh</button>}>
        <div className="an-table-wrap">
          <table className="an-table">
            <thead>
              <tr>
                <th>Service</th>
                <th>Status</th>
                <th>Auth</th>
                <th>Capabilities</th>
                <th>Quota / billing</th>
                <th>Next step</th>
              </tr>
            </thead>
            <tbody>
              {(l.data?.connections ?? []).map((c) => {
                const s = STATE[c.state] ?? { label: c.state, cls: 'pill-idle' };
                return (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.name}</strong>
                      {c.model && <div className="cx-sub">{c.model}</div>}
                    </td>
                    <td>
                      <Pill cls={s.cls}>{s.label}</Pill>
                      <div className="cx-sub">{c.lastSuccessAt ? `last OK ${dateShort(c.lastSuccessAt)}` : 'never verified'}</div>
                      {c.lastError && <div className="cx-err">{c.lastError.message}</div>}
                    </td>
                    <td className="cx-sub">{c.authMethod}</td>
                    <td>
                      <ul className="cx-assume">
                        {c.capabilities.map((x) => (
                          <li key={x}>{x}</li>
                        ))}
                      </ul>
                    </td>
                    <td className="cx-sub">
                      {c.quotaVisibility}
                      <br />
                      {c.billingVisibility}
                      {c.subscriptionNote && <div className="cx-warn-text">{c.subscriptionNote}</div>}
                    </td>
                    <td className="cx-sub">
                      {c.missing.length > 0 && <div>Missing: {c.missing.join(', ')}</div>}
                      {c.nextAction ?? '—'}
                      {c.id === 'openai' && c.state !== 'not_configured' && (
                        <div>
                          <button className="btn btn-small" disabled={act.busy === 'oai'} onClick={() => act.run('oai', () => conn.testOpenAI(), l.reload)}>
                            Test connection
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {act.error && <p className="form-error">{act.error}</p>}
        <h3 className="cx-h3">Consumer subscriptions (entered in CFO)</h3>
        {(l.data?.subscriptions ?? []).length === 0 ? (
          <EmptyState title="None entered yet." hint="Add Google AI Pro, ChatGPT, Claude and Canva in CFO → Subscriptions with what you actually pay." />
        ) : (
          <ul className="cx-list compact">
            {l.data!.subscriptions.map((s) => (
              <li key={s.id}>
                <span>
                  <strong>{s.name}</strong> <span className="cx-sub">{s.provider} · {s.includes_api ? 'includes API' : 'no API access'}</span>
                </span>
                <span>{s.currency === 'INR' ? inr(s.amount) : usd(s.amount)}/{s.billing_cycle === 'yearly' ? 'yr' : 'mo'}</span>
              </li>
            ))}
          </ul>
        )}
        <Honest>A paid consumer subscription, a signed-in account, an API key, API billing, included allowances, remaining quota and capabilities are different things. “Connected” appears only after a real request succeeds. Secrets live in Cloudflare and are never sent to this page.</Honest>
      </Card>
    </Gate>
  );
}
