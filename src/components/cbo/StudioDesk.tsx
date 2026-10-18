// Owner's desk: ChatGPT-style CBO chat, decisions grouped by agent (Approve / Decline with the
// agent's output one tap away) and finished work. All data is live from the Worker.
import { BatchUpload, InlineRename, nameFromFile } from '../BatchUpload';
import { FlowPack } from './FlowPack';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, base, getToken, AUTH_EVENT } from '../../services/adminService';
import { Card, EmptyState, formatWhen } from '../ui';
import { agentName } from '../../data/agentsMeta';
import { SheetThumb } from '../SheetThumb';
import { Markdown } from '../Markdown';

/* ---------------- shared ---------------- */
function useLive<T>(path: string, every = 60_000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!getToken()) return setError('locked');
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, [path]);
  useEffect(() => {
    load();
    const t = setInterval(load, every);
    window.addEventListener(AUTH_EVENT, load);
    return () => {
      clearInterval(t);
      window.removeEventListener(AUTH_EVENT, load);
    };
  }, [load, every]);
  return { data, error, load };
}

function OutputViewer({ artifactId, onClose }: { artifactId: string; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<{ content: { deliverable?: string; summary?: string } }>(`/api/artifacts/${artifactId}`)
      .then((a) => setText(a.content.deliverable ?? a.content.summary ?? JSON.stringify(a.content, null, 2)))
      .catch((e) => setErr(e instanceof Error ? e.message : 'Failed'));
  }, [artifactId]);
  return (
    <div className="sd-output">
      <div className="sd-output-head">
        <strong>Agent output</strong>
        <button className="btn btn-small" onClick={onClose}>Close</button>
      </div>
      {err ? <p className="form-error">{err}</p> : text === null ? <p className="cx-sub">Loading…</p> : <pre className="sd-pre">{text}</pre>}
    </div>
  );
}

/* ---------------- CBO chat ---------------- */
interface ChatAction { type: 'start_goal'; template: string; title: string; goal: string }
interface Msg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  engine?: string | null;
  model?: string | null;
  created_at: string;
  thoughts?: string | null;
  sources?: { url: string; title: string }[];
  action?: ChatAction | null;
  mode?: { think?: boolean; research?: boolean; image?: boolean; fallback?: string | null; requestId?: string | null; incomplete?: string | null } | null;
}
interface Engine { id: 'gemini' | 'openai'; name: string; available: boolean; note: string; think?: boolean; research?: boolean; images?: boolean; stream?: boolean }
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Reads the Worker's server-sent events: `delta` while ChatGPT writes, then `done` or `error`. */
async function streamChat(body: object, onDelta: (t: string) => void): Promise<Msg> {
  const res = await fetch(`${base()}/api/cbo/chat`, { method: 'POST', cache: 'no-store', headers: { authorization: `Bearer ${getToken()}`, 'content-type': 'application/json' }, body: JSON.stringify({ ...body, stream: true }) });
  if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = /^event: (\w+)/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1];
      if (!ev || !data) continue;
      const d = JSON.parse(data);
      if (ev === 'delta') onDelta(d.t);
      else if (ev === 'done') return d.reply as Msg;
      else if (ev === 'error') throw new Error(d.error ?? 'Chat failed');
    }
  }
  throw new Error('Connection closed before the reply finished');
}
const readPref = (k: string) => {
  try {
    return localStorage.getItem(k) === '1';
  } catch {
    return false;
  }
};
const writePref = (k: string, v: boolean) => {
  try {
    localStorage.setItem(k, v ? '1' : '0');
  } catch {
    /* ignore */
  }
};
const CHAT_IDEAS = ['Aaj mujhe kya karna chahiye?', 'Kaun se approvals pending hain?', 'Is mahine ka kharcha kitna hua?', 'LittleLoop ke liye 3 reel ideas do'];

export function CboChat({ compact = false, title = 'Chat with GANESHA CBO' }: { compact?: boolean; title?: string } = {}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [engines, setEngines] = useState<Engine[]>([]);
  const [engine, setEngine] = useState<'gemini' | 'openai'>('gemini');
  const [think, setThink] = useState(() => readPref('gas.chat.think'));
  const [research, setResearch] = useState(() => readPref('gas.chat.research'));
  const [started, setStarted] = useState<Record<string, string>>({});
  const [text, setText] = useState('');
  const [image, setImage] = useState<{ url: string; name: string } | null>(null);
  const [live, setLive] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [locked, setLocked] = useState(!getToken());
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!getToken()) return setLocked(true);
    setLocked(false);
    try {
      const r = await api<{ engines: Engine[]; messages: Msg[] }>('/api/cbo/chat');
      setEngines(r.engines);
      setMsgs(r.messages);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load chat');
    }
  }, []);
  useEffect(() => {
    load();
    window.addEventListener(AUTH_EVENT, load);
    return () => window.removeEventListener(AUTH_EVENT, load);
  }, [load]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [msgs, busy, live]);

  const current = engines.find((x) => x.id === engine);
  const send = async (e?: FormEvent, t = text) => {
    e?.preventDefault();
    const m = t.trim();
    if (!m || busy) return;
    setBusy(true);
    setError(null);
    setText('');
    const img = current?.images ? image : null;
    setImage(null);
    setMsgs((x) => [...x, { id: `tmp-${Date.now()}`, role: 'user', content: img ? `${m}\n\n_(image attached)_` : m, created_at: new Date().toISOString() }]);
    const payload = { message: m, engine, think: think && Boolean(current?.think), research: research && Boolean(current?.research), image: img?.url ?? null };
    try {
      if (current?.stream) {
        setLive('');
        const reply = await streamChat(payload, (t) => setLive((x) => (x ?? '') + t));
        setMsgs((x) => [...x, reply]);
      } else {
        const r = await api<{ reply: Msg }>('/api/cbo/chat', { method: 'POST', body: JSON.stringify(payload) });
        setMsgs((x) => [...x, r.reply]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLive(null);
      setBusy(false);
    }
  };

  const pickImage = (file: File | undefined) => {
    if (imgRef.current) imgRef.current.value = '';
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return setError('Image must be PNG, JPEG, WebP or GIF.');
    if (file.size > MAX_IMAGE_BYTES) return setError('Image must be under 5 MB.');
    const r = new FileReader();
    r.onload = () => setImage({ url: String(r.result), name: file.name });
    r.onerror = () => setError('Could not read that image.');
    r.readAsDataURL(file);
  };

  const startGoal = async (m: Msg) => {
    const a = m.action!;
    setStarted((x) => ({ ...x, [m.id]: 'starting' }));
    try {
      await api('/api/workflows', { method: 'POST', headers: { 'idempotency-key': `chat-${m.id}` }, body: JSON.stringify({ template: a.template, title: a.title, goal: a.goal }) });
      setStarted((x) => ({ ...x, [m.id]: 'started' }));
      window.dispatchEvent(new Event('ganesha:goal-created'));
    } catch (e) {
      setStarted((x) => ({ ...x, [m.id]: `failed: ${e instanceof Error ? e.message : 'error'}` }));
    }
  };

  const clear = async () => {
    if (!window.confirm('Clear the whole chat?')) return;
    await api('/api/cbo/chat', { method: 'DELETE' }).catch(() => {});
    setMsgs([]);
  };

  const attachSheet = async (file: File | undefined) => {
    if (!file) return;
    const name = window.prompt('Sheet ka naam? (file ke naam se bhara hai — badal sakte ho)', nameFromFile(file.name))?.trim();
    if (!name) return;
    setNotice(null);
    try {
      const q = new URLSearchParams({ name });
      const res = await fetch(`${base()}/api/reels/sheets?${q}`, { method: 'POST', headers: { authorization: `Bearer ${getToken()}`, 'content-type': file.type }, body: file });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
      setNotice(`✅ ${name} ki character sheet LittleLoop rotation mein add ho gayi. Renderer ise ~30 min mein padh lega.`);
    } catch (e) {
      setNotice(`Upload failed: ${e instanceof Error ? e.message : 'error'}`);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  if (locked) return <Card title={title} className={compact ? 'sd-chat sd-compact' : ''}><EmptyState title="Unlock the studio to chat" hint="Bell → Unlock with your admin token." /></Card>;

  return (
    <Card
      title={title}
      className={compact ? 'sd-chat sd-compact' : 'sd-chat'}
      action={
        <div className="sd-chat-tools">
          <select value={engine} onChange={(e) => setEngine(e.target.value as 'gemini' | 'openai')} aria-label="AI engine">
            {engines.map((x) => (
              <option key={x.id} value={x.id} disabled={!x.available}>
                {x.name}{x.available ? '' : ' (needs API key)'}
              </option>
            ))}
          </select>
          {msgs.length > 0 && <button className="btn btn-small" onClick={clear}>New chat</button>}
        </div>
      }
    >
      <div className="sd-modes">
        <button type="button" className={`sd-toggle ${think ? 'on' : ''}`} disabled={!current?.think} aria-pressed={think} onClick={() => (setThink(!think), writePref('gas.chat.think', !think))}>
          🧠 Think {think ? 'ON' : 'OFF'}
        </button>
        <button type="button" className={`sd-toggle ${research ? 'on' : ''}`} disabled={!current?.research} aria-pressed={research} onClick={() => (setResearch(!research), writePref('gas.chat.research', !research))}>
          🔎 Research {research ? 'ON' : 'OFF'}
        </button>
        {current && !compact && <span className="cx-sub">{current.name}: {current.note}</span>}
      </div>
      {!compact && <p className="cx-sub">Think = deeper reasoning (slower). Research = live web search with sources ({engine === 'openai' ? 'OpenAI web search, billed per search' : 'Google, first 5,000 searches/month free'}). Ask it to do work and it proposes a goal for the agents — you confirm.</p>}
      <div className="sd-thread" aria-live="polite">
        {msgs.length === 0 && !busy && (
          <div className="sd-ideas">
            {CHAT_IDEAS.map((s) => (
              <button key={s} type="button" className="cx-chip" onClick={() => send(undefined, s)}>{s}</button>
            ))}
          </div>
        )}
        {msgs.map((m) => (
          <div key={m.id} className={`sd-msg sd-${m.role}`}>
            {m.thoughts && (
              <details className="sd-thoughts">
                <summary>🧠 Thought process</summary>
                <p>{m.thoughts}</p>
              </details>
            )}
            <div className="sd-bubble">{m.role === 'assistant' ? <Markdown text={m.content} /> : m.content}</div>
            {m.sources && m.sources.length > 0 && (
              <div className="sd-sources">
                {m.sources.map((x, i) => (
                  <a key={x.url} href={x.url} target="_blank" rel="noreferrer" title={x.url}>[{i + 1}] {x.title}</a>
                ))}
              </div>
            )}
            {m.action && (
              <div className="sd-action">
                <p><strong>Proposed goal:</strong> {m.action.title}</p>
                <p className="cx-sub">{m.action.goal}</p>
                {started[m.id] === 'started' ? (
                  <p className="cx-ok">Started — agents are on it (see Pipelines / Agents).</p>
                ) : (
                  <button className="btn btn-small btn-primary" disabled={started[m.id] === 'starting'} onClick={() => startGoal(m)}>
                    {started[m.id] === 'starting' ? 'Starting…' : 'Start this goal'}
                  </button>
                )}
                {started[m.id]?.startsWith('failed') && <p className="form-error">{started[m.id]}</p>}
              </div>
            )}
            {m.role === 'assistant' && m.model && (
              <span className="sd-meta">
                {m.engine === 'openai' ? 'ChatGPT' : 'Gemini'} · {m.model}
                {m.mode?.think ? ' · thinking' : ''}
                {m.mode?.research ? ' · research' : ''}
                {m.mode?.image ? ' · image' : ''}
                {m.mode?.incomplete ? ` · cut off (${m.mode.incomplete})` : ''}
                {m.mode?.requestId ? <span title="OpenAI request ID (for support)"> · {m.mode.requestId}</span> : null}
              </span>
            )}
          </div>
        ))}
        {busy && live ? (
          <div className="sd-msg sd-assistant"><div className="sd-bubble sd-live"><Markdown text={live} /></div></div>
        ) : busy && <div className="sd-msg sd-assistant"><div className="sd-bubble sd-typing">{research ? 'CBO search kar raha hai…' : think ? 'CBO gehraai se soch raha hai…' : 'CBO soch raha hai…'}</div></div>}
        <div ref={endRef} />
      </div>
      {notice && <p className="drawer-notice" role="status">{notice}</p>}
      {error && <p className="form-error">{error}</p>}
      <form className="sd-compose" onSubmit={send}>
        <label className="sd-attach" title="Upload a LittleLoop character sheet">
          📎<input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => attachSheet(e.target.files?.[0])} />
        </label>
        {current?.images && (
          <label className="sd-attach" title="Ask ChatGPT about an image">
            🖼<input ref={imgRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => pickImage(e.target.files?.[0])} />
          </label>
        )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={compact ? `Message ${title.replace(/^Chat with /, "")}…` : "Message GANESHA CBO…"}
          rows={1}
          maxLength={4000}
        />
        <button className="btn btn-primary" disabled={busy || !text.trim()}>Send</button>
      </form>
      {image && current?.images && (
        <p className="sd-imgchip">
          🖼 {image.name} <button type="button" className="btn btn-small" onClick={() => setImage(null)} aria-label="Remove image">✕</button>
        </p>
      )}
      {!compact && <p className="cx-sub">📎 = LittleLoop character sheet upload.{current?.images ? ' 🖼 = ask ChatGPT about a picture.' : ''} The CBO only advises — approvals and actions stay on their buttons.</p>}
    </Card>
  );
}

/* ---------------- decisions by agent ---------------- */
interface Approval { id: string; action: string; summary: string; created_at: string; workflow_title: string; brand: string; agent_id: string | null; deliverable: string | null; output_artifact: string | null }
interface ReelWaiting { id: string; day: string; slot: number; title: string; caption: string | null; videoUrl: string | null; costUsd: number }

export function AgentDecisions({ title = 'Waiting for your decision · by agent' }: { title?: string }) {
  const { data, error, load } = useLive<{ approvals: Approval[]; reels?: ReelWaiting[] }>('/api/notifications', 45_000);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    setNotice(null);
    try {
      await fn();
      setNotice(done);
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? `Failed: ${e.message}` : 'Failed');
    } finally {
      setBusy(null);
    }
  };
  if (error === 'locked') return <Card title={title}><EmptyState title="Unlock the studio to see decisions" /></Card>;
  if (error) return <Card title={title}><p className="form-error">{error}</p></Card>;
  if (!data) return <Card title={title}><p className="cx-sub">Loading…</p></Card>;

  const groups = new Map<string, Approval[]>();
  for (const a of data.approvals) {
    const k = a.agent_id ?? 'unknown';
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  const reelsWaiting = data.reels ?? [];
  const empty = !data.approvals.length && !reelsWaiting.length;

  return (
    <Card title={title} action={<button className="btn btn-small" onClick={load}>Refresh</button>}>
      {notice && <p className="drawer-notice" role="status">{notice}</p>}
      {empty && <EmptyState title="Kuch pending nahi hai." hint="Agents jab kuch publish / spend / deploy karna chahenge, woh yahan aayega." />}
      {[...groups.entries()].map(([agent, items]) => (
        <div key={agent} className="sd-agent">
          <p className="sd-agent-name"><span className="sd-avatar">{agentName(agent).charAt(0)}</span>{agentName(agent)} <span className="cx-sub">· {items.length} waiting</span></p>
          {items.map((a) => (
            <article key={a.id} className="sd-item">
              <p><strong>{a.workflow_title}</strong> <span className="cx-sub">· {a.brand} · {a.action.replace(/^budget:/, 'budget: ')} · {formatWhen(a.created_at)}</span></p>
              <p className="cx-sub">{a.summary}</p>
              <div className="nt-actions">
                {a.output_artifact && <button className="btn btn-small" onClick={() => setOpen(open === a.id ? null : a.id)}>{open === a.id ? 'Hide output' : 'View output'}</button>}
                <button className="btn btn-small btn-primary" disabled={busy === a.id} onClick={() => act(a.id, () => api(`/api/approvals/${a.id}`, { method: 'POST', body: JSON.stringify({ decision: 'approved' }) }), `Approved: ${a.workflow_title}`)}>Approve</button>
                <button className="btn btn-small" disabled={busy === a.id} onClick={() => act(a.id, () => api(`/api/approvals/${a.id}`, { method: 'POST', body: JSON.stringify({ decision: 'rejected' }) }), `Declined: ${a.workflow_title}`)}>Decline</button>
              </div>
              {open === a.id && a.output_artifact && <OutputViewer artifactId={a.output_artifact} onClose={() => setOpen(null)} />}
            </article>
          ))}
        </div>
      ))}
      {reelsWaiting.length > 0 && (
        <div className="sd-agent">
          <p className="sd-agent-name"><span className="sd-avatar">L</span>LittleLoop Reel Factory <span className="cx-sub">· {reelsWaiting.length} reel(s) to post</span></p>
          {reelsWaiting.map((r) => (
            <article key={r.id} className="sd-item sd-reel">
              {r.videoUrl && <video className="rf-video" src={r.videoUrl} controls playsInline preload="metadata" />}
              <div>
                <p><strong>{r.title}</strong> <span className="cx-sub">· {r.day} #{r.slot}</span></p>
                {r.caption && <p className="cx-sub">{r.caption}</p>}
                <div className="nt-actions">
                  <button className="btn btn-small btn-primary" disabled={busy === r.id} onClick={() => act(r.id, () => api(`/api/reels/${r.id}/approve`, { method: 'POST', body: '{}' }), `Approved: ${r.title} — posting to Instagram`)}>Approve & post</button>
                  <button className="btn btn-small" disabled={busy === r.id} onClick={() => act(r.id, () => api(`/api/reels/${r.id}/reject`, { method: 'POST', body: '{}' }), `Declined: ${r.title}`)}>Decline</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ---------------- finished work ---------------- */
interface Step { id: string; step_key: string; agent_id: string; deliverable: string; output_artifact: string | null; finished_at: string | null }
interface Goal { id: string; title: string; brand: string; template: string; updated_at: string; steps: Step[] }
interface DoneReel { id: string; day: string; slot: number; status: string; script: { title?: string } | null; videoUrl: string | null; igPermalink: string | null; publishedAt: string | null }

export function FinishedWork() {
  const { data, error } = useLive<{ goals: Goal[]; reels: DoneReel[] }>('/api/finished?limit=20', 120_000);
  const [openGoal, setOpenGoal] = useState<string | null>(null);
  const [flowGoal, setFlowGoal] = useState<string | null>(null);
  const [view, setView] = useState<string | null>(null);
  const title = 'Finished work';
  if (error === 'locked') return <Card title={title}><EmptyState title="Unlock the studio to see finished work" /></Card>;
  if (error) return <Card title={title}><p className="form-error">{error}</p></Card>;
  if (!data) return <Card title={title}><p className="cx-sub">Loading…</p></Card>;
  const empty = !data.goals.length && !data.reels.length;
  return (
    <Card title={title}>
      {empty && <EmptyState title="Abhi tak koi kaam complete nahi hua." hint="Goal ya reel complete hote hi yahan dikhega, output ke saath." />}
      {data.reels.length > 0 && (
        <>
          <h3 className="rf-h">LittleLoop reels</h3>
          <ul className="rf-list">
            {data.reels.map((r) => (
              <li key={r.id}>
                <span className={`pill ${r.status === 'published' ? 'pill-running' : 'pill-warn'}`}>{r.status === 'published' ? 'Posted' : r.status === 'review' ? 'Ready · needs approval' : 'Posting'}</span>
                <span className="rf-li-title">{r.script?.title ?? 'Reel'}</span>
                <span className="cx-sub">{r.day} #{r.slot}</span>
                {r.videoUrl && <a href={r.videoUrl} target="_blank" rel="noreferrer">Watch</a>}
                {r.igPermalink && <a href={r.igPermalink} target="_blank" rel="noreferrer">Instagram</a>}
              </li>
            ))}
          </ul>
        </>
      )}
      {data.goals.length > 0 && (
        <>
          <h3 className="rf-h">Completed goals</h3>
          {data.goals.map((g) => (
            <article key={g.id} className="sd-item">
              <p>
                <span className="pill pill-running">Done</span> <strong>{g.title}</strong> <span className="cx-sub">· {g.brand} · {formatWhen(g.updated_at)} · {g.steps.length} steps</span>
              </p>
              <div className="nt-actions">
                <button className="btn btn-small" onClick={() => setOpenGoal(openGoal === g.id ? null : g.id)}>{openGoal === g.id ? 'Hide steps' : 'View outputs'}</button>
                {g.brand === 'littleloop' && <button className="btn btn-small btn-primary" onClick={() => setFlowGoal(flowGoal === g.id ? null : g.id)}>{flowGoal === g.id ? 'Hide Flow pack' : '🎬 Flow prompt + sheets'}</button>}
              </div>
              {flowGoal === g.id && <FlowPack workflowId={g.id} />}
              {openGoal === g.id && (
                <ul className="sd-steps">
                  {g.steps.map((s) => (
                    <li key={s.id}>
                      <span><strong>{agentName(s.agent_id)}</strong> · {s.deliverable}</span>
                      {s.output_artifact && <button className="btn btn-small" onClick={() => setView(view === s.output_artifact ? null : s.output_artifact)}>Open</button>}
                      {view === s.output_artifact && s.output_artifact && <OutputViewer artifactId={s.output_artifact} onClose={() => setView(null)} />}
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </>
      )}
    </Card>
  );
}

/* ---------------- simple character sheet upload (name + image) ---------------- */
interface SheetRow { id: string; name: string; detailsStatus: 'pending' | 'ready' | 'error'; active: boolean; useCount: number; details: string | null }

export function SheetUploader() {
  const { data, error, load } = useLive<{ sheets: SheetRow[] }>('/api/reels', 60_000);
  const title = 'Upload character sheets · LittleLoop';
  if (error === 'locked') return <Card title={title}><EmptyState title="Unlock the studio to upload" /></Card>;
  const sheets = data?.sheets ?? [];
  return (
    <Card title={title}>
      <p className="cx-sub">Ek ya kai sheets ek saath chuno. Naam file ke naam se apne aap aa jaata hai — upload se pehle ya baad mein ✏️ se badal sakte ho. Ganesha har sheet padh kar characters ki details khud likh leta hai aur roz rotation mein use karta hai.</p>
      <BatchUpload
        accept="image/png,image/jpeg,image/webp"
        allowed={(f) => ['image/png', 'image/jpeg', 'image/webp'].includes(f.type)}
        maxBytes={8 * 1024 * 1024}
        maxLabel="8 MB"
        takenNames={sheets.map((s) => s.name)}
        endpoint={(name) => `/api/reels/sheets?${new URLSearchParams({ name })}`}
        label="🖼 Choose sheet images"
        button="Upload sheets"
        onUploaded={load}
      />
      {error && <p className="form-error">{error}</p>}
      {sheets.length > 0 && (
        <div className="rf-sheets">
          {sheets.map((s) => (
            <div key={s.id} className={`rf-sheet ${s.active ? '' : 'rf-off'}`}>
              <SheetThumb id={s.id} name={s.name} />
              <InlineRename name={s.name} path={`/api/reels/sheets/${s.id}`} onSaved={() => load()} />
              <p className="cx-sub">{s.detailsStatus === 'ready' ? `Ready · used ${s.useCount}×` : s.detailsStatus === 'pending' ? 'Reading the sheet…' : 'Could not read'}</p>
              {s.detailsStatus === 'error' && <p className="rf-err">{s.details}</p>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ---------------- Instagram connect ---------------- */
interface IgStatus { connected: boolean; via: 'worker_secret' | 'connect_button' | null; problem?: string | null; username: string | null; accountId?: string | null; expiresAt: string | null; connectedAt?: string | null; appConfigured: boolean; missing?: string[]; redirectUri: string }

export function InstagramConnect({ compact = false }: { compact?: boolean }) {
  const { data, error, load } = useLive<IgStatus>('/api/instagram', 120_000);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const connect = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ url: string }>('/api/instagram/connect', { method: 'POST', body: '{}' });
      window.location.href = r.url;
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed');
      setBusy(false);
    }
  };
  const disconnect = async () => {
    if (!window.confirm('Disconnect Instagram? Approved reels will stop posting until you connect again.')) return;
    await api('/api/instagram', { method: 'DELETE' }).catch(() => {});
    load();
  };
  if (error === 'locked') return null;
  if (error) return <p className="form-error">Instagram: {error}</p>;
  if (!data) return null;
  if (data.connected)
    return (
      <div className="sd-ig ok">
        <span>📸 Instagram connected{data.username ? ` · @${data.username}` : ''}{data.via === 'worker_secret' ? ' (Worker secret)' : ''}</span>
        {data.expiresAt && <span className="cx-sub">auto-renews · valid till {formatWhen(data.expiresAt)}</span>}
        {data.connectedAt && !compact && <span className="cx-sub">connected {formatWhen(data.connectedAt)}</span>}
        {data.via === 'connect_button' && !compact && (
          <>
            <button className="btn btn-small" disabled={busy} onClick={connect}>Reconnect</button>
            <button className="btn btn-small" onClick={disconnect}>Disconnect</button>
          </>
        )}
      </div>
    );
  return (
    <div className="sd-ig">
      <div className="sd-ig-row">
        <span>📸 <strong>Instagram not connected</strong> — needed to post approved reels and for LittleLoop analytics.</span>
        <button className="btn btn-small btn-primary" disabled={busy || !data.appConfigured} onClick={connect}>{busy ? 'Opening Instagram…' : 'Connect Instagram'}</button>
        {!data.appConfigured && <button className="btn btn-small" onClick={() => setShowSetup(!showSetup)}>{showSetup ? 'Hide setup' : 'One-time setup'}</button>}
      </div>
      {data.problem && <p className="form-error">{data.problem}</p>}
      {!data.appConfigured && (
        <p className="cx-sub">
          Missing in ⚙️ Settings → API keys · Platforms: <strong>{(data.missing ?? ['IG_APP_ID', 'IG_APP_SECRET']).join(' + ')}</strong>. Typing in the box is not enough — press <strong>Save</strong> and wait for the green “Saved” pill.
        </p>
      )}
      <p className="cx-sub">
        Redirect URL for Meta (paste exactly, no slash at the end): <code>{data.redirectUri}</code>{' '}
        <button type="button" className="btn btn-small" onClick={() => navigator.clipboard?.writeText(data.redirectUri).then(() => setMsg('Redirect URL copied.'), () => {})}>Copy</button>
      </p>
      {msg && <p className={msg.endsWith('copied.') ? 'cx-ok' : 'form-error'}>{msg}</p>}
      {!data.appConfigured && showSetup && (
        <ol className="flow sd-ig-steps">
          <li>Instagram app → Settings → Account type → switch <strong>@little_loop09</strong> to <strong>Creator</strong> (free).</li>
          <li>developers.facebook.com → My Apps → Create app → use case <strong>“Manage messaging & content on Instagram”</strong> (Instagram API with Instagram login).</li>
          <li>In the app: Instagram → API setup with Instagram login → <strong>Business login settings</strong> → add redirect URL: <code>{data.redirectUri}</code></li>
          <li>Same page: copy <strong>Instagram app ID</strong> (not the Meta app ID at the top of the dashboard) and <strong>Instagram app secret</strong>. App roles → add @little_loop09 as an Instagram tester and accept it in the Instagram app.</li>
          <li>Ganesha → ⚙️ Settings → <strong>Instagram</strong> keys → paste <code>IG_APP_ID</code> and <code>IG_APP_SECRET</code> → Save. (Stored encrypted; no Cloudflare step needed.)</li>
          <li>Come back here and tap <strong>Connect Instagram</strong>. Token renews itself every ~50 days.</li>
        </ol>
      )}
    </div>
  );
}
