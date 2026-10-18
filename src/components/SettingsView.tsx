// Settings: everything the owner configures, in one place — AI keys (saved encrypted, never shown
// back), Instagram connection, chat defaults, display, updates and this browser's access.
import { useCallback, useEffect, useState } from 'react';
import { api, getToken, setToken, AUTH_EVENT } from '../services/adminService';
import { Card, EmptyState, formatWhen } from './ui';
import { InstagramConnect } from './cbo/StudioDesk';
import { Unlock } from './NotificationCenter';
import { FX_EVENT, readFx, writeFx, type CosmicFx } from './cosmic/CosmicBackground';

interface SettingRow { name: string; purpose: string; secret: boolean; source: 'worker' | 'app' | null; hint: string | null; updatedAt: string | null }
const GROUPS: { title: string; names: string[]; note?: string }[] = [
  { title: 'AI engines', names: ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_MAX_OUTPUT_TOKENS', 'OPENAI_DAILY_REQUEST_LIMIT', 'ANTHROPIC_API_KEY'], note: 'Gemini is free (aistudio.google.com → Get API key). ChatGPT needs an OpenAI API key from platform.openai.com/api-keys (paid per use — ChatGPT Go/Plus app plans do not include API access).' },
  { title: 'Platforms', names: ['YOUTUBE_API_KEY', 'IG_APP_ID', 'IG_APP_SECRET', 'IG_ACCESS_TOKEN'], note: 'For Instagram, add the app ID + secret once, then use Connect Instagram below (no token copying needed).' },
];
const pref = (k: string, d = false) => {
  try {
    const v = localStorage.getItem(k);
    return v === null ? d : v === '1';
  } catch {
    return d;
  }
};
const setPref = (k: string, v: boolean) => {
  try {
    localStorage.setItem(k, v ? '1' : '0');
  } catch {
    /* ignore */
  }
};

export function SettingsView() {
  const [locked, setLocked] = useState(!getToken());
  const [rows, setRows] = useState<SettingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fx, setFx] = useState<CosmicFx>(readFx());
  const [think, setThink] = useState(pref('gas.chat.think'));
  const [research, setResearch] = useState(pref('gas.chat.research'));

  const load = useCallback(async () => {
    if (!getToken()) return setLocked(true);
    setLocked(false);
    try {
      setRows((await api<{ settings: SettingRow[] }>('/api/settings/secrets')).settings);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }, []);
  useEffect(() => {
    load();
    window.addEventListener(AUTH_EVENT, load);
    const onFx = () => setFx(readFx());
    window.addEventListener(FX_EVENT, onFx);
    return () => {
      window.removeEventListener(AUTH_EVENT, load);
      window.removeEventListener(FX_EVENT, onFx);
    };
  }, [load]);

  const save = async (name: string, value: string | null) => {
    setBusy(name);
    setNotice(null);
    try {
      await api('/api/settings/secrets', { method: 'PUT', body: JSON.stringify({ name, value }) });
      setVals((v) => ({ ...v, [name]: '' }));
      setNotice(value ? `${name} saved (encrypted). It is active right away.` : `${name} removed.`);
      await load();
    } catch (e) {
      setNotice(`Failed: ${e instanceof Error ? e.message : 'error'}`);
    } finally {
      setBusy(null);
    }
  };
  const test = async (what: 'gemini' | 'claude') => {
    setBusy(`test-${what}`);
    setNotice(null);
    try {
      const r = await api<{ state?: string; message?: string; ok?: boolean }>(`/api/providers/${what}/test`, { method: 'POST', body: '{}' });
      setNotice(`${what}: ${r.state ?? (r.ok ? 'connected' : 'checked')}${r.message ? ` — ${r.message}` : ''}`);
    } catch (e) {
      setNotice(`${what}: ${e instanceof Error ? e.message : 'failed'}`);
    } finally {
      setBusy(null);
    }
  };
  const checkUpdate = async () => {
    try {
      const r = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
      const b = (await r.json()).build;
      if (b && b !== __BUILD_ID__) {
        setNotice('New version found — updating…');
        setTimeout(() => window.location.reload(), 500);
      } else setNotice('You are on the latest version.');
    } catch {
      setNotice('Could not check right now.');
    }
  };

  if (locked)
    return (
      <Card title="Settings">
        <Unlock onUnlocked={load} />
      </Card>
    );

  return (
    <div className="settings">
      {notice && <p className="drawer-notice" role="status">{notice}</p>}

      <OpenAICard key={rows?.filter((r) => r.name.startsWith('OPENAI')).map((r) => `${r.source}${r.updatedAt}`).join('|')} />

      <Card title="Instagram (LittleLoop)">
        <InstagramConnect />
      </Card>

      {error && <Card title="API keys"><p className="form-error">{error}</p></Card>}
      {!rows && !error && <Card title="API keys"><EmptyState title="Loading…" /></Card>}
      {rows &&
        GROUPS.map((g) => (
          <Card key={g.title} title={`API keys · ${g.title}`}>
            {g.note && <p className="cx-sub">{g.note}</p>}
            <div className="st-rows">
              {g.names.map((n) => {
                const r = rows.find((x) => x.name === n);
                if (!r) return null;
                return (
                  <div key={n} className="st-row">
                    <div className="st-name">
                      <code>{n}</code>
                      <span className="cx-sub">{r.purpose}</span>
                    </div>
                    <span className={`pill ${r.source ? 'pill-running' : 'pill-idle'}`}>{r.source === 'worker' ? 'Set in Cloudflare' : r.source === 'app' ? `Saved ${r.hint ?? ''}` : 'Not set'}</span>
                    {r.source !== 'worker' && (
                      <form
                        className="st-form"
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (vals[n]?.trim()) save(n, vals[n]);
                        }}
                      >
                        {/* Plain text box masked with CSS: browsers never autofill saved passwords into it (a real
                            password box got the studio password autofilled and looked "saved" while it was not). */}
                        <input
                          type="text"
                          name={`gas-key-${n.toLowerCase()}`}
                          className={r.secret && !shown[n] ? 'st-secret' : ''}
                          autoComplete="off"
                          autoCorrect="off"
                          autoCapitalize="off"
                          spellCheck={false}
                          data-lpignore="true"
                          data-1p-ignore="true"
                          placeholder={r.source === 'app' ? 'Replace…' : 'Paste here'}
                          value={vals[n] ?? ''}
                          onChange={(e) => setVals((v) => ({ ...v, [n]: e.target.value }))}
                          aria-label={n}
                        />
                        {r.secret && vals[n] && (
                          <button type="button" className="btn btn-small" onClick={() => setShown((x) => ({ ...x, [n]: !x[n] }))} aria-label={shown[n] ? `Hide ${n}` : `Show ${n}`}>
                            {shown[n] ? 'Hide' : 'Show'}
                          </button>
                        )}
                        <button className="btn btn-small btn-primary" disabled={busy === n || !vals[n]?.trim()}>Save</button>
                        {r.source === 'app' && <button type="button" className="btn btn-small" disabled={busy === n} onClick={() => save(n, null)}>Remove</button>}
                      </form>
                    )}
                    {vals[n]?.trim() && <span className="st-unsaved">Not saved yet — press Save</span>}
                    {r.updatedAt && <span className="cx-sub">updated {formatWhen(r.updatedAt)}</span>}
                  </div>
                );
              })}
            </div>
            {g.title === 'AI engines' && (
              <div className="nt-actions">
                <button className="btn btn-small" disabled={busy === 'test-gemini'} onClick={() => test('gemini')}>Test Gemini</button>
                <button className="btn btn-small" disabled={busy === 'test-claude'} onClick={() => test('claude')}>Test Claude</button>
              </div>
            )}
            <p className="cx-sub">Keys are encrypted before they are stored and are never sent back to the browser. A key set in Cloudflare always takes priority.</p>
          </Card>
        ))}

      <Card title="CBO chat defaults">
        <label className="st-check"><input type="checkbox" checked={think} onChange={(e) => (setThink(e.target.checked), setPref('gas.chat.think', e.target.checked))} /> Start chats with 🧠 Think ON (deeper, slower)</label>
        <label className="st-check"><input type="checkbox" checked={research} onChange={(e) => (setResearch(e.target.checked), setPref('gas.chat.research', e.target.checked))} /> Start chats with 🔎 Research ON (live Google search)</label>
      </Card>

      <Card title="Display & app">
        <label className="st-inline">
          Cosmic effects
          <select value={fx} onChange={(e) => writeFx(e.target.value as CosmicFx)}>
            <option value="full">Full</option>
            <option value="balanced">Balanced</option>
            <option value="minimal">Minimal (saves battery)</option>
          </select>
        </label>
        <p className="cx-sub">App version {__BUILD_ID__.replace('T', ' ').slice(0, 16)} UTC · updates install automatically when you open the app.</p>
        <div className="nt-actions">
          <button className="btn btn-small" onClick={checkUpdate}>Check for updates now</button>
          <button className="btn btn-small" onClick={() => setToken(null)}>Lock this browser</button>
        </div>
      </Card>
    </div>
  );
}

interface OpenAIStatus {
  configured: boolean;
  keySource: 'worker' | 'app' | null;
  model: string;
  modelSource: 'worker' | 'app' | 'default';
  defaultModel: string;
  modelValid: boolean;
  maxOutputTokens: number;
  dailyRequestLimit: number;
  requestsToday: number;
  pricing: { input: number; output: number; cachedInput: number | null; origin: string; source: string | null; verifiedAt: string | null } | null;
  month: { requests: number; successful: number; inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningTokens: number; estimatedCostUsd: number; unpricedRequests: number };
  byPurpose: { purpose: string; agent: string | null; requests: number; input: number | null; output: number | null; cost: number | null }[];
  lastCall: { status: string; purpose: string; httpStatus: number | null; error: string | null; at: string; requestId: string | null } | null;
  lastTest: { status: string; error: string | null; at: string; requestId: string | null } | null;
}
interface TestResult { state: string; message?: string; requestId?: string | null; live?: boolean; model?: string }
const num = (v: number | null | undefined) => (v == null ? '0' : Math.round(v).toLocaleString('en-IN'));
const SRC = { worker: 'Cloudflare secret (takes priority)', app: 'Saved in Settings (encrypted)' } as const;

/** Effective server-side OpenAI configuration + this month's usage. The key itself never reaches the browser. */
function OpenAICard() {
  const [s, setS] = useState<OpenAIStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<'key' | 'live' | null>(null);
  const [res, setRes] = useState<TestResult | null>(null);
  const load = useCallback(async () => {
    try {
      setS(await api<OpenAIStatus>('/api/settings/openai'));
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const run = async (live: boolean) => {
    if (live && !window.confirm('Live test sends one tiny paid request to OpenAI (about 20 tokens). Continue?')) return;
    setBusy(live ? 'live' : 'key');
    setRes(null);
    try {
      setRes(await api<TestResult>('/api/settings/test-openai', { method: 'POST', body: JSON.stringify({ live }) }));
    } catch (e) {
      setRes({ state: 'error', message: e instanceof Error ? e.message : 'failed' });
    } finally {
      setBusy(null);
      load();
    }
  };
  const lastOk = s?.lastTest?.status === 'success';
  const pill = !s ? null : !s.configured ? ['pill-idle', 'Not configured'] : !s.lastTest ? ['pill-warn', 'Key set · not tested'] : lastOk ? ['pill-running', 'Connected'] : ['pill-error', 'Last test failed'];
  return (
    <Card title="ChatGPT · OpenAI API" action={pill ? <span className={`pill ${pill[0]}`}>{pill[1]}</span> : undefined}>
      {err && <p className="form-error">{err}</p>}
      {!s && !err && <EmptyState title="Loading…" />}
      {s && (
        <>
          <dl className="kv-row oa-kv">
            <div><dt>API key</dt><dd>{s.keySource ? SRC[s.keySource] : 'Not set — add OPENAI_API_KEY below'}</dd></div>
            <div><dt>Model</dt><dd><code>{s.model}</code> {s.modelSource === 'default' ? '(default)' : s.modelSource === 'worker' ? '(Cloudflare)' : '(Settings)'}{!s.modelValid && <span className="form-error"> invalid ID</span>}</dd></div>
            <div><dt>Max output / request</dt><dd>{num(s.maxOutputTokens)} tokens</dd></div>
            <div><dt>Requests today</dt><dd>{num(s.requestsToday)} / {num(s.dailyRequestLimit)}</dd></div>
          </dl>
          <p className="cx-sub">This month (requests through Ganesha): {num(s.month.requests)} requests · {num(s.month.inputTokens)} in ({num(s.month.cachedInputTokens)} cached) · {num(s.month.outputTokens)} out ({num(s.month.reasoningTokens)} reasoning) · <strong>≈ ${s.month.estimatedCostUsd.toFixed(4)}</strong>{s.month.unpricedRequests ? ` + ${s.month.unpricedRequests} requests with no price on file` : ''}</p>
          <p className="cx-sub">
            {s.pricing
              ? <>Price used: ${s.pricing.input} in / ${s.pricing.output} out per 1M tokens{s.pricing.cachedInput != null ? `, cached $${s.pricing.cachedInput}` : ' (no cached price listed → full input rate)'} · {s.pricing.origin === 'owner' ? 'your CFO & Costs entry' : s.pricing.origin === 'env' ? 'OPENAI_PRICE_PER_MTOK' : `official page, checked ${s.pricing.verifiedAt}`}. Rates change — add a newer price in CFO & Costs to override.</>
              : <>No price on file for {s.model}: tokens are counted but cost is not estimated. Add its price in CFO & Costs.</>}
          </p>
          {s.byPurpose.length > 0 && (
            <ul className="oa-usage">
              {s.byPurpose.map((r) => (
                <li key={`${r.purpose}-${r.agent}`}><code>{r.agent ?? r.purpose}</code> {num(r.requests)} req · {num(r.input)}/{num(r.output)} tok · {r.cost != null ? `$${r.cost.toFixed(4)}` : 'cost n/a'}</li>
              ))}
            </ul>
          )}
          {s.lastCall?.status === 'error' && (
            <p className="drawer-notice error">Last request failed {formatWhen(s.lastCall.at)}{s.lastCall.httpStatus ? ` (HTTP ${s.lastCall.httpStatus})` : ''}: {s.lastCall.error}{s.lastCall.requestId ? ` · request ${s.lastCall.requestId}` : ''}</p>
          )}
          <div className="nt-actions">
            <button className="btn btn-small btn-primary" disabled={!s.configured || busy !== null} onClick={() => run(false)}>{busy === 'key' ? 'Checking…' : 'Test key & model (free)'}</button>
            <button className="btn btn-small" disabled={!s.configured || busy !== null} onClick={() => run(true)}>{busy === 'live' ? 'Sending…' : 'Live test (tiny paid request)'}</button>
          </div>
          {res && (
            <p className={`drawer-notice ${res.state === 'connected' ? '' : 'error'}`} role="status">
              {res.state === 'connected' ? '✅ ' : res.state === 'not_configured' ? '' : '⚠️ '}
              {res.message ?? res.state}
              {res.requestId ? ` · request ${res.requestId}` : ''}
            </p>
          )}
          <p className="cx-sub">Used by: CBO chat (pick ChatGPT), any agent you switch to ChatGPT in Agents, and LittleLoop scripts if you choose OpenAI in the Reel Factory. Nothing switches to OpenAI by itself.</p>
        </>
      )}
    </Card>
  );
}
