// Ganesha Brain: Missions (Think → Plan → Execute → Verify), long-term Memory, Skills library, Connectors.
// Everything stays inside the studio panel: plans are approved here with one tap, and results show here.
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, AUTH_EVENT, getToken } from '../services/adminService';
import { postStream } from '../services/sseChat';
import { Markdown } from './Markdown';
import { Card, EmptyState, formatWhen } from './ui';

type Brand = 'studio' | 'littleloop' | 'sunverse' | 'foliocraft';
const BRANDS: { id: Brand; name: string }[] = [
  { id: 'littleloop', name: 'LittleLoop' },
  { id: 'sunverse', name: 'Sunverse' },
  { id: 'foliocraft', name: 'Foliocraft' },
  { id: 'studio', name: 'Whole studio' },
];
const TABS = ['🎯 Missions', '🧠 Memory', '🧩 Skills', '🔌 Connectors'] as const;
type Tab = (typeof TABS)[number];

interface Step { id: string; idx: number; agent_id: string; agent_name: string; title: string; instruction: string; skill_id: string | null; status: 'pending' | 'running' | 'done' | 'failed'; attempts: number; output: string | null; check: { pass?: boolean; score?: number | null; note?: string; skipped?: boolean; error?: string } | null; engine: string | null; model: string | null }
interface Mission { id: string; goal: string; brand: Brand; status: string; thinking: string | null; criteria: string[]; deliver: string[]; result: string | null; error: string | null; engine: string | null; created_at: string; finished_at: string | null; steps?: Step[]; deliveries?: { target: string; status: string; url: string | null; message: string }[]; stepsTotal?: number; stepsDone?: number }
interface Connector { id: string; name: string; configured: boolean; missing: string[]; detail: string | null }
interface BrainStatus { memoryCount: number; skillCount: number; missions: Record<string, number>; engines: { provider: string; configured: boolean; free: boolean; model: string }[]; connectors: Connector[] }
interface Memory { id: string; scope: string; fact: string; source: string; pinned: boolean; uses: number; updated_at: string }
interface Skill { id: string; name: string; description: string; instructions: string; brand: Brand; uses: number; builtin: boolean }

const err = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
const STATUS_PILL: Record<string, string> = { planning: 'pill-info', awaiting_approval: 'pill-warn', running: 'pill-running', done: 'pill-running', failed: 'pill-error', rejected: 'pill-idle', cancelled: 'pill-idle', pending: 'pill-idle' };
const STATUS_TEXT: Record<string, string> = { planning: 'Soch rahe hain', awaiting_approval: 'Aapki approval', running: 'Chal raha hai', done: 'Done', failed: 'Failed', rejected: 'Rejected', cancelled: 'Cancelled', pending: 'Pending' };

export function BrainView() {
  const [tab, setTab] = useState<Tab>('🎯 Missions');
  const [locked, setLocked] = useState(!getToken());
  const [status, setStatus] = useState<BrainStatus | null>(null);
  const loadStatus = useCallback(() => {
    setLocked(!getToken());
    if (!getToken()) return;
    api<BrainStatus>('/api/brain').then(setStatus).catch(() => {});
  }, []);
  useEffect(() => {
    loadStatus();
    window.addEventListener(AUTH_EVENT, loadStatus);
    return () => window.removeEventListener(AUTH_EVENT, loadStatus);
  }, [loadStatus]);
  if (locked) return <Card title="Ganesha Brain"><EmptyState title="Unlock the studio to use the Brain" hint="Bell → Unlock with your admin token." /></Card>;
  return (
    <div className="br">
      <div className="br-flow" aria-label="How a mission works">
        <span>💬 Goal</span><i>→</i><span>🧠 Think</span><i>→</i><span>🗺️ Plan</span><i>→</i><span>✅ Aapki approval</span><i>→</i><span>⚡ Execute</span><i>→</i><span>🔍 Verify</span><i>→</i><span>📦 Deliver</span>
      </div>
      {status && (
        <div className="br-stats">
          <span><b>{status.memoryCount}</b> memories</span>
          <span><b>{status.skillCount}</b> skills</span>
          <span><b>{status.missions.running ?? 0}</b> running · <b>{status.missions.awaiting_approval ?? 0}</b> need you</span>
          <span><b>{status.engines.filter((e) => e.configured).map((e) => e.provider).join(' + ') || 'no engine'}</b> engines</span>
        </div>
      )}
      <div className="tabs" role="tablist" aria-label="Brain section">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {tab === '🎯 Missions' && <Missions connectors={status?.connectors ?? []} onChange={loadStatus} />}
      {tab === '🧠 Memory' && <MemoryTab onChange={loadStatus} />}
      {tab === '🧩 Skills' && <SkillsTab onChange={loadStatus} />}
      {tab === '🔌 Connectors' && <ConnectorsTab status={status} />}
    </div>
  );
}

/* ---------------- Missions ---------------- */
function DeliverPicker({ connectors, value, onChange }: { connectors: Connector[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="br-deliver">
      <span className="cx-sub">Result kahan bhejna hai?</span>
      {connectors.map((c) => (
        <label key={c.id} className={c.configured ? '' : 'br-off'} title={c.configured ? c.detail ?? '' : `Not connected — Settings → API keys: ${c.missing.join(', ')}`}>
          <input type="checkbox" disabled={!c.configured} checked={value.includes(c.id)} onChange={(e) => onChange(e.target.checked ? [...value, c.id] : value.filter((x) => x !== c.id))} /> {c.name}{c.configured ? '' : ' (connect)'}
        </label>
      ))}
    </div>
  );
}

function Missions({ connectors, onChange }: { connectors: Connector[]; onChange: () => void }) {
  const [list, setList] = useState<Mission[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [goal, setGoal] = useState('');
  const [brand, setBrand] = useState<Brand>('littleloop');
  const [deliver, setDeliver] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [e, setE] = useState<string | null>(null);
  const load = useCallback(() => api<{ missions: Mission[] }>('/api/brain/missions').then((r) => setList(r.missions)).catch((x) => setE(err(x))), []);
  useEffect(() => {
    load();
  }, [load]);

  const create = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!goal.trim() || busy) return;
    setBusy(true);
    setE(null);
    try {
      const m = await postStream<Mission>('/api/brain/missions', { goal, brand, deliver });
      setGoal('');
      setOpenId(m.id);
      await load();
      onChange();
    } catch (x) {
      setE(err(x));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="br-grid">
      <Card title="Ganesha ko mission do">
        <form className="form" onSubmit={create}>
          <label>Goal<textarea rows={3} value={goal} onChange={(x) => setGoal(x.target.value)} maxLength={2000} placeholder="e.g. Is hafte ke liye LittleLoop ki 2 rain-themed reels: research → script → Flow prompt → safety check" /></label>
          <label>Brand<select value={brand} onChange={(x) => setBrand(x.target.value as Brand)}>{BRANDS.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <DeliverPicker connectors={connectors} value={deliver} onChange={setDeliver} />
          <button className="btn btn-primary" disabled={busy || goal.trim().length < 8}>{busy ? 'Ganesha soch rahe hain… (30–60 s)' : '🧠 Think & plan'}</button>
          {e && <p className="form-error">{e}</p>}
          <p className="ai-note">Ganesha plan banata hai, aap approve karte ho, phir agents ek-ek step chalate hain aur har step ko checker verify karta hai. Kuch bhi publish, send ya spend nahi hota.</p>
        </form>
        <div className="br-list">
          {list === null ? <p className="ai-note">Loading…</p> : list.length === 0 ? <p className="ai-note">Abhi koi mission nahi.</p> : list.map((m) => (
            <button key={m.id} className={`br-item ${openId === m.id ? 'active' : ''}`} onClick={() => setOpenId(m.id)}>
              <span className={`pill ${STATUS_PILL[m.status] ?? 'pill-idle'}`}>{STATUS_TEXT[m.status] ?? m.status}</span>
              <span className="br-item-goal">{m.goal}</span>
              <span className="cx-sub">{m.brand} · {m.stepsDone ?? 0}/{m.stepsTotal ?? 0} steps · {formatWhen(m.created_at)}</span>
            </button>
          ))}
        </div>
      </Card>
      {openId ? <MissionDetail key={openId} id={openId} connectors={connectors} onChange={() => { load(); onChange(); }} /> : <Card title="Mission"><EmptyState title="Ek mission chuniye ya naya banaiye" hint="Plan yahin dikhega — Approve / Reject ek tap mein." /></Card>}
    </div>
  );
}

function MissionDetail({ id, connectors, onChange }: { id: string; connectors: Connector[]; onChange: () => void }) {
  const [m, setM] = useState<Mission | null>(null);
  const [deliver, setDeliver] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [e, setE] = useState<string | null>(null);
  const alive = useRef(true);
  const running = useRef(false);
  const load = useCallback(() => api<{ mission: Mission }>(`/api/brain/missions/${id}`).then((r) => { if (alive.current) setM(r.mission); return r.mission; }), [id]);

  // While this page is open and the mission is running, drive it one step at a time.
  const drive = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (let i = 0; i < 12 && alive.current; i++) {
        const next = await postStream<Mission>(`/api/brain/missions/${id}/advance`, {}, undefined, 300_000);
        if (!alive.current) break;
        setM(next);
        if (next.status !== 'running') break;
      }
    } catch (x) {
      if (alive.current) setE(`${err(x)} — cron will carry on every 5 minutes.`);
    } finally {
      running.current = false;
      onChange();
    }
  }, [id, onChange]);

  useEffect(() => {
    alive.current = true;
    load().then((mm) => { if (mm.status === 'running') drive(); }).catch((x) => setE(err(x)));
    return () => { alive.current = false; };
  }, [load, drive]);

  const decide = async (decision: 'approve' | 'reject' | 'cancel') => {
    setBusy(decision);
    setE(null);
    try {
      const r = await api<{ mission: Mission }>(`/api/brain/missions/${id}/decide`, { method: 'POST', body: JSON.stringify({ decision, ...(decision === 'approve' && deliver ? { deliver } : {}) }) });
      setM(r.mission);
      onChange();
      if (decision === 'approve') drive();
    } catch (x) {
      setE(err(x));
    } finally {
      setBusy(null);
    }
  };

  if (!m) return <Card title="Mission"><p className="ai-note">{e ?? 'Loading…'}</p></Card>;
  const current = m.steps?.find((s) => s.status === 'running') ?? (m.status === 'running' ? m.steps?.find((s) => s.status === 'pending') : undefined);
  return (
    <Card title={`Mission · ${m.brand}`}>
      <div className="br-detail">
        <p className="br-title"><span className={`pill ${STATUS_PILL[m.status] ?? 'pill-idle'}`}>{STATUS_TEXT[m.status] ?? m.status}</span> {m.goal}</p>
        {m.thinking && (
          <section>
            <h4>🧠 Ganesha ki soch</h4>
            <p>{m.thinking}</p>
            {m.criteria.length > 0 && <ul className="br-criteria">{m.criteria.map((c) => <li key={c}>✔ {c}</li>)}</ul>}
            {m.engine && <span className="sd-meta">planned with {m.engine}</span>}
          </section>
        )}
        {m.error && <p className="form-error">{m.error}</p>}
        <section>
          <h4>🗺️ Plan</h4>
          <ol className="br-steps">
            {(m.steps ?? []).map((s) => (
              <li key={s.id} className={`br-step ${s.status}`}>
                <div className="br-step-head">
                  <span className={`pill ${STATUS_PILL[s.status]}`}>{s.status === 'running' ? '⚡ running' : s.status === 'done' ? (s.check?.pass === false ? '⚠ done' : '✓ done') : s.status}</span>
                  <b>{s.title}</b>
                  <span className="cx-sub">{s.agent_name}{s.skill_id ? ` · /${s.skill_id}` : ''}{s.engine ? ` · ${s.engine}` : ''}</span>
                </div>
                <p className="cx-sub">{s.instruction}</p>
                {s.check?.note && <p className={`br-check ${s.check.pass === false ? 'bad' : ''}`}>🔍 {s.check.skipped ? '' : s.check.pass ? 'Checker: pass' : 'Checker: needs work'}{s.check.score ? ` (${s.check.score}/10)` : ''} — {s.check.note}</p>}
                {s.check?.error && <p className="form-error">Engine error (attempt {s.attempts}): {s.check.error}</p>}
                {s.output && (
                  <details>
                    <summary>Output dekhiye</summary>
                    <Markdown text={s.output} />
                  </details>
                )}
              </li>
            ))}
          </ol>
        </section>
        {m.status === 'awaiting_approval' && (
          <section className="br-approve">
            <h4>✅ Approve karein?</h4>
            <DeliverPicker connectors={connectors} value={deliver ?? m.deliver} onChange={setDeliver} />
            <div className="br-actions">
              <button className="btn btn-primary" disabled={Boolean(busy)} onClick={() => decide('approve')}>{busy === 'approve' ? '…' : '✅ Approve & run'}</button>
              <button className="btn btn-ghost" disabled={Boolean(busy)} onClick={() => decide('reject')}>❌ Reject</button>
            </div>
          </section>
        )}
        {m.status === 'running' && (
          <div className="br-actions">
            <span className="cx-sub">{current ? `⚡ ${current.agent_name}: ${current.title}…` : 'Final result likh rahe hain…'} (page band karne par bhi har 5 min mein chalta rahega)</span>
            <button className="btn btn-small" disabled={Boolean(busy)} onClick={() => decide('cancel')}>Stop</button>
          </div>
        )}
        {m.result && (
          <section>
            <h4>📦 Result</h4>
            <div className="br-result"><Markdown text={m.result} /></div>
          </section>
        )}
        {(m.deliveries?.length ?? 0) > 0 && (
          <section>
            <h4>🔌 Delivered</h4>
            <ul className="br-criteria">
              {m.deliveries!.map((d) => (
                <li key={d.target}>{d.status === 'sent' ? '✓' : d.status === 'skipped' ? '–' : '✗'} {d.target}: {d.message} {d.url && <a href={d.url} target="_blank" rel="noreferrer">open</a>}</li>
              ))}
            </ul>
          </section>
        )}
        {e && <p className="form-error">{e}</p>}
      </div>
    </Card>
  );
}

/* ---------------- Mission card inside a chat (SAARTHI / GANESHA) ---------------- */
export interface ChatMissionRef { type: 'mission'; id: string | null; goal: string; brand: string; status: string; steps: number; error: string | null }
const noop = () => {};
export function ChatMission({ mission }: { mission: ChatMissionRef }) {
  const [connectors, setConnectors] = useState<Connector[] | null>(null);
  useEffect(() => {
    api<BrainStatus>('/api/brain').then((s) => setConnectors(s.connectors)).catch(() => setConnectors([]));
  }, []);
  if (!mission.id) return <div className="sd-action"><p><strong>🎯 Mission:</strong> {mission.goal}</p><p className="form-error">{mission.error ?? 'Could not plan this mission.'}</p></div>;
  return (
    <div className="br-chat">
      <p className="cx-sub">🎯 GANESHA ne mission plan kiya — approve karte hi agents kaam shuru karenge (Agents → Brain mein bhi dikhega).</p>
      {connectors ? <MissionDetail id={mission.id} connectors={connectors} onChange={noop} /> : <p className="ai-note">Loading plan…</p>}
    </div>
  );
}

/* ---------------- Memory ---------------- */
function MemoryTab({ onChange }: { onChange: () => void }) {
  const [rows, setRows] = useState<Memory[] | null>(null);
  const [fact, setFact] = useState('');
  const [scope, setScope] = useState('studio');
  const [filter, setFilter] = useState('all');
  const [e, setE] = useState<string | null>(null);
  const load = useCallback(() => api<{ memory: Memory[] }>('/api/brain/memory').then((r) => setRows(r.memory)).catch((x) => setE(err(x))), []);
  useEffect(() => {
    load();
  }, [load]);
  const add = async (ev: FormEvent) => {
    ev.preventDefault();
    setE(null);
    try {
      await api('/api/brain/memory', { method: 'POST', body: JSON.stringify({ scope, fact }) });
      setFact('');
      await load();
      onChange();
    } catch (x) {
      setE(err(x));
    }
  };
  const act = async (m: Memory, op: 'pin' | 'delete') => {
    try {
      if (op === 'delete') await api(`/api/brain/memory/${m.id}`, { method: 'DELETE' });
      else await api(`/api/brain/memory/${m.id}`, { method: 'PATCH', body: JSON.stringify({ pinned: !m.pinned }) });
      await load();
      onChange();
    } catch (x) {
      setE(err(x));
    }
  };
  const shown = (rows ?? []).filter((r) => filter === 'all' || r.scope === filter || (filter === 'agents' && !['studio', 'littleloop', 'sunverse', 'foliocraft'].includes(r.scope)));
  return (
    <Card title="Long-term memory · har agent yeh yaad rakhta hai">
      <form className="form br-inline" onSubmit={add}>
        <select value={scope} onChange={(x) => setScope(x.target.value)} aria-label="Who should know">
          <option value="studio">Sab agents</option>
          <option value="littleloop">LittleLoop team</option>
          <option value="sunverse">Sunverse team</option>
          <option value="foliocraft">Foliocraft team</option>
        </select>
        <input value={fact} onChange={(x) => setFact(x.target.value)} maxLength={400} placeholder="e.g. LittleLoop reels hamesha 2 × 10 s scenes, end card ke saath" />
        <button className="btn btn-primary" disabled={fact.trim().length < 4}>Yaad rakho</button>
      </form>
      <p className="ai-note">Agents chat mein bhi yaad rakhte hain — bas likhiye “yeh yaad rakho: …”. Missions apne lessons khud save karte hain. Keys/passwords kabhi save nahi hote.</p>
      <div className="tabs br-filter">
        {['all', 'studio', 'littleloop', 'sunverse', 'foliocraft', 'agents'].map((f) => <button key={f} className={`tab ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>{f}</button>)}
      </div>
      {e && <p className="form-error">{e}</p>}
      {rows === null ? <p className="ai-note">Loading…</p> : shown.length === 0 ? <EmptyState title="Kuch yaad nahi abhi" hint="Upar ek fact add kijiye." /> : (
        <ul className="br-mem">
          {shown.map((m) => (
            <li key={m.id}>
              <span className="pill pill-info">{m.scope}</span>
              <span className="br-mem-fact">{m.pinned ? '📌 ' : ''}{m.fact}</span>
              <span className="cx-sub">{m.source} · used {m.uses}× · {formatWhen(m.updated_at)}</span>
              <span className="br-mem-act">
                <button className="btn btn-small" onClick={() => act(m, 'pin')}>{m.pinned ? 'Unpin' : 'Pin'}</button>
                <button className="btn btn-small" onClick={() => window.confirm('Delete this memory?') && act(m, 'delete')}>Delete</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ---------------- Skills ---------------- */
const EMPTY_SKILL = { id: '', name: '', description: '', instructions: '', brand: 'studio' as Brand };
function SkillsTab({ onChange }: { onChange: () => void }) {
  const [rows, setRows] = useState<Skill[] | null>(null);
  const [edit, setEdit] = useState<typeof EMPTY_SKILL | null>(null);
  const [e, setE] = useState<string | null>(null);
  const load = useCallback(() => api<{ skills: Skill[] }>('/api/brain/skills').then((r) => setRows(r.skills)).catch((x) => setE(err(x))), []);
  useEffect(() => {
    load();
  }, [load]);
  const save = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!edit) return;
    setE(null);
    try {
      await api('/api/brain/skills', { method: 'PUT', body: JSON.stringify(edit) });
      setEdit(null);
      await load();
      onChange();
    } catch (x) {
      setE(err(x));
    }
  };
  const del = async (s: Skill) => {
    if (!window.confirm(`Delete skill /${s.id}?`)) return;
    try {
      await api(`/api/brain/skills/${s.id}`, { method: 'DELETE' });
      await load();
      onChange();
    } catch (x) {
      setE(err(x));
    }
  };
  return (
    <Card title="Skills library · kisi bhi agent chat mein /skill-id likhiye">
      <div className="br-actions"><button className="btn btn-primary" onClick={() => setEdit({ ...EMPTY_SKILL })}>+ New skill</button></div>
      {edit && (
        <form className="form br-skill-form" onSubmit={save}>
          <label>ID (chat command)<input value={edit.id} onChange={(x) => setEdit({ ...edit, id: x.target.value.toLowerCase() })} placeholder="e.g. diwali-reel" maxLength={40} /></label>
          <label>Name<input value={edit.name} onChange={(x) => setEdit({ ...edit, name: x.target.value })} maxLength={80} /></label>
          <label>Brand<select value={edit.brand} onChange={(x) => setEdit({ ...edit, brand: x.target.value as Brand })}>{BRANDS.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <label>When to use (one line)<input value={edit.description} onChange={(x) => setEdit({ ...edit, description: x.target.value })} maxLength={300} /></label>
          <label>Method / instructions<textarea rows={7} value={edit.instructions} onChange={(x) => setEdit({ ...edit, instructions: x.target.value })} maxLength={4000} /></label>
          <div className="br-actions"><button className="btn btn-primary">Save skill</button><button type="button" className="btn btn-ghost" onClick={() => setEdit(null)}>Cancel</button></div>
        </form>
      )}
      {e && <p className="form-error">{e}</p>}
      {rows === null ? <p className="ai-note">Loading…</p> : (
        <div className="br-skills">
          {rows.map((s) => (
            <div key={s.id} className="br-skill">
              <div className="br-step-head"><b>{s.name}</b><code>/{s.id}</code><span className="pill pill-info">{s.brand}</span></div>
              <p className="cx-sub">{s.description}</p>
              <span className="cx-sub">used {s.uses}×{s.builtin ? ' · built-in' : ''}</span>
              <div className="br-actions">
                <button className="btn btn-small" onClick={() => setEdit({ id: s.id, name: s.name, description: s.description, instructions: s.instructions, brand: s.brand })}>Edit</button>
                {!s.builtin && <button className="btn btn-small" onClick={() => del(s)}>Delete</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ---------------- Connectors ---------------- */
function ConnectorsTab({ status }: { status: BrainStatus | null }) {
  const [tests, setTests] = useState<Record<string, string>>({});
  const test = async (id: string) => {
    setTests((t) => ({ ...t, [id]: 'Testing…' }));
    try {
      const r = await api<{ ok: boolean; message: string }>(`/api/brain/connectors/${id}/test`, { method: 'POST', body: '{}' });
      setTests((t) => ({ ...t, [id]: `${r.ok ? '✓' : '✗'} ${r.message}` }));
    } catch (x) {
      setTests((t) => ({ ...t, [id]: `✗ ${err(x)}` }));
    }
  };
  if (!status) return <Card title="Connectors"><p className="ai-note">Loading…</p></Card>;
  return (
    <div className="br-grid">
      <Card title="AI engines · multi-model router">
        <ul className="br-mem">
          {status.engines.map((x) => (
            <li key={x.provider}>
              <span className={`pill ${x.configured ? 'pill-running' : 'pill-idle'}`}>{x.configured ? 'ready' : 'not set'}</span>
              <span className="br-mem-fact">{x.provider} · {x.model}</span>
              <span className="cx-sub">{x.free ? 'free tier — used first' : 'paid — only where you set it as an agent engine'}</span>
            </li>
          ))}
        </ul>
        <p className="ai-note">Plan → Gemini, phir Groq. Checks → Groq (fast), phir Gemini. Agent steps → us agent ka apna engine, phir free engines. Keys: Settings → API keys.</p>
      </Card>
      <Card title="Delivery connectors (free)">
        <ul className="br-mem">
          {status.connectors.map((c) => (
            <li key={c.id}>
              <span className={`pill ${c.configured ? 'pill-running' : 'pill-idle'}`}>{c.configured ? 'key set' : 'not connected'}</span>
              <span className="br-mem-fact">{c.name}{c.detail ? ` · ${c.detail}` : ''}</span>
              <span className="cx-sub">{c.configured ? tests[c.id] ?? 'Test se confirm kijiye' : `Needs ${c.missing.join(', ')}`}</span>
              {c.configured && <span className="br-mem-act"><button className="btn btn-small" onClick={() => test(c.id)}>Test</button></span>}
            </li>
          ))}
        </ul>
        <p className="ai-note">Sirf wahi destinations use hote hain jo aap mission approve karte waqt tick karte ho. Setup steps: docs/BRAIN.md.</p>
      </Card>
    </div>
  );
}
