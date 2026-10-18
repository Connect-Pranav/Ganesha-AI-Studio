// Owner's desk: ChatGPT-style CBO chat, decisions grouped by agent (Approve / Decline with the
// agent's output one tap away) and finished work. All data is live from the Worker.
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, base, getToken, AUTH_EVENT } from '../../services/adminService';
import { Card, EmptyState, formatWhen } from '../ui';
import { agentName } from '../../data/agentsMeta';
import { SheetThumb } from '../ReelFactory';

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
interface Msg { id: string; role: 'user' | 'assistant'; content: string; engine?: string | null; model?: string | null; created_at: string }
interface Engine { id: 'gemini' | 'openai'; name: string; available: boolean; note: string }
const CHAT_IDEAS = ['Aaj mujhe kya karna chahiye?', 'Kaun se approvals pending hain?', 'Is mahine ka kharcha kitna hua?', 'LittleLoop ke liye 3 reel ideas do'];

export function CboChat() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [engines, setEngines] = useState<Engine[]>([]);
  const [engine, setEngine] = useState<'gemini' | 'openai'>('gemini');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [locked, setLocked] = useState(!getToken());
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
  useEffect(() => endRef.current?.scrollIntoView({ block: 'nearest' }), [msgs, busy]);

  const send = async (e?: FormEvent, t = text) => {
    e?.preventDefault();
    const m = t.trim();
    if (!m || busy) return;
    setBusy(true);
    setError(null);
    setText('');
    setMsgs((x) => [...x, { id: `tmp-${Date.now()}`, role: 'user', content: m, created_at: new Date().toISOString() }]);
    try {
      const r = await api<{ reply: Msg }>('/api/cbo/chat', { method: 'POST', body: JSON.stringify({ message: m, engine }) });
      setMsgs((x) => [...x, r.reply]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!window.confirm('Clear the whole chat?')) return;
    await api('/api/cbo/chat', { method: 'DELETE' }).catch(() => {});
    setMsgs([]);
  };

  const attachSheet = async (file: File | undefined) => {
    if (!file) return;
    const name = window.prompt('Character ka naam? (e.g. Chiku)')?.trim();
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

  if (locked) return <Card title="Chat with GANESHA CBO"><EmptyState title="Unlock the studio to chat" hint="Bell → Unlock with your admin token." /></Card>;
  const current = engines.find((x) => x.id === engine);

  return (
    <Card
      title="Chat with GANESHA CBO"
      className="sd-chat"
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
      {current && <p className="cx-sub">{current.name}: {current.note}. Answers use your live studio data.</p>}
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
            <div className="sd-bubble">{m.content}</div>
            {m.role === 'assistant' && m.model && <span className="sd-meta">{m.engine === 'openai' ? 'ChatGPT' : 'Gemini'} · {m.model}</span>}
          </div>
        ))}
        {busy && <div className="sd-msg sd-assistant"><div className="sd-bubble sd-typing">CBO soch raha hai…</div></div>}
        <div ref={endRef} />
      </div>
      {notice && <p className="drawer-notice" role="status">{notice}</p>}
      {error && <p className="form-error">{error}</p>}
      <form className="sd-compose" onSubmit={send}>
        <label className="sd-attach" title="Upload a LittleLoop character sheet">
          📎<input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => attachSheet(e.target.files?.[0])} />
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Message GANESHA CBO…"
          rows={1}
          maxLength={4000}
        />
        <button className="btn btn-primary" disabled={busy || !text.trim()}>Send</button>
      </form>
      <p className="cx-sub">📎 = LittleLoop character sheet upload. The CBO only advises — approvals and actions stay on their buttons.</p>
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
              <button className="btn btn-small" onClick={() => setOpenGoal(openGoal === g.id ? null : g.id)}>{openGoal === g.id ? 'Hide steps' : 'View outputs'}</button>
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
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = async (e: FormEvent) => {
    e.preventDefault();
    if (!file || !name.trim()) return setNotice('Sheet ka naam aur image dono chahiye.');
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`${base()}/api/reels/sheets?${new URLSearchParams({ name: name.trim() })}`, { method: 'POST', headers: { authorization: `Bearer ${getToken()}`, 'content-type': file.type }, body: file });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
      setNotice(`✅ "${name.trim()}" upload ho gayi. Ganesha ~30 min mein har character ko padh kar unki details khud likh lega.`);
      setName('');
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      load();
    } catch (err) {
      setNotice(`Upload failed: ${err instanceof Error ? err.message : 'error'}`);
    } finally {
      setBusy(false);
    }
  };
  const title = 'Upload character sheet · LittleLoop';
  if (error === 'locked') return <Card title={title}><EmptyState title="Unlock the studio to upload" /></Card>;
  return (
    <Card title={title}>
      <p className="cx-sub">Bas naam aur sheet image. Ek sheet mein ek ya kai characters ho sakte hain — Ganesha khud padh kar har character ki details (look, outfit, expressions) likh leta hai, aur roz rotation mein sheets use karta hai.</p>
      <form className="form sd-upload" onSubmit={upload}>
        <div className="form-row">
          <label>Sheet name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Jungle Expedition cast" /></label>
          <label>Sheet image (PNG/JPG/WebP, max 8 MB)<input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        </div>
        <div className="modal-actions"><button className="btn btn-primary" disabled={busy}>{busy ? 'Uploading…' : 'Upload sheet'}</button></div>
      </form>
      {notice && <p className="drawer-notice" role="status">{notice}</p>}
      {error && <p className="form-error">{error}</p>}
      {data && data.sheets.length > 0 && (
        <div className="rf-sheets">
          {data.sheets.map((s) => (
            <div key={s.id} className={`rf-sheet ${s.active ? '' : 'rf-off'}`}>
              <SheetThumb id={s.id} name={s.name} />
              <p className="nt-title">{s.name}</p>
              <p className="cx-sub">{s.detailsStatus === 'ready' ? `Ready · used ${s.useCount}×` : s.detailsStatus === 'pending' ? 'Reading the sheet…' : 'Could not read'}</p>
              {s.detailsStatus === 'error' && <p className="rf-err">{s.details}</p>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
