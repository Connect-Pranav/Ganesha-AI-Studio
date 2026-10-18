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
  { title: 'AI engines', names: ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'OPENAI_MODEL', 'ANTHROPIC_API_KEY'], note: 'Gemini is free (aistudio.google.com → Get API key). ChatGPT in the CBO chat needs an OpenAI API key from platform.openai.com (paid per use — ChatGPT Go/Plus app plans do not include API access).' },
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
  const test = async (what: 'gemini' | 'claude' | 'openai') => {
    setBusy(`test-${what}`);
    setNotice(null);
    try {
      const r = await api<{ state?: string; message?: string; ok?: boolean }>(what === 'openai' ? '/api/settings/test-openai' : `/api/providers/${what}/test`, { method: 'POST', body: '{}' });
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
                        <input type={r.secret ? 'password' : 'text'} autoComplete="off" placeholder={r.source === 'app' ? 'Replace…' : 'Paste here'} value={vals[n] ?? ''} onChange={(e) => setVals((v) => ({ ...v, [n]: e.target.value }))} aria-label={n} />
                        <button className="btn btn-small btn-primary" disabled={busy === n || !vals[n]?.trim()}>Save</button>
                        {r.source === 'app' && <button type="button" className="btn btn-small" disabled={busy === n} onClick={() => save(n, null)}>Remove</button>}
                      </form>
                    )}
                    {r.updatedAt && <span className="cx-sub">updated {formatWhen(r.updatedAt)}</span>}
                  </div>
                );
              })}
            </div>
            {g.title === 'AI engines' && (
              <div className="nt-actions">
                <button className="btn btn-small" disabled={busy === 'test-gemini'} onClick={() => test('gemini')}>Test Gemini</button>
                <button className="btn btn-small" disabled={busy === 'test-openai'} onClick={() => test('openai')}>Test ChatGPT (OpenAI)</button>
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
