import { ProvidersPanel } from './cbo/ProvidersPanel';
// AI Connection: the Worker's real provider state. Keys are never shown — only whether
// they are set (public health booleans) and what the last real request returned.
import { useState } from 'react';
import { Icon } from './Icon';
import { Card, EmptyState, formatWhen } from './ui';
import { Unlock } from './NotificationCenter';
import { AiStatusCard, Modal } from './AiConnection';
import { RunHistory } from './AgentWidgets';
import { useStudio } from '../services/StudioContext';
import { testProvider, type ProviderStatus, type UsageRow } from '../services/studioService';
import type { AiStatus, DashboardData } from '../types';

const PROVIDER = {
  gemini: { label: 'Gemini', secret: 'GEMINI_API_KEY', where: 'Google AI Studio → Get API key (free tier available)' },
  claude: { label: 'Claude (Anthropic API)', secret: 'ANTHROPIC_API_KEY', where: 'console.anthropic.com → API keys (billed per token, separate from a Claude subscription)' },
  openai: { label: 'ChatGPT (OpenAI API)', secret: 'OPENAI_API_KEY', where: 'platform.openai.com/api-keys → save it in Settings (billed per token; ChatGPT Go/Plus plans include no API)' },
} as const;

type Tone = 'ok' | 'warn' | 'error' | 'muted';
export interface EngineView {
  label: string;
  tone: Tone;
  detail: string;
}

/** Plain-language state + the next action, from the provider's last real request. */
export function describeProvider(p: ProviderStatus | undefined, keySet: boolean | undefined): EngineView {
  if (!p) {
    if (keySet === undefined) return { label: 'Unknown', tone: 'muted', detail: 'Backend not reachable.' };
    return keySet
      ? { label: 'Key set', tone: 'muted', detail: 'Unlock to see whether real requests succeed.' }
      : { label: 'Not configured', tone: 'muted', detail: 'No key set on the Worker.' };
  }
  switch (p.state) {
    case 'not_configured':
      return { label: 'Not configured', tone: 'muted', detail: 'No key set on the Worker.' };
    case 'key_set_untested':
      return { label: 'Key set · untested', tone: 'warn', detail: 'No request has been made yet. Use “Test connection”.' };
    case 'last_request_ok':
      return { label: 'Connected', tone: 'ok', detail: `Last successful request ${formatWhen(p.lastSuccessAt!)}.` };
    case 'last_request_failed':
      return { label: 'Error', tone: 'error', detail: fixFor(p) };
  }
}

function fixFor(p: ProviderStatus): string {
  const e = p.lastError;
  const code = e?.httpStatus ?? null;
  const msg = (e?.message ?? '').slice(0, 200);
  const when = e ? ` (${formatWhen(e.at)})` : '';
  const secret = PROVIDER[p.provider].secret;
  if (code === 401 || code === 403) return `The provider rejected the key${when}. Create a new key and replace the ${secret} secret.`;
  if (code === 404) return `Model “${p.model}” was not found${when}. Change the model variable to a model your key can use.`;
  if (code === 429) return `Rate limit or free-tier quota reached${when}. Wait, or lower usage; requests retry automatically with backoff.`;
  if (code && code >= 500) return `The provider was unavailable${when}. This is usually temporary; failed steps can be retried.`;
  return `Last request failed${when}: ${msg || 'no message'}`;
}

function usageFor(rows: UsageRow[] | undefined, provider: string) {
  return rows?.find((r) => r.provider === provider) ?? null;
}

const n = (v: number | null | undefined) => (v === null || v === undefined ? '—' : Math.round(v).toLocaleString('en-IN'));

function ProviderCard({ id }: { id: 'gemini' | 'claude' | 'openai' }) {
  const { health, summary, locked, refresh } = useStudio();
  const p = summary?.providers.find((x) => x.provider === id);
  const keySet = id === 'gemini' ? health?.geminiKeySet : id === 'claude' ? health?.claudeKeySet : p ? p.state !== 'not_configured' : undefined;
  const v = describeProvider(p, keySet);
  const u = usageFor(summary?.usage30d, id);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const primary = health?.primaryEngine === id;

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const r = await testProvider(id);
      setResult({ ok: r.state === 'connected', text: r.state === 'connected' ? (id === 'openai' ? r.message ?? 'Connected.' : `Live request succeeded (${r.model}).`) : r.message ?? r.state });
      await refresh();
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : 'Test failed' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <li className="engine">
      <div className="engine-top">
        <span className="engine-name">
          {PROVIDER[id].label} {primary && <span className="approval">Primary</span>}
        </span>
        <span className={`ai-pill tone-${v.tone}`}>
          <span className="ai-dot" aria-hidden="true" />
          {v.label}
        </span>
      </div>
      <p className={`engine-msg ${v.tone === 'error' ? 'meta-error' : ''}`}>{v.detail}</p>
      <dl className="kv-row">
        <div>
          <dt>Key on Worker</dt>
          <dd>{keySet === undefined ? '—' : keySet ? 'Set' : 'Not set'}</dd>
        </div>
        <div>
          <dt>Model</dt>
          <dd>{p?.model ?? '—'}</dd>
        </div>
        <div>
          <dt>Calls · 30 d</dt>
          <dd>{locked ? '—' : u ? n(u.calls) : '0'}</dd>
        </div>
        <div>
          <dt>Errors · 30 d</dt>
          <dd>{locked ? '—' : u ? n(u.errors) : '0'}</dd>
        </div>
        <div>
          <dt>Tokens in / out</dt>
          <dd>{locked ? '—' : u ? `${n(u.input_tokens)} / ${n(u.output_tokens)}` : '0 / 0'}</dd>
        </div>
        <div>
          <dt>Cost</dt>
          <dd title={p?.costTracking === 'tokens_only' ? 'No per-token price configured, so cost is not calculated.' : undefined}>
            {locked ? '—' : p?.costTracking === 'configured' ? (u?.cost_usd != null ? `$${u.cost_usd.toFixed(4)}` : '$0') : 'Not tracked'}
          </dd>
        </div>
      </dl>
      {!locked && (
        <div className="nt-actions">
          <button className="btn btn-small btn-primary" onClick={test} disabled={testing || keySet === false}>
            <Icon name="refresh" size={14} /> {testing ? 'Testing…' : 'Test connection'}
          </button>
          {keySet === false && <span className="stat-hint">Set {PROVIDER[id].secret} first.</span>}
        </div>
      )}
      {result && <p className={`drawer-notice ${result.ok ? '' : 'error'}`}>{result.text}</p>}
    </li>
  );
}

export function SetupModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Connect AI to the studio" onClose={onClose}>
      <p className="modal-lead">Keys are stored as encrypted secrets on your Cloudflare Worker. They never reach this page, the browser or Git.</p>
      <ol className="setup-steps">
        <li>
          Get a key: <strong>Gemini</strong> — {PROVIDER.gemini.where}. <strong>Claude</strong> — {PROVIDER.claude.where}.
        </li>
        <li>
          Open <strong>dash.cloudflare.com → Workers &amp; Pages → ganesha-studio → Settings → Variables and Secrets</strong>.
        </li>
        <li>
          <strong>Add → Secret</strong>. Name <code>GEMINI_API_KEY</code> or <code>ANTHROPIC_API_KEY</code>, paste the key, <strong>Deploy</strong>.
        </li>
        <li>
          Come back here and press <strong>Test connection</strong>. “Connected” appears only after a real reply from the provider.
        </li>
      </ol>
      <div className="modal-actions">
        <button className="btn btn-primary" onClick={onClose}>
          Got it
        </button>
      </div>
    </Modal>
  );
}

export function ConnectionPage({ data, ai, aiChecking, onRecheck }: { data: DashboardData; ai: AiStatus | null; aiChecking: boolean; onRecheck: () => void }) {
  const { health, healthError, summary, summaryError, locked, lock, refresh, loading } = useStudio();
  const [setup, setSetup] = useState(false);

  return (
    <div className="grid-main">
      <div className="col">
        <Card
          title="AI providers on the studio backend"
          action={
            <button className="btn btn-small" onClick={() => refresh()} disabled={loading}>
              <Icon name="refresh" size={14} /> Refresh
            </button>
          }
        >
          {healthError && !health ? (
            <EmptyState title="Studio backend not reachable" hint={healthError} />
          ) : (
            <>
              <ul className="engines">
                <ProviderCard id="gemini" />
                <ProviderCard id="claude" />
                <ProviderCard id="openai" />
              </ul>
              {summaryError && <p className="drawer-notice error">{summaryError}</p>}
              {locked ? (
                <div className="unlock-wrap">
                  <Unlock onUnlocked={() => refresh()} />
                </div>
              ) : null}
              <div className="ai-actions">
                <button className="btn btn-ghost" onClick={() => setSetup(true)}>
                  <Icon name="connection" size={16} /> How to add a key
                </button>
              </div>
            </>
          )}
        </Card>

        <Card title="Scheduled agent runs (outside the backend)">
          <p className="ai-note">
            NARADA’s daily research and the goal runner also run as scheduled jobs. Their status comes from the runs they recorded.
          </p>
          <AiStatusCard status={ai} checking={aiChecking} onRecheck={onRecheck} onConnect={() => setSetup(true)} embedded />
        </Card>
        <RunHistory runs={data.runs} />
      </div>

      <div className="col">
        <Card title="Studio backend">
          {health ? (
            <dl className="kv-list">
              <div>
                <dt>Backend</dt>
                <dd>
                  <span className="pill pill-running">Reachable</span> v{health.version}
                </dd>
              </div>
              <div>
                <dt>Database</dt>
                <dd>{health.db ? 'Connected' : <span className="meta-error">Not bound</span>}</dd>
              </div>
              <div>
                <dt>Owner token</dt>
                <dd>{health.adminTokenSet ? 'Set on Worker' : <span className="meta-error">Not set — owner actions are locked</span>}</dd>
              </div>
              <div>
                <dt>YouTube stats key</dt>
                <dd>{health.youtubeKeySet ? 'Set' : 'Not set'}</dd>
              </div>
              <div>
                <dt>Agents registered</dt>
                <dd>{health.agents}</dd>
              </div>
              <div>
                <dt>This browser</dt>
                <dd>
                  {locked ? (
                    'Locked'
                  ) : (
                    <>
                      Unlocked{' '}
                      <button className="btn btn-small" onClick={lock}>
                        Lock
                      </button>
                    </>
                  )}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="ai-note">{healthError ?? 'Checking…'}</p>
          )}
        </Card>

        <Card title="Where keys live">
          <table className="env-table">
            <thead>
              <tr>
                <th>Secret</th>
                <th>Purpose</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>GEMINI_API_KEY</code></td>
                <td>Free-tier Gemini for all agents (primary engine).</td>
              </tr>
              <tr>
                <td><code>ANTHROPIC_API_KEY</code></td>
                <td>Claude API. Optional; billed per token by Anthropic.</td>
              </tr>
              <tr>
                <td><code>YOUTUBE_API_KEY</code></td>
                <td>Public channel stats for Sunverse analytics.</td>
              </tr>
              <tr>
                <td><code>ADMIN_TOKEN</code></td>
                <td>Unlocks owner actions in this panel.</td>
              </tr>
            </tbody>
          </table>
          <p className="ai-note">All are Cloudflare Worker secrets (ganesha-studio → Settings → Variables and Secrets). Values are never sent to the browser.</p>
        </Card>

        {!locked && summary && (
          <Card title="Integrations">
            <ul className="integ">
              <Integ name="YouTube stats (Sunverse)" ok={summary.integrations.youtubeStats.configured} okText={`Connected · ${summary.integrations.youtubeStats.account ?? ''}`} />
              <Integ name="YouTube upload" ok={false} offText={summary.integrations.youtubeUpload.reason} />
              <Integ name="Google Flow" ok={false} offText={summary.integrations.googleFlow.reason} pending="Manual handoff" />
              <Integ name="Instagram" ok={false} offText={summary.integrations.instagram.reason} pending="On hold" />
              <Integ name="Spotify" ok={false} offText={summary.integrations.spotify.reason} />
            </ul>
          </Card>
        )}
      </div>
      {setup && <SetupModal onClose={() => setSetup(false)} />}
      <div className="cx-span">
        <ProvidersPanel />
      </div>
    </div>
  );
}

export function Integ({ name, ok, okText, offText, pending }: { name: string; ok: boolean; okText?: string; offText?: string; pending?: string }) {
  return (
    <li>
      <span className="integ-name">{name}</span>
      <span className={`pill ${ok ? 'pill-running' : pending ? 'pill-paused' : 'pill-idle'}`}>{ok ? 'Connected' : (pending ?? 'Not configured')}</span>
      <span className="integ-detail">{ok ? okText : offText}</span>
    </li>
  );
}

/** One overall engine state for the top bar and sidebar, from the Worker (not the old run log). */
export function useEngineOverall(): EngineView & { dot: 'connected' | 'error' | 'disconnected' | 'not_configured' | 'checking' } {
  const { health, healthError, summary, locked } = useStudio();
  if (!health && !healthError) return { label: 'Checking…', tone: 'muted', detail: '', dot: 'checking' };
  if (!health) return { label: 'Backend offline', tone: 'error', detail: healthError ?? '', dot: 'error' };
  if (!locked && summary) {
    const st = summary.providers.map((p) => p.state);
    if (st.includes('last_request_ok')) return { label: 'Connected', tone: 'ok', detail: 'Last real request succeeded.', dot: 'connected' };
    if (st.includes('last_request_failed')) {
      const bad = summary.providers.find((p) => p.state === 'last_request_failed');
      const why = bad?.lastError?.message ? ` ${String(bad.lastError.message).slice(0, 160)}` : '';
      const limit = bad?.lastError?.httpStatus === 429 || /quota|rate|limit|exhaust/i.test(why);
      return { label: limit ? `${bad?.provider ?? 'AI'} limit` : `${bad?.provider ?? 'AI'} error`, tone: 'error', detail: `Last ${bad?.provider ?? 'provider'} request failed${bad?.lastError?.httpStatus ? ` (HTTP ${bad.lastError.httpStatus})` : ''}.${why} Tap for details.`, dot: 'error' };
    }
    if (st.includes('key_set_untested')) return { label: 'Key set · untested', tone: 'warn', detail: 'No request yet.', dot: 'disconnected' };
    return { label: 'Not configured', tone: 'muted', detail: 'No AI key on the Worker.', dot: 'not_configured' };
  }
  const anyKey = health.geminiKeySet || health.groqKeySet || health.claudeKeySet;
  return anyKey
    ? { label: 'Key set', tone: 'muted', detail: 'Unlock to see whether real requests succeed.', dot: 'not_configured' }
    : { label: 'Not configured', tone: 'muted', detail: 'No AI key on the Worker.', dot: 'not_configured' };
}

export function EnginePill() {
  const v = useEngineOverall();
  return (
    <span className={`ai-pill tone-${v.tone}`} title={v.detail}>
      <span className="ai-dot" aria-hidden="true" />
      AI: {v.label}
    </span>
  );
}
