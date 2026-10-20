// Talk to one agent: the owner's message is a prayer, the agent answers in its own voice and craft.
// Owner-only (studio unlocked). A proposed goal starts only when the owner presses the button.
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, AUTH_EVENT, getToken } from '../services/adminService';
import { Markdown } from './Markdown';
import { formatWhen } from './ui';
import { BlueprintCard, type Blueprint } from './BlueprintCard';

interface Action { type: 'start_goal'; template: string; title: string; goal: string }
interface Msg { id: string; role: 'user' | 'assistant'; content: string; engine?: string | null; model?: string | null; created_at: string; action: Action | Blueprint | null; sources: { url: string; title: string }[] }

const SUGGEST: Record<string, string[]> = {
  default: ['Aap kya kya kar sakte ho?', 'Aaj ke liye 3 ideas do', 'Mere brand ke liye aapki salah?'],
  mushak_growth: ['Aaj ka status do', 'LittleLoop ke liye 5 kids brands dhoondo aur drafts banao', 'Sunverse ke liye collab artists dhoondo'],
};

export function AgentChat({ agentId, name }: { agentId: string; name: string }) {
  const employee = agentId === 'mushak_growth'; // Mushak talks like an employee, the others like deities of their craft
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [canResearch, setCanResearch] = useState(false);
  const [research, setResearch] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [started, setStarted] = useState<Record<string, string>>({});
  const [locked, setLocked] = useState(!getToken());
  const end = useRef<HTMLDivElement | null>(null);

  const load = useCallback(() => {
    const has = Boolean(getToken());
    setLocked(!has);
    if (!has) return;
    api<{ messages: Msg[]; research: boolean }>(`/api/agent-chat/${agentId}`)
      .then((r) => {
        setMsgs(r.messages);
        setCanResearch(r.research);
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : 'Could not load the conversation'));
  }, [agentId]);
  useEffect(() => {
    load();
    window.addEventListener(AUTH_EVENT, load);
    return () => window.removeEventListener(AUTH_EVENT, load);
  }, [load]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [msgs, busy]);

  const send = async (e?: FormEvent, preset?: string) => {
    e?.preventDefault();
    const message = (preset ?? text).trim();
    if (!message || busy) return;
    setBusy(true);
    setErr(null);
    const temp: Msg = { id: `tmp-${Date.now()}`, role: 'user', content: message, created_at: new Date().toISOString(), action: null, sources: [] };
    setMsgs((m) => [...(m ?? []), temp]);
    setText('');
    try {
      const { reply } = await api<{ reply: Msg }>(`/api/agent-chat/${agentId}`, { method: 'POST', body: JSON.stringify({ message, research }) });
      setMsgs((m) => [...(m ?? []), reply]);
    } catch (e2) {
      setMsgs((m) => (m ?? []).filter((x) => x.id !== temp.id));
      setText(message);
      setErr(e2 instanceof Error ? e2.message : 'No answer');
    } finally {
      setBusy(false);
    }
  };

  const startGoal = async (m: Msg) => {
    if (!m.action || m.action.type !== 'start_goal') return;
    setStarted((s) => ({ ...s, [m.id]: 'starting' }));
    try {
      await api('/api/workflows', { method: 'POST', headers: { 'idempotency-key': `agentchat-${m.id}` }, body: JSON.stringify({ template: m.action.template, title: m.action.title, goal: m.action.goal }) });
      setStarted((s) => ({ ...s, [m.id]: 'started' }));
    } catch (e) {
      setStarted((s) => ({ ...s, [m.id]: `failed: ${e instanceof Error ? e.message : 'error'}` }));
    }
  };

  const clear = async () => {
    if (!window.confirm(`Clear your conversation with ${name}?`)) return;
    await api(`/api/agent-chat/${agentId}`, { method: 'DELETE' }).catch(() => {});
    setMsgs([]);
  };

  if (locked) return <p className="ai-note">Unlock the studio (🔔 bell → Unlock) to talk to {name}.</p>;
  return (
    <div className="ac">
      <div className="ac-log" aria-live="polite">
        {msgs === null ? (
          <p className="ai-note">Loading…</p>
        ) : msgs.length === 0 ? (
          <div className="ac-empty">
            <p>{employee ? `${name} ko command dijiye. Woh blueprint banakar khud chala dega.` : `🙏 Apni prarthana likhiye. ${name} apni kala ke anusaar uttar denge.`}</p>
            <div className="ac-suggest">
              {(SUGGEST[agentId] ?? SUGGEST.default).map((s) => (
                <button key={s} className="cx-chip" onClick={() => send(undefined, s)} disabled={busy}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          msgs.map((m) => (
            <div key={m.id} className={`ac-msg ${m.role}`}>
              <span className="ac-who">{m.role === 'user' ? (employee ? 'You' : '🙏 Your prayer') : employee ? name : `✨ ${name}`}</span>
              <div className="ac-bubble">{m.role === 'assistant' ? <Markdown text={m.content} /> : m.content}</div>
              {m.sources.length > 0 && (
                <div className="sd-sources">
                  {m.sources.map((x, i) => (
                    <a key={x.url} href={x.url} target="_blank" rel="noreferrer">[{i + 1}] {x.title}</a>
                  ))}
                </div>
              )}
              {m.action?.type === 'blueprint' && <BlueprintCard bp={m.action} />}
              {m.action?.type === 'start_goal' && (
                <div className="sd-action">
                  <p><strong>Proposed goal:</strong> {m.action.title}</p>
                  <p className="cx-sub">{m.action.goal}</p>
                  {started[m.id] === 'started' ? (
                    <p className="cx-ok">Started. The agents are on it (Agents → Pipelines).</p>
                  ) : (
                    <button className="btn btn-small btn-primary" disabled={started[m.id] === 'starting'} onClick={() => startGoal(m)}>
                      {started[m.id] === 'starting' ? 'Starting…' : 'Start this goal'}
                    </button>
                  )}
                  {started[m.id]?.startsWith('failed') && <p className="form-error">{started[m.id]}</p>}
                </div>
              )}
              {m.role === 'assistant' && m.model && <span className="sd-meta">{m.engine} · {m.model} · {formatWhen(m.created_at)}</span>}
            </div>
          ))
        )}
        {busy && <div className="ac-msg assistant"><span className="ac-who">{employee ? name : `✨ ${name}`}</span><div className="ac-bubble ac-typing">{employee ? 'kaam par hai… (research mein 1 minute lag sakta hai)' : 'dhyaan mein hain…'}</div></div>}
        <div ref={end} />
      </div>
      {err && <p className="form-error">{err}</p>}
      <form className="ac-form" onSubmit={send}>
        <textarea
          rows={2}
          value={text}
          placeholder={employee ? `${name} ko command dein…` : `${name} se prarthana karein…`}
          maxLength={4000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="btn btn-primary" disabled={busy || !text.trim()}>{busy ? '…' : 'Send'}</button>
      </form>
      <div className="ac-tools">
        {canResearch && (
          <label className="st-check">
            <input type="checkbox" checked={research} onChange={(e) => setResearch(e.target.checked)} /> Web research (Google, cited)
          </label>
        )}
        {msgs && msgs.length > 0 && <button className="gr-link" onClick={clear}>Clear conversation</button>}
        <span className="cx-sub">Agents advise and draft; nothing is posted, sent or spent without your button.</span>
      </div>
    </div>
  );
}
